import type { FastifyInstance } from 'fastify';
import { ACHIEVEMENTS, levelFromXp, nextRank, rankForLevel } from '@bookverse/game-engine';
import type { ProfileDto } from '@bookverse/shared';
import type { User } from '@prisma/client';
import { requireUser, toUserDto } from '../auth/session.ts';
import { prisma } from '../db.ts';
import { collectStats } from './service.ts';

export async function buildProfile(user: User): Promise<ProfileDto> {
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const [stats, earned, telegram, inProgress] = await Promise.all([
    collectStats(prisma, user.id),
    prisma.userAchievement.findMany({ where: { userId: user.id } }),
    prisma.telegramAccount.findUnique({ where: { userId: user.id } }),
    prisma.readingProgress.count({ where: { userId: user.id, status: 'reading' } }),
  ]);
  const level = levelFromXp(fresh.xp);
  const unlockedAt = new Map(earned.map((a) => [a.code, a.unlockedAt.toISOString()]));
  return {
    user: toUserDto(fresh),
    level: {
      level: level.level,
      rank: rankForLevel(level.level),
      xpIntoLevel: level.xpIntoLevel,
      xpForLevel: level.xpForLevel,
      nextRank: nextRank(level.level),
    },
    stats: {
      booksOpened: stats.booksOpened,
      booksInProgress: inProgress,
      booksCompleted: stats.booksCompleted,
      savedWords: stats.uniqueWords,
      masteredWords: stats.masteredWords,
      quizzesCompleted: stats.quizzesPassed,
      reviewSessions: stats.reviewSessions,
    },
    achievements: ACHIEVEMENTS.map((a) => ({
      code: a.code,
      title: a.title,
      description: a.description,
      icon: a.icon,
      unlockedAt: unlockedAt.get(a.code) ?? null,
    })),
    telegram: { linked: Boolean(telegram), username: telegram?.username ?? null },
  };
}

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/profile', async (request) => buildProfile(requireUser(request)));
}
