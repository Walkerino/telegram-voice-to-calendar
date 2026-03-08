import { DateTime } from "luxon";
import type { ParseResult } from "@/lib/types/event";
import type { IEventParser, ParseInput } from "./IEventParser";

type ParsedTime = { hour: number; minute: number };
type DayPart = "morning" | "afternoon" | "evening" | "night" | "am" | "pm";
type ParsedTimeRange = { start: ParsedTime; end: ParsedTime };

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

const DAY_PART_ALIASES: Array<{ part: DayPart; form: string }> = [
  { part: "morning", form: "утра" },
  { part: "morning", form: "утром" },
  { part: "morning", form: "утро" },
  { part: "morning", form: "in the morning" },
  { part: "morning", form: "morning" },
  { part: "afternoon", form: "дня" },
  { part: "afternoon", form: "днем" },
  { part: "afternoon", form: "днём" },
  { part: "afternoon", form: "in the afternoon" },
  { part: "afternoon", form: "afternoon" },
  { part: "evening", form: "вечера" },
  { part: "evening", form: "вечером" },
  { part: "evening", form: "in the evening" },
  { part: "evening", form: "evening" },
  { part: "night", form: "ночи" },
  { part: "night", form: "ночью" },
  { part: "night", form: "at night" },
  { part: "night", form: "night" },
  { part: "am", form: "am" },
  { part: "pm", form: "pm" }
];

const DAY_PART_PATTERN = DAY_PART_ALIASES.map((item) => escapeRegex(item.form))
  .sort((left, right) => right.length - left.length)
  .join("|");

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;
const TITLE_TOKEN_EDGE_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const TITLE_STOP_WORDS = new Set([
  "сегодня",
  "завтра",
  "послезавтра",
  "today",
  "tomorrow",
  "утро",
  "утром",
  "утра",
  "день",
  "днем",
  "днём",
  "дня",
  "вечер",
  "вечером",
  "вечера",
  "ночь",
  "ночью",
  "ночи",
  "morning",
  "afternoon",
  "evening",
  "night",
  "am",
  "pm",
  "час",
  "часа",
  "часов",
  "minute",
  "minutes",
  "hour",
  "hours",
  "минута",
  "минуты",
  "минут",
  "мин",
  "h",
  "min"
]);

