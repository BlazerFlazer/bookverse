import type { FastifyInstance } from 'fastify';
import { lookupQuerySchema } from '@bookverse/shared';
import { lookup } from './lexicon.ts';

export async function dictionaryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dictionary/lookup', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const query = lookupQuerySchema.parse(request.query);
    return lookup({ ...query, userId: request.user?.id ?? null });
  });
}
