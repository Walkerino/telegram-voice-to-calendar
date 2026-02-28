import {
  CalendarEventStatus,
  CalendarProvider,
  ConnectionStatus,
  PipelineStatus,
  Prisma,
  UserState
} from "@prisma/client";
import type { Bot, Context } from "grammy";
import { InputFile } from "grammy";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import { createICloudEventFromDraft, type ICloudCredentials } from "@/lib/calendar/icloud";
import { env, requireEnv } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { getEventParser } from "@/lib/parser";
import { buildIcs, buildIcsFilename } from "@/lib/services/ics";
import { getTranscriber } from "@/lib/transcriber";
import { parseAction, buildDraftKeyboard } from "@/lib/telegram/keyboards";
import { renderDraftMessage } from "@/lib/telegram/messages";
import { consumeUserRateLimit } from "@/lib/telegram/rate-limit";
import type { EventDraft } from "@/lib/types/event";
import { logError, logInfo } from "@/lib/utils/log";

const BOT_TOKEN = () => requireEnv("TELEGRAM_BOT_TOKEN");
const DEFAULT_TIMEZONE = "Europe/Warsaw";
const DEFAULT_REMINDER_MINUTES = 30;
const UPCOMING_LIMIT = 10;
const PERSONAL_ICAL_PROVIDER = CalendarProvider.icloud;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

