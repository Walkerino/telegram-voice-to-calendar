import type { ParseStructuredInput, ParseStructuredOutput } from "./types";

export interface IParser {
  parse(input: ParseStructuredInput): Promise<ParseStructuredOutput>;
}
