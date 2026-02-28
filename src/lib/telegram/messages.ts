import { DateTime } from "luxon";
import type { EventDraft } from "@/lib/types/event";
import type { StructuredItem } from "@/lib/understanding/types";

export function renderDraftMessage(transcript: string, draft: EventDraft): string {
  const start = DateTime.fromISO(draft.start, { zone: "utc" }).setZone(draft.timezone);
  const end = DateTime.fromISO(draft.end, { zone: "utc" }).setZone(draft.timezone);
  const reminders = draft.reminders.map((r) => `${r.minutesBefore} мин`).join(", ");

  const lines = [
    // "Распознанный текст:",
    // transcript,
    // "",
    `Название: ${draft.title}`,
    "",
    `🕐 Начало: ${start.toFormat("dd.LL.yyyy HH:mm")}`,
    `🕐 Конец: ${end.toFormat("dd.LL.yyyy HH:mm")}`,
    "",
    `🌍 Таймзона: ${draft.timezone}`
  ];

  if (reminders) {
    lines.push(`⏰ Напоминание: ${reminders}`);
  }

  return lines.join("\n");
}

export function renderStructuredItemMessage(transcript: string, item: StructuredItem): string {
  if (item.type === "event") {
    return `Тип: EVENT\n${renderDraftMessage(transcript, item.event)}`;
  }

  if (item.type === "task") {
    const due = item.task.dueAt
      ? DateTime.fromISO(item.task.dueAt, { zone: "utc" }).toFormat("dd.LL.yyyy HH:mm")
      : "без срока";
    return [
      "Тип: TASK",
      `Заголовок: ${item.task.title}`,
      `Срок: ${due}`,
      `Приоритет: ${item.task.priority}`,
      `Теги: ${formatTags(item.tags)}`,
      `Next action: ${item.nextAction}`
    ].join("\n");
  }

  if (item.type === "reminder") {
    const remindAt = DateTime.fromISO(item.reminder.remindAt, { zone: "utc" }).toFormat("dd.LL.yyyy HH:mm");
    return [
      "Тип: REMINDER",
      `Когда: ${remindAt}`,
      `Текст: ${item.reminder.message}`,
      `Теги: ${formatTags(item.tags)}`,
      `Next action: ${item.nextAction}`
    ].join("\n");
  }

  if (item.type === "journal") {
    return [
      "Тип: JOURNAL",
      `Текст: ${item.journal.text}`,
      `Mood: ${item.journal.mood ?? "n/a"}`,
      `Теги: ${formatTags(item.tags)}`,
      `Next action: ${item.nextAction}`
    ].join("\n");
  }

  return [
    "Тип: NOTE",
    `Текст: ${item.note.text}`,
    `Topic: ${item.note.topic ?? "n/a"}`,
    `Теги: ${formatTags(item.tags)}`,
    `Next action: ${item.nextAction}`
  ].join("\n");
}

function formatTags(tags: string[]): string {
  if (tags.length === 0) {
    return "—";
  }
  return tags.map((tag) => `#${tag}`).join(" ");
}