export function registerHandlers(bot: Bot<Context>): void {
  bot.command("start", async (ctx) => {
    const user = await ensureUser(ctx);
    await ctx.reply(
      [
        "Привет! Я превращаю голосовые в события календаря.",
        "Пример: Встреча завтра в 18:30 на час.",
        `Текущая таймзона: ${user.timezone}`,
        `Напоминание по умолчанию: ${formatReminderValue(user.defaultReminderMinutes)}`,
        "Полный список команд: /help"
      ].join("\n")
    );
  });

  bot.command("help", async (ctx) => {
    await ensureUser(ctx);
    await ctx.reply(buildHelpMessage());
  });

  bot.command("timezone", async (ctx) => {
    const user = await ensureUser(ctx);
    const text = ctx.message?.text ?? "";
    const nextTimezone = extractCommandArg(text, "timezone");

    if (!nextTimezone) {
      await ctx.reply(`Текущая таймзона: ${user.timezone}`);
      return;
    }

    const check = DateTime.now().setZone(nextTimezone);
    if (!check.isValid) {
      await ctx.reply("Некорректная таймзона. Пример: Europe/Warsaw");
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { timezone: nextTimezone }
    });

    await ctx.reply(`Таймзона обновлена: ${nextTimezone}`);
  });

  bot.command("reminder", async (ctx) => {
    const user = await ensureUser(ctx);
    const text = ctx.message?.text ?? "";
    const rawArg = extractCommandArg(text, "reminder");

    if (!rawArg) {
      await ctx.reply(`Текущее напоминание по умолчанию: ${formatReminderValue(user.defaultReminderMinutes)}`);
      return;
    }

    const parsed = parseReminderArg(rawArg);
    if (!parsed.ok) {
      await ctx.reply("Формат: /reminder 10 или /reminder off");
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { defaultReminderMinutes: parsed.value }
    });

    await ctx.reply(`Напоминание по умолчанию обновлено: ${formatReminderValue(parsed.value)}`);
  });

  bot.command("settings", async (ctx) => {
    const user = await ensureUser(ctx);
    const connection = await prisma.calendarConnection.findUnique({
      where: {
        userId_provider: {
          userId: user.id,
          provider: PERSONAL_ICAL_PROVIDER
        }
      }
    });

    const globalICloudEnabled = Boolean(env.ICLOUD_APPLE_ID && env.ICLOUD_APP_SPECIFIC_PASSWORD);
    const connectionLabel = formatICloudConnectionStatus(connection?.status, globalICloudEnabled);

    await ctx.reply(
      [
        `Таймзона: ${user.timezone}`,
        `Напоминание по умолчанию: ${formatReminderValue(user.defaultReminderMinutes)}`,
        `iCloud: ${connectionLabel}`
      ].join("\n")
    );
  });

  bot.command("cancel", async (ctx) => {
    const user = await ensureUser(ctx);
    const cancelled = await cancelActiveDraftForUser(user.id);
    await ctx.reply(cancelled ? "Текущий черновик отменен." : "Активного черновика нет.");
  });

  bot.command("new", async (ctx) => {
    const user = await ensureUser(ctx);
    await cancelActiveDraftForUser(user.id);
    await ctx.reply("Ок, начинаем новый сценарий. Отправьте голосовое сообщение.");
  });

  bot.command("today", async (ctx) => {
    const user = await ensureUser(ctx);
    const now = DateTime.now().setZone(user.timezone);
    const start = now.startOf("day");
    const end = start.plus({ days: 1 });
    const events = await listEvents(user.id, start, end, 20);
    await ctx.reply(renderEventsList("События на сегодня", events, user.timezone));
  });

  bot.command("upcoming", async (ctx) => {
    const user = await ensureUser(ctx);
    const now = DateTime.now().setZone(user.timezone);
    const events = await listEvents(user.id, now, null, UPCOMING_LIMIT);
    await ctx.reply(renderEventsList(`Ближайшие ${UPCOMING_LIMIT} событий`, events, user.timezone));
  });

  bot.command("connect_icloud", async (ctx) => {
    const user = await ensureUser(ctx);
    const text = ctx.message?.text ?? "";
    const rawArg = extractCommandArg(text, "connect_icloud");
    const usage = "Формат: /connect_icloud your_apple_id@example.com xxxx-xxxx-xxxx-xxxx";

    if (!rawArg) {
      await ctx.reply(`${usage}\nПароль: app-specific password из Apple ID.`);
      return;
    }

    if (!env.ENCRYPTION_KEY.trim()) {
      await ctx.reply("Невозможно сохранить ключи: задайте ENCRYPTION_KEY в .env и перезапустите бота.");
      return;
    }

    const [appleIdRaw, appPasswordRaw] = rawArg.split(/\s+/u);
    const appleId = (appleIdRaw ?? "").trim();
    const appPassword = (appPasswordRaw ?? "").trim();

    if (!appleId || !appPassword || !appleId.includes("@")) {
      await ctx.reply(usage);
      return;
    }

    const encryptedAppPassword = encryptSecret(appPassword, env.ENCRYPTION_KEY);

    await prisma.calendarConnection.upsert({
      where: {
        userId_provider: {
          userId: user.id,
          provider: PERSONAL_ICAL_PROVIDER
        }
      },
      create: {
        userId: user.id,
        provider: PERSONAL_ICAL_PROVIDER,
        appleId,
        encryptedAppPassword,
        encryptedSecret: encryptedAppPassword,
        isActive: true,
        status: ConnectionStatus.connected
      },
      update: {
        appleId,
        encryptedAppPassword,
        encryptedSecret: encryptedAppPassword,
        isActive: true,
        status: ConnectionStatus.connected
      }
    });

    await ctx.reply("Персональное подключение iCloud сохранено.");
  });

  bot.command("disconnect_icloud", async (ctx) => {
    const user = await ensureUser(ctx);

    await prisma.calendarConnection.upsert({
      where: {
        userId_provider: {
          userId: user.id,
          provider: PERSONAL_ICAL_PROVIDER
        }
      },
      create: {
        userId: user.id,
        provider: PERSONAL_ICAL_PROVIDER,
        isActive: false,
        status: ConnectionStatus.disconnected
      },
      update: {
        appleId: null,
        encryptedAppPassword: null,
        encryptedSecret: null,
        isActive: false,
        status: ConnectionStatus.disconnected
      }
    });

    await ctx.reply("Персональное подключение iCloud отключено.");
  });

  bot.command("feedback", async (ctx) => {
    const user = await ensureUser(ctx);
    const text = ctx.message?.text ?? "";
    const feedback = extractCommandArg(text, "feedback");

    if (!feedback) {
      await ctx.reply("Напишите отзыв так: /feedback текст вашего сообщения");
      return;
    }

    logInfo("telegram feedback", {
      userId: user.id,
      telegramUserId: user.telegramUserId,
      feedbackLength: feedback.length
    });

    await ctx.reply("Спасибо! Отзыв сохранен.");
  });

  bot.on("message:voice", async (ctx) => {
    const from = ctx.from;
    const voice = ctx.message?.voice;
    const chatId = ctx.chat?.id;

    if (!from || !voice || !chatId) {
      return;
    }

    const user = await ensureUser(ctx);
    const rate = consumeUserRateLimit(user.id);
    if (!rate.ok) {
      await ctx.reply(`Слишком много сообщений. Повторите через ${rate.retryAfterSeconds} сек.`);
      return;
    }

    const telegramChatId = String(chatId);
    const telegramMessageId = ctx.message.message_id;

    const existingMessage = await prisma.message.findUnique({
      where: {
        telegramChatId_telegramMessageId: {
          telegramChatId,
          telegramMessageId
        }
      }
    });

    if (existingMessage) {
      await ctx.reply("Это голосовое уже обработано.");
      return;
    }

    const dbMessage = await prisma.message.create({
      data: {
        userId: user.id,
        telegramChatId,
        telegramMessageId,
        telegramUpdateId: ctx.update.update_id,
        voiceFileId: voice.file_id,
        status: PipelineStatus.received,
        itemType: "event"
      }
    });

    try {
      const file = await ctx.api.getFile(voice.file_id);
      if (!file.file_path) {
        throw new Error("Telegram file path missing");
      }

      const audioBuffer = await downloadTelegramFile(file.file_path);
      const transcriber = getTranscriber();
      const transcriptResult = await transcriber.transcribe({
        audio: audioBuffer,
        mimeType: "audio/ogg",
        fileName: "voice.ogg"
      });

      const transcript = transcriptResult.text.trim();
      if (!transcript) {
        throw new Error("Transcriber returned empty text");
      }

      await prisma.message.update({
        where: { id: dbMessage.id },
        data: {
          transcript,
          rawText: transcript,
          status: PipelineStatus.transcribed,
          itemType: "event"
        }
      });

      const parser = getEventParser();
      const parseResult = await parser.parse({
        text: transcript,
        timezone: user.timezone
      });

      if (!parseResult.draft) {
        await prisma.$transaction([
          prisma.message.update({
            where: { id: dbMessage.id },
            data: {
              status: PipelineStatus.parsed,
              parsedJson: {
                question: parseResult.question ?? "Нужно уточнение по событию.",
                clarificationsAsked: 1
              }
            }
          }),
          prisma.user.update({
            where: { id: user.id },
            data: {
              state: UserState.awaiting_edit,
              currentDraftMessageId: dbMessage.id
            }
          })
        ]);

        await ctx.reply(`${parseResult.question ?? "Нужно уточнение по событию."}\nОтветьте одной строкой.`);
        return;
      }

      const draft = applyReminderPreference(parseResult.draft, user.defaultReminderMinutes);

      await prisma.message.update({
        where: { id: dbMessage.id },
        data: {
          status: PipelineStatus.awaiting_confirmation,
          draftJson: toJsonDraft(draft),
          parsedJson: Prisma.DbNull,
          itemType: "event"
        }
      });

      await ctx.reply(renderDraftMessage(transcript, draft), {
        reply_markup: buildDraftKeyboard(dbMessage.id)
      });
    } catch (error) {
      await prisma.message.update({
        where: { id: dbMessage.id },
        data: {
          status: PipelineStatus.failed,
          lastError: toSafeError(error)
        }
      });

      await ctx.reply("Не удалось обработать голосовое. Попробуйте еще раз.");
      logError("voice pipeline failed", {
        messageId: dbMessage.id,
        reason: toSafeError(error)
      });
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const payload = parseAction(ctx.callbackQuery.data);
    if (!payload || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }

    const user = await ensureUser(ctx);
    const message = await prisma.message.findFirst({
      where: {
        id: payload.messageId,
        userId: user.id
      }
    });

    if (!message) {
      await ctx.answerCallbackQuery({ text: "Черновик не найден" });
      return;
    }

    if (payload.action === "cancel") {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: PipelineStatus.cancelled }
      });

      if (user.currentDraftMessageId === message.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            state: UserState.idle,
            currentDraftMessageId: null
          }
        });
      }

      await ctx.answerCallbackQuery({ text: "Отменено" });
      await safeRemoveInlineKeyboard(ctx);
      await ctx.reply("Черновик отменен.");
      return;
    }

    if (payload.action === "edit") {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          state: UserState.awaiting_edit,
          currentDraftMessageId: message.id
        }
      });

      await ctx.answerCallbackQuery({ text: "Жду исправления" });
      await ctx.reply("Напишите исправления одной строкой.");
      return;
    }

    if (message.status === PipelineStatus.created) {
      await ctx.answerCallbackQuery({ text: "Событие уже создано" });
      return;
    }
    if (message.status === PipelineStatus.cancelled) {
      await ctx.answerCallbackQuery({ text: "Черновик был отменен" });
      await safeRemoveInlineKeyboard(ctx);
      return;
    }

    if (!message.draftJson) {
      await ctx.answerCallbackQuery({ text: "Нет данных события" });
      return;
    }

    const draft = message.draftJson as unknown as EventDraft;
    const uid = `tg-${user.telegramUserId}-${message.telegramMessageId}`;

    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.message.findUnique({ where: { id: message.id } });
        if (!fresh) {
          throw new Error("Draft message not found");
        }
        if (fresh.status === PipelineStatus.created) {
          return;
        }

        await tx.event.create({
          data: {
            userId: user.id,
            messageId: message.id,
            uid,
            title: draft.title,
            description: draft.description,
            location: draft.location,
            startAt: new Date(draft.start),
            endAt: new Date(draft.end),
            timezone: draft.timezone,
            reminders: toJsonReminders(draft.reminders)
          }
        });

        await tx.calendarEvent.upsert({
          where: { uid },
          create: {
            userId: user.id,
            inboxItemId: message.id,
            uid,
            title: draft.title,
            location: draft.location,
            startAt: new Date(draft.start),
            endAt: new Date(draft.end),
            status: CalendarEventStatus.created,
            providerMeta: {
              timezone: draft.timezone
            }
          },
          update: {
            title: draft.title,
            location: draft.location,
            startAt: new Date(draft.start),
            endAt: new Date(draft.end),
            status: CalendarEventStatus.created
          }
        });

        await tx.message.update({
          where: { id: message.id },
          data: { status: PipelineStatus.created }
        });

        if (user.currentDraftMessageId === message.id) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              state: UserState.idle,
              currentDraftMessageId: null
            }
          });
        }
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        await ctx.answerCallbackQuery({ text: "Ошибка создания" });
        logError("event creation failed", { messageId: message.id, reason: toSafeError(error) });
        return;
      }
    }

    const iCloudConfig = await resolveICloudConfig(user.id);
    const hasICloudConfig = Boolean(iCloudConfig);
    let syncedToICloud = false;
    let iCloudSyncError: string | null = null;

    if (iCloudConfig) {
      try {
        const syncResult = await createICloudEventFromDraft({
          uid,
          draft,
          calendarName: env.ICLOUD_CALENDAR_NAME || undefined,
          credentials: iCloudConfig.credentials
        });

        syncedToICloud = true;
        await prisma.calendarEvent.updateMany({
          where: { uid },
          data: {
            status: CalendarEventStatus.synced,
            createdInIcloud: true,
            providerMeta: {
              source: iCloudConfig.source,
              eventUrl: syncResult.eventUrl,
              calendarUrl: syncResult.calendarUrl,
              principalUrl: syncResult.principalUrl,
              etag: syncResult.etag ?? null
            }
          }
        });
      } catch (error) {
        iCloudSyncError = toSafeError(error);
        logError("icloud sync failed", {
          messageId: message.id,
          reason: iCloudSyncError
        });

        await prisma.calendarEvent.updateMany({
          where: { uid },
          data: {
            status: CalendarEventStatus.failed,
            createdInIcloud: false,
            providerMeta: {
              syncError: iCloudSyncError
            }
          }
        });
      }
    }

    if (syncedToICloud) {
      await ctx.answerCallbackQuery({ text: "Событие добавлено в iCloud" });
      const updated = await safeEditDraftMessage(
        ctx,
        `${renderDraftMessage(message.transcript ?? "", draft)}\n\n✅ Событие создано и автоматически добавлено в iCloud Calendar.`
      );
      if (!updated) {
        await safeRemoveInlineKeyboard(ctx);
        await ctx.reply("Событие создано и автоматически добавлено в iCloud Calendar.");
      }
      return;
    }

    const ics = buildIcs({ uid, draft });
    const fileName = buildIcsFilename(draft.start, "event");

    await ctx.api.sendDocument(
      ctx.callbackQuery?.message?.chat.id ?? ctx.from.id,
      new InputFile(Buffer.from(ics, "utf-8"), fileName),
      {
        caption: hasICloudConfig
          ? "Событие создано. Не удалось добавить в iCloud автоматически, отправляю .ics как запасной вариант."
          : "Событие создано. Подключите iCloud через /connect_icloud или .env, чтобы добавлять автоматически."
      }
    );

    await ctx.answerCallbackQuery({
      text: hasICloudConfig && iCloudSyncError ? "iCloud недоступен, отправлен .ics" : "Событие создано"
    });
    await safeRemoveInlineKeyboard(ctx);
  });

  bot.on("message:text", async (ctx) => {
    const from = ctx.from;
    const text = ctx.message?.text?.trim();

    if (!from || !text || text.startsWith("/")) {
      return;
    }

    const user = await ensureUser(ctx);
    const rate = consumeUserRateLimit(user.id);
    if (!rate.ok) {
      await ctx.reply(`Слишком много сообщений. Повторите через ${rate.retryAfterSeconds} сек.`);
      return;
    }

    if (user.state !== UserState.awaiting_edit || !user.currentDraftMessageId) {
      await ctx.reply("Отправьте голосовое сообщение для создания события.");
      return;
    }

    const message = await prisma.message.findFirst({
      where: {
        id: user.currentDraftMessageId,
        userId: user.id
      }
    });

    if (!message) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          state: UserState.idle,
          currentDraftMessageId: null
        }
      });
      await ctx.reply("Черновик не найден. Отправьте новое голосовое.");
      return;
    }

    const baseText = message.transcript ?? "";
    const mergedText = `${baseText} ${text}`.trim();

    const parser = getEventParser();
    const parseResult = await parser.parse({
      text: mergedText,
      timezone: user.timezone
    });

    if (!parseResult.draft) {
      const clarificationsAsked = getClarificationsAsked(message.parsedJson);

      if (clarificationsAsked >= 1) {
        await prisma.$transaction([
          prisma.message.update({
            where: { id: message.id },
            data: {
              status: PipelineStatus.cancelled,
              parsedJson: {
                question: parseResult.question ?? "Недостаточно данных для события"
              }
            }
          }),
          prisma.user.update({
            where: { id: user.id },
            data: {
              state: UserState.idle,
              currentDraftMessageId: null
            }
          })
        ]);

        await ctx.reply("Не удалось уточнить событие. Отправьте новое голосовое с датой и временем.");
        return;
      }

      await prisma.message.update({
        where: { id: message.id },
        data: {
          transcript: mergedText,
          rawText: mergedText,
          parsedJson: {
            question: parseResult.question ?? "Нужно уточнение",
            clarificationsAsked: clarificationsAsked + 1
          },
          status: PipelineStatus.parsed
        }
      });

      await ctx.reply(`${parseResult.question ?? "Нужно уточнение."}\nОтветьте одной строкой.`);
      return;
    }

    const draft = applyReminderPreference(parseResult.draft, user.defaultReminderMinutes);

    await prisma.$transaction([
      prisma.message.update({
        where: { id: message.id },
        data: {
          transcript: mergedText,
          rawText: mergedText,
          draftJson: toJsonDraft(draft),
          status: PipelineStatus.awaiting_confirmation,
          itemType: "event"
        }
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          state: UserState.idle,
          currentDraftMessageId: null
        }
      })
    ]);

    await ctx.reply(renderDraftMessage(mergedText, draft), {
      reply_markup: buildDraftKeyboard(message.id)
    });
  });
}

