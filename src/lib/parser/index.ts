import { env } from "@/lib/config/env";
import { logWarn } from "@/lib/utils/log";
import type { IEventParser } from "./IEventParser";
import { RulesEventParser } from "./rules-event-parser";

let parserSingleton: IEventParser | undefined;

export function getEventParser(): IEventParser {
  if (parserSingleton) {
    return parserSingleton;
  }

  if (env.EVENT_PARSER === "llm") {
    logWarn("EVENT_PARSER=llm is not implemented in MVP. Falling back to rules parser.");
  }

  parserSingleton = new RulesEventParser();
  return parserSingleton;
}
