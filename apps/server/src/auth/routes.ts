import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { createTransport } from 'nodemailer';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from '@bookverse/shared';
import { config, mailConfigured } from '../config.ts';
import { isUniqueViolation, prisma } from '../db.ts';
import { HttpError } from '../http.ts';
import { mergeGuestInto } from './merge.ts';
import { endSession, hashToken, newToken, requireUser, startSession, toUserDto } from './session.ts';

// Параметры Argon2id по рекомендации OWASP: 19 МиБ памяти, 2 прохода.
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
// Сверка с этой заглушкой уравнивает время ответа: по нему нельзя узнать, есть ли такая почта.
const DUMMY_HASH = hash('bookverse-timing-guard', ARGON2);

const AUTH_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

const RESET_TTL_MS = 3_600_000;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/me', async (request) => ({
    user: request.user ? toUserDto(request.user) : null,
    mailConfigured,
  }));

  app.post('/api/auth/register', { config: AUTH_LIMIT }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const passwordHash = await hash(input.password, ARGON2);
    const profile = { email: input.email, passwordHash, displayName: input.displayName, isGuest: false };
    try {
      // Гость становится полноценным аккаунтом на месте: прогресс и слова никуда не переносятся.
      const user = request.user?.isGuest
        ? await prisma.user.update({ where: { id: request.user.id }, data: profile })
        : await prisma.user.create({ data: profile });
      await endSession(reply, request.sessionId);
      await startSession(reply, user.id, true);
      reply.code(201);
      return { user: toUserDto(user) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, 'Этот адрес уже зарегистрирован', { email: 'Этот адрес уже зарегистрирован. Попробуйте войти.' });
      }
      throw error;
    }
  });

  app.post('/api/auth/login', { config: AUTH_LIMIT }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const valid = await verify(user?.passwordHash ?? (await DUMMY_HASH), input.password);
    if (!user?.passwordHash || !valid) throw new HttpError(401, 'Неверная почта или пароль');

    const guest = request.user?.isGuest ? request.user : null;
    if (guest) await prisma.$transaction((tx) => mergeGuestInto(tx, guest.id, user.id));
    else await endSession(reply, request.sessionId);

    await startSession(reply, user.id, input.remember);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { user: toUserDto(fresh), mergedGuest: Boolean(guest) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    requireUser(request);
    await endSession(reply, request.sessionId);
    return { ok: true };
  });

  app.post('/api/auth/forgot', { config: AUTH_LIMIT }, async (request) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    // Не притворяемся, что письмо ушло, если почта не настроена.
    if (!mailConfigured) return { available: false };

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = newToken();
      await prisma.passwordResetToken.create({
        data: { id: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      await createTransport(config.SMTP_URL).sendMail({
        from: config.MAIL_FROM,
        to: email,
        subject: 'BOOKVERSE: восстановление пароля',
        text: `Чтобы задать новый пароль, откройте ссылку (действует один час):\n${config.PUBLIC_WEB_URL}/auth?reset=${token}`,
      });
    }
    // Ответ одинаковый, есть такой аккаунт или нет.
    return { available: true };
  });

  app.post('/api/auth/reset', { config: AUTH_LIMIT }, async (request) => {
    const input = resetPasswordSchema.parse(request.body);
    const stored = await prisma.passwordResetToken.findUnique({ where: { id: hashToken(input.token) } });
    if (!stored || stored.usedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new HttpError(400, 'Ссылка устарела. Запросите восстановление ещё раз.');
    }
    const passwordHash = await hash(input.password, ARGON2);
    await prisma.$transaction([
      prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: stored.userId } }),
    ]);
    return { ok: true };
  });
}
