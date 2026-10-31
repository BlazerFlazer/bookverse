import { rewardKey, scheduleReview, XP_RULES, type Rating } from '@bookverse/game-engine';
import { normalizeForLookup } from '@bookverse/shared';
import type { GameEventDto, Mastery, VocabularyItemDto, VocabularySummaryDto } from '@bookverse/shared';
import { prisma, type Tx } from '../db.ts';
import { notFound } from '../http.ts';
import { award, publishGame, REVIEW_DAY_PREFIX, settle } from '../game/service.ts';
import { pushToUser } from '../realtime.ts';

const WITH_CONTEXTS = {
  contexts: {
    include: { book: { select: { title: true, publicId: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
};

/** Сколько повторений в день считается полноценной сессией. */
const REVIEWS_PER_SESSION = 3;

type Row = Awaited<ReturnType<typeof loadRow>>;
const loadRow = (id: string) => prisma.savedVocabulary.findFirstOrThrow({ where: { id }, include: WITH_CONTEXTS });

export function vocabularyDto(row: Row): VocabularyItemDto {
  return {
    id: row.id,
    word: row.word,
    lemma: row.lemma,
    language: row.language as VocabularyItemDto['language'],
    definition: row.definition,
    partOfSpeech: row.partOfSpeech,
    sourceLabel: row.sourceLabel,
    mastery: row.mastery as Mastery,
    box: row.box,
    nextReviewAt: row.nextReviewAt.toISOString(),
    reviewCount: row.reviewCount,
    studyLater: row.studyLater,
    createdAt: row.createdAt.toISOString(),
    contexts: row.contexts.map((c) => ({
      bookTitle: c.book?.title ?? null,
      publicId: c.book?.publicId ?? null,
      snippet: c.snippet,
      chapterOrder: c.chapterOrder,
    })),
  };
}

export interface SaveWordInput {
  word: string;
  lemma: string;
  language: 'ru' | 'en';
  definition: string | null;
  partOfSpeech?: string | null;
  sourceLabel?: string | null;
  publicId?: string;
  blockKey?: string;
  context?: string;
  studyLater: boolean;
}

export async function saveWord(userId: string, input: SaveWordInput): Promise<{ item: VocabularyItemDto; game: GameEventDto; created: boolean }> {
  const lemmaKey = normalizeForLookup(input.lemma);
  const book = input.publicId ? await prisma.book.findUnique({ where: { publicId: input.publicId } }) : null;
  const block =
    book && input.blockKey
      ? await prisma.bookContentBlock.findUnique({
          where: { bookId_key: { bookId: book.id, key: input.blockKey } },
          include: { chapter: { select: { order: true } } },
        })
      : null;

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const existing = await tx.savedVocabulary.findUnique({
      where: { userId_lemmaKey_language: { userId, lemmaKey, language: input.language } },
    });
    const row =
      existing ??
      (await tx.savedVocabulary.create({
        data: {
          userId,
          lemmaKey,
          lemma: input.lemma,
          language: input.language,
          word: input.word,
          definition: input.definition,
          partOfSpeech: input.partOfSpeech ?? null,
          sourceLabel: input.sourceLabel ?? null,
          studyLater: input.studyLater,
        },
      }));

    // Повторное сохранение не создаёт дубль слова, но добавляет новое место, где оно встретилось.
    if (block && input.context) {
      await tx.vocabularyContext.upsert({
        where: { vocabularyId_blockKey: { vocabularyId: row.id, blockKey: block.key } },
        update: {},
        create: {
          vocabularyId: row.id,
          bookId: book!.id,
          chapterOrder: block.chapter.order,
          blockKey: block.key,
          snippet: input.context,
        },
      });
    }
    const gained = await award(tx, userId, rewardKey.wordSaved(input.language, lemmaKey), XP_RULES.wordSaved, `Новое слово: ${input.lemma}`);
    return { id: row.id, created: !existing, game: await settle(tx, userId, user.xp, gained) };
  });

  publishGame(userId, result.game);
  pushToUser(userId, 'vocabulary:changed', {});
  return { item: vocabularyDto(await loadRow(result.id)), game: result.game, created: result.created };
}

export async function listVocabulary(userId: string): Promise<VocabularyItemDto[]> {
  const rows = await prisma.savedVocabulary.findMany({
    where: { userId },
    include: WITH_CONTEXTS,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(vocabularyDto);
}

export async function vocabularySummary(userId: string): Promise<VocabularySummaryDto> {
  const rows = await prisma.savedVocabulary.findMany({
    where: { userId },
    select: { mastery: true, nextReviewAt: true, createdAt: true },
  });
  const now = Date.now();
  const weekMs = 7 * 86_400_000;
  const growth = new Map<string, number>();
  for (const row of rows) {
    const weekStart = new Date(Math.floor(row.createdAt.getTime() / weekMs) * weekMs).toISOString().slice(0, 10);
    growth.set(weekStart, (growth.get(weekStart) ?? 0) + 1);
  }
  return {
    total: rows.length,
    mastered: rows.filter((r) => r.mastery === 'mastered').length,
    due: rows.filter((r) => r.mastery !== 'mastered' && r.nextReviewAt.getTime() <= now).length,
    recent: rows.filter((r) => now - r.createdAt.getTime() < weekMs).length,
    growth: [...growth.entries()].sort().map(([week, count]) => ({ week, count })),
  };
}

export async function dueWords(userId: string, limit: number): Promise<VocabularyItemDto[]> {
  const rows = await prisma.savedVocabulary.findMany({
    where: { userId, nextReviewAt: { lte: new Date() } },
    include: WITH_CONTEXTS,
    orderBy: { nextReviewAt: 'asc' },
    take: limit,
  });
  return rows.map(vocabularyDto);
}

async function grantSessionIfEarned(tx: Tx, userId: string, now: Date): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const reviewedToday = await tx.vocabularyReview.count({ where: { userId, reviewedAt: { gte: dayStart } } });
  if (reviewedToday < REVIEWS_PER_SESSION) return 0;
  return award(tx, userId, `${REVIEW_DAY_PREFIX}${day}`, XP_RULES.reviewSession, 'Сессия повторения слов');
}

export async function reviewWord(
  userId: string,
  id: string,
  rating: Rating,
  source: 'web' | 'telegram',
): Promise<{ item: VocabularyItemDto; game: GameEventDto }> {
  const result = await prisma.$transaction(async (tx) => {
    const word = await tx.savedVocabulary.findFirst({ where: { id, userId } });
    if (!word) throw notFound('Слово не найдено');
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const now = new Date();
    const next = scheduleReview({ box: word.box, lapses: word.lapses }, rating, now);
    await tx.savedVocabulary.update({
      where: { id },
      data: {
        box: next.box,
        lapses: next.lapses,
        mastery: next.mastery,
        nextReviewAt: next.nextReviewAt,
        lastReviewedAt: now,
        reviewCount: { increment: 1 },
        studyLater: false,
      },
    });
    await tx.vocabularyReview.create({
      data: { userId, vocabularyId: id, rating, source, boxBefore: word.box, boxAfter: next.box },
    });
    let gained = await grantSessionIfEarned(tx, userId, now);
    if (next.mastery === 'mastered') {
      gained += await award(tx, userId, rewardKey.wordMastered(word.language, word.lemmaKey), XP_RULES.wordMastered, `Выучено слово: ${word.lemma}`);
    }
    return settle(tx, userId, user.xp, gained);
  });
  publishGame(userId, result);
  pushToUser(userId, 'vocabulary:changed', {});
  return { item: vocabularyDto(await loadRow(id)), game: result };
}
