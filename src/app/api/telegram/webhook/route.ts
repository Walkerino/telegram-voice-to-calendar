import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { getInitializedTelegramBot } from "@/lib/telegram/bot";
import { logError } from "@/lib/utils/log";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "telegram_webhook" });
}

export async function POST(request: Request) {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let update: unknown;

  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  try {
    const bot = await getInitializedTelegramBot();
    await bot.handleUpdate(update as never);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("telegram webhook failed", {
      reason: error instanceof Error ? error.message : "unknown"
    });

    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
