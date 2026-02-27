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
    transcriberSingleton = new WhisperTranscriber();
    return transcriberSingleton;
  }

  transcriberSingleton = new MockTranscriber();
  return transcriberSingleton;
}
