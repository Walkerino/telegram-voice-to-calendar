import { env } from "@/lib/config/env";
import type { ITranscriber, TranscribeInput, TranscribeOutput } from "./ITranscriber";

export class WhisperTranscriber implements ITranscriber {
  async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for whisper transcriber");
    }

    const form = new FormData();
    const blob = new Blob([input.audio], { type: input.mimeType || "audio/ogg" });

    form.append("model", "whisper-1");
    form.append("file", blob, input.fileName ?? "voice.ogg");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: form
    });

    if (!response.ok) {
      throw new Error(`Whisper API failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { text?: string };
    return {
      text: (payload.text ?? "").trim(),
      provider: "whisper"
    };
  }
}
