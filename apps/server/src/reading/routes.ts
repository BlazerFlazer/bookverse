import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  bookmarkSchema,
  checkpointSchema,
  DEFAULT_READER_SETTINGS,
  highlightSchema,
  quoteSchema,
  readerSettingsSchema,
  savePreferenceSchema,
} from '@bookverse/shared';
import type { BookmarkDto, HighlightDto, PreferenceDto, QuoteDto, ReaderSettings } from '@bookverse/shared';
import { completedChapters, type Range } from '@bookverse/reading-engine';
import { ensureUser, requireUser } from '../auth/session.ts';
import { findBook } from '../books/routes.ts';
import { isUniqueViolation, prisma } from '../db.ts';
import { HttpError, notFound } from '../http.ts';
import { openBook, saveCheckpoint } from './service.ts';

type WithBook = { Params: { publicId: string } };
type WithId = { Params: { id: string } };

async function blockOf(bookId: string, key: string) {
  const block = await prisma.bookContentBlock.findUnique({
    where: { bookId_key: { bookId, key } },
    include: { chapter: { select: { order: true } } },
  });
  if (!block) throw new HttpError(400, 'Такого места в книге нет');
  return block;
}

export async function readingRoutes(app: FastifyInstance): Promise<void> {
  app.post<WithBook>('/api/books/:publicId/open', async (request, reply) => {
    const book = await findBook(request.params.publicId);
    const user = await ensureUser(request, reply);
    return openBook(user.id, book.publicId);
  });

  app.post<WithBook>('/api/books/:publicId/progress', async (request, reply) => {
    const input = checkpointSchema.parse(request.body);
    const book = await findBook(request.params.publicId);
    const user = await ensureUser(request, reply);
    return saveCheckpoint(user.id, book.publicId, input);
  });

  app.get<WithBook>('/api/books/:publicId/progress', async (request) => {
    const book = await findBook(request.params.publicId);
    if (!request.user) return { progress: null, completedChapters: [] };
    const progress = await prisma.readingProgress.findUnique({
      where: { userId_bookId: { userId: request.user.id, bookId: book.id } },
    });
    if (!progress) return { progress: null, completedChapters: [] };
    const chapters = await prisma.bookChapter.findMany({ where: { bookId: book.id } });
    return {
      progress: {
        percent: progress.status === 'completed' ? 100 : progress.percent,
        status: progress.status,
        chapterOrder: progress.chapterOrder,
        blockKey: progress.blockKey,
        offset: progress.offset,
        canonicalPos: progress.canonicalPos,
        updatedAt: progress.updatedAt.toISOString(),
      },
      completedChapters: completedChapters(chapters, JSON.parse(progress.visited) as Range[]),
    };
  });

  app.get<WithBook>('/api/books/:publicId/annotations', async (request) => {
    const book = await findBook(request.params.publicId);
    if (!request.user) return { bookmarks: [], highlights: [] };
    const where = { userId: request.user.id, bookId: book.id };
    const [bookmarks, highlights] = await Promise.all([
      prisma.bookmark.findMany({ where, orderBy: { createdAt: 'desc' } }),
      prisma.highlight.findMany({ where, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      bookmarks: bookmarks.map((b): BookmarkDto => ({
        id: b.id,
        blockKey: b.blockKey,
        offset: b.offset,
        chapterOrder: b.chapterOrder,
        snippet: b.snippet,
        createdAt: b.createdAt.toISOString(),
      })),
      highlights: highlights.map((h): HighlightDto => ({
        id: h.id,
        blockKey: h.blockKey,
        start: h.start,
        end: h.end,
        color: h.color as HighlightDto['color'],
        text: h.text,
      })),
    };
  });

  app.post<WithBook>('/api/books/:publicId/bookmarks', async (request, reply) => {
    const input = bookmarkSchema.parse(request.body);
    const book = await findBook(request.params.publicId);
    const block = await blockOf(book.id, input.blockKey);
    const user = await ensureUser(request, reply);
    try {
      const mark = await prisma.bookmark.create({
        data: { ...input, userId: user.id, bookId: book.id, chapterOrder: block.chapter.order },
      });
      reply.code(201);
      return { id: mark.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'Закладка здесь уже есть');
      throw error;
    }
  });

  app.delete<WithId>('/api/bookmarks/:id', async (request) => {
    const user = requireUser(request);
    const { count } = await prisma.bookmark.deleteMany({ where: { id: request.params.id, userId: user.id } });
    if (count === 0) throw notFound('Закладка не найдена');
    return { ok: true };
  });

  app.post<WithBook>('/api/books/:publicId/highlights', async (request, reply) => {
    const input = highlightSchema.parse(request.body);
    const book = await findBook(request.params.publicId);
    const block = await blockOf(book.id, input.blockKey);
    if (input.end <= input.start || input.end > block.charLength) throw new HttpError(400, 'Неверные границы выделения');
    const user = await ensureUser(request, reply);
    const highlight = await prisma.highlight.create({
      data: { ...input, userId: user.id, bookId: book.id, text: block.text.slice(input.start, input.end) },
    });
    reply.code(201);
    return { id: highlight.id, text: highlight.text };
  });

  app.delete<WithId>('/api/highlights/:id', async (request) => {
    const user = requireUser(request);
    const { count } = await prisma.highlight.deleteMany({ where: { id: request.params.id, userId: user.id } });
    if (count === 0) throw notFound('Выделение не найдено');
    return { ok: true };
  });

  app.post<WithBook>('/api/books/:publicId/quotes', async (request, reply) => {
    const input = quoteSchema.parse(request.body);
    const book = await findBook(request.params.publicId);
    const block = await blockOf(book.id, input.blockKey);
    const user = await ensureUser(request, reply);
    const quote = await prisma.savedQuote.create({
      data: { ...input, userId: user.id, bookId: book.id, chapterOrder: block.chapter.order },
    });
    reply.code(201);
    return { id: quote.id };
  });

  app.get('/api/quotes', async (request) => {
    const user = requireUser(request);
    const quotes = await prisma.savedQuote.findMany({
      where: { userId: user.id },
      include: { book: { select: { title: true, publicId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return quotes.map((q): QuoteDto => ({
      id: q.id,
      blockKey: q.blockKey,
      chapterOrder: q.chapterOrder,
      text: q.text,
      createdAt: q.createdAt.toISOString(),
      bookTitle: q.book.title,
      publicId: q.book.publicId,
    }));
  });

  app.delete<WithId>('/api/quotes/:id', async (request) => {
    const user = requireUser(request);
    const { count } = await prisma.savedQuote.deleteMany({ where: { id: request.params.id, userId: user.id } });
    if (count === 0) throw notFound('Цитата не найдена');
    return { ok: true };
  });

  app.get('/api/preferences', async (request) => {
    const { publicId } = z.object({ publicId: z.string().max(16).optional() }).parse(request.query);
    const empty: PreferenceDto = { global: null, book: null };
    if (!request.user) return empty;
    const parse = (value: unknown): ReaderSettings | null => {
      const parsed = readerSettingsSchema.safeParse({ ...DEFAULT_READER_SETTINGS, ...(value as object) });
      return parsed.success ? parsed.data : null;
    };
    const book = publicId ? await findBook(publicId) : null;
    const rows = await prisma.readingThemePreference.findMany({
      where: { userId: request.user.id, scope: { in: ['global', ...(book ? [book.id] : [])] } },
    });
    const result: PreferenceDto = {
      global: parse(rows.find((r) => r.scope === 'global')?.settings ?? null),
      book: book ? parse(rows.find((r) => r.scope === book.id)?.settings ?? null) : null,
    };
    if (!rows.some((r) => r.scope === 'global')) result.global = null;
    if (!book || !rows.some((r) => r.scope === book.id)) result.book = null;
    return result;
  });

  app.put('/api/preferences', async (request, reply) => {
    const input = savePreferenceSchema.parse(request.body);
    const book = input.publicId ? await findBook(input.publicId) : null;
    const user = await ensureUser(request, reply);
    const scope = book?.id ?? 'global';
    await prisma.readingThemePreference.upsert({
      where: { userId_scope: { userId: user.id, scope } },
      update: { settings: input.settings },
      create: { userId: user.id, scope, bookId: book?.id ?? null, settings: input.settings },
    });
    return { ok: true };
  });
}
