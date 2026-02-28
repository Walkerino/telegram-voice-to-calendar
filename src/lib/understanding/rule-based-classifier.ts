import type { IClassifier } from "./IClassifier";
import type { ClassifyOutput } from "./types";

const EVENT_HINTS = ["встреч", "созвон", "calendar", "meeting", "event", "календар", "звонок", "appointment"];
const TASK_HINTS = ["сдела", "нужно", "todo", "задач", "купить", "подготов", "отправить", "проверить", "написать"];
const REMINDER_HINTS = ["напомн", "не забуд", "remind", "ping", "пингани"];
const JOURNAL_HINTS = ["дневник", "journal", "сегодня я", "я чувств", "рефлек", "итог дня"];
const TIME_HINT =
  /\b(сегодня|завтра|послезавтра|в\s+\d{1,2}(?::\d{2})?|через\s+\d+\s+(?:минут|час|часа|часов|дня|дней|день)|утром|днем|днём|вечером|ночью|today|tomorrow|day after tomorrow|at\s+\d{1,2}(?::\d{2})?|in the morning|in the evening|at night)\b/iu;

export class RuleBasedClassifier implements IClassifier {
  async classify(text: string): Promise<ClassifyOutput> {
    const source = text.trim();
    const lower = source.toLowerCase();

    if (!source) {
      return {
        type: "note",
        confidence: 0.1,
        reason: "empty_text"
      };
    }

    if (matchesAny(lower, JOURNAL_HINTS)) {
      return {
        type: "journal",
        confidence: 0.85,
        reason: "journal_keywords"
      };
    }

    if (matchesAny(lower, REMINDER_HINTS)) {
      return {
        type: "reminder",
        confidence: 0.88,
        reason: "reminder_keywords"
      };
    }

    const hasEventWords = matchesAny(lower, EVENT_HINTS);
    const hasTime = TIME_HINT.test(lower);
    if (hasEventWords || hasTime) {
      return {
        type: "event",
        confidence: hasEventWords && hasTime ? 0.9 : 0.72,
        reason: hasEventWords ? "event_keywords" : "time_pattern"
      };
    }

    if (matchesAny(lower, TASK_HINTS)) {
      return {
        type: "task",
        confidence: 0.78,
        reason: "task_keywords"
      };
    }

    return {
      type: "note",
      confidence: 0.55,
      reason: "fallback_note"
    };
  }
}

function matchesAny(text: string, hints: string[]): boolean {
  return hints.some((hint) => text.includes(hint));
}
