import type { Book, ReadingProgress } from '@prisma/client';
import type { BookProgressDto, BookSummaryDto, CoverStyle } from '@bookverse/shared';
import { editDistance, normalizeBookId, normalizeForLookup } from '@bookverse/shared';
import { prisma } from '../db.ts';

type BookWithCount = Book & { _count: { chapters: number } };

export function progressDto(progress: ReadingProgress): BookProgressDto {
  return {
    percent: progress.status === 'completed' ? 100 : progress.percent,
    status: progress.status as BookProgressDto['status'],
    chapterOrder: progress.chapterOrder,
    blockKey: progress.blockKey,
    offset: progress.offset,
    canonicalPos: progress.canonicalPos,
    updatedAt: progress.updatedAt.toISOString(),
  };
}

export function bookDto(book: BookWithCount, progress?: ReadingProgress | null): BookSummaryDto {
  return {
    publicId: book.publicId,
    slug: book.slug,
    title: book.title,
    author: book.author,
    language: book.language as BookSummaryDto['language'],
    genre: book.genre,
    description: book.description,
    ageBand: book.ageBand,
    year: book.year,
    featured: book.featured,
    estMinutes: book.estMinutes,
    totalWords: book.totalWords,
    chapterCount: book._count.chapters,
    cover: book.coverStyle as unknown as CoverStyle,
    progress: progress ? progressDto(progress) : null,
  };
}

/** Чем выше оценка, тем лучше совпадение. Ноль означает, что книга не подходит. */
export function scoreBook(book: Pick<Book, 'titleSearch' | 'authorSearch' | 'genre' | 'language'>, rawQuery: string): number {
  const query = normalizeForLookup(rawQuery);
  if (!query) return 1;
  const title = book.titleSearch;
  const author = book.authorSearch;
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 70;
  if (author.includes(query)) return 60;
  const genre = normalizeForLookup(book.genre);
  if (genre.includes(query) || book.language === query) return 50;

  // Опечатки: каждое слово запроса должно быть похоже на слово названия или автора.
  const words = [...title.split(/\s+/), ...author.split(/\s+/)];
  const parts = query.split(/\s+/).filter((part) => part.length >= 3);
  if (parts.length === 0) return 0;
  const similar = parts.every((part) => {
    const allowed = part.length <= 5 ? 1 : 2;
    return words.some((word) => editDistance(part, word, allowed) <= allowed);
  });
  return similar ? 30 : 0;
}

export interface CatalogFilter {
  q?: string;
  genre?: string;
  language?: string;
  shelf?: string;
}

export async function searchCatalog(filter: CatalogFilter, userId: string | null): Promise<BookSummaryDto[]> {
  const code = filter.q ? normalizeBookId(filter.q) : null;
  const books = await prisma.book.findMany({
    where: {
      ...(code ? { publicId: code } : {}),
      ...(filter.genre ? { genre: filter.genre } : {}),
      ...(filter.language ? { language: filter.language } : {}),
    },
    include: { _count: { select: { chapters: true } } },
    orderBy: { sequence: 'asc' },
  });
  const progress = userId ? await prisma.readingProgress.findMany({ where: { userId } }) : [];
  const byBook = new Map(progress.map((p) => [p.bookId, p]));

  const scored = books
    .map((book) => ({ book, score: code ? 100 : scoreBook(book, filter.q ?? '') }))
    .filter(({ book, score }) => {
      if (score === 0) return false;
      const own = byBook.get(book.id);
      switch (filter.shelf) {
        case 'featured': return book.featured;
        case 'continue': return own?.status === 'reading';
        case 'discover': return !own;
        case 'completed': return own?.status === 'completed';
        default: return true;
      }
    })
    .sort((a, b) => b.score - a.score);

  return scored.map(({ book }) => bookDto(book, byBook.get(book.id)));
}
