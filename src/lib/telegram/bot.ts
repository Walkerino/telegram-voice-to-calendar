import { Bot } from "grammy";
import { requireEnv } from "@/lib/config/env";
import { registerHandlers } from "@/lib/telegram/handlers";

const globalScope = globalThis as unknown as {
  telegramBot?: Bot;
};

export function getTelegramBot(): Bot {
  if (globalScope.telegramBot) {
    return globalScope.telegramBot;
  }

  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const bot = new Bot(token);

  registerHandlers(bot);

  globalScope.telegramBot = bot;
  return bot;
}
