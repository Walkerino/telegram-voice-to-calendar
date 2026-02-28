import type { ITranscriber, TranscribeInput, TranscribeOutput } from "./ITranscriber";

const DEFAULT_MOCK_TEXT = "Встреча завтра в 18:30 на час";

export class MockTranscriber implements ITranscriber {
  async transcribe(_input: TranscribeInput): Promise<TranscribeOutput> {
    return {
      text: process.env.MOCK_TRANSCRIPT_TEXT?.trim() || DEFAULT_MOCK_TEXT,
      provider: "mock"
    };
  }
}
