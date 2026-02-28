-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "inboxItemId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueAt" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "tags" JSONB,
    "project" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "inboxItemId" TEXT,
    "remindAt" DATETIME NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reminder_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "inboxItemId" TEXT,
    "uid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdInIcloud" BOOLEAN NOT NULL DEFAULT false,
    "providerMeta" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarEvent_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runAt" DATETIME NOT NULL,
    "dedupeKey" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "appleId" TEXT,
    "encryptedAppPassword" TEXT,
    "encryptedSecret" TEXT,
    "calendarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CalendarConnection" ("appleId", "createdAt", "encryptedAppPassword", "id", "provider", "status", "updatedAt", "userId") SELECT "appleId", "createdAt", "encryptedAppPassword", "id", "provider", "status", "updatedAt", "userId" FROM "CalendarConnection";
DROP TABLE "CalendarConnection";
ALTER TABLE "new_CalendarConnection" RENAME TO "CalendarConnection";
CREATE UNIQUE INDEX "CalendarConnection_userId_provider_key" ON "CalendarConnection"("userId", "provider");
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "telegramMessageId" INTEGER NOT NULL,
    "telegramUpdateId" INTEGER,
    "voiceFileId" TEXT,
    "transcript" TEXT,
    "rawText" TEXT,
    "itemType" TEXT NOT NULL DEFAULT 'event',
    "draftJson" JSONB,
    "parsedJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'received',
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("createdAt", "draftJson", "id", "lastError", "status", "telegramChatId", "telegramMessageId", "telegramUpdateId", "transcript", "updatedAt", "userId", "voiceFileId") SELECT "createdAt", "draftJson", "id", "lastError", "status", "telegramChatId", "telegramMessageId", "telegramUpdateId", "transcript", "updatedAt", "userId", "voiceFileId" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_userId_createdAt_idx" ON "Message"("userId", "createdAt" DESC);
CREATE INDEX "Message_userId_itemType_createdAt_idx" ON "Message"("userId", "itemType", "createdAt" DESC);
CREATE UNIQUE INDEX "Message_telegramChatId_telegramMessageId_key" ON "Message"("telegramChatId", "telegramMessageId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegramUserId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Warsaw',
    "defaultReminderMinutes" INTEGER DEFAULT 30,
    "languageCode" TEXT DEFAULT 'ru',
    "state" TEXT NOT NULL DEFAULT 'idle',
    "currentDraftMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "currentDraftMessageId", "defaultReminderMinutes", "firstName", "id", "languageCode", "lastName", "state", "telegramUserId", "telegramUsername", "timezone", "updatedAt") SELECT "createdAt", "currentDraftMessageId", "defaultReminderMinutes", "firstName", "id", "languageCode", "lastName", "state", "telegramUserId", "telegramUsername", "timezone", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Task_inboxItemId_key" ON "Task"("inboxItemId");

-- CreateIndex
CREATE INDEX "Task_userId_status_dueAt_idx" ON "Task"("userId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_inboxItemId_key" ON "Reminder"("inboxItemId");

-- CreateIndex
CREATE INDEX "Reminder_userId_status_remindAt_idx" ON "Reminder"("userId", "status", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_inboxItemId_key" ON "CalendarEvent"("inboxItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_uid_key" ON "CalendarEvent"("uid");

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_startAt_idx" ON "CalendarEvent"("userId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_userId_kind_runAt_idx" ON "Job"("userId", "kind", "runAt");
