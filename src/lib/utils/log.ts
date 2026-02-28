type LogLevel = "info" | "warn" | "error";

const REDACTED = "<redacted>";
const PROD = process.env.NODE_ENV === "production";

const SENSITIVE_KEYS = [
  "password",
  "secret",
  "token",
  "authorization",
  "encryptedapppassword",
  "encryptedsecret",
  "transcript",
  "rawtext",
  "feedback"
];

export function logInfo(message: string, payload?: unknown): void {
  log("info", message, payload);
}

export function logWarn(message: string, payload?: unknown): void {
  log("warn", message, payload);
}

export function logError(message: string, payload?: unknown): void {
  log("error", message, payload);
}

function log(level: LogLevel, message: string, payload?: unknown): void {
  const logger = level === "info" ? console.info : level === "warn" ? console.warn : console.error;

  if (typeof payload === "undefined") {
    logger(message);
    return;
  }

  logger(message, sanitizePayload(payload));
}

function sanitizePayload(value: unknown): unknown {
  if (!PROD) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, current] of Object.entries(source)) {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sensitive) => normalizedKey.includes(sensitive))) {
      result[key] = REDACTED;
      continue;
    }

    result[key] = sanitizePayload(current);
  }

  return result;
}
