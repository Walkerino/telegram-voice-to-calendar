import type { TaskPriority } from "@prisma/client";
import { DateTime } from "luxon";
import { OpenAICompatibleClient, extractJsonObject } from "@/lib/llm/openai-compatible-client";
import { logWarn } from "@/lib/utils/log";
import type { IParser } from "../IParser";
import type { ParseStructuredInput, ParseStructuredOutput, StructuredItem } from "../types";

export class LlmStructuredParser implements IParser {
  constructor(
    private readonly client: OpenAICompatibleClient,
    private readonly fallback: IParser
  ) {}

  async parse(input: ParseStructuredInput): Promise<ParseStructuredOutput> {
    try {
      const now = DateTime.fromJSDate(input.now ?? new Date(), { zone: input.timezone });
      const response = await this.client.chat(
        [
          {
            role: "system",
            content: [
              "You parse inbox text into structured JSON.",
              "Return JSON only with shape:",
              "{",
              '  "question": string|null,',
              '  "confidence": number,',
              '  "item": {',
              '    "type": "event|task|reminder|note|journal",',
              "    ...fields by type",
              "  } | null",
              "}",
              "For event/reminder/task dates use ISO-8601.",
              "If required information is missing, set item=null and provide one short question."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `Input type hint: ${input.type}`,
              `Timezone: ${input.timezone}`,
              `Current local datetime: ${now.toISO()}`,
              `Text: ${input.text}`
            ].join("\n")
          }
        ],
        { temperature: 0.15, maxTokens: 900 }
      );

      const json = extractJsonObject(response);
      if (!json) {
        throw new Error("LLM parser returned non-JSON output");
      }

      const question = typeof json.question === "string" ? json.question.trim() : undefined;
      const confidence = normalizeConfidence(json.confidence);
      const item = normalizeStructuredItem(json.item, input.type, input.timezone);

      if (!item) {
        if (question) {
          return { question, confidence: confidence || 0.45 };
        }
        throw new Error("LLM parser returned invalid structured item");
      }

      return {
        item,
        confidence: confidence || 0.75
      };
    } catch (error) {
      logWarn("llm parser fallback", {
        reason: error instanceof Error ? error.message : "unknown",
        type: input.type
      });
      return this.fallback.parse(input);
    }
  }
}

function normalizeStructuredItem(value: unknown, hintedType: string, timezone: string): StructuredItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const itemType = normalizeType(item.type) ?? normalizeType(hintedType);
  if (!itemType) {
    return null;
  }

  const tags = normalizeTags(item.tags);
  const nextAction = normalizeString(item.nextAction, 120) ?? defaultNextAction(itemType);

  if (itemType === "event") {
    const eventObj = toRecord(item.event) ?? item;
    const title = normalizeString(eventObj.title, 160) ?? "Событие";
    const start = normalizeIso(eventObj.start);
    const end = normalizeIso(eventObj.end);
    if (!start || !end) {
      return null;
    }

    const reminderMinutes = normalizeReminderMinutes(eventObj.remindersMinutesBefore);
    return {
      type: "event",
      event: {
        title,
        description: normalizeString(eventObj.description, 500),
        location: normalizeString(eventObj.location, 160),
        start,
        end,
        timezone: normalizeString(eventObj.timezone, 80) ?? timezone,
        reminders: reminderMinutes.map((minutesBefore) => ({ minutesBefore })),
        confidence: 0.8
      },
      tags,
      nextAction
    };
  }

  if (itemType === "task") {
    const taskObj = toRecord(item.task) ?? item;
    const title = normalizeString(taskObj.title, 160);
    if (!title) {
      return null;
    }

    return {
      type: "task",
      task: {
        title,
        notes: normalizeString(taskObj.notes, 1200),
        dueAt: normalizeIso(taskObj.dueAt) ?? undefined,
        priority: normalizePriority(taskObj.priority),
        tags: normalizeTags(taskObj.tags),
        project: normalizeString(taskObj.project, 80)
      },
      tags,
      nextAction
    };
  }

  if (itemType === "reminder") {
    const reminderObj = toRecord(item.reminder) ?? item;
    const remindAt = normalizeIso(reminderObj.remindAt);
    const message = normalizeString(reminderObj.message, 500);
    if (!remindAt || !message) {
      return null;
    }

    return {
      type: "reminder",
      reminder: {
        remindAt,
        message,
        tags: normalizeTags(reminderObj.tags)
      },
      tags,
      nextAction
    };
  }

  if (itemType === "journal") {
    const journalObj = toRecord(item.journal) ?? item;
    const text = normalizeString(journalObj.text, 3000);
    if (!text) {
      return null;
    }

    return {
      type: "journal",
      journal: {
        text,
        mood: normalizeString(journalObj.mood, 80),
        tags: normalizeTags(journalObj.tags)
      },
      tags,
      nextAction
    };
  }

  const noteObj = toRecord(item.note) ?? item;
  const text = normalizeString(noteObj.text, 3000);
  if (!text) {
    return null;
  }

  return {
    type: "note",
    note: {
      text,
      topic: normalizeString(noteObj.topic, 80),
      tags: normalizeTags(noteObj.tags)
    },
    tags,
    nextAction
  };
}

function normalizeType(value: unknown): StructuredItem["type"] | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["event", "task", "reminder", "note", "journal"].includes(normalized)) {
    return normalized as StructuredItem["type"];
  }
  return null;
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase().replace(/^#/, ""))
    .filter((item) => item.length >= 2)
    .slice(0, 6);

  return [...new Set(tags)];
}

function normalizeReminderMinutes(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [30];
  }

  const minutes = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 14 * 24 * 60)
    .map((item) => Math.trunc(item));

  return minutes.length > 0 ? [...new Set(minutes)].slice(0, 3) : [30];
}

function normalizePriority(value: unknown): TaskPriority {
  if (typeof value !== "string") {
    return "medium";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "high") {
    return normalized;
  }
  return "medium";
}

function normalizeString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLen);
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.7;
  }

  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }

  return Number(value.toFixed(2));
}

function defaultNextAction(type: StructuredItem["type"]): string {
  if (type === "event") {
    return "Проверить время и сохранить в календарь";
  }
  if (type === "task") {
    return "Поставить задачу в работу";
  }
  if (type === "reminder") {
    return "Подтвердить время напоминания";
  }
  if (type === "journal") {
    return "Использовать запись в дневном анализе";
  }
  return "Добавить теги и связь с задачами";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
