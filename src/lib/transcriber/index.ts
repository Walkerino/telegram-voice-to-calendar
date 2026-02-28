import { env } from "@/lib/config/env";
import type { ITranscriber } from "./ITranscriber";
import { MockTranscriber } from "./mock-transcriber";
import { WhisperTranscriber } from "./whisper-transcriber";

let transcriberSingleton: ITranscriber | undefined;

export function getTranscriber(): ITranscriber {
  if (transcriberSingleton) {
    return transcriberSingleton;
  }

  if (env.TRANSCRIBER === "whisper") {
    if (!env.WHISPER_MODEL_PATH) {
      console.warn("TRANSCRIBER=whisper selected but WHISPER_MODEL_PATH is missing. Falling back to mock.");
      transcriberSingleton = new MockTranscriber();
      return transcriberSingleton;
    }

    transcriberSingleton = new WhisperTranscriber();
    return transcriberSingleton;
  }

  transcriberSingleton = new MockTranscriber();
  return transcriberSingleton;
}
