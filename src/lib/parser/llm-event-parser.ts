import type { ParseResult } from "@/lib/types/event";
import type { IEventParser, ParseInput } from "./IEventParser";

export class LlmEventParser implements IEventParser {
  async parse(_input: ParseInput): Promise<ParseResult> {
    throw new Error("LLM parser adapter is not configured for MVP");
  }
}
