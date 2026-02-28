import { env } from "@/lib/config/env";
import type { ITranscriber, TranscribeInput, TranscribeOutput } from "./ITranscriber";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = "ffmpeg";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class FasterWhisperTranscriber implements ITranscriber {
  async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
    const workDir = await mkdtemp(join(tmpdir(), "tg-voice-faster-whisper-"));
    const sourceFile = join(workDir, input.fileName ?? "voice.ogg");
    const wavFile = join(workDir, "voice.wav");

    try {
      await writeFile(sourceFile, input.audio);
      await convertToWav(sourceFile, wavFile);

      const transcript = await runFasterWhisper(wavFile);
      if (!transcript) {
        throw new Error("faster-whisper returned empty transcription");
      }

      return {
        text: transcript,
        provider: "faster-whisper-local"
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
      timeout: parseTimeout(),
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    throw toCommandError(error, "ffmpeg conversion failed");
  }
}

async function runFasterWhisper(wavFile: string): Promise<string> {
  const scriptPath = env.FASTER_WHISPER_SCRIPT_PATH.trim() || "src/lib/transcriber/scripts/faster_whisper_transcribe.py";
  const pythonBin = env.FASTER_WHISPER_PYTHON_BIN.trim() || "python3";
  const args = [
    scriptPath,
    "--input",
    wavFile,
    "--model",
    env.FASTER_WHISPER_MODEL.trim() || "small",
    "--device",
    env.FASTER_WHISPER_DEVICE.trim() || "auto",
    "--compute-type",
    env.FASTER_WHISPER_COMPUTE_TYPE.trim() || "int8"
  ];

  const language = env.FASTER_WHISPER_LANGUAGE.trim();
  if (language && language.toLowerCase() !== "auto") {
    args.push("--language", language);
  }

  const beamSize = parsePositiveInt(env.FASTER_WHISPER_BEAM_SIZE, 5);
  args.push("--beam-size", String(beamSize));

  const bestOf = parsePositiveInt(env.FASTER_WHISPER_BEST_OF, 5);
  args.push("--best-of", String(bestOf));

  const initialPrompt = env.WHISPER_INITIAL_PROMPT.trim();
  if (initialPrompt) {
    args.push("--initial-prompt", initialPrompt);
  }

  if (isEnabled(env.FASTER_WHISPER_VAD_FILTER, true)) {
    args.push("--vad-filter");
  }

  const threads = parsePositiveInt(env.WHISPER_THREADS, 0);
  if (threads > 0) {
    args.push("--cpu-threads", String(threads));
  }

  try {
    const { stdout } = await execFileAsync(pythonBin, args, {
      timeout: parseTimeout(),
      maxBuffer: 10 * 1024 * 1024
    });

    const parsed = parseJson(stdout);
    const text = typeof parsed?.text === "string" ? parsed.text : "";
    return normalizeTranscript(text);
  } catch (error) {
    throw toCommandError(error, "faster-whisper transcription failed");
  }
}

function parseJson(raw: string): Record<string, unknown> | null {
  const source = raw.trim();
  if (!source) {
    return null;
  }

  try {
    const json = JSON.parse(source);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return json as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTimeout(): number {
  const raw = Number(env.FASTER_WHISPER_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.trunc(raw);
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

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function isEnabled(value: string, defaultValue: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}
