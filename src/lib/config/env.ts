export const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "",
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
  TRANSCRIBER: process.env.TRANSCRIBER ?? "mock",
  EVENT_PARSER: process.env.EVENT_PARSER ?? "rules",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? ""
};

export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}
