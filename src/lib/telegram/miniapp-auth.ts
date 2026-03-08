import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/config/env";

export type MiniAppAuthUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type MiniAppAuthPayload = {
  user: MiniAppAuthUser;
};

const AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyTelegramMiniAppInitData(initData: string): MiniAppAuthPayload {
  const source = initData.trim();
  if (!source) {
    throw new Error("Missing initData");
  }

  const params = new URLSearchParams(source);
  const hash = params.get("hash");
  if (!hash) {
    throw new Error("Missing hash in initData");
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) {
    throw new Error("Missing auth_date in initData");
  }
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) {
    throw new Error("Invalid auth_date in initData");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - authDate) > AUTH_MAX_AGE_SECONDS) {
    throw new Error("initData is expired");
  }

  const dataCheckString = buildDataCheckString(params);
  const expectedHash = createInitDataHash(dataCheckString, requireEnv("TELEGRAM_BOT_TOKEN"));

  if (!safeEqualHex(expectedHash, hash)) {
    throw new Error("initData signature mismatch");
  }

  const rawUser = params.get("user");
  if (!rawUser) {
    throw new Error("Missing user in initData");
  }

  let userValue: unknown;
  try {
    userValue = JSON.parse(rawUser);
  } catch {
    throw new Error("Invalid user JSON in initData");
  }

  if (!isMiniAppUser(userValue)) {
    throw new Error("Invalid user payload in initData");
  }

  return { user: userValue };
}

function buildDataCheckString(params: URLSearchParams): string {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") {
      continue;
    }
    entries.push([key, value]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return entries.map(([key, value]) => `${key}=${value}`).join("\n");
}

function createInitDataHash(dataCheckString: string, botToken: string): string {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isMiniAppUser(value: unknown): value is MiniAppAuthUser {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "number" || !Number.isFinite(candidate.id)) {
    return false;
  }

  const optionalTextKeys = ["first_name", "last_name", "username", "language_code"] as const;
  for (const key of optionalTextKeys) {
    const current = candidate[key];
    if (typeof current !== "undefined" && typeof current !== "string") {
      return false;
    }
  }

  return true;
}