export class RulesEventParser implements IEventParser {
  async parse(input: ParseInput): Promise<ParseResult> {
    const source = input.text.trim();
    if (!source) {
      return { question: "Не понял текст. Напишите событие одной строкой." };
    }

    const timezone = input.timezone || "Europe/Moscow";
    const now = DateTime.fromJSDate(input.now ?? new Date(), { zone: timezone });
    const lower = source.toLowerCase();

    const relativeStart = parseRelativeStart(lower, now);
    const durationMinutes = parseDuration(lower) ?? 60;

    let start: DateTime | null = null;
    let end: DateTime | null = null;
    let hasDate = false;
    let hasTime = false;

    if (relativeStart) {
      start = relativeStart;
      end = start.plus({ minutes: durationMinutes });
      hasDate = true;
      hasTime = true;
    } else {
      const parsedDate = parseDate(lower, now);
      const parsedTimeRange = parseTimeRange(lower);
      const parsedTime = parsedTimeRange?.start ?? parseTime(lower);

      hasDate = Boolean(parsedDate);
      hasTime = Boolean(parsedTimeRange || parsedTime);

      if (!hasDate || !hasTime) {
        return {
          question: !hasDate
            ? "Уточните дату события (например: сегодня, завтра, в пятницу)."
            : "Уточните время события (например: в 18:30)."
        };
      }

      start = applyDateAndTime(parsedDate as ParsedDate, parsedTime as ParsedTime, now);

      if (parsedTimeRange) {
        const rangeEnd = applyDateAndTime(parsedDate as ParsedDate, parsedTimeRange.end, now);
        end = rangeEnd <= start ? rangeEnd.plus({ days: 1 }) : rangeEnd;
      } else {
        end = start.plus({ minutes: durationMinutes });
      }
    }

    if (!start || !start.isValid || !end || !end.isValid || end <= start) {
      return { question: "Не удалось распознать дату/время. Напишите событие одной строкой." };
    }

    const title = extractTitle(source);

    return {
      draft: {
        title,
        start: start.toUTC().toISO() as string,
        end: end.toUTC().toISO() as string,
        timezone,
        reminders: [{ minutesBefore: 30 }],
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
  const withPrefix = new RegExp(
    `(?:^|[^${WORD_CHAR_CLASS}])(?:в|at)\\s*(\\d{1,2})(?::(\\d{2}))?(?=$|[^\\d])`,
    "u"
  ).exec(text);
  const withoutPrefix = /(?:^|[^\d])(\d{1,2})[:.](\d{2})(?=$|[^\d])/u.exec(text);
  const match = withPrefix ?? withoutPrefix;
  if (!match) {
    return null;
  }

  const rawHour = Number(match[1]);
  const minute = Number(match[2] ?? "0");

  if (rawHour > 23 || minute > 59) {
    return null;
  }

  const hourToken = match[1] ?? "";
  const localHourIndex = Math.max(match[0].indexOf(hourToken), 0);
  const timeStart = (match.index ?? 0) + localHourIndex;
  const timeEnd = timeStart + hourToken.length + (match[2] ? match[2].length + 1 : 0);
  const dayPart = detectDayPartNearTime(text, timeStart, timeEnd);
  const hour = applyDayPart(rawHour, dayPart);

  if (hour === null) {
    return null;
  }

  return { hour, minute };
}

function parseTimeRange(text: string): ParsedTimeRange | null {
  const clockMatches = [...text.matchAll(/(\d{1,2})[:.](\d{2})/gu)]
    .map((match) => {
      if (typeof match.index !== "number") {
        return null;
      }

      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) {
        return null;
      }

      const token = match[0] ?? "";
      const start = match.index;
      const end = start + token.length;
      return { hour, minute, start, end };
    })
    .filter((item): item is { hour: number; minute: number; start: number; end: number } => Boolean(item));

  if (clockMatches.length < 2) {
    return null;
  }

  for (let index = 0; index < clockMatches.length - 1; index += 1) {
    const left = clockMatches[index];
    const right = clockMatches[index + 1];
    const separator = text.slice(left.end, right.start);
    if (!/(?:до|to|[-–—])/iu.test(separator)) {
      continue;
    }

    const startDayPart = detectDayPartNearTime(text, left.start, left.end);
    const endDayPart = detectDayPartNearTime(text, right.start, right.end);
    const startHour = applyDayPart(left.hour, startDayPart);
    const endHour = applyDayPart(right.hour, endDayPart);
    if (startHour === null || endHour === null) {
      continue;
    }

    return {
      start: { hour: startHour, minute: left.minute },
      end: { hour: endHour, minute: right.minute }
    };
  }

  return null;
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
    /(?:с|from)?\s*\d{1,2}(?::\d{2})?\s*(?:до|to|[-–—])\s*\d{1,2}(?::\d{2})?/giu,
    new RegExp(`(?:через|in)\\s+${numberWordPattern}\\s*(?:час(?:а|ов)?|hour|hours|минут(?:а|ы)?|мин|min|minute|minutes)`, "giu"),
    /(?:в|at)\s*\d{1,2}(?::\d{2})?/giu,
    /\d{1,2}[:.]\d{2}/g,
    /(?:^|\s)(?:с|from)\s+(?:до|to)(?=$|\s)/giu,
    new RegExp(`(?:^|[^${WORD_CHAR_CLASS}])(?:${DAY_PART_PATTERN})(?=$|[^${WORD_CHAR_CLASS}])`, "giu"),
    /(?:в\s+)?(?:понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/giu,
    new RegExp(`(?:на|for)\\s+${numberWordPattern}\\s*(?:час(?:а|ов)?|h|hour|hours|минут(?:а|ы)?|мин|min|minute|minutes)`, "giu"),
    /(?:на|for)\s*(?:час|an hour|one hour)/giu
  ];

  for (const pattern of cleanupPatterns) {
    title = title.replace(pattern, " ");
  }

  title = filterTitleStopWords(title);
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

function detectDayPartNearTime(text: string, timeStart: number, timeEnd: number): DayPart | null {
  const beforeRaw = text.slice(Math.max(0, timeStart - 40), timeStart).replace(/\s+$/u, "");
  const afterRaw = text.slice(timeEnd, Math.min(text.length, timeEnd + 40)).replace(/^\s+/u, "");

  const aliases = [...DAY_PART_ALIASES].sort((left, right) => right.form.length - left.form.length);
  for (const alias of aliases) {
    if (endsWithWholeWord(beforeRaw, alias.form) || startsWithWholeWord(afterRaw, alias.form)) {
      return alias.part;
    }
  }

  return null;
}

function applyDayPart(hour: number, dayPart: DayPart | null): number | null {
  if (!dayPart) {
    return hour;
  }

  if ((dayPart === "am" || dayPart === "pm") && hour > 12) {
    return null;
  }

  switch (dayPart) {
    case "am":
      return hour === 12 ? 0 : hour;
    case "pm":
      return hour === 12 ? 12 : hour + 12;
    case "morning":
      return hour === 12 ? 0 : hour;
    case "afternoon":
      if (hour >= 1 && hour <= 11) {
        return hour + 12;
      }
      return hour;
    case "evening":
      if (hour >= 1 && hour <= 11) {
        return hour + 12;
      }
      return hour === 12 ? 0 : hour;
    case "night":
      if (hour === 12) {
        return 0;
      }
      if (hour >= 1 && hour <= 5) {
        return hour;
      }
      if (hour >= 6 && hour <= 11) {
        return hour + 12;
      }
      return hour;
    default:
      return hour;
  }
}

function startsWithWholeWord(text: string, phrase: string): boolean {
  if (!text.startsWith(phrase)) {
    return false;
  }
  const next = text.charAt(phrase.length);
  return !isWordChar(next);
}

function endsWithWholeWord(text: string, phrase: string): boolean {
  if (!text.endsWith(phrase)) {
    return false;
  }
  const prevIndex = text.length - phrase.length - 1;
  const prev = prevIndex >= 0 ? text.charAt(prevIndex) : "";
  return !isWordChar(prev);
}

function isWordChar(value: string): boolean {
  return Boolean(value) && WORD_CHAR_RE.test(value);
}

function filterTitleStopWords(source: string): string {
  const parts = source.split(/\s+/u);
  const filtered: string[] = [];

  for (const part of parts) {
    const normalized = part.toLowerCase().replace(TITLE_TOKEN_EDGE_RE, "");
    if (!normalized || TITLE_STOP_WORDS.has(normalized)) {
      continue;
    }
    filtered.push(part);
  }

  return filtered.join(" ");
}
