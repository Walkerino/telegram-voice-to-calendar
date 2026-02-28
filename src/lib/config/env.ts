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
  WHISPER_VAD_THRESHOLD: process.env.WHISPER_VAD_THRESHOLD ?? ""
};

export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}
