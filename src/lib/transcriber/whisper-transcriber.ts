import { env } from "@/lib/config/env";
import type { ITranscriber, TranscribeInput, TranscribeOutput } from "./ITranscriber";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = "ffmpeg";
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

export class WhisperTranscriber implements ITranscriber {
  async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
    if (!env.WHISPER_MODEL_PATH) {
      throw new Error("WHISPER_MODEL_PATH is required for local whisper transcriber");
    }

    const workDir = await mkdtemp(join(tmpdir(), "tg-voice-whisper-"));
    const sourceFile = join(workDir, input.fileName ?? "voice.ogg");
    const wavFile = join(workDir, "voice.wav");
    const outputBase = join(workDir, "transcript");
    const outputTxt = `${outputBase}.txt`;

    try {
      await writeFile(sourceFile, input.audio);
      await convertToWav(sourceFile, wavFile);
      await runWhisperCpp(wavFile, outputBase);

      const transcript = (await readFile(outputTxt, "utf-8")).trim();
      if (!transcript) {
        throw new Error("Local whisper returned empty transcription");
      }

      return {
        text: transcript,
        provider: "whisper-local"
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

async function convertToWav(sourceFile: string, wavFile: string): Promise<void> {
  try {
    await execFileAsync(
      FFMPEG_BIN,
      ["-y", "-i", sourceFile, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavFile],
      {
        timeout: TRANSCRIBE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024
      }
    );
  } catch (error) {
    throw toCommandError(error, "ffmpeg conversion failed");
  }
}

async function runWhisperCpp(wavFile: string, outputBase: string): Promise<void> {
  const args = ["-m", env.WHISPER_MODEL_PATH, "-f", wavFile, "-otxt", "-of", outputBase];
  const language = env.WHISPER_LANGUAGE.trim();
  if (language && language.toLowerCase() !== "auto") {
    args.push("-l", language);
  }

  const threads = Number(env.WHISPER_THREADS);
  if (Number.isFinite(threads) && threads > 0) {
    args.push("-t", String(Math.trunc(threads)));
  }

  try {
    await execFileAsync(env.WHISPER_CPP_BIN, args, {
      timeout: TRANSCRIBE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    throw toCommandError(error, "whisper.cpp transcription failed");
  }
}

function toCommandError(error: unknown, prefix: string): Error {
  if (error instanceof Error) {
    const stderr = (error as Error & { stderr?: string }).stderr?.trim();
    if (stderr) {
      return new Error(`${prefix}: ${stderr.slice(0, 400)}`);
    }
    return new Error(`${prefix}: ${error.message}`);
  }
  return new Error(prefix);
}
