import type { FastifyInstance } from 'fastify';
import type { TelegramLinkDto } from '@bookverse/shared';
import { hashToken, newToken, requireUser } from '../auth/session.ts';
import { config } from '../config.ts';
import { prisma } from '../db.ts';
import { HttpError } from '../http.ts';

const LINK_TTL_MS = 10 * 60_000;

/** Привязка идёт от сайта: браузер получает одноразовый токен, а Telegram ID присылает только бот. */
export async function telegramRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/telegram/link-token', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const user = requireUser(request);
    if (user.isGuest) throw new HttpError(403, 'Сначала создайте аккаунт: так привязка сохранится надёжно.');

    // Новый токен отменяет прежние неиспользованные.
    await prisma.telegramLinkToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    const token = newToken(18);
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await prisma.telegramLinkToken.create({ data: { id: hashToken(token), userId: user.id, expiresAt } });

    const username = config.TELEGRAM_BOT_USERNAME;
    const result: TelegramLinkDto = {
      configured: Boolean(username),
      url: username ? `https://t.me/${username}?start=link_${token}` : null,
      code: token,
      expiresAt: expiresAt.toISOString(),
    };
    return result;
  });

  app.delete('/api/telegram/link', async (request) => {
    const user = requireUser(request);
    await prisma.telegramAccount.deleteMany({ where: { userId: user.id } });
    return { ok: true };
  });
}
