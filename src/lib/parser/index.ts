import { env } from "@/lib/config/env";
import type { IEventParser } from "./IEventParser";
import { LlmEventParser } from "./llm-event-parser";
import { RulesEventParser } from "./rules-event-parser";

let parserSingleton: IEventParser | undefined;

export function getEventParser(): IEventParser {
  if (parserSingleton) {
    return parserSingleton;
  }

  if (env.EVENT_PARSER === "llm") {
    parserSingleton = new LlmEventParser();
    return parserSingleton;
  }

  parserSingleton = new RulesEventParser();
  return parserSingleton;
}
