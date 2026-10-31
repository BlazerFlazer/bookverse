import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { authRoutes } from './auth/routes.ts';
import { loadUser } from './auth/session.ts';
import { bookRoutes } from './books/routes.ts';
import { config, isProduction } from './config.ts';
import { demoRoutes } from './demo/routes.ts';
import { dictionaryRoutes } from './dictionary/routes.ts';
import { gameRoutes } from './game/routes.ts';
import { HttpError } from './http.ts';
import { quizRoutes } from './quizzes/routes.ts';
import { readingRoutes } from './reading/routes.ts';
import { internalBotRoutes } from './telegram/internal.ts';
import { telegramRoutes } from './telegram/routes.ts';
import { vocabularyRoutes } from './vocabulary/routes.ts';

const PRIVATE_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === config.PUBLIC_WEB_URL) return true;
  // В разработке сайт открывают и с телефона по адресу компьютера в локальной сети.
  return !isProduction && PRIVATE_HOST.test(origin);
}

export async function buildApp(options: { logger?: boolean; rateLimit?: boolean } = {}): Promise<FastifyInstance> {
  // За прокси лимиты запросов должны считаться по адресу посетителя, а не самого прокси.
  // Число в trustProxy Fastify игнорирует, поэтому счёт переходов задан функцией.
  const hops = config.TRUST_PROXY_HOPS;
  const app = Fastify({ logger: options.logger ?? false, trustProxy: hops > 0 ? (_address, hop) => hop < hops : false });

  await app.register(cookie);
  await app.register(cors, { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    // Тестам нужен обход лимита, причём и для маршрутов со своим потолком.
    allowList: () => options.rateLimit === false,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new HttpError(429, 'Слишком много запросов. Подождите минуту.'),
  });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.addHook('onRequest', async (request) => {
    // Cookie SameSite=Lax закрывает основной CSRF, проверка Origin добавляет второй рубеж.
    const unsafe = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
    if (unsafe && !isAllowedOrigin(request.headers.origin)) throw new HttpError(403, 'Запрос с чужого сайта отклонён');
  });
  app.addHook('preHandler', loadUser);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
      return reply.code(400).send({ message: Object.values(fields)[0] ?? 'Проверьте данные', fields });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ message: error.message, fields: error.fields });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ message: 'Слишком много запросов. Подождите минуту.' });
    if (status && status < 500) return reply.code(status).send({ message: 'Неверный запрос' });
    request.log.error(error);
    if (!options.logger) console.error(error);
    return reply.code(500).send({ message: 'На сервере что-то пошло не так. Попробуйте ещё раз.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(bookRoutes);
  await app.register(readingRoutes);
  await app.register(dictionaryRoutes);
  await app.register(vocabularyRoutes);
  await app.register(gameRoutes);
  await app.register(quizRoutes);
  await app.register(telegramRoutes);
  await app.register(demoRoutes);
  await app.register(internalBotRoutes);

  return app;
}
