import { TaskStatus, ReminderStatus, type Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { getInsightEngine } from "@/lib/understanding";

export async function buildDailyDigestMessage(userId: string, date: Date = new Date()): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return "Пользователь не найден.";
  }

  const zone = user.timezone || "Europe/Warsaw";
  const day = DateTime.fromJSDate(date, { zone });
  const start = day.startOf("day");
  const end = start.plus({ days: 1 });
  const tomorrowStart = end;
  const tomorrowEnd = tomorrowStart.plus({ days: 1 });

  const [inboxItemsCount, openTasks, remindersTomorrow, tomorrowEvents, recentNotes] = await Promise.all([
    prisma.message.count({
      where: {
        userId,
        createdAt: {
          gte: new Date(start.toUTC().toISO() as string),
          lt: new Date(end.toUTC().toISO() as string)
        }
      }
    }),
    prisma.task.findMany({
      where: {
        userId,
        status: {
          in: [TaskStatus.open, TaskStatus.in_progress]
        }
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 20
    }),
    prisma.reminder.findMany({
      where: {
        userId,
        status: ReminderStatus.pending,
        remindAt: {
          gte: new Date(tomorrowStart.toUTC().toISO() as string),
          lt: new Date(tomorrowEnd.toUTC().toISO() as string)
        }
      },
      orderBy: { remindAt: "asc" },
      take: 20
    }),
    prisma.event.findMany({
      where: {
        userId,
        startAt: {
          gte: new Date(tomorrowStart.toUTC().toISO() as string),
          lt: new Date(tomorrowEnd.toUTC().toISO() as string)
        }
      },
      orderBy: { startAt: "asc" },
      take: 20
    }),
    prisma.message.findMany({
      where: {
        userId,
        itemType: {
          in: ["note", "journal"]
        }
      },
      orderBy: { createdAt: "desc" },
      take: 10
    })
  ]);

  const insight = getInsightEngine();
  const digest = await insight.dailyDigest({
    date,
    timezone: zone,
    inboxItemsCount,
    openTasks: openTasks.map((task) => ({
      title: task.title,
      dueAt: task.dueAt,
      priority: task.priority,
      tags: parseTags(task.tags)
    })),
    remindersTomorrow: remindersTomorrow.map((reminder) => ({
      remindAt: reminder.remindAt,
      message: reminder.message
    })),
    tomorrowEvents: tomorrowEvents.map((event) => ({
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt
    })),
    recentNotes: recentNotes.map((note) => ({
      text: note.transcript || note.rawText || "",
      tags: parseTags(note.parsedJson)
    }))
  });

  return digest.message;
}

function parseTags(value: Prisma.JsonValue | null): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const raw = (value as Record<string, unknown>).tags;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
