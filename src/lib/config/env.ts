export const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "",
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
  ICLOUD_APPLE_ID: process.env.ICLOUD_APPLE_ID ?? "",
  ICLOUD_APP_SPECIFIC_PASSWORD: process.env.ICLOUD_APP_SPECIFIC_PASSWORD ?? "",
  ICLOUD_CALDAV_BASE_URL: process.env.ICLOUD_CALDAV_BASE_URL ?? "https://caldav.icloud.com",
  ICLOUD_CALENDAR_NAME: process.env.ICLOUD_CALENDAR_NAME ?? "Helper",
  TRANSCRIBER: process.env.TRANSCRIBER ?? "mock",
  EVENT_PARSER: process.env.EVENT_PARSER ?? "rules",
  WHISPER_CPP_BIN: process.env.WHISPER_CPP_BIN ?? "whisper-cli",
  WHISPER_MODEL_PATH: process.env.WHISPER_MODEL_PATH ?? "",
  WHISPER_LANGUAGE: process.env.WHISPER_LANGUAGE ?? "auto",
  WHISPER_THREADS: process.env.WHISPER_THREADS ?? "",
  WHISPER_INITIAL_PROMPT: process.env.WHISPER_INITIAL_PROMPT ?? "",
  WHISPER_BEAM_SIZE: process.env.WHISPER_BEAM_SIZE ?? "",
  WHISPER_BEST_OF: process.env.WHISPER_BEST_OF ?? "",
  WHISPER_NO_TIMESTAMPS: process.env.WHISPER_NO_TIMESTAMPS ?? "1",
  WHISPER_SUPPRESS_NON_SPEECH: process.env.WHISPER_SUPPRESS_NON_SPEECH ?? "1",
  WHISPER_AUDIO_FILTER: process.env.WHISPER_AUDIO_FILTER ?? "",
  WHISPER_VAD_MODEL_PATH: process.env.WHISPER_VAD_MODEL_PATH ?? "",
  WHISPER_VAD_THRESHOLD: process.env.WHISPER_VAD_THRESHOLD ?? "",
  FASTER_WHISPER_PYTHON_BIN: process.env.FASTER_WHISPER_PYTHON_BIN ?? "python3",
  FASTER_WHISPER_SCRIPT_PATH:
    process.env.FASTER_WHISPER_SCRIPT_PATH ?? "src/lib/transcriber/scripts/faster_whisper_transcribe.py",
  FASTER_WHISPER_MODEL: process.env.FASTER_WHISPER_MODEL ?? "small",
  FASTER_WHISPER_DEVICE: process.env.FASTER_WHISPER_DEVICE ?? "auto",
  FASTER_WHISPER_COMPUTE_TYPE: process.env.FASTER_WHISPER_COMPUTE_TYPE ?? "int8",
  FASTER_WHISPER_LANGUAGE: process.env.FASTER_WHISPER_LANGUAGE ?? "ru",
  FASTER_WHISPER_BEAM_SIZE: process.env.FASTER_WHISPER_BEAM_SIZE ?? "5",
  FASTER_WHISPER_BEST_OF: process.env.FASTER_WHISPER_BEST_OF ?? "5",
  FASTER_WHISPER_VAD_FILTER: process.env.FASTER_WHISPER_VAD_FILTER ?? "1",
  FASTER_WHISPER_TIMEOUT_MS: process.env.FASTER_WHISPER_TIMEOUT_MS ?? "300000",
  OLLAMA_ENABLED: process.env.OLLAMA_ENABLED ?? "0",
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? "llama3.2",
  TELEGRAM_RATE_LIMIT_PER_MINUTE: process.env.TELEGRAM_RATE_LIMIT_PER_MINUTE ?? "25",
  LLM_ENABLED: process.env.LLM_ENABLED ?? "0",
  LLM_PROVIDER: process.env.LLM_PROVIDER ?? "openrouter",
  LLM_API_KEY: process.env.LLM_API_KEY ?? "",
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? "",
  LLM_MODEL: process.env.LLM_MODEL ?? "",
  LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS ?? "20000",
  LLM_MAX_TOKENS: process.env.LLM_MAX_TOKENS ?? "900",
  LLM_TEMPERATURE: process.env.LLM_TEMPERATURE ?? "0.2",
  LLM_APP_URL: process.env.LLM_APP_URL ?? "http://localhost:3000",
  LLM_APP_NAME: process.env.LLM_APP_NAME ?? "telegram-voice-assistant"
};

export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}
