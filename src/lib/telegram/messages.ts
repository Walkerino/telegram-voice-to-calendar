import { DateTime } from "luxon";
import type { EventDraft } from "@/lib/types/event";

export function renderDraftMessage(transcript: string, draft: EventDraft): string {
  const start = DateTime.fromISO(draft.start, { zone: "utc" }).setZone(draft.timezone);
  const end = DateTime.fromISO(draft.end, { zone: "utc" }).setZone(draft.timezone);
  const reminders = draft.reminders.map((r) => `${r.minutesBefore} мин`).join(", ");

  return [
    "Распознанный текст:",
    transcript,
    "",
    "Черновик события:",
    `Название: ${draft.title}`,
    `Начало: ${start.toFormat("dd.LL.yyyy HH:mm")}`,
    `Конец: ${end.toFormat("dd.LL.yyyy HH:mm")}`,
    `Таймзона: ${draft.timezone}`,
    `Напоминание: ${reminders}`
  ].join("\n");
}