async function ensureUser(ctx: Context) {
  if (!ctx.from) {
    throw new Error("Telegram user is missing");
  }

  return prisma.user.upsert({
    where: {
      telegramUserId: String(ctx.from.id)
    },
    create: {
      telegramUserId: String(ctx.from.id),
      telegramUsername: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      languageCode: ctx.from.language_code,
      timezone: DEFAULT_TIMEZONE,
      defaultReminderMinutes: DEFAULT_REMINDER_MINUTES
    },
    update: {
      telegramUsername: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      languageCode: ctx.from.language_code
    }
  });
}

async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const token = BOT_TOKEN();
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download telegram file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getClarificationsAsked(value: Prisma.JsonValue | null): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  const raw = (value as Record<string, unknown>).clarificationsAsked;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return 0;
  }

  return Math.trunc(raw);
}

function toSafeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 300);
  }
  return "Unknown error";
}

async function safeRemoveInlineKeyboard(ctx: Context): Promise<void> {
  try {
    if (ctx.callbackQuery?.message) {
      await ctx.api.editMessageReplyMarkup(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id, {
        reply_markup: undefined
      });
    }
  } catch {
    // ignore
  }
}

async function safeEditDraftMessage(ctx: Context, text: string): Promise<boolean> {
  try {
    if (!ctx.callbackQuery?.message) {
      return false;
    }

    await ctx.api.editMessageText(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id, text, {
      reply_markup: undefined
    });
    return true;
  } catch {
    return false;
  }
}

