import { env } from "@/lib/config/env";

export type LlmProvider = "openrouter" | "groq" | "custom";

export type LlmClientConfig = {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  appUrl?: string;
  appName?: string;
};

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmChatOptions = {
  maxTokens?: number;
  temperature?: number;
};

export class OpenAICompatibleClient {
  constructor(private readonly config: LlmClientConfig) {}

  async chat(messages: LlmMessage[], options: LlmChatOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(buildChatCompletionsUrl(this.config.baseUrl), {
        method: "POST",
        headers: buildHeaders(this.config),
        body: JSON.stringify({
          model: this.config.model,
          messages,
          max_tokens: options.maxTokens ?? this.config.maxTokens,
          temperature: options.temperature ?? this.config.temperature
        }),
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status} ${response.statusText} ${text.slice(0, 300)}`);
      }

      const parsed = safeParseJson(text) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      } | null;

      const content = parsed?.choices?.[0]?.message?.content;
      const normalized = normalizeContent(content);
      if (!normalized) {
        throw new Error("LLM response content is empty");
      }

      return normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function buildLlmClientConfig(): LlmClientConfig | null {
  if (!isEnabled(env.LLM_ENABLED)) {
    return null;
  }

  const apiKey = env.LLM_API_KEY.trim();
  const model = env.LLM_MODEL.trim();
  if (!apiKey || !model) {
    return null;
  }

  const provider = parseProvider(env.LLM_PROVIDER);
  const baseUrl = env.LLM_BASE_URL.trim() || defaultBaseUrl(provider);
  const timeoutMs = parsePositiveInt(env.LLM_TIMEOUT_MS, 20_000);
  const maxTokens = parsePositiveInt(env.LLM_MAX_TOKENS, 900);
  const temperature = parseTemperature(env.LLM_TEMPERATURE, 0.2);

  return {
    provider,
    apiKey,
    model,
    baseUrl,
    timeoutMs,
    maxTokens,
    temperature,
    appUrl: env.LLM_APP_URL.trim() || undefined,
    appName: env.LLM_APP_NAME.trim() || undefined
  };
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const source = text.trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const payload = (fenced?.[1] ?? source).trim();

  const direct = safeParseJson(payload);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const start = payload.indexOf("{");
  const end = payload.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const sliced = payload.slice(start, end + 1);
  const parsed = safeParseJson(sliced);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  return null;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}/chat/completions`;
}

function buildHeaders(config: LlmClientConfig): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json"
  };

  if (config.provider === "openrouter") {
    if (config.appUrl) {
      headers["HTTP-Referer"] = config.appUrl;
    }
    if (config.appName) {
      headers["X-Title"] = config.appName;
    }
  }

  return headers;
}

function normalizeContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const record = item as Record<string, unknown>;
        return typeof record.text === "string" ? record.text : "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseProvider(value: string): LlmProvider {
  const normalized = value.trim().toLowerCase();
  if (normalized === "groq") {
    return "groq";
  }
  if (normalized === "custom") {
    return "custom";
  }
  return "openrouter";
}

function defaultBaseUrl(provider: LlmProvider): string {
  if (provider === "groq") {
    return "https://api.groq.com/openai/v1";
  }
  if (provider === "custom") {
    return "";
  }
  return "https://openrouter.ai/api/v1";
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function parseTemperature(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 2) {
    return 2;
  }
  return parsed;
}

function isEnabled(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
