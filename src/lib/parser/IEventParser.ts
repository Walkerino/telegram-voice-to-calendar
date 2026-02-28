import type { ParseResult } from "@/lib/types/event";

export type ParseInput = {
  text: string;
  timezone: string;
  now?: Date;
};

export interface IEventParser {
  parse(input: ParseInput): Promise<ParseResult>;
}
