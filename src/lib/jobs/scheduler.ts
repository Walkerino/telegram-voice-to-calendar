import { JobKind, JobStatus, ReminderStatus } from "@prisma/client";
import type { Bot, Context } from "grammy";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { buildDailyDigestMessage } from "@/lib/services/digest";
import { logError } from "@/lib/utils/log";

const POLL_INTERVAL_MS = 60_000;
const MAX_ATTEMPTS = 3;
const DAILY_DIGEST_HOUR = 21;

const globalScope = globalThis as unknown as {
  jobsSchedulerStarted?: boolean;
  jobsSchedulerTimer?: NodeJS.Timeout;
};

type ReminderJobPayload = {
  reminderId: string;
};

type DigestJobPayload = {
  dateIso?: string;
};

export function startJobsScheduler(bot: Bot<Context>): void {
  if (globalScope.jobsSchedulerStarted) {
    return;
  }

  globalScope.jobsSchedulerStarted = true;
  globalScope.jobsSchedulerTimer = setInterval(() => {
    pollDueJobs(bot).catch((error) => {
      logError("job scheduler poll failed", {
        reason: error instanceof Error ? error.message : "unknown"
      });
    });
  }, POLL_INTERVAL_MS);

  void pollDueJobs(bot);
}

export async function enqueueReminderJob(params: {
  userId: string;
  reminderId: string;
  runAt: Date;
}): Promise<void> {
  const dedupeKey = `reminder:${params.reminderId}`;

  await prisma.job.upsert({
    where: { dedupeKey },
    update: {
      runAt: params.runAt,
      status: JobStatus.pending,
      attempts: 0,
      lastError: null,
      payload: {
        reminderId: params.reminderId
      }
    },
    create: {
      userId: params.userId,
      kind: JobKind.reminder,
      runAt: params.runAt,
      dedupeKey,
      payload: {
        reminderId: params.reminderId
      }
    }
  });
}

export async function enqueueDigestJob(params: {
  userId: string;
  runAt: Date;
  dateIso?: string;
}): Promise<void> {
  const dateKey = params.dateIso?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const dedupeKey = `digest:${params.userId}:${dateKey}`;

  await prisma.job.upsert({
    where: { dedupeKey },
    update: {
      runAt: params.runAt,
      status: JobStatus.pending,
      attempts: 0,
      lastError: null,
      payload: { dateIso: params.dateIso }
    },
    create: {
      userId: params.userId,
      kind: JobKind.digest,
      runAt: params.runAt,
      dedupeKey,
      payload: { dateIso: params.dateIso }
    }
  });
}

async function pollDueJobs(bot: Bot<Context>): Promise<void> {
  const now = new Date();
  const jobs = await prisma.job.findMany({
    where: {
      status: JobStatus.pending,
      runAt: { lte: now }
    },
    orderBy: { runAt: "asc" },
    take: 20
  });

  for (const job of jobs) {
    const claim = await prisma.job.updateMany({
      where: {
        id: job.id,
        status: JobStatus.pending
      },
      data: {
        status: JobStatus.running,
        lockedAt: now,
        attempts: { increment: 1 }
      }
    });

    if (claim.count === 0) {
      continue;
    }

    try {
      if (job.kind === JobKind.reminder) {
        await handleReminderJob(bot, job.userId, job.payload as unknown as ReminderJobPayload);
      } else if (job.kind === JobKind.digest) {
        await handleDigestJob(bot, job.userId, job.payload as unknown as DigestJobPayload);
      }

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.completed,
          lockedAt: null,
          lastError: null
        }
      });
    } catch (error) {
      const latest = await prisma.job.findUnique({ where: { id: job.id } });
      const attempts = latest?.attempts ?? 1;
      const failedPermanently = attempts >= MAX_ATTEMPTS;

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: failedPermanently ? JobStatus.failed : JobStatus.pending,
          runAt: failedPermanently ? latest?.runAt : nextRetryAt(1),
          lockedAt: null,
          lastError: safeError(error)
        }
      });
    }
  }
}

async function handleReminderJob(
  bot: Bot<Context>,
  userId: string,
  payload: ReminderJobPayload
): Promise<void> {
  if (!payload.reminderId) {
    throw new Error("reminder payload is invalid");
  }

  const reminder = await prisma.reminder.findUnique({
    where: { id: payload.reminderId },
    include: { user: true }
  });

  if (!reminder || reminder.userId !== userId) {
    return;
  }

  if (reminder.status !== ReminderStatus.pending) {
    return;
  }

  await bot.api.sendMessage(Number(reminder.user.telegramUserId), `⏰ Напоминание: ${reminder.message}`);

  await prisma.reminder.update({
    where: { id: reminder.id },
    data: {
      status: ReminderStatus.sent,
      sentAt: new Date()
    }
  });
}

async function handleDigestJob(bot: Bot<Context>, userId: string, payload: DigestJobPayload): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return;
  }

  const date = payload.dateIso ? new Date(payload.dateIso) : new Date();
  const digest = await buildDailyDigestMessage(user.id, date);
  await bot.api.sendMessage(Number(user.telegramUserId), digest);

  const nextRunAt = calculateNextDigestRunAt(user.timezone || "Europe/Warsaw");
  await enqueueDigestJob({
    userId: user.id,
    runAt: nextRunAt,
    dateIso: DateTime.fromJSDate(nextRunAt, { zone: "utc" }).setZone(user.timezone || "Europe/Warsaw").toFormat("yyyy-LL-dd")
  });
}

function nextRetryAt(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function safeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 300);
  }
  return "unknown";
}

function calculateNextDigestRunAt(timezone: string): Date {
  const now = DateTime.now().setZone(timezone);
  let runAt = now.set({ hour: DAILY_DIGEST_HOUR, minute: 0, second: 0, millisecond: 0 });
  if (runAt <= now) {
    runAt = runAt.plus({ days: 1 });
  }

  return new Date(runAt.toUTC().toISO() as string);
}
