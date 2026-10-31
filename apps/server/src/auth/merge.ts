import { mergeRanges, percentOf, type Range } from '@bookverse/reading-engine';
import type { Tx } from '../db.ts';

/**
 * Переносит накопленное гостем в существующий аккаунт. Награды не суммируются вслепую:
 * записи с тем же ключом уже есть у аккаунта и просто отбрасываются.
 */
export async function mergeGuestInto(tx: Tx, guestId: string, accountId: string): Promise<void> {
  const guestProgress = await tx.readingProgress.findMany({ where: { userId: guestId }, include: { book: true } });
  for (const progress of guestProgress) {
    const own = await tx.readingProgress.findUnique({ where: { userId_bookId: { userId: accountId, bookId: progress.bookId } } });
    if (!own) {
      await tx.readingProgress.update({ where: { id: progress.id }, data: { userId: accountId } });
      continue;
    }
    const visited = mergeRanges([
      ...(JSON.parse(own.visited) as Range[]),
      ...(JSON.parse(progress.visited) as Range[]),
    ]);
    const newer = progress.updatedAt > own.updatedAt ? progress : own;
    await tx.readingProgress.update({
      where: { id: own.id },
      data: {
        visited: JSON.stringify(visited),
        percent: percentOf(visited, progress.book.totalChars),
        chapterOrder: newer.chapterOrder,
        blockKey: newer.blockKey,
        offset: newer.offset,
        canonicalPos: newer.canonicalPos,
        status: own.status === 'completed' || progress.status === 'completed' ? 'completed' : 'reading',
        completedAt: own.completedAt ?? progress.completedAt,
      },
    });
  }

  const guestWords = await tx.savedVocabulary.findMany({ where: { userId: guestId }, include: { contexts: true } });
  for (const word of guestWords) {
    const own = await tx.savedVocabulary.findUnique({
      where: { userId_lemmaKey_language: { userId: accountId, lemmaKey: word.lemmaKey, language: word.language } },
      include: { contexts: true },
    });
    if (!own) {
      await tx.savedVocabulary.update({ where: { id: word.id }, data: { userId: accountId } });
      await tx.vocabularyReview.updateMany({ where: { vocabularyId: word.id }, data: { userId: accountId } });
      continue;
    }
    const known = new Set(own.contexts.map((c) => c.blockKey));
    for (const context of word.contexts) {
      if (!known.has(context.blockKey)) {
        await tx.vocabularyContext.update({ where: { id: context.id }, data: { vocabularyId: own.id } });
      }
    }
  }

  const ownKeys = new Set(
    (await tx.xPTransaction.findMany({ where: { userId: accountId }, select: { dedupeKey: true } })).map((x) => x.dedupeKey),
  );
  for (const entry of await tx.xPTransaction.findMany({ where: { userId: guestId } })) {
    if (!ownKeys.has(entry.dedupeKey)) {
      await tx.xPTransaction.update({ where: { id: entry.id }, data: { userId: accountId } });
    }
  }

  const ownCodes = new Set(
    (await tx.userAchievement.findMany({ where: { userId: accountId }, select: { code: true } })).map((a) => a.code),
  );
  for (const earned of await tx.userAchievement.findMany({ where: { userId: guestId } })) {
    if (!ownCodes.has(earned.code)) {
      await tx.userAchievement.update({ where: { id: earned.id }, data: { userId: accountId } });
    }
  }

  const ownMarks = await tx.bookmark.findMany({ where: { userId: accountId } });
  for (const mark of await tx.bookmark.findMany({ where: { userId: guestId } })) {
    const duplicate = ownMarks.some((m) => m.bookId === mark.bookId && m.blockKey === mark.blockKey && m.offset === mark.offset);
    if (!duplicate) await tx.bookmark.update({ where: { id: mark.id }, data: { userId: accountId } });
  }
  await tx.highlight.updateMany({ where: { userId: guestId }, data: { userId: accountId } });
  await tx.savedQuote.updateMany({ where: { userId: guestId }, data: { userId: accountId } });
  await tx.quizAttempt.updateMany({ where: { userId: guestId }, data: { userId: accountId } });

  const total = await tx.xPTransaction.aggregate({ where: { userId: accountId }, _sum: { amount: true } });
  await tx.user.update({ where: { id: accountId }, data: { xp: total._sum.amount ?? 0 } });
  await tx.user.delete({ where: { id: guestId } });
}
