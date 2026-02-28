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

      const transcript = normalizeTranscript(await readFile(outputTxt, "utf-8"));
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
  const args = ["-y", "-i", sourceFile, "-vn", "-sn", "-dn", "-ar", "16000", "-ac", "1"];
  const audioFilter = env.WHISPER_AUDIO_FILTER.trim();
  if (audioFilter) {
    args.push("-af", audioFilter);
  }
  args.push("-c:a", "pcm_s16le", wavFile);

  try {
    await execFileAsync(FFMPEG_BIN, args, {
      timeout: TRANSCRIBE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024
    });
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

  if (isEnabled(env.WHISPER_NO_TIMESTAMPS, true)) {
    args.push("-nt");
  }

  if (isEnabled(env.WHISPER_SUPPRESS_NON_SPEECH, true)) {
    args.push("-sns");
  }

  const prompt = env.WHISPER_INITIAL_PROMPT.trim();
  if (prompt) {
    args.push("--prompt", prompt, "--carry-initial-prompt");
  }

  const bestOf = parsePositiveInt(env.WHISPER_BEST_OF);
  if (bestOf !== null) {
    args.push("-bo", String(bestOf));
  }

  const beamSize = parsePositiveInt(env.WHISPER_BEAM_SIZE);
  if (beamSize !== null) {
    args.push("-bs", String(beamSize));
  }

  const threads = Number(env.WHISPER_THREADS);
  if (Number.isFinite(threads) && threads > 0) {
    args.push("-t", String(Math.trunc(threads)));
  }

  const vadModelPath = env.WHISPER_VAD_MODEL_PATH.trim();
  if (vadModelPath) {
    args.push("--vad", "-vm", vadModelPath);

    const vadThreshold = parsePositiveFloat(env.WHISPER_VAD_THRESHOLD);
    if (vadThreshold !== null) {
      args.push("-vt", String(vadThreshold));
    }
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

function normalizeTranscript(raw: string): string {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\[(?:BLANK_AUDIO|MUSIC|APPLAUSE|LAUGHTER)\]/giu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
}

function parsePositiveFloat(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function isEnabled(value: string, defaultValue: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}
