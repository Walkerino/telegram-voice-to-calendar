import { CalendarEventStatus, PipelineStatus, Prisma } from "@prisma/client";
import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getEventParser } from "@/lib/parser";
import { verifyTelegramMiniAppInitData } from "@/lib/telegram/miniapp-auth";
import { getTranscriber } from "@/lib/transcriber";
import type { EventDraft } from "@/lib/types/event";
import { logError } from "@/lib/utils/log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let messageId: string | null = null;

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!isUploadedAudio(audio)) {
      return NextResponse.json({ ok: false, error: "Поле audio обязательно." }, { status: 400 });
    }

    const initData = resolveInitData(formData, request);
    if (!initData) {
      return NextResponse.json(
        { ok: false, error: "initData отсутствует. Откройте Mini App через Telegram." },
        { status: 401 }
      );
    }

    const auth = verifyTelegramMiniAppInitData(initData);
    const user = await upsertMiniAppUser(auth.user);
    const telegramChatId = String(auth.user.id);

    const message = await createMiniAppMessage({
      userId: user.id,
      telegramChatId
    });
    messageId = message.id;

    const audioBuffer = Buffer.from(await audio.arrayBuffer());
    const fileName = typeof audio.name === "string" && audio.name.trim() ? audio.name.trim() : "voice.webm";
    const mimeType = typeof audio.type === "string" && audio.type.trim() ? audio.type.trim() : "audio/webm";
    const transcriptResult = await getTranscriber().transcribe({
      audio: audioBuffer,
      mimeType,
      fileName
    });

    const transcript = transcriptResult.text.trim();
    if (!transcript) {
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: PipelineStatus.failed,
          lastError: "empty transcript"
        }
      });
      return NextResponse.json({ ok: false, error: "Не удалось распознать речь." }, { status: 422 });
    }

    await prisma.message.update({
      where: { id: message.id },
      data: {
        transcript,
        rawText: transcript,
        status: PipelineStatus.transcribed,
        itemType: "event"
      }
    });

    const parseResult = await getEventParser().parse({
      text: transcript,
      timezone: user.timezone
    });

    if (!parseResult.draft) {
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: PipelineStatus.parsed,
          parsedJson: {
            question: parseResult.question ?? "Нужно уточнение по событию.",
            clarificationsAsked: 1
          }
        }
      });

      return NextResponse.json(
        {
          ok: false,
          error: "Недостаточно данных для события.",
          question: parseResult.question ?? "Уточните дату и время события.",
          transcript
        },
        { status: 422 }
      );
    }

    const draft = applyReminderPreference(parseResult.draft, user.defaultReminderMinutes);
    const uid = `mini-${auth.user.id}-${randomUUID()}`;

    await prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: message.id },
        data: {
          status: PipelineStatus.created,
          draftJson: toJsonDraft(draft),
          parsedJson: Prisma.DbNull,
          itemType: "event"
        }
      });

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

      await tx.calendarEvent.create({
        data: {
          userId: user.id,
          inboxItemId: message.id,
          uid,
          title: draft.title,
          location: draft.location,
          startAt: new Date(draft.start),
          endAt: new Date(draft.end),
          status: CalendarEventStatus.created,
          createdInIcloud: false,
          providerMeta: { source: "miniapp", synced: false }
        }
      });
    });

    return NextResponse.json({
      ok: true,
      transcript,
      provider: transcriptResult.provider,
      event: {
        uid,
        title: draft.title,
        start: draft.start,
        end: draft.end,
        timezone: draft.timezone
      }
    });
  } catch (error) {
    if (messageId) {
      await prisma.message
        .update({
          where: { id: messageId },
          data: {
            status: PipelineStatus.failed,
            lastError: error instanceof Error ? error.message : "unknown error"
          }
        })
        .catch(() => undefined);
    }

    logError("miniapp voice pipeline failed", {
      reason: error instanceof Error ? error.message : "unknown"
    });

    return NextResponse.json({ ok: false, error: "Не удалось обработать запись." }, { status: 500 });
  }
}

function resolveInitData(formData: FormData, request: Request): string {
  const fromBody = formData.get("initData");
  if (typeof fromBody === "string" && fromBody.trim()) {
    return fromBody.trim();
  }

  const fromHeader = request.headers.get("x-telegram-init-data");
  if (fromHeader && fromHeader.trim()) {
    return fromHeader.trim();
  }

  return "";
}

function isUploadedAudio(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === "string") {
    return false;
  }
  return typeof value.arrayBuffer === "function" && typeof value.name === "string";
}

async function upsertMiniAppUser(user: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}) {
  return prisma.user.upsert({
    where: {
      telegramUserId: String(user.id)
    },
    create: {
      telegramUserId: String(user.id),
      telegramUsername: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      languageCode: user.language_code ?? "ru"
    },
    update: {
      telegramUsername: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      languageCode: user.language_code ?? undefined
    }
  });
}

async function createMiniAppMessage(options: { userId: string; telegramChatId: string }) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await prisma.message.create({
        data: {
          userId: options.userId,
          telegramChatId: options.telegramChatId,
          telegramMessageId: generateSyntheticMessageId(),
          status: PipelineStatus.received,
          itemType: "event"
        }
      });
    } catch (error) {
      if (isUniqueChatMessageConstraint(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to allocate synthetic message id");
}

function generateSyntheticMessageId(): number {
  return -randomInt(1, 2_000_000_000);
}

function isUniqueChatMessageConstraint(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /telegramChatId_telegramMessageId/i.test(error.message) || /Unique constraint/i.test(error.message);
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
