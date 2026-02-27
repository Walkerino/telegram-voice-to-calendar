import { DateTime } from "luxon";
import type { ParseResult } from "@/lib/types/event";
import type { IEventParser, ParseInput } from "./IEventParser";

type ParsedTime = { hour: number; minute: number };

type ParsedDate = {
  date: DateTime;
  type: "today" | "tomorrow" | "weekday";
};

const WEEKDAY_FORMS: Array<{ weekday: number; forms: string[] }> = [
  { weekday: 1, forms: ["понедельник", "понедельнику", "monday", "mon"] },
  { weekday: 2, forms: ["вторник", "вторнику", "tuesday", "tue"] },
  { weekday: 3, forms: ["среда", "среду", "wednesday", "wed"] },
  { weekday: 4, forms: ["четверг", "четверг", "thursday", "thu"] },
  { weekday: 5, forms: ["пятница", "пятницу", "friday", "fri"] },
  { weekday: 6, forms: ["суббота", "субботу", "saturday", "sat"] },
  { weekday: 7, forms: ["воскресенье", "воскресенье", "sunday", "sun"] }
];

export class RulesEventParser implements IEventParser {
  async parse(input: ParseInput): Promise<ParseResult> {
    const source = input.text.trim();
    if (!source) {
      return { question: "Не понял текст. Напишите событие одной строкой." };
    }

    const timezone = input.timezone || "Europe/Warsaw";
    const now = DateTime.fromJSDate(input.now ?? new Date(), { zone: timezone });
    const lower = source.toLowerCase();

    const relativeStart = parseRelativeStart(lower, now);
    const durationMinutes = parseDuration(lower) ?? 60;

    let start: DateTime | null = null;
    let hasDate = false;
    let hasTime = false;

    if (relativeStart) {
      start = relativeStart;
      hasDate = true;
      hasTime = true;
    } else {
      const parsedDate = parseDate(lower, now);
      const parsedTime = parseTime(lower);

      hasDate = Boolean(parsedDate);
      hasTime = Boolean(parsedTime);

      if (!hasDate || !hasTime) {
        return {
          question: !hasDate
            ? "Уточните дату события (например: сегодня, завтра, в пятницу)."
            : "Уточните время события (например: в 18:30)."
        };
      }

      start = applyDateAndTime(parsedDate as ParsedDate, parsedTime as ParsedTime, now);
    }

    if (!start || !start.isValid) {
      return { question: "Не удалось распознать дату/время. Напишите событие одной строкой." };
    }

    const end = start.plus({ minutes: durationMinutes });
    const title = extractTitle(source);

    return {
      draft: {
        title,
        start: start.toUTC().toISO() as string,
        end: end.toUTC().toISO() as string,
        timezone,
        reminders: [{ minutesBefore: 10 }],
        confidence: hasDate && hasTime ? 0.9 : 0.6
      }
    };
  }
}

function parseRelativeStart(text: string, now: DateTime): DateTime | null {
  const hoursMatch = text.match(/(?:через|in)\s+(\d{1,2})\s*(?:час|часа|часов|hour|hours)\b/u);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    return now.plus({ hours }).startOf("minute");
  }

  const minutesMatch = text.match(/(?:через|in)\s+(\d{1,3})\s*(?:минут|минута|минуты|min|minute|minutes)\b/u);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1]);
    return now.plus({ minutes }).startOf("minute");
  }

  return null;
}

function parseDuration(text: string): number | null {
  const hourMatch = text.match(/(?:на|for)\s+(\d{1,2})\s*(?:час|часа|часов|h|hour|hours)\b/u);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60;
  }

  const oneHourMatch = text.match(/(?:на|for)\s*(?:час|an hour|one hour)\b/u);
  if (oneHourMatch) {
    return 60;
  }

  const minMatch = text.match(/(?:на|for)\s+(\d{1,3})\s*(?:минут|минута|минуты|min|minute|minutes)\b/u);
  if (minMatch) {
    return Number(minMatch[1]);
  }

  return null;
}

function parseDate(text: string, now: DateTime): ParsedDate | null {
  if (/\b(сегодня|today)\b/u.test(text)) {
    return { date: now.startOf("day"), type: "today" };
  }

  if (/\b(завтра|tomorrow)\b/u.test(text)) {
    return { date: now.plus({ days: 1 }).startOf("day"), type: "tomorrow" };
  }

  for (const item of WEEKDAY_FORMS) {
    for (const form of item.forms) {
      const pattern = new RegExp(`\\b${escapeRegex(form)}\\b`, "u");
      if (pattern.test(text)) {
        const delta = (item.weekday - now.weekday + 7) % 7;
        const days = delta === 0 ? 7 : delta;
        return {
          date: now.plus({ days }).startOf("day"),
          type: "weekday"
        };
      }
    }
  }

  return null;
}

function parseTime(text: string): ParsedTime | null {
  const match = text.match(/(?:\bв\b|\bat\b)\s*(\d{1,2})(?::(\d{2}))?/u);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");

  if (hour > 23 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function applyDateAndTime(parsedDate: ParsedDate, parsedTime: ParsedTime, now: DateTime): DateTime {
  let result = parsedDate.date.set({
    hour: parsedTime.hour,
    minute: parsedTime.minute,
    second: 0,
    millisecond: 0
  });

  // If user says "today at 10:00" when it is already past 10:00, move to tomorrow.
  if (parsedDate.type === "today" && result <= now) {
    result = result.plus({ days: 1 });
  }

  return result;
}

function extractTitle(source: string): string {
  let title = source;

  const cleanupPatterns = [
    /(?:сегодня|завтра|today|tomorrow)/giu,
    /(?:через|in)\s+\d+\s*(?:час|часа|часов|hour|hours|минут|минута|минуты|min|minute|minutes)/giu,
    /(?:в|at)\s*\d{1,2}(?::\d{2})?/giu,
    /(?:в\s+)?(?:понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/giu,
    /(?:на|for)\s+\d+\s*(?:час|часа|часов|h|hour|hours|минут|минута|минуты|min|minute|minutes)/giu,
    /(?:на|for)\s*(?:час|an hour|one hour)/giu
  ];

  for (const pattern of cleanupPatterns) {
    title = title.replace(pattern, " ");
  }

  title = title.replace(/\s+/g, " ").trim();
  title = title.replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "");

  if (!title) {
    return "Событие";
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
