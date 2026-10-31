import type { FastifyInstance } from 'fastify';
import { quizSubmitSchema } from '@bookverse/shared';
import { ensureUser } from '../auth/session.ts';
import { findBook } from '../books/routes.ts';
import { listQuizzes, submitQuiz } from './service.ts';

export async function quizRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { publicId: string } }>('/api/books/:publicId/quizzes', async (request) => {
    const book = await findBook(request.params.publicId);
    return listQuizzes(book.id, request.user?.id ?? null);
  });

  app.post<{ Params: { id: string } }>('/api/quizzes/:id/submit', async (request, reply) => {
    const { answers } = quizSubmitSchema.parse(request.body);
    const user = await ensureUser(request, reply);
    return submitQuiz(user.id, request.params.id, answers);
  });
}
