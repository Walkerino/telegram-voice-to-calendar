import { env } from "@/lib/config/env";
import { logWarn } from "@/lib/utils/log";
import type { ITranscriber } from "./ITranscriber";
import { FasterWhisperTranscriber } from "./faster-whisper-transcriber";
import { MockTranscriber } from "./mock-transcriber";
import { WhisperTranscriber } from "./whisper-transcriber";

let transcriberSingleton: ITranscriber | undefined;

export function getTranscriber(): ITranscriber {
  if (transcriberSingleton) {
    return transcriberSingleton;
  }

  if (env.TRANSCRIBER === "whisper") {
    if (!env.WHISPER_MODEL_PATH) {
      logWarn("TRANSCRIBER=whisper selected but WHISPER_MODEL_PATH is missing. Falling back to mock.");
      transcriberSingleton = new MockTranscriber();
      return transcriberSingleton;
    }
    if (/base/i.test(env.WHISPER_MODEL_PATH)) {
      logWarn("Using Whisper base model may be inaccurate. Prefer small/medium model for better STT quality.");
    }

    transcriberSingleton = new WhisperTranscriber();
    return transcriberSingleton;
  }

  if (env.TRANSCRIBER === "faster-whisper") {
    const model = env.FASTER_WHISPER_MODEL.trim() || "small";
    if (model === "base") {
      logWarn("Using faster-whisper base model may be inaccurate. Prefer small/medium model.");
    }

    transcriberSingleton = new FasterWhisperTranscriber();
    return transcriberSingleton;
  }

  transcriberSingleton = new MockTranscriber();
  return transcriberSingleton;
}
