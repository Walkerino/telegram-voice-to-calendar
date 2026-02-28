import type { InboxItemType, TaskPriority } from "@prisma/client";
import { DateTime } from "luxon";
import { getEventParser } from "@/lib/parser";
import type { IParser } from "./IParser";
import type { ParseStructuredInput, ParseStructuredOutput } from "./types";

const WEEKDAYS: Array<{ weekday: number; forms: string[] }> = [
  { weekday: 1, forms: ["понедельник", "понедельнику", "monday", "mon"] },
  { weekday: 2, forms: ["вторник", "вторнику", "tuesday", "tue"] },
  { weekday: 3, forms: ["среда", "среду", "wednesday", "wed"] },
  { weekday: 4, forms: ["четверг", "четвергу", "thursday", "thu"] },
  { weekday: 5, forms: ["пятница", "пятницу", "friday", "fri"] },
  { weekday: 6, forms: ["суббота", "субботу", "saturday", "sat"] },
  { weekday: 7, forms: ["воскресенье", "воскресенью", "sunday", "sun"] }
];

const TASK_LEAD = /^(?:нужно|надо|задача|task|todo|сделать|сделай|please)\s+/iu;
const REMINDER_LEAD = /^(?:напомни|напомнить|remind(?:\s+me)?|не\s+забудь)\s+/iu;

export class RuleBasedParser implements IParser {
  async parse(input: ParseStructuredInput): Promise<ParseStructuredOutput> {
    const source = input.text.trim();
    const timezone = input.timezone || "Europe/Warsaw";
    const now = DateTime.fromJSDate(input.now ?? new Date(), { zone: timezone });

    if (!source) {
      return { question: "Пустое сообщение. Скажите задачу или событие одной строкой.", confidence: 0.1 };
    }

    switch (input.type) {
      case "event":
        return this.parseEvent(source, timezone, new Date(now.toISO() as string));
      case "task":
        return this.parseTask(source, timezone, now);
      case "reminder":
        return this.parseReminder(source, timezone, now);
      case "journal":
        return this.parseJournal(source);
      case "note":
      default:
        return this.parseNote(source);
    }
  }

  private async parseEvent(text: string, timezone: string, now: Date): Promise<ParseStructuredOutput> {
    const parser = getEventParser();
    const result = await parser.parse({ text, timezone, now });

    if (!result.draft) {
      return {
        question: result.question ?? "Уточните дату и время события.",
        confidence: 0.5
      };
    }

    const tags = extractTags(text);

    return {
      item: {
        type: "event",
        event: result.draft,
        tags,
        nextAction: "Проверить карточку и сохранить событие"
      },
      confidence: result.draft.confidence
    };
  }

  private async parseTask(text: string, timezone: string, now: DateTime): Promise<ParseStructuredOutput> {
    const dueAt = parseDateTime(text, timezone, now, { defaultHour: 18 });
    const title = cleanupTitle(text.replace(TASK_LEAD, ""));
    const taskTitle = title || "Новая задача";
    const tags = extractTags(text);

    return {
      item: {
        type: "task",
        task: {
          title: taskTitle,
          notes: text,
          dueAt: dueAt?.toUTC().toISO() ?? undefined,
          priority: detectPriority(text),
          tags
        },
        tags,
        nextAction: dueAt ? "Запланировать выполнение до дедлайна" : "Добавить дедлайн при необходимости"
      },
      confidence: dueAt ? 0.82 : 0.74
    };
  }

  private async parseReminder(text: string, timezone: string, now: DateTime): Promise<ParseStructuredOutput> {
    const remindAt = parseDateTime(text, timezone, now, { defaultHour: 9 });
    if (!remindAt) {
      return {
        question: "Уточните когда напомнить (например: завтра в 09:30 или через 2 часа).",
        confidence: 0.45
      };
    }

    const message = cleanupTitle(text.replace(REMINDER_LEAD, "")) || "Напоминание";
    const tags = extractTags(text);

    return {
      item: {
        type: "reminder",
        reminder: {
          remindAt: remindAt.toUTC().toISO() as string,
          message,
          tags
        },
        tags,
        nextAction: "Подтвердить время и текст напоминания"
      },
      confidence: 0.88
    };
  }

  private async parseNote(text: string): Promise<ParseStructuredOutput> {
    const tags = extractTags(text);
    const topic = buildTopic(text);

    return {
      item: {
        type: "note",
        note: {
          text,
          topic,
          tags
        },
        tags,
        nextAction: "Добавить теги или связать с задачей"
      },
      confidence: 0.78
    };
  }

  private async parseJournal(text: string): Promise<ParseStructuredOutput> {
    const tags = extractTags(text);
    const mood = detectMood(text);

    return {
      item: {
        type: "journal",
        journal: {
          text,
          mood,
          tags
        },
        tags,
        nextAction: "Использовать запись в ежедневном дайджесте"
      },
      confidence: 0.8
    };
  }
}

function detectPriority(text: string): TaskPriority {
  const lower = text.toLowerCase();
  if (/(срочно|urgent|critical|asap)/iu.test(lower)) {
    return "high";
  }
  if (/(когда[- ]нибудь|later|не срочно)/iu.test(lower)) {
    return "low";
  }
  return "medium";
}

