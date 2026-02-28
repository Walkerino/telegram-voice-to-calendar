import type { InboxItemType } from "@prisma/client";
import { OpenAICompatibleClient, extractJsonObject } from "@/lib/llm/openai-compatible-client";
import { logWarn } from "@/lib/utils/log";
import type { IClassifier } from "../IClassifier";
import type { ClassifyOutput } from "../types";

const ALLOWED_TYPES: InboxItemType[] = ["event", "task", "reminder", "note", "journal"];

export class LlmClassifier implements IClassifier {
  constructor(
    private readonly client: OpenAICompatibleClient,
    private readonly fallback: IClassifier
  ) {}

  async classify(text: string): Promise<ClassifyOutput> {
    const source = text.trim();
    if (!source) {
      return this.fallback.classify(text);
    }

    try {
      const response = await this.client.chat(
        [
          {
            role: "system",
            content:
              "You classify voice inbox notes into one type: event, task, reminder, note, journal. Return JSON only: {\"type\":\"...\",\"confidence\":0..1,\"reason\":\"short\"}."
          },
          {
            role: "user",
            content: `Text:\n${source}`
          }
        ],
        { temperature: 0.1, maxTokens: 220 }
      );

      const json = extractJsonObject(response);
      if (!json) {
        throw new Error("LLM classifier returned non-JSON output");
      }

      const type = normalizeType(json.type);
      if (!type) {
        throw new Error("LLM classifier returned invalid type");
      }

      return {
        type,
        confidence: normalizeConfidence(json.confidence),
        reason: typeof json.reason === "string" ? json.reason.slice(0, 80) : "llm"
      };
    } catch (error) {
      logWarn("llm classifier fallback", {
        reason: error instanceof Error ? error.message : "unknown"
      });
      return this.fallback.classify(text);
    }
  }
}

function normalizeType(value: unknown): InboxItemType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!ALLOWED_TYPES.includes(normalized as InboxItemType)) {
    return null;
  }

  return normalized as InboxItemType;
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