function toJsonDraft(draft: EventDraft): Prisma.InputJsonValue {
  return {
    title: draft.title,
    description: draft.description ?? null,
    location: draft.location ?? null,
    start: draft.start,
    end: draft.end,
    timezone: draft.timezone,
    reminders: draft.reminders.map((r) => ({ minutesBefore: r.minutesBefore })),
    confidence: draft.confidence,
    questions: draft.questions ?? []
  };
}

function toJsonReminders(reminders: EventDraft["reminders"]): Prisma.InputJsonValue {
  return reminders.map((r) => ({ minutesBefore: r.minutesBefore }));
}

function buildHelpMessage(): string {
  return [
    "Команды:",
    "/start - старт и краткая инструкция",
    "/help - список всех команд",
    "/timezone [Zone] - показать или изменить таймзону",
    "/reminder [минуты|off] - напоминание по умолчанию",
    "/settings - текущие настройки",
    "/today - события на сегодня",
    "/upcoming - ближайшие события",
    "/new - начать новый сценарий",
    "/cancel - отменить активный черновик",
    "/connect_icloud <apple_id> <app_password> - персональный iCloud",
    "/disconnect_icloud - отключить персональный iCloud",
    "/feedback <текст> - отправить отзыв"
  ].join("\n");
}

function extractCommandArg(text: string, command: string): string {
  const pattern = new RegExp(`^\\/${command}(?:@\\w+)?\\s*`, "iu");
  return text.replace(pattern, "").trim();
}