function detectMood(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/(рад|класс|отлично|happy|great)/iu.test(lower)) {
    return "positive";
  }
  if (/(устал|груст|тревож|sad|anxious|tired)/iu.test(lower)) {
    return "negative";
  }
  return undefined;
}

function buildTopic(text: string): string | undefined {
  const tags = extractTags(text);
  if (tags.length > 0) {
    return tags[0];
  }

  const words = tokenize(text).filter((word) => word.length >= 5);
  return words[0];
}

function cleanupTitle(text: string): string {
  return text
    .replace(/\b(сегодня|завтра|послезавтра|today|tomorrow|day after tomorrow)\b/giu, " ")
    .replace(/\b(через\s+\d+\s+(?:минут|час|часа|часов|дня|дней|день)|in\s+\d+\s+(?:minutes?|hours?|days?))\b/giu, " ")
    .replace(/\b(?:в|at)\s*\d{1,2}(?::\d{2})?\b/giu, " ")
    .replace(/\b(утром|днем|днём|вечером|ночью|in the morning|in the evening|at night)\b/giu, " ")
    .replace(/\b(?:понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "")
    .trim();
}

function parseDateTime(
  text: string,
  timezone: string,
  now: DateTime,
  options: { defaultHour: number }
): DateTime | null {
  const lower = text.toLowerCase();

  const relative = parseRelative(lower, now);
  if (relative) {
    return relative;
  }

  let base: DateTime | null = null;

  if (/\b(сегодня|today)\b/iu.test(lower)) {
    base = now.startOf("day");
  } else if (/\b(завтра|tomorrow)\b/iu.test(lower)) {
    base = now.plus({ days: 1 }).startOf("day");
  } else if (/\b(послезавтра|day after tomorrow)\b/iu.test(lower)) {
    base = now.plus({ days: 2 }).startOf("day");
  } else {
    for (const item of WEEKDAYS) {
      if (item.forms.some((form) => new RegExp(`\\b${escapeRegex(form)}\\b`, "iu").test(lower))) {
        const delta = (item.weekday - now.weekday + 7) % 7;
        const days = delta === 0 ? 7 : delta;
        base = now.plus({ days }).startOf("day");
        break;
      }
    }
  }

  const time = parseClock(lower);
  const dayPartHour = parseDayPartHour(lower);
  if (!base && !time) {
    return null;
  }

  const resolved = (base ?? now.startOf("day")).set({
    hour: time?.hour ?? dayPartHour ?? options.defaultHour,
    minute: time?.minute ?? 0,
    second: 0,
    millisecond: 0
  });

  if (!resolved.isValid) {
    return null;
  }

  if (!base && time && resolved <= now) {
    return resolved.plus({ days: 1 }).setZone(timezone);
  }

  if (base && /\b(сегодня|today)\b/iu.test(lower) && resolved <= now) {
    return resolved.plus({ days: 1 });
  }

  return resolved;
}

function parseRelative(text: string, now: DateTime): DateTime | null {
  const hourMatch = text.match(/\b(?:через|in)\s+(\d+)\s*(?:час|часа|часов|hours?)\b/iu);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (Number.isFinite(hours) && hours > 0) {
      return now.plus({ hours }).startOf("minute");
    }
  }

  const minuteMatch = text.match(/\b(?:через|in)\s+(\d+)\s*(?:минут|мин|minutes?)\b/iu);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (Number.isFinite(minutes) && minutes > 0) {
      return now.plus({ minutes }).startOf("minute");
    }
  }

  const dayMatch = text.match(/\b(?:через|in)\s+(\d+)\s*(?:дня|дней|день|days?)\b/iu);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    if (Number.isFinite(days) && days > 0) {
      return now.plus({ days }).startOf("minute");
    }
  }

  return null;
}

function parseDayPartHour(text: string): number | null {
  if (/\b(утром|in the morning)\b/iu.test(text)) {
    return 9;
  }
  if (/\b(днем|днём|in the afternoon)\b/iu.test(text)) {
    return 14;
  }
  if (/\b(вечером|in the evening)\b/iu.test(text)) {
    return 19;
  }
  if (/\b(ночью|at night)\b/iu.test(text)) {
    return 22;
  }
  return null;
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const withPrefix = text.match(/\b(?:в|at)\s*(\d{1,2})(?::(\d{2}))?\b/iu);
  const noPrefix = text.match(/\b(\d{1,2})[:.](\d{2})\b/u);
  const match = withPrefix ?? noPrefix;
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function extractTags(text: string): string[] {
  const hashtags = [...text.matchAll(/#([\p{L}\p{N}_-]{2,30})/gu)].map((item) => item[1].toLowerCase());
  const topWords = topKeywords(text);

  return uniq([...hashtags, ...topWords]).slice(0, 5);
}

function topKeywords(text: string): string[] {
  const stopwords = new Set([
    "это",
    "как",
    "что",
    "чтобы",
    "потом",
    "нужно",
    "надо",
    "сегодня",
    "завтра",
    "в",
    "на",
    "по",
    "и",
    "a",
    "the",
    "to",
    "for",
    "today",
    "tomorrow"
  ]);

  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (token.length < 4 || stopwords.has(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((item) => item[0]);
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []).map((item) => item.trim()).filter(Boolean);
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isSupportedType(type: InboxItemType): boolean {
  return ["event", "task", "reminder", "note", "journal"].includes(type);
}
