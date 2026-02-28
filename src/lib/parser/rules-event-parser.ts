import { DateTime } from "luxon";
import type { ParseResult } from "@/lib/types/event";
import type { IEventParser, ParseInput } from "./IEventParser";

type ParsedTime = { hour: number; minute: number };

type ParsedDate = {
  date: DateTime;
  type: "today" | "tomorrow" | "weekday";
};

const WORD_CHAR_CLASS = "\\p{L}\\p{N}_";

const NUMBER_WORDS: Record<string, number> = {
  ноль: 0,
  один: 1,
  одна: 1,
  одну: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  fifty: 50,
  sixty: 60,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
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
  const hoursMatch = text.match(
    new RegExp(
      `(?:^|[^${WORD_CHAR_CLASS}])(?:через|in)\\s+([\\p{L}\\p{N}-]+)\\s*(?:час(?:а|ов)?|hour|hours)(?=$|[^${WORD_CHAR_CLASS}])`,
      "u"
    )
  );
  if (hoursMatch) {
    const hours = parseNumberToken(hoursMatch[1]);
    if (hours !== null && hours > 0) {
      return now.plus({ hours }).startOf("minute");
    }
  }

  const minutesMatch = text.match(
    new RegExp(
      `(?:^|[^${WORD_CHAR_CLASS}])(?:через|in)\\s+([\\p{L}\\p{N}-]+)\\s*(?:минут(?:а|ы)?|мин|minute|minutes|min)(?=$|[^${WORD_CHAR_CLASS}])`,
      "u"
    )
  );
  if (minutesMatch) {
    const minutes = parseNumberToken(minutesMatch[1]);
    if (minutes !== null && minutes > 0) {
      return now.plus({ minutes }).startOf("minute");
    }
  }

  return null;
}

function parseDuration(text: string): number | null {
  const hourMatch = text.match(
    new RegExp(
      `(?:^|[^${WORD_CHAR_CLASS}])(?:на|for)\\s+([\\p{L}\\p{N}-]+)\\s*(?:час(?:а|ов)?|h|hour|hours)(?=$|[^${WORD_CHAR_CLASS}])`,
      "u"
    )
  );
  if (hourMatch) {
    const hours = parseNumberToken(hourMatch[1]);
    if (hours !== null && hours > 0) {
      return hours * 60;
    }
  }

  const oneHourMatch = text.match(
    new RegExp(`(?:^|[^${WORD_CHAR_CLASS}])(?:на|for)\\s*(?:час|an\\s+hour|one\\s+hour)(?=$|[^${WORD_CHAR_CLASS}])`, "u")
  );
  if (oneHourMatch) {
    return 60;
  }

  const minMatch = text.match(
    new RegExp(
      `(?:^|[^${WORD_CHAR_CLASS}])(?:на|for)\\s+([\\p{L}\\p{N}-]+)\\s*(?:минут(?:а|ы)?|мин|minute|minutes|min)(?=$|[^${WORD_CHAR_CLASS}])`,
      "u"
    )
  );
  if (minMatch) {
    const minutes = parseNumberToken(minMatch[1]);
    if (minutes !== null && minutes > 0) {
      return minutes;
    }
  }

  return null;
}

function parseDate(text: string, now: DateTime): ParsedDate | null {
  if (containsWord(text, "сегодня") || containsWord(text, "today")) {
    return { date: now.startOf("day"), type: "today" };
  }

  if (containsWord(text, "завтра") || containsWord(text, "tomorrow")) {
    return { date: now.plus({ days: 1 }).startOf("day"), type: "tomorrow" };
  }

  for (const item of WEEKDAY_FORMS) {
    for (const form of item.forms) {
      const pattern = wordPattern(form);
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
  const withPrefix = text.match(
    new RegExp(
      `(?:^|[^${WORD_CHAR_CLASS}])(?:в|at)\\s*(\\d{1,2})(?::(\\d{2}))?(?=$|[^\\d])`,
      "u"
    )
  );
  const withoutPrefix = text.match(/(?:^|[^\d])(\d{1,2})[:.](\d{2})(?=$|[^\d])/u);
  const match = withPrefix ?? withoutPrefix;
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

  const numberWordPattern = "(?:\\d+|один|одна|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|one|two|three|four|five|six|seven|eight|nine|ten)";

  const cleanupPatterns = [
    /(?:сегодня|завтра|today|tomorrow)/giu,
    new RegExp(`(?:через|in)\\s+${numberWordPattern}\\s*(?:час(?:а|ов)?|hour|hours|минут(?:а|ы)?|мин|min|minute|minutes)`, "giu"),
    /(?:в|at)\s*\d{1,2}(?::\d{2})?/giu,
    /\d{1,2}[:.]\d{2}/g,
    /(?:в\s+)?(?:понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/giu,
    new RegExp(`(?:на|for)\\s+${numberWordPattern}\\s*(?:час(?:а|ов)?|h|hour|hours|минут(?:а|ы)?|мин|min|minute|minutes)`, "giu"),
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

function wordPattern(word: string): RegExp {
  return new RegExp(`(?:^|[^${WORD_CHAR_CLASS}])${escapeRegex(word)}(?=$|[^${WORD_CHAR_CLASS}])`, "u");
}

function containsWord(text: string, word: string): boolean {
  return wordPattern(word).test(text);
}

function parseNumberToken(raw: string): number | null {
  const token = raw.toLowerCase().trim();
  if (!token) {
    return null;
  }

  if (/^\d+$/.test(token)) {
    const value = Number(token);
    return Number.isFinite(value) ? value : null;
  }

  return NUMBER_WORDS[token] ?? null;
}
