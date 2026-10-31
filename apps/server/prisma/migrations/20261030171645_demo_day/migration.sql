-- CreateTable
CREATE TABLE "PresenterSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DemoSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'lobby',
    "practice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateTable
CREATE TABLE "DemoParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "telegramId" TEXT,
    "nickname" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "notified" TEXT,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DemoSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DemoActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct" INTEGER,
    "explanation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resultCounts" JSONB,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "DemoActivity_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DemoSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DemoVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "choice" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoVote_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "DemoActivity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemoVote_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "DemoParticipant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoSession_code_key" ON "DemoSession"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DemoParticipant_tokenHash_key" ON "DemoParticipant"("tokenHash");

-- CreateIndex
CREATE INDEX "DemoParticipant_sessionId_idx" ON "DemoParticipant"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoParticipant_sessionId_telegramId_key" ON "DemoParticipant"("sessionId", "telegramId");

-- CreateIndex
CREATE INDEX "DemoActivity_sessionId_openedAt_idx" ON "DemoActivity"("sessionId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DemoVote_activityId_participantId_key" ON "DemoVote"("activityId", "participantId");
