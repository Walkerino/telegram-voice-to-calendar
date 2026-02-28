import { env } from "@/lib/config/env";
import type { IEventParser } from "./IEventParser";
import { RulesEventParser } from "./rules-event-parser";

let parserSingleton: IEventParser | undefined;

export function getEventParser(): IEventParser {
  if (parserSingleton) {
    return parserSingleton;
  }

  if (env.EVENT_PARSER === "llm") {
    console.warn("EVENT_PARSER=llm is not implemented in MVP. Falling back to rules parser.");
  }

  parserSingleton = new RulesEventParser();
  return parserSingleton;
}
