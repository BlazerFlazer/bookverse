import { XP_RULES, rewardKey } from '@bookverse/game-engine';
import {
  completedChapters,
  creditVisit,
  CREDIT_CAPACITY,
  percentOf,
  type Range,
} from '@bookverse/reading-engine';
import type { CheckpointResultDto, GameEventDto } from '@bookverse/shared';
import { prisma } from '../db.ts';
import { HttpError, notFound } from '../http.ts';
import { progressDto } from '../books/catalog.ts';
import { award, publishGame, settle } from '../game/service.ts';

/** Открытие книги. Повторное открытие ничего не начисляет: запись и награда уже есть. */
export async function openBook(userId: string, publicId: string): Promise<{ game: GameEventDto; created: boolean }> {
  const book = await prisma.book.findUnique({ where: { publicId } });
  if (!book) throw notFound('Книга с таким кодом не найдена');

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const existing = await tx.readingProgress.findUnique({ where: { userId_bookId: { userId, bookId: book.id } } });
    if (!existing) await tx.readingProgress.create({ data: { userId, bookId: book.id } });
    const gained = await award(tx, userId, rewardKey.bookOpened(book.id), XP_RULES.bookOpened, `Открыта книга «${book.title}»`);
    return { game: await settle(tx, userId, user.xp, gained), created: !existing };
  });
  publishGame(userId, result.game);
  return result;
}

export interface CheckpointInput {
  blockKey: string;
  offset: number;
  visitFrom: number;
  visitTo: number;
  source: 'read' | 'audio';
}

export async function saveCheckpoint(userId: string, publicId: string, input: CheckpointInput): Promise<CheckpointResultDto> {
  const book = await prisma.book.findUnique({
    where: { publicId },
    include: { chapters: { orderBy: { order: 'asc' } } },
  });
  if (!book) throw notFound('Книга с таким кодом не найдена');

  const block = await prisma.bookContentBlock.findUnique({
    where: { bookId_key: { bookId: book.id, key: input.blockKey } },
    include: { chapter: true },
  });
  if (!block) throw new HttpError(400, 'Такого места в книге нет');

  const offset = Math.min(input.offset, block.charLength);
  const from = Math.max(0, Math.min(input.visitFrom, book.totalChars));
  // Один отчёт не может покрыть больше страницы-другой: так нельзя отметить книгу целиком.
  const to = Math.min(book.totalChars, from + CREDIT_CAPACITY, Math.max(input.visitTo, from));

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const current =
      (await tx.readingProgress.findUnique({ where: { userId_bookId: { userId, bookId: book.id } } })) ??
      (await tx.readingProgress.create({ data: { userId, bookId: book.id } }));

    const now = Date.now();
    const credit = creditVisit(
      JSON.parse(current.visited) as Range[],
      [from, to],
      { tokens: current.creditTokens, at: current.creditAt.getTime() },
      now,
    );
    const done = completedChapters(book.chapters, credit.ranges);
    const finished = current.status === 'completed' || done.length === book.chapters.length;

    const progress = await tx.readingProgress.update({
      where: { id: current.id },
      data: {
        chapterOrder: block.chapter.order,
        blockKey: block.key,
        offset,
        canonicalPos: block.charStart + offset,
        visited: JSON.stringify(credit.ranges),
        percent: percentOf(credit.ranges, book.totalChars),
        status: finished ? 'completed' : current.status,
        completedAt: finished ? (current.completedAt ?? new Date()) : null,
        lastSource: input.source,
        creditTokens: credit.state.tokens,
        creditAt: new Date(credit.state.at),
      },
    });

    let gained = 0;
    for (const order of done) {
      gained += await award(tx, userId, rewardKey.chapterCompleted(book.id, order), XP_RULES.chapterCompleted, `Глава ${order} книги «${book.title}»`);
    }
    if (finished) {
      gained += await award(tx, userId, rewardKey.bookCompleted(book.id), XP_RULES.bookCompleted, `Прочитана книга «${book.title}»`);
    }
    return { progress: progressDto(progress), game: await settle(tx, userId, user.xp, gained), completedChapters: done };
  });
  publishGame(userId, result.game);
  return result;
}
