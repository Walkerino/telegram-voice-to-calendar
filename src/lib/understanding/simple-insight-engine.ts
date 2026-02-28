import { DateTime } from "luxon";
import type { IInsightEngine } from "./IInsightEngine";
import type { DailyDigestInput, DigestOutput } from "./types";

export class SimpleInsightEngine implements IInsightEngine {
  async dailyDigest(input: DailyDigestInput): Promise<DigestOutput> {
    const now = DateTime.fromJSDate(input.date, { zone: input.timezone });

    const overdueTasks = input.openTasks.filter((task) => task.dueAt && DateTime.fromJSDate(task.dueAt) < now);
    const topTags = findTopTags(input.openTasks.flatMap((task) => task.tags), input.recentNotes.flatMap((note) => note.tags));

    const lines: string[] = [];
    lines.push(`Дайджест за ${now.toFormat("dd.LL.yyyy")}`);
    lines.push(`Inbox за день: ${input.inboxItemsCount}`);
    lines.push(`Открытые задачи: ${input.openTasks.length}`);

    if (overdueTasks.length > 0) {
      lines.push(`Просрочено задач: ${overdueTasks.length}`);
      lines.push(`Фокус: ${overdueTasks.slice(0, 3).map((task) => task.title).join("; ")}`);
    }

    if (input.tomorrowEvents.length > 0) {
      lines.push("События на завтра:");
      for (const event of input.tomorrowEvents.slice(0, 5)) {
        const start = DateTime.fromJSDate(event.startAt, { zone: "utc" }).setZone(input.timezone);
        lines.push(`• ${start.toFormat("HH:mm")} ${event.title}`);
      }
    }

    if (input.remindersTomorrow.length > 0) {
      lines.push("Напоминания на завтра:");
      for (const reminder of input.remindersTomorrow.slice(0, 5)) {
        const at = DateTime.fromJSDate(reminder.remindAt, { zone: "utc" }).setZone(input.timezone);
        lines.push(`• ${at.toFormat("HH:mm")} ${reminder.message}`);
      }
    }

    if (topTags.length > 0) {
      lines.push(`Повторяющиеся темы: ${topTags.join(", ")}`);
    }

    if (input.recentNotes.length > 0) {
      lines.push(`Последние мысли: ${input.recentNotes.slice(0, 2).map((note) => shrink(note.text, 80)).join(" | ")}`);
    }

    return {
      message: lines.join("\n")
    };
  }
}

function findTopTags(...groups: string[][]): string[] {
  const counts = new Map<string, number>();

  for (const group of groups) {
    for (const tag of group) {
      const normalized = tag.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map((item) => item[0]);
}

function shrink(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
