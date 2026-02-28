import { DateTime } from "luxon";
import type { EventDraft } from "@/lib/types/event";

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
