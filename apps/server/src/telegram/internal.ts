import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizeBookId, reviewSchema } from '@bookverse/shared';
import { hashToken } from '../auth/session.ts';
import { bookDetail } from '../books/routes.ts';
import { searchCatalog } from '../books/catalog.ts';
import { botConfigured, config } from '../config.ts';
import { prisma } from '../db.ts';
import { buildProfile } from '../game/routes.ts';
import { FOUND_CODE_PREFIX, award, publishGame, settle } from '../game/service.ts';
import { HttpError, notFound } from '../http.ts';
import { listQuizzes, submitQuiz } from '../quizzes/service.ts';
import { pushToUser } from '../realtime.ts';
import { openBook } from '../reading/service.ts';
import { dueWords, reviewWord, vocabularySummary } from '../vocabulary/service.ts';
import { joinFromTelegram, pendingTelegramMessages, voteFromTelegram } from '../demo/service.ts';

type WithTelegramId = { Params: { telegramId: string } };

const telegramIdSchema = z.string().regex(/^\d{1,20}$/);

function assertBot(request: FastifyRequest): void {
  const expected = Buffer.from(config.BOT_INTERNAL_SECRET);
  const received = Buffer.from(String(request.headers['x-bot-secret'] ?? ''));
  const valid = botConfigured && expected.length === received.length && timingSafeEqual(expected, received);
  if (!valid) throw new HttpError(401, 'Неверный секрет бота');
}

async function accountOf(rawId: string) {
  const telegramId = telegramIdSchema.parse(rawId);
  const account = await prisma.telegramAccount.findUnique({ where: { telegramId }, include: { user: true } });
  if (!account) throw new HttpError(404, 'telegram-not-linked');
  return account;
}

const deepLink = (publicId: string, query = '') => `${config.PUBLIC_WEB_URL}/read/${publicId}${query}`;

