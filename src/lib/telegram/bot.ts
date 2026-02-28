import { Bot } from "grammy";
import { requireEnv } from "@/lib/config/env";
import { registerHandlers } from "@/lib/telegram/handlers";

const globalScope = globalThis as unknown as {
  telegramBot?: Bot;
  telegramBotInitPromise?: Promise<void>;
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

export async function getInitializedTelegramBot(): Promise<Bot> {
  const bot = getTelegramBot();

  if (!globalScope.telegramBotInitPromise) {
    globalScope.telegramBotInitPromise = bot.init().catch((error) => {
      globalScope.telegramBotInitPromise = undefined;
      throw error;
    });
  }

  await globalScope.telegramBotInitPromise;
  return bot;
}
