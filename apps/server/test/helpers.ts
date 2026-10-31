import type { PrismaClient } from '@prisma/client';

type Call = <T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) => Promise<{ status: number; body: T }>;

/**
 * Читает книгу так же, как настоящий читатель: страница за страницей.
 * Лимит скорости сдвигается в прошлое вручную, чтобы тест не ждал реальные минуты.
 */
export async function pageReader(call: Call, publicId: string, userId: string, prisma: PrismaClient): Promise<void> {
  const book = await prisma.book.findUniqueOrThrow({
    where: { publicId },
    include: { blocks: { orderBy: [{ charStart: 'asc' }] } },
  });
  for (const block of book.blocks) {
    await prisma.readingProgress.updateMany({ where: { userId, bookId: book.id }, data: { creditAt: new Date(Date.now() - 60_000) } });
    await call('POST', `/books/${publicId}/progress`, {
      blockKey: block.key,
      offset: 0,
      visitFrom: block.charStart,
      visitTo: block.charStart + block.charLength,
      source: 'read',
    });
  }
}