/** API только для бота. Отдельный секрет не даёт браузеру обращаться сюда от чужого имени. */
export async function internalBotRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => assertBot(request));

  app.get('/internal/bot/reminders', async () => {
    const accounts = await prisma.telegramAccount.findMany({ where: { remindersEnabled: true } });
    const rows = [];
    for (const account of accounts) {
      const latest = await prisma.readingProgress.findFirst({
        where: { userId: account.userId, status: 'reading' },
        orderBy: { updatedAt: 'desc' },
        include: { book: { select: { title: true, publicId: true } } },
      });
      if (latest) {
        const anchor = latest.blockKey ? `?b=${latest.blockKey}&o=${latest.offset}` : '';
        rows.push({ telegramId: account.telegramId, title: latest.book.title, percent: latest.percent, url: deepLink(latest.book.publicId, anchor) });
      }
    }
    return { reminders: rows };
  });

  app.post('/internal/bot/link', async (request) => {
    const input = z
      .object({ token: z.string().min(10).max(64), telegramId: telegramIdSchema, username: z.string().max(64).nullable() })
      .parse(request.body);
    const tokenId = hashToken(input.token);

    const account = await prisma.$transaction(async (tx) => {
      const stored = await tx.telegramLinkToken.findUnique({ where: { id: tokenId } });
      if (!stored || stored.usedAt || stored.expiresAt.getTime() < Date.now()) {
        throw new HttpError(400, 'Ссылка устарела или уже использована. Создайте новую на сайте.');
      }
      await tx.telegramLinkToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } });
      const taken = await tx.telegramAccount.findUnique({ where: { telegramId: input.telegramId } });
      if (taken && taken.userId !== stored.userId) {
        throw new HttpError(409, 'Этот Telegram уже привязан к другому аккаунту BOOKVERSE.');
      }
      return tx.telegramAccount.upsert({
        where: { userId: stored.userId },
        update: { telegramId: input.telegramId, username: input.username },
        create: { userId: stored.userId, telegramId: input.telegramId, username: input.username },
        include: { user: true },
      });
    });
    pushToUser(account.userId, 'telegram:linked', { username: account.username });
    return { displayName: account.user.displayName };
  });

  app.get('/internal/bot/books', async (request) => {
    const { q } = z.object({ q: z.string().max(120) }).parse(request.query);
    return { books: (await searchCatalog({ q }, null)).slice(0, 5) };
  });

  app.get<{ Params: { publicId: string } }>('/internal/bot/books/:publicId', async (request) => {
    const detail = await bookDetail(request.params.publicId, null);
    const { telegramId } = z.object({ telegramId: telegramIdSchema.optional() }).parse(request.query);
    const account = telegramId ? await prisma.telegramAccount.findUnique({ where: { telegramId } }) : null;
    if (account) {
      // Поиск по коду в Telegram тоже засчитывается «Книжному следопыту».
      const book = await prisma.book.findUniqueOrThrow({ where: { publicId: detail.publicId } });
      const game = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: account.userId } });
        const gained = await award(tx, user.id, `${FOUND_CODE_PREFIX}${book.publicId}`, 5, `Найдена книга ${book.publicId}`);
        return gained > 0 ? settle(tx, user.id, user.xp, gained) : null;
      });
      if (game) publishGame(account.userId, game);
    }
    return { ...detail, readUrl: deepLink(detail.publicId), listenUrl: deepLink(detail.publicId, '?listen=1') };
  });

  app.post<{ Params: WithTelegramId['Params'] & { publicId: string } }>('/internal/bot/users/:telegramId/shelf/:publicId', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const publicId = normalizeBookId(request.params.publicId);
    if (!publicId) throw notFound('Книга с таким кодом не найдена');
    const { created } = await openBook(account.userId, publicId);
    return { created };
  });

  app.post('/internal/bot/demo/join', async (request) => {
    const { code, telegramId } = z.object({ code: z.string().max(8), telegramId: telegramIdSchema }).parse(request.body);
    return joinFromTelegram(code, telegramId);
  });

  app.post('/internal/bot/demo/vote', async (request) => {
    const input = z.object({ telegramId: telegramIdSchema, activityId: z.string().max(40), choice: z.number().int().min(0).max(5) }).parse(request.body);
    await voteFromTelegram(input.telegramId, input.activityId, input.choice);
    return { ok: true };
  });

  app.get('/internal/bot/demo/pending', async () => ({ messages: await pendingTelegramMessages() }));

  app.get<WithTelegramId>('/internal/bot/users/:telegramId/profile', async (request) => {
    const account = await accountOf(request.params.telegramId);
    return { profile: await buildProfile(account.user), vocabulary: await vocabularySummary(account.userId), reminders: account.remindersEnabled };
  });

  app.get<WithTelegramId>('/internal/bot/users/:telegramId/continue', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const latest = await prisma.readingProgress.findFirst({
      where: { userId: account.userId, status: 'reading' },
      orderBy: { updatedAt: 'desc' },
      include: { book: { include: { chapters: { orderBy: { order: 'asc' } } } } },
    });
    if (!latest) return { book: null };
    const chapter = latest.book.chapters.find((c) => c.order === latest.chapterOrder);
    const anchor = latest.blockKey ? `?b=${latest.blockKey}&o=${latest.offset}` : '';
    return {
      book: {
        publicId: latest.book.publicId,
        title: latest.book.title,
        author: latest.book.author,
        percent: latest.percent,
        chapterOrder: latest.chapterOrder,
        chapterTitle: chapter?.title ?? null,
        chapterCount: latest.book.chapters.length,
        url: deepLink(latest.book.publicId, anchor),
      },
    };
  });

  app.get<WithTelegramId>('/internal/bot/users/:telegramId/library', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const rows = await prisma.readingProgress.findMany({
      where: { userId: account.userId },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { book: { select: { title: true, publicId: true } } },
    });
    return {
      books: rows.map((r) => ({
        title: r.book.title,
        publicId: r.book.publicId,
        percent: r.status === 'completed' ? 100 : r.percent,
        status: r.status,
        url: deepLink(r.book.publicId),
      })),
    };
  });

  app.get<WithTelegramId>('/internal/bot/users/:telegramId/review', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const [next] = await dueWords(account.userId, 1);
    return { word: next ?? null, due: (await vocabularySummary(account.userId)).due };
  });

  app.post<{ Params: WithTelegramId['Params'] & { id: string } }>('/internal/bot/users/:telegramId/review/:id', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const { rating } = reviewSchema.parse(request.body);
    return reviewWord(account.userId, request.params.id, rating, 'telegram');
  });

  app.get<WithTelegramId>('/internal/bot/users/:telegramId/quiz', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const latest = await prisma.readingProgress.findFirst({
      where: { userId: account.userId },
      orderBy: { updatedAt: 'desc' },
      include: { book: { select: { id: true, title: true } } },
    });
    if (!latest) return { quiz: null };
    const quizzes = await listQuizzes(latest.book.id, account.userId);
    const quiz = quizzes.find((q) => q.chapterOrder === latest.chapterOrder) ?? quizzes[0];
    if (!quiz) return { quiz: null };
    // В Telegram показываем только задания с выбором ответа: они удобны на кнопках.
    const taskIndex = quiz.tasks.findIndex((t) => t.type === 'single');
    if (taskIndex < 0) return { quiz: null };
    return { quiz: { id: quiz.id, title: quiz.title, bookTitle: latest.book.title, taskIndex, task: quiz.tasks[taskIndex] } };
  });

  app.post<{ Params: WithTelegramId['Params'] & { quizId: string } }>('/internal/bot/users/:telegramId/quiz/:quizId', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const { taskIndex, answer } = z.object({ taskIndex: z.number().int().min(0).max(12), answer: z.number().int().min(0) }).parse(request.body);
    const answers: number[] = [];
    answers[taskIndex] = answer;
    const result = await submitQuiz(account.userId, request.params.quizId, Array.from(answers, (a) => a ?? -1));
    return result.results[taskIndex];
  });

  app.get<WithTelegramId>('/internal/bot/users/:telegramId/recommend', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const opened = await prisma.readingProgress.findMany({
      where: { userId: account.userId },
      include: { book: { select: { genre: true } } },
    });
    const liked = new Set(opened.map((p) => p.book.genre));
    const books = await searchCatalog({ shelf: 'discover' }, account.userId);
    // Сначала жанры, которые читатель уже открывал, затем остальное.
    const sorted = [...books].sort((a, b) => Number(liked.has(b.genre)) - Number(liked.has(a.genre)));
    return { books: sorted.slice(0, 3).map((b) => ({ ...b, readUrl: deepLink(b.publicId) })) };
  });

  app.post<WithTelegramId>('/internal/bot/users/:telegramId/reminders', async (request) => {
    const account = await accountOf(request.params.telegramId);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    await prisma.telegramAccount.update({ where: { id: account.id }, data: { remindersEnabled: enabled } });
    return { enabled };
  });
}
