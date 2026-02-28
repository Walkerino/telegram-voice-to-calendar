import { DateTime } from "luxon";
import { OpenAICompatibleClient } from "@/lib/llm/openai-compatible-client";
import { logWarn } from "@/lib/utils/log";
import type { IInsightEngine } from "../IInsightEngine";
import type { DailyDigestInput, DigestOutput } from "../types";

export class LlmInsightEngine implements IInsightEngine {
  constructor(
    private readonly client: OpenAICompatibleClient,
    private readonly fallback: IInsightEngine
  ) {}

  async dailyDigest(input: DailyDigestInput): Promise<DigestOutput> {
    try {
      const payload = {
        date: DateTime.fromJSDate(input.date, { zone: input.timezone }).toFormat("yyyy-LL-dd"),
        timezone: input.timezone,
        inboxItemsCount: input.inboxItemsCount,
        openTasks: input.openTasks.map((task) => ({
          title: task.title,
          dueAt: task.dueAt ? DateTime.fromJSDate(task.dueAt, { zone: "utc" }).toISO() : null,
          priority: task.priority,
          tags: task.tags
        })),
        remindersTomorrow: input.remindersTomorrow.map((reminder) => ({
          remindAt: DateTime.fromJSDate(reminder.remindAt, { zone: "utc" }).toISO(),
          message: reminder.message
        })),
        tomorrowEvents: input.tomorrowEvents.map((event) => ({
          title: event.title,
          startAt: DateTime.fromJSDate(event.startAt, { zone: "utc" }).toISO(),
          endAt: DateTime.fromJSDate(event.endAt, { zone: "utc" }).toISO()
        })),
        recentNotes: input.recentNotes
      };

      const response = await this.client.chat(
        [
          {
            role: "system",
            content:
              "You are a concise personal productivity assistant. Build a practical daily digest in Russian with actionable next steps. Keep it short and structured."
          },
          {
            role: "user",
            content: `Create digest from data:\n${JSON.stringify(payload)}`
          }
        ],
        { temperature: 0.3, maxTokens: 750 }
      );

      const message = response.trim();
      if (!message) {
        throw new Error("LLM digest is empty");
      }

      return {
        message
      };
    } catch (error) {
      logWarn("llm digest fallback", {
        reason: error instanceof Error ? error.message : "unknown"
      });
      return this.fallback.dailyDigest(input);
    }
  }
}
