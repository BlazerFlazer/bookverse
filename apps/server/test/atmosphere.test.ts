import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ATMOSPHERE } from '@bookverse/shared';
import type { AtmosphereBotDto, AtmosphereSettings, DemoAtmosphereDto, DemoControlDto, DemoStateDto, PresenterTelegramLinkDto, TelegramLinkDto } from '@bookverse/shared';
import { buildApp, isAllowedOrigin } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { attachRealtime } from '../src/realtime.ts';

let app: FastifyInstance;
let baseUrl: string;

const KEY = 'test-presenter-key';
const SECRET = 'test-secret-0123456789abcdef';
const PASSWORD = 'очень-длинный-пароль';
const custom: AtmosphereSettings = { ...DEFAULT_ATMOSPHERE, atmosphereVolume: 0.35, autoTimeOfDayEnabled: false, preferredManualTimeOfDay: 'night', rainIntensity: 'heavy' };

beforeAll(async () => {
  app = await buildApp({ rateLimit: false });
  attachRealtime(app.server, isAllowedOrigin);
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function client() {
  const jar = new Map<string, string>();
  const call = async <T = unknown>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
    const response = await app.inject({
      method,
      url: `/api${url}`,
      headers: jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const raw = response.headers['set-cookie'];
    for (const cookie of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      const [name, value] = cookie.split(';')[0]!.split('=');
      jar.set(name!, value!);
    }
    return { status: response.statusCode, body: response.json() as T };
  };
  return { call };
}

async function bot<T = unknown>(method: 'GET' | 'POST', url: string, body?: unknown) {
  const response = await app.inject({
    method,
    url: `/internal/bot${url}`,
    headers: { 'x-bot-secret': SECRET },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: response.statusCode, body: response.json() as T };
}

let accounts = 0;
async function account() {
  accounts += 1;
  const browser = client();
  const email = `atmos${accounts}@example.com`;
  await browser.call('POST', '/auth/register', { displayName: 'Читатель', email, password: PASSWORD, confirmPassword: PASSWORD });
  return { ...browser, email };
}

async function presenter(practice = false) {
  const browser = client();
  await browser.call('POST', '/demo/presenter/login', { key: KEY });
  const { body } = await browser.call<DemoControlDto>('POST', '/demo/session', { practice });
  return { ...browser, code: body.state!.code };
}

async function pairTelegram(host: Awaited<ReturnType<typeof presenter>>, telegramId: string) {
  const { body } = await host.call<PresenterTelegramLinkDto>('POST', '/demo/presenter/telegram', {});
  const token = body.command.split(' ')[1]!;
  return { response: await bot('POST', '/demo/presenter', { token, telegramId }), token };
}

describe('настройки на сервере', () => {
  it('гость не пишет настройки на сервер и получает пустой ответ', async () => {
    const guest = client();
    expect((await guest.call('PUT', '/atmosphere', { settings: custom })).status).toBe(401);
    expect((await guest.call('GET', '/atmosphere')).body).toEqual({ settings: null });
    await guest.call('POST', '/books/BV-000002/open', {});
    expect((await guest.call('PUT', '/atmosphere', { settings: custom })).status).toBe(403);
  });

  it('аккаунт сохраняет настройки, и они переживают новый вход', async () => {
    const reader = await account();
    expect((await reader.call<{ settings: unknown }>('GET', '/atmosphere')).body.settings).toBeNull();
    expect((await reader.call('PUT', '/atmosphere', { settings: custom, utcOffsetMinutes: 180 })).status).toBe(200);
    const again = client();
    await again.call('POST', '/auth/login', { email: reader.email, password: PASSWORD });
    expect((await again.call<{ settings: AtmosphereSettings }>('GET', '/atmosphere')).body.settings).toEqual(custom);
  });

  it('гость, ставший аккаунтом, может перенести настройки браузера', async () => {
    const guest = client();
    await guest.call('POST', '/books/BV-000002/open', {});
    await guest.call('POST', '/auth/register', { displayName: 'Новичок', email: 'atmos-guest@example.com', password: PASSWORD, confirmPassword: PASSWORD });
    expect((await guest.call<{ settings: unknown }>('GET', '/atmosphere')).body.settings).toBeNull();
    expect((await guest.call('PUT', '/atmosphere', { settings: custom })).status).toBe(200);
    expect((await guest.call<{ settings: AtmosphereSettings }>('GET', '/atmosphere')).body.settings?.rainIntensity).toBe('heavy');
  });

  it('отклоняет неверные значения', async () => {
    const reader = await account();
    const { status } = await reader.call('PUT', '/atmosphere', { settings: { ...custom, rainIntensity: 'потоп' } });
    expect(status).toBe(400);
  });
});

describe('библиотека в боте', () => {
  it('без секрета бота закрыта', async () => {
    const response = await app.inject({ method: 'GET', url: '/internal/bot/atmosphere?telegramId=1' });
    expect(response.statusCode).toBe(401);
  });

  it('показывает настройки по умолчанию непривязанному пользователю', async () => {
    const { body } = await bot<AtmosphereBotDto>('GET', '/atmosphere?telegramId=700001');
    expect(body.linked).toBe(false);
    expect(body.settings).toEqual(DEFAULT_ATMOSPHERE);
    expect(body.links.phases.evening).toBe('https://bookverse.example/?atmosphere=evening');
  });

  it('видит настройки привязанного аккаунта и сохраняет выбор', async () => {
    const reader = await account();
    const telegramId = '700002';
    const { body: link } = await reader.call<TelegramLinkDto>('POST', '/telegram/link-token', {});
    await bot('POST', '/link', { token: link.code, telegramId, username: 'reader' });
    await reader.call('PUT', '/atmosphere', { settings: custom });

    const seen = await bot<AtmosphereBotDto>('GET', `/atmosphere?telegramId=${telegramId}`);
    expect(seen.body).toMatchObject({ linked: true, phase: 'night' });
    expect(seen.body.settings.atmosphereVolume).toBe(0.35);

    expect((await bot('POST', `/users/${telegramId}/atmosphere`, { time: 'morning' })).status).toBe(200);
    expect((await reader.call<{ settings: AtmosphereSettings }>('GET', '/atmosphere')).body.settings).toMatchObject({ autoTimeOfDayEnabled: false, preferredManualTimeOfDay: 'morning', atmosphereVolume: 0.35 });
    await bot('POST', `/users/${telegramId}/atmosphere`, { time: 'auto' });
    expect((await reader.call<{ settings: AtmosphereSettings }>('GET', '/atmosphere')).body.settings?.autoTimeOfDayEnabled).toBe(true);
  });

  it('сохранять настройки может только привязанный Telegram', async () => {
    expect((await bot('POST', '/users/700003/atmosphere', { time: 'day' })).status).toBe(404);
  });
});

describe('управление показом', () => {
  it('сайт без входа ведущего не меняет атмосферу', async () => {
    await presenter();
    const stranger = client();
    expect((await stranger.call('POST', '/demo/atmosphere', { time: 'night' })).status).toBe(401);
    expect((await stranger.call('POST', '/demo/presenter/telegram', {})).status).toBe(401);
    const reader = await account();
    expect((await reader.call('POST', '/demo/atmosphere', { time: 'night' })).status).toBe(401);
  });

  it('ведущий меняет зал, а все экраны получают это через настоящий WebSocket', async () => {
    const host = await presenter();
    const socket = io(baseUrl, { transports: ['websocket'] });
    const received = new Promise<DemoStateDto>((resolve) => {
      socket.on('demo:state', (state: DemoStateDto) => {
        if (state.atmosphere.time === 'night') resolve(state);
      });
    });
    socket.on('connect', () => socket.emit('demo:watch', host.code));

    const { body } = await host.call<DemoAtmosphereDto>('POST', '/demo/atmosphere', { time: 'night', rainBoost: true });
    expect(body).toMatchObject({ time: 'night', rainBoost: true, source: 'presenter' });
    const state = await received;
    socket.disconnect();
    expect(state.atmosphere).toMatchObject({ time: 'night', rainBoost: true });
  });

  it('показ погоды увеличивает счётчик один раз на команду', async () => {
    const host = await presenter();
    await host.call('POST', '/demo/atmosphere', { showcase: true });
    const { body } = await host.call<DemoAtmosphereDto>('POST', '/demo/atmosphere', { showcase: true });
    expect(body.showcase).toBe(2);
  });

  it('команды без начатого показа отклоняются', async () => {
    const host = await presenter();
    await host.call('POST', '/demo/end', {});
    expect((await host.call('POST', '/demo/atmosphere', { time: 'day' })).status).toBe(409);
  });

  it('бот управляет экраном только после подключения ведущего', async () => {
    const host = await presenter();
    const outsider = '800001';
    expect((await bot('POST', '/demo/atmosphere', { telegramId: outsider, patch: { time: 'night' } })).status).toBe(403);

    const owner = '800002';
    const { response, token } = await pairTelegram(host, owner);
    expect(response.status).toBe(200);
    expect((await bot('POST', '/demo/atmosphere', { telegramId: outsider, patch: { time: 'night' } })).status).toBe(403);

    const allowed = await bot<DemoAtmosphereDto>('POST', '/demo/atmosphere', { telegramId: owner, patch: { time: 'evening', audio: false } });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ time: 'evening', audio: false, source: 'telegram' });

    const view = await bot<AtmosphereBotDto>('GET', `/atmosphere?telegramId=${owner}`);
    expect(view.body.demo).toMatchObject({ presenter: true, phase: 'evening' });
    const other = await bot<AtmosphereBotDto>('GET', `/atmosphere?telegramId=${outsider}`);
    expect(other.body.demo?.presenter).toBe(false);

    // Ссылка одноразовая: чужой не может ей воспользоваться даже случайно увидев на экране.
    expect((await bot('POST', '/demo/presenter', { token, telegramId: outsider })).status).toBe(400);
  });

  it('токен ссылки хранится только хешем, а просроченная ссылка не работает', async () => {
    const host = await presenter();
    const { body } = await host.call<PresenterTelegramLinkDto>('POST', '/demo/presenter/telegram', {});
    const token = body.command.split(' ')[1]!;
    const stored = await prisma.presenterLinkToken.findMany();
    expect(stored.every((row) => /^[0-9a-f]{64}$/.test(row.id) && row.id !== token)).toBe(true);
    await prisma.presenterLinkToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await bot('POST', '/demo/presenter', { token, telegramId: '800003' })).status).toBe(400);
  });

  it('подключение ведущего заканчивается вместе с показом', async () => {
    const host = await presenter();
    await pairTelegram(host, '800004');
    await host.call('POST', '/demo/end', {});
    const session = await prisma.demoSession.findUnique({ where: { code: host.code } });
    expect(session?.presenterTelegramId).toBeNull();
    await presenter();
    expect((await bot('POST', '/demo/atmosphere', { telegramId: '800004', patch: { time: 'day' } })).status).toBe(403);
  });

  it('имитация Telegram есть только в репетиции и честно помечена', async () => {
    const live = await presenter(false);
    expect((await live.call('POST', '/demo/atmosphere', { time: 'day', simulateTelegram: true })).status).toBe(403);
    const practice = await presenter(true);
    const { body } = await practice.call<DemoAtmosphereDto>('POST', '/demo/atmosphere', { time: 'day', simulateTelegram: true });
    expect(body.source).toBe('practice');
  });

  it('сброс показа возвращает экран к настройкам ведущего', async () => {
    const host = await presenter();
    await host.call('POST', '/demo/atmosphere', { time: 'night' });
    const { body } = await host.call<DemoControlDto>('POST', '/demo/reset', {});
    expect(body.state?.atmosphere.time).toBeNull();
  });
});
