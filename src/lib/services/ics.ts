import ical, { ICalAlarmType, ICalCalendarMethod } from "ical-generator";
import type { EventDraft } from "@/lib/types/event";

export function buildIcs(options: {
  uid: string;
  draft: EventDraft;
  createdAt?: Date;
}): string {
  const { uid, draft } = options;

  const calendar = ical({
    name: "Telegram Voice Calendar",
    method: ICalCalendarMethod.PUBLISH,
    prodId: "//telegram-voice-to-calendar//mvp//EN"
  });

  const event = calendar.createEvent({
    id: uid,
    start: new Date(draft.start),
    end: new Date(draft.end),
    summary: draft.title,
    description: draft.description,
    location: draft.location,
    stamp: options.createdAt ?? new Date()
  });

  for (const reminder of draft.reminders) {
    event.createAlarm({
      type: ICalAlarmType.display,
      trigger: -Math.abs(reminder.minutesBefore) * 60,
      description: "Reminder"
    });
  }

  return calendar.toString();
}

export function buildIcsFilename(startIso: string, fallback = "event"): string {
  const date = new Date(startIso);
  if (Number.isNaN(date.getTime())) {
    return `${fallback}.ics`;
  }

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");

  return `${fallback}-${yyyy}${mm}${dd}-${hh}${mi}.ics`;
}
