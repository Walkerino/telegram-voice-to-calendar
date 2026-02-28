import { PipelineStatus, Prisma, UserState } from "@prisma/client";
import type { Bot, Context } from "grammy";
import { InputFile } from "grammy";
import { DateTime } from "luxon";
import { env, requireEnv } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { createICloudEventFromDraft } from "@/lib/calendar/icloud";
import { getEventParser } from "@/lib/parser";
import { buildIcs, buildIcsFilename } from "@/lib/services/ics";
import { parseAction, buildDraftKeyboard } from "@/lib/telegram/keyboards";
import { renderDraftMessage } from "@/lib/telegram/messages";
import { getTranscriber } from "@/lib/transcriber";
import type { EventDraft } from "@/lib/types/event";

const BOT_TOKEN = () => requireEnv("TELEGRAM_BOT_TOKEN");

export function registerHandlers(bot: Bot<Context>): void {
  bot.command("start", async (ctx) => {
    const user = await ensureUser(ctx);
    await ctx.reply(
      [
        "Отправьте голосовое сообщение с задачей.",
        "Пример: Встреча завтра в 18:30 на час",
        `Текущая таймзона: ${user.timezone}`,
        "Команда смены таймзоны: /timezone Europe/Warsaw"
      ].join("\n")
    );
  });

  bot.command("timezone", async (ctx) => {
    const user = await ensureUser(ctx);
    const text = ctx.message?.text ?? "";
    const nextTimezone = text.replace(/^\/timezone\s*/i, "").trim();

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

  bot.on("message:voice", async (ctx) => {
    const from = ctx.from;
    const voice = ctx.message?.voice;
    const chatId = ctx.chat?.id;

    if (!from || !voice || !chatId) {
      return;
    }

    const user = await ensureUser(ctx);
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
        status: PipelineStatus.received
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
          status: PipelineStatus.transcribed
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
            data: { status: PipelineStatus.parsed }
          }),
          prisma.user.update({
            where: { id: user.id },
            data: {
              state: UserState.awaiting_edit,
              currentDraftMessageId: dbMessage.id
            }
          })
        ]);

        await ctx.reply(
          `${parseResult.question ?? "Нужно уточнение по событию."}\nОтветьте одной строкой.`
        );
        return;
      }

      await prisma.message.update({
        where: { id: dbMessage.id },
        data: {
          status: PipelineStatus.awaiting_confirmation,
          draftJson: toJsonDraft(parseResult.draft)
        }
      });

      await ctx.reply(renderDraftMessage(transcript, parseResult.draft), {
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
      console.error("voice pipeline failed", {
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

    // create action
    if (message.status === PipelineStatus.created) {
      await ctx.answerCallbackQuery({ text: "Событие уже создано" });
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
        console.error("event creation failed", { messageId: message.id, reason: toSafeError(error) });
        return;
      }
    }

    const hasICloudConfig = Boolean(env.ICLOUD_APPLE_ID && env.ICLOUD_APP_SPECIFIC_PASSWORD);
    let syncedToICloud = false;
    let iCloudSyncError: string | null = null;

    if (hasICloudConfig) {
      try {
        await createICloudEventFromDraft({
          uid,
          draft,
          calendarName: env.ICLOUD_CALENDAR_NAME || undefined,
          credentials: {
            appleId: env.ICLOUD_APPLE_ID,
            appSpecificPassword: env.ICLOUD_APP_SPECIFIC_PASSWORD,
            baseUrl: env.ICLOUD_CALDAV_BASE_URL
          }
        });
        syncedToICloud = true;
      } catch (error) {
        iCloudSyncError = toSafeError(error);
        console.error("icloud sync failed", {
          messageId: message.id,
          reason: iCloudSyncError
        });
      }
    }

    if (syncedToICloud) {
      await ctx.answerCallbackQuery({ text: "Событие добавлено в iCloud" });
      await safeRemoveInlineKeyboard(ctx);
      await ctx.reply("Событие создано и автоматически добавлено в iCloud Calendar.");
      return;
    }

    const ics = buildIcs({ uid, draft });
    const fileName = buildIcsFilename(draft.start, "event");

    await ctx.api.sendDocument(
      ctx.callbackQuery.message?.chat.id ?? ctx.from.id,
      new InputFile(Buffer.from(ics, "utf-8"), fileName),
      {
        caption: hasICloudConfig
          ? "Событие создано. Не удалось добавить в iCloud автоматически, отправляю .ics как запасной вариант."
          : "Событие создано. Подключите iCloud в .env, чтобы добавлять автоматически."
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
      await prisma.message.update({
        where: { id: message.id },
        data: {
          transcript: mergedText,
          status: PipelineStatus.parsed
        }
      });

      await ctx.reply(
        `${parseResult.question ?? "Нужно уточнение."}\nОтветьте одной строкой.`
      );
      return;
    }

    await prisma.$transaction([
      prisma.message.update({
        where: { id: message.id },
        data: {
          transcript: mergedText,
          draftJson: toJsonDraft(parseResult.draft),
          status: PipelineStatus.awaiting_confirmation
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

    await ctx.reply(renderDraftMessage(mergedText, parseResult.draft), {
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
      timezone: "Europe/Warsaw"
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
