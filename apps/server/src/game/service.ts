import {
  achievementByCode,
  evaluateAchievements,
  levelFromXp,
  rankForLevel,
  rewardKey,
  type GameStats,
} from '@bookverse/game-engine';
import type { GameEventDto } from '@bookverse/shared';
import { isUniqueViolation, prisma, type Tx } from '../db.ts';
import { pushToUser } from '../realtime.ts';

export const REVIEW_DAY_PREFIX = 'review-day:';
export const FOUND_CODE_PREFIX = 'found-code:';

/**
 * Начисляет награду один раз. Гарантия держится на уникальном индексе (userId, dedupeKey),
 * поэтому её не обойти ни двойным кликом, ни параллельными запросами.
 */
export async function award(tx: Tx, userId: string, dedupeKey: string, amount: number, reason: string): Promise<number> {
  const existing = await tx.xPTransaction.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } } });
  if (existing) return 0;
  try {
    await tx.xPTransaction.create({ data: { userId, dedupeKey, amount, reason } });
  } catch (error) {
    if (isUniqueViolation(error)) return 0;
    throw error;
  }
  await tx.user.update({ where: { id: userId }, data: { xp: { increment: amount } } });
  return amount;
}

export async function collectStats(tx: Tx, userId: string): Promise<GameStats> {
  const progress = await tx.readingProgress.findMany({
    where: { userId },
    select: { percent: true, status: true },
  });
  const [chaptersCompleted, uniqueWords, masteredWords, quizzesPassed, reviewSessions, foundByCode] = await Promise.all([
    tx.xPTransaction.count({ where: { userId, dedupeKey: { startsWith: 'chapter:' } } }),
    tx.savedVocabulary.count({ where: { userId } }),
    tx.savedVocabulary.count({ where: { userId, mastery: 'mastered' } }),
    tx.xPTransaction.count({ where: { userId, dedupeKey: { startsWith: 'quiz:' } } }),
    tx.xPTransaction.count({ where: { userId, dedupeKey: { startsWith: REVIEW_DAY_PREFIX } } }),
    tx.xPTransaction.count({ where: { userId, dedupeKey: { startsWith: FOUND_CODE_PREFIX } } }),
  ]);
  return {
    booksOpened: progress.length,
    chaptersCompleted,
    maxBookPercent: progress.reduce((max, p) => Math.max(max, p.percent), 0),
    booksCompleted: progress.filter((p) => p.status === 'completed').length,
    uniqueWords,
    masteredWords,
    quizzesPassed,
    reviewSessions,
    foundByCode,
  };
}

/** Проверяет достижения после действия и собирает событие для интерфейса. */
export async function settle(tx: Tx, userId: string, xpBefore: number, gained: number): Promise<GameEventDto> {
  const stats = await collectStats(tx, userId);
  const earned = new Set(
    (await tx.userAchievement.findMany({ where: { userId }, select: { code: true } })).map((a) => a.code),
  );
  const unlocked: GameEventDto['achievements'] = [];
  let xpGained = gained;
  for (const achievement of evaluateAchievements(stats, earned)) {
    try {
      await tx.userAchievement.create({ data: { userId, code: achievement.code } });
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
    xpGained += await award(tx, userId, rewardKey.achievement(achievement.code), achievement.xp, `Достижение: ${achievement.title}`);
    unlocked.push({
      code: achievement.code,
      title: achievement.title,
      description: achievement.description,
      icon: achievement.icon,
    });
  }
  const before = levelFromXp(xpBefore).level;
  const after = levelFromXp(xpBefore + xpGained).level;
  return {
    xpGained,
    achievements: unlocked,
    levelUp: after > before ? { level: after, rank: rankForLevel(after) } : null,
  };
}

export function publishGame(userId: string, event: GameEventDto): void {
  if (event.xpGained > 0 || event.achievements.length > 0) pushToUser(userId, 'game:event', event);
}

export async function seedAchievements(): Promise<void> {
  const { ACHIEVEMENTS } = await import('@bookverse/game-engine');
  for (const a of ACHIEVEMENTS) {
    const data = { title: a.title, description: a.description, icon: a.icon };
    await prisma.achievement.upsert({ where: { code: a.code }, update: data, create: { code: a.code, ...data } });
  }
}

export { achievementByCode };
