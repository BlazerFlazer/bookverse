-- AlterTable
ALTER TABLE "DemoSession" ADD COLUMN "atmosphere" JSONB;
ALTER TABLE "DemoSession" ADD COLUMN "presenterTelegramId" TEXT;

-- CreateTable
CREATE TABLE "AtmospherePreference" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "preferredAtmospherePreset" TEXT NOT NULL DEFAULT 'rain',
    "atmosphereAudioEnabled" BOOLEAN NOT NULL DEFAULT true,
    "atmosphereVolume" REAL NOT NULL DEFAULT 0.6,
    "autoTimeOfDayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "timeOfDaySource" TEXT NOT NULL DEFAULT 'cycle',
    "preferredManualTimeOfDay" TEXT NOT NULL DEFAULT 'evening',
    "effectsQuality" TEXT NOT NULL DEFAULT 'auto',
    "rainIntensity" TEXT NOT NULL DEFAULT 'medium',
    "lightningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "readingAudioDuckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "utcOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AtmospherePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PresenterLinkToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    CONSTRAINT "PresenterLinkToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DemoSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
