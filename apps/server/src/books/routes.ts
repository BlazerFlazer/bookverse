import type { FastifyInstance } from 'fastify';
import { bookQuerySchema, normalizeBookId } from '@bookverse/shared';
import type { BookDetailDto, BlockDto, ChapterContentDto, CoverStyle, LicenseDto } from '@bookverse/shared';
import { prisma } from '../db.ts';
import { notFound } from '../http.ts';
import { FOUND_CODE_PREFIX, award, publishGame, settle } from '../game/service.ts';
import { bookDto, searchCatalog } from './catalog.ts';
import { coverPng } from './cover.ts';

export async function findBook(publicId: string) {
  const code = normalizeBookId(publicId);
  const book = code ? await prisma.book.findUnique({ where: { publicId: code } }) : null;
  if (!book) throw notFound('Книга с таким кодом не найдена');
  return book;
}

export async function bookDetail(publicId: string, userId: string | null): Promise<BookDetailDto> {
  const code = normalizeBookId(publicId);
  const book = code
    ? await prisma.book.findUnique({
        where: { publicId: code },
        include: {
          _count: { select: { chapters: true, quizzes: true } },
          chapters: { orderBy: { order: 'asc' } },
          license: true,
        },
      })
    : null;
  if (!book?.license) throw notFound('Книга с таким кодом не найдена');
  const progress = userId
    ? await prisma.readingProgress.findUnique({ where: { userId_bookId: { userId, bookId: book.id } } })
    : null;
  const { id: _id, bookId: _bookId, ...license } = book.license;
  return {
    ...bookDto(book, progress),
    totalChars: book.totalChars,
    chapters: book.chapters.map((c) => ({
      order: c.order,
      title: c.title,
      charStart: c.charStart,
      charLength: c.charLength,
      wordCount: c.wordCount,
    })),
    license: license as LicenseDto,
    // Озвучка браузером есть у любого текста. Лицензионных записей пока нет, и это видно в данных.
    narration: { tts: true, recordings: 0 },
    hasQuizzes: book._count.quizzes > 0,
  };
}

export async function bookRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/books', async (request) => {
    const query = bookQuerySchema.parse(request.query);
    const books = await searchCatalog(query, request.user?.id ?? null);

    // Поиск по точному коду засчитывается на сервере, поэтому награду нельзя получить запросом с клиента.
    const code = query.q ? normalizeBookId(query.q) : null;
    const hit = code ? books[0] : undefined;
    const user = request.user;
    if (hit && user) {
      const game = await prisma.$transaction(async (tx) => {
        const gained = await award(tx, user.id, `${FOUND_CODE_PREFIX}${hit.publicId}`, 5, `Найдена книга ${hit.publicId}`);
        return gained > 0 ? settle(tx, user.id, user.xp, gained) : null;
      });
      if (game) publishGame(user.id, game);
    }
    const genres = await prisma.book.findMany({ distinct: ['genre'], select: { genre: true }, orderBy: { genre: 'asc' } });
    return { books, genres: genres.map((g) => g.genre) };
  });

  app.get<{ Params: { publicId: string } }>('/api/books/:publicId', async (request) =>
    bookDetail(request.params.publicId, request.user?.id ?? null),
  );

  app.get<{ Params: { publicId: string } }>('/api/books/:publicId/cover.png', async (request, reply) => {
    const book = await findBook(request.params.publicId);
    reply.header('cache-control', 'public, max-age=86400').type('image/png');
    return coverPng(book.publicId, book.title, book.author, book.coverStyle as unknown as CoverStyle);
  });

  app.get<{ Params: { publicId: string; order: string } }>('/api/books/:publicId/chapters/:order', async (request) => {
    const book = await findBook(request.params.publicId);
    const chapter = await prisma.bookChapter.findUnique({
      where: { bookId_order: { bookId: book.id, order: Number(request.params.order) } },
      include: { blocks: { orderBy: { order: 'asc' } } },
    });
    if (!chapter) throw notFound('Такой главы нет');
    const content: ChapterContentDto = {
      publicId: book.publicId,
      order: chapter.order,
      title: chapter.title,
      charStart: chapter.charStart,
      charLength: chapter.charLength,
      wordCount: chapter.wordCount,
      blocks: chapter.blocks.map((b) => ({
        key: b.key,
        order: b.order,
        kind: b.kind as BlockDto['kind'],
        text: b.text,
        charStart: b.charStart,
        charLength: b.charLength,
      })),
    };
    return content;
  });
}