function formatReminderValue(minutes: number | null): string {
  if (!minutes || minutes <= 0) {
    return "выключено";
  }
  return formatReminderBeforeStart(minutes);
}

function formatReminderBeforeStart(minutes: number): string {
  const total = Math.max(0, Math.trunc(Math.abs(minutes)));
  const hours = Math.floor(total / 60);
  const restMinutes = total % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${pluralizeRu(hours, "час", "часа", "часов")}`);
  }
  if (restMinutes > 0 || parts.length === 0) {
    parts.push(`${restMinutes} ${pluralizeRu(restMinutes, "минуту", "минуты", "минут")}`);
  }

  return `за ${parts.join(" ")} до начала`;
}

function pluralizeRu(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;

  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}

function parseReminderArg(raw: string): { ok: true; value: number | null } | { ok: false } {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { ok: false };
  }
  if (["off", "none", "no", "нет", "0"].includes(normalized)) {
    return { ok: true, value: null };
  }

  const value = Number(normalized);
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    return { ok: false };
  }
  return { ok: true, value };
}

function applyReminderPreference(draft: EventDraft, defaultReminderMinutes: number | null): EventDraft {
  if (!defaultReminderMinutes || defaultReminderMinutes <= 0) {
    return { ...draft, reminders: [] };
  }

  return {
    ...draft,
    reminders: [{ minutesBefore: defaultReminderMinutes }]
  };
}

function formatICloudConnectionStatus(
  status: ConnectionStatus | undefined,
  globalICloudEnabled: boolean
): string {
  if (status === ConnectionStatus.connected) {
    return "подключен (персонально)";
  }
  if (status === ConnectionStatus.invalid) {
    return globalICloudEnabled ? "ошибка персонального подключения, fallback: .env" : "ошибка подключения";
  }
  return globalICloudEnabled ? "подключен через .env" : "не подключен";
}

async function cancelActiveDraftForUser(userId: string): Promise<boolean> {
  let cancelled = false;

  const active = await prisma.message.findFirst({
    where: {
      userId,
      status: {
        in: [PipelineStatus.parsed, PipelineStatus.awaiting_confirmation, PipelineStatus.transcribed]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const tx: Prisma.PrismaPromise<unknown>[] = [
    prisma.user.update({
      where: { id: userId },
      data: {
        state: UserState.idle,
        currentDraftMessageId: null
      }
    })
  ];

  if (active) {
    cancelled = true;
    tx.push(
      prisma.message.update({
        where: { id: active.id },
        data: { status: PipelineStatus.cancelled }
      })
    );
  }

  await prisma.$transaction(tx);
  return cancelled;
}

async function listEvents(
  userId: string,
  fromLocal: DateTime,
  toLocal: DateTime | null,
  limit: number
) {
  const where: Prisma.EventWhereInput = {
    userId,
    startAt: {
      gte: toDate(fromLocal.toUTC()),
      ...(toLocal ? { lt: toDate(toLocal.toUTC()) } : {})
    }
  };

  return prisma.event.findMany({
    where,
    orderBy: { startAt: "asc" },
    take: limit
  });
}

function renderEventsList(
  title: string,
  events: Array<{ title: string; startAt: Date; endAt: Date; timezone: string }>,
  userTimezone: string
): string {
  if (events.length === 0) {
    return `${title}: пока пусто.`;
  }

  const lines = [title + ":"];
  for (const event of events) {
    const start = DateTime.fromJSDate(event.startAt, { zone: "utc" }).setZone(userTimezone);
    const end = DateTime.fromJSDate(event.endAt, { zone: "utc" }).setZone(userTimezone);
    lines.push(`• ${start.toFormat("dd.LL HH:mm")} - ${end.toFormat("HH:mm")} ${event.title}`);
  }
  return lines.join("\n");
}

async function resolveICloudConfig(
  userId: string
): Promise<{ credentials: ICloudCredentials; source: "user" | "env" } | null> {
  const connection = await prisma.calendarConnection.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: PERSONAL_ICAL_PROVIDER
      }
    }
  });

  if (
    connection?.status === ConnectionStatus.connected &&
    connection.appleId &&
    connection.encryptedAppPassword &&
    env.ENCRYPTION_KEY.trim()
  ) {
    try {
      const password = decryptSecret(connection.encryptedAppPassword, env.ENCRYPTION_KEY);
      return {
        source: "user",
        credentials: {
          appleId: connection.appleId,
          appSpecificPassword: password,
          baseUrl: env.ICLOUD_CALDAV_BASE_URL
        }
      };
    } catch (error) {
      logError("icloud credentials decrypt failed", {
        userId,
        reason: toSafeError(error)
      });
      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { status: ConnectionStatus.invalid }
      });
    }
  }

  if (env.ICLOUD_APPLE_ID && env.ICLOUD_APP_SPECIFIC_PASSWORD) {
    return {
      source: "env",
      credentials: {
        appleId: env.ICLOUD_APPLE_ID,
        appSpecificPassword: env.ICLOUD_APP_SPECIFIC_PASSWORD,
        baseUrl: env.ICLOUD_CALDAV_BASE_URL
      }
    };
  }

  return null;
}

function encryptSecret(value: string, passphrase: string): string {
  const key = createHash("sha256").update(passphrase, "utf-8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

function decryptSecret(payload: string, passphrase: string): string {
  const [ivBase64, tagBase64, encryptedBase64] = payload.split(":");
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error("Invalid encrypted payload format");
  }

  const key = createHash("sha256").update(passphrase, "utf-8").digest();
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf-8");
}

function toDate(value: DateTime): Date {
  const iso = value.toISO();
  if (!iso) {
    throw new Error("Invalid datetime");
  }
  return new Date(iso);
}
