import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { demoOpenSchema, demoPracticeSchema, demoStartSchema, demoVoteSchema, presenterLoginSchema } from '@bookverse/shared';
import type { DemoControlDto } from '@bookverse/shared';
import { hashToken, newToken } from '../auth/session.ts';
import { config, isProduction } from '../config.ts';
import { prisma } from '../db.ts';
import { HttpError, notFound } from '../http.ts';
import { joinLinks, qrSvg } from './links.ts';
import {
  activeSession,
  addPracticeParticipants,
  closeActivity,
  endSession,
  joinFromBrowser,
  openActivity,
  questionBank,
  resetSession,
  resumeLobby,
  setFinale,
  startSession,
  stateOf,
  voteFromBrowser,
} from './service.ts';

const PRESENTER_COOKIE = 'bv_presenter';
const AUDIENCE_COOKIE = 'bv_demo';
const PRESENTER_TTL_MS = 12 * 3_600_000;
const AUDIENCE_TTL_S = 6 * 3600;

export const presenterConfigured = () => config.DEMO_PRESENTER_KEY.length >= 6;

function keyMatches(input: string): boolean {
  const expected = Buffer.from(hashToken(config.DEMO_PRESENTER_KEY));
  const received = Buffer.from(hashToken(input));
  return presenterConfigured() && timingSafeEqual(expected, received);
}

async function isPresenter(request: FastifyRequest): Promise<boolean> {
  const token = request.cookies[PRESENTER_COOKIE];
  if (!token) return false;
  const session = await prisma.presenterSession.findUnique({ where: { id: hashToken(token) } });
  return Boolean(session && session.expiresAt.getTime() > Date.now());
}

async function requirePresenter(request: FastifyRequest): Promise<void> {
  if (!(await isPresenter(request))) throw new HttpError(401, 'Нужен вход ведущего');
}

const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: isProduction };

async function control(request: FastifyRequest): Promise<DemoControlDto> {
  const session = await activeSession();
  const questions = await questionBank();
  return {
    state: session ? await stateOf(session) : null,
    links: session ? joinLinks(session.code, request.headers.origin ?? originFromReferer(request)) : null,
    // Верные ответы остаются на сервере даже для ведущего: их не должно быть видно на проекторе.
    questions: questions.map(({ id, bookTitle, prompt, options }) => ({ id, bookTitle, prompt, options })),
  };
}

function originFromReferer(request: FastifyRequest): string | undefined {
  const referer = request.headers.referer;
  return referer ? new URL(referer).origin : undefined;
}

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/demo/presenter', async (request) => ({
    configured: presenterConfigured(),
    authorized: await isPresenter(request),
  }));

  app.post('/api/demo/presenter/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { key } = presenterLoginSchema.parse(request.body);
    if (!presenterConfigured()) throw new HttpError(503, 'Режим ведущего не настроен');
    if (!keyMatches(key)) throw new HttpError(401, 'Неверный ключ ведущего');
    const token = newToken();
    await prisma.presenterSession.create({ data: { id: hashToken(token), expiresAt: new Date(Date.now() + PRESENTER_TTL_MS) } });
    reply.setCookie(PRESENTER_COOKIE, token, { ...cookieOptions, maxAge: PRESENTER_TTL_MS / 1000 });
    return { ok: true };
  });

  app.post('/api/demo/presenter/logout', async (request, reply) => {
    const token = request.cookies[PRESENTER_COOKIE];
    if (token) await prisma.presenterSession.deleteMany({ where: { id: hashToken(token) } });
    reply.clearCookie(PRESENTER_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.register(async (presenter) => {
    presenter.addHook('preHandler', requirePresenter);

    presenter.get('/api/demo/control', (request) => control(request));

    presenter.post('/api/demo/session', async (request) => {
      const { practice } = demoStartSchema.parse(request.body);
      await startSession(practice);
      return control(request);
    });

    presenter.post('/api/demo/reset', async (request) => {
      await resetSession();
      return control(request);
    });

    presenter.post('/api/demo/end', async (request) => {
      const session = await activeSession();
      if (session) await endSession(session);
      return control(request);
    });

    presenter.post('/api/demo/activity', async (request) => {
      await openActivity(demoOpenSchema.parse(request.body));
      return { ok: true };
    });

    presenter.post('/api/demo/activity/close', async () => {
      await closeActivity();
      return { ok: true };
    });

    presenter.post('/api/demo/finale', async () => {
      await setFinale();
      return { ok: true };
    });

    presenter.post('/api/demo/lobby', async () => {
      await resumeLobby();
      return { ok: true };
    });

    presenter.post('/api/demo/practice', async (request) => {
      const { count } = demoPracticeSchema.parse(request.body);
      await addPracticeParticipants(count);
      return { ok: true };
    });
  });

  app.get<{ Params: { code: string }; Querystring: { target?: string } }>('/api/demo/qr/:code.svg', async (request, reply: FastifyReply) => {
    const session = await prisma.demoSession.findUnique({ where: { code: request.params.code } });
    if (!session) throw notFound('Показ не найден');
    const links = joinLinks(session.code, originFromReferer(request));
    const url = request.query.target === 'telegram' ? links.telegram : links.web;
    if (!url) throw notFound('Telegram не настроен');
    reply.type('image/svg+xml').header('cache-control', 'no-store');
    return qrSvg(url);
  });

  // Участники зала с одной школьной сети выглядят как один адрес, поэтому лимиты здесь широкие.
  const audienceLimit = { rateLimit: { max: 1000, timeWindow: '1 minute' } };

  app.post<{ Params: { code: string } }>('/api/demo/join/:code', { config: audienceLimit }, async (request, reply) => {
    const { result, token } = await joinFromBrowser(request.params.code, request.cookies[AUDIENCE_COOKIE]);
    if (token) reply.setCookie(AUDIENCE_COOKIE, token, { ...cookieOptions, maxAge: AUDIENCE_TTL_S });
    return result;
  });

  app.post('/api/demo/vote', { config: audienceLimit }, async (request) => {
    const { activityId, choice } = demoVoteSchema.parse(request.body);
    return voteFromBrowser(request.cookies[AUDIENCE_COOKIE], activityId, choice);
  });
}
