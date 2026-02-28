import type { DailyDigestInput, DigestOutput } from "./types";

export interface IInsightEngine {
  dailyDigest(input: DailyDigestInput): Promise<DigestOutput>;
}
