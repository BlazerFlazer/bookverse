import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { levelFromXp, rankForLevel } from '@bookverse/game-engine';
import type { UserDto } from '@bookverse/shared';
import { isProduction } from '../config.ts';
import { prisma } from '../db.ts';
import { unauthorized } from '../http.ts';

export const SESSION_COOKIE = 'bv_session';
const SHORT_SESSION_MS = 12 * 3_600_000;
const LONG_SESSION_MS = 30 * 86_400_000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
  }
}

export async function startSession(reply: FastifyReply, userId: string, remember: boolean): Promise<void> {
  const token = newToken();
  const lifetime = remember ? LONG_SESSION_MS : SHORT_SESSION_MS;
  await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt: new Date(Date.now() + lifetime) },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    // Без maxAge cookie живёт до закрытия браузера: это и есть вход без «запомнить меня».
    maxAge: remember ? LONG_SESSION_MS / 1000 : undefined,
  });
}

export async function endSession(reply: FastifyReply, sessionId: string | null): Promise<void> {
  if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } });
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function userFromToken(token: string | undefined): Promise<{ user: User; sessionId: string } | null> {
  if (!token) return null;
  const sessionId = hashToken(token);
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
    return null;
  }
  return { user: session.user, sessionId };
}

export async function loadUser(request: FastifyRequest): Promise<void> {
  const found = await userFromToken(request.cookies[SESSION_COOKIE]);
  request.user = found?.user ?? null;
  request.sessionId = found?.sessionId ?? null;
}

export function requireUser(request: FastifyRequest): User {
  if (!request.user) throw unauthorized();
  return request.user;
}

/** Первое сохранение заводит гостевого пользователя: читать можно сразу, без регистрации. */
export async function ensureUser(request: FastifyRequest, reply: FastifyReply): Promise<User> {
  if (request.user) return request.user;
  const user = await prisma.user.create({ data: { displayName: 'Гость', isGuest: true } });
  await startSession(reply, user.id, true);
  request.user = user;
  return user;
}

export function toUserDto(user: User): UserDto {
  const { level } = levelFromXp(user.xp);
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    isGuest: user.isGuest,
    xp: user.xp,
    level,
    rank: rankForLevel(level),
  };
}
