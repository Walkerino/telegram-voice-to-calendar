-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
INSERT INTO "new_User" ("createdAt", "currentDraftMessageId", "defaultReminderMinutes", "firstName", "id", "languageCode", "lastName", "state", "telegramUserId", "telegramUsername", "timezone", "updatedAt") SELECT "createdAt", "currentDraftMessageId", CASE WHEN "defaultReminderMinutes" IS NULL OR "defaultReminderMinutes" = 10 THEN 30 ELSE "defaultReminderMinutes" END, "firstName", "id", "languageCode", "lastName", "state", "telegramUserId", "telegramUsername", "timezone", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
