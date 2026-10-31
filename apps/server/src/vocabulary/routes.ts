import type { FastifyInstance } from 'fastify';
import { reviewSchema, saveWordSchema } from '@bookverse/shared';
import { ensureUser, requireUser } from '../auth/session.ts';
import { prisma } from '../db.ts';
import { notFound } from '../http.ts';
import { pushToUser } from '../realtime.ts';
import { dueWords, listVocabulary, reviewWord, saveWord, vocabularySummary } from './service.ts';

export async function vocabularyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/vocabulary', async (request) => {
    if (!request.user) {
      return { items: [], summary: { total: 0, mastered: 0, due: 0, recent: 0, growth: [] } };
    }
    const [items, summary] = await Promise.all([listVocabulary(request.user.id), vocabularySummary(request.user.id)]);
    return { items, summary };
  });

  app.get('/api/vocabulary/due', async (request) => {
    if (!request.user) return { items: [] };
    return { items: await dueWords(request.user.id, 30) };
  });

  app.post('/api/vocabulary', async (request, reply) => {
    const input = saveWordSchema.parse(request.body);
    const user = await ensureUser(request, reply);
    const result = await saveWord(user.id, input);
    reply.code(result.created ? 201 : 200);
    return result;
  });

  app.delete<{ Params: { id: string } }>('/api/vocabulary/:id', async (request) => {
    const user = requireUser(request);
    const { count } = await prisma.savedVocabulary.deleteMany({ where: { id: request.params.id, userId: user.id } });
    if (count === 0) throw notFound('Слово не найдено');
    pushToUser(user.id, 'vocabulary:changed', {});
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/vocabulary/:id/review', async (request) => {
    const user = requireUser(request);
    const input = reviewSchema.parse(request.body);
    return reviewWord(user.id, request.params.id, input.rating, input.source);
  });
}
