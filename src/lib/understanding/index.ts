import { env } from "@/lib/config/env";
import { buildLlmClientConfig, OpenAICompatibleClient } from "@/lib/llm/openai-compatible-client";
import { logInfo, logWarn } from "@/lib/utils/log";
import type { IClassifier } from "./IClassifier";
import type { IParser } from "./IParser";
import type { IInsightEngine } from "./IInsightEngine";
import { LlmClassifier } from "./llm/llm-classifier";
import { LlmInsightEngine } from "./llm/llm-insight-engine";
import { LlmStructuredParser } from "./llm/llm-parser";
import { RuleBasedClassifier } from "./rule-based-classifier";
import { RuleBasedParser } from "./rule-based-parser";
import { SimpleInsightEngine } from "./simple-insight-engine";

let classifierSingleton: IClassifier | undefined;
let parserSingleton: IParser | undefined;
let insightSingleton: IInsightEngine | undefined;
let llmClientSingleton: OpenAICompatibleClient | undefined;

export function getClassifier(): IClassifier {
  if (!classifierSingleton) {
    const fallback = new RuleBasedClassifier();
    const llmClient = getOptionalLlmClient();
    classifierSingleton = llmClient ? new LlmClassifier(llmClient, fallback) : fallback;
  }
  return classifierSingleton;
}

export function getStructuredParser(): IParser {
  if (!parserSingleton) {
    const fallback = new RuleBasedParser();
    const llmClient = getOptionalLlmClient();
    parserSingleton = llmClient ? new LlmStructuredParser(llmClient, fallback) : fallback;
  }
  return parserSingleton;
}

export function getInsightEngine(): IInsightEngine {
  if (!insightSingleton) {
    const fallback = new SimpleInsightEngine();
    const llmClient = getOptionalLlmClient();
    insightSingleton = llmClient ? new LlmInsightEngine(llmClient, fallback) : fallback;
  }
  return insightSingleton;
}

function getOptionalLlmClient(): OpenAICompatibleClient | undefined {
  if (llmClientSingleton) {
    return llmClientSingleton;
  }

  const config = buildLlmClientConfig();
  if (!config) {
    return undefined;
  }

  if (config.provider === "custom" && !config.baseUrl) {
    logWarn("LLM custom provider enabled but LLM_BASE_URL is empty. Falling back to rules.");
    return undefined;
  }

  llmClientSingleton = new OpenAICompatibleClient(config);
  logInfo("LLM provider enabled", {
    provider: config.provider,
    model: config.model
  });
  return llmClientSingleton;
}
