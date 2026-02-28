import { env } from "@/lib/config/env";

const WINDOW_MS = 60_000;
const eventsByUser = new Map<string, number[]>();

export function consumeUserRateLimit(userId: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const limit = parseLimit(env.TELEGRAM_RATE_LIMIT_PER_MINUTE);
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const events = eventsByUser.get(userId) ?? [];
  const fresh = events.filter((ts) => ts >= windowStart);

  if (fresh.length >= limit) {
    const oldestInWindow = fresh[0];
    const retryAfter = Math.max(1, Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000));
    eventsByUser.set(userId, fresh);
    return { ok: false, retryAfterSeconds: retryAfter };
  }

  fresh.push(now);
  eventsByUser.set(userId, fresh);
  return { ok: true };
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 25;
  }
  return Math.trunc(parsed);
}
