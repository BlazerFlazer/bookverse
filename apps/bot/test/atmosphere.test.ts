import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoControlDto, DemoAtmosphereDto, PresenterTelegramLinkDto } from '@bookverse/shared';
import { buildApp } from '../../server/src/app.ts';
import { prisma } from '../../server/src/db.ts';
import { BookverseApi } from '../src/api.ts';
import { createBot, MENU } from '../src/bot.ts';
import { attachHarness } from '../src/harness.ts';

let app: FastifyInstance;
let harness: ReturnType<typeof attachHarness>;

const SECRET = 'test-secret-0123456789abcdef';
const KEY = 'test-presenter-key';

beforeAll(async () => {
  app = await buildApp({ rateLimit: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  harness = attachHarness(createBot('test', new BookverseApi(baseUrl, SECRET)));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const text = () => String(harness.last()?.payload.text ?? '');
const alert = () => harness.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)?.payload;

async function presenter(practice = false) {
  let cookie = '';
  const call = async <T>(method: 'GET' | 'POST', url: string, body?: unknown) => {
    const response = await app.inject({ method, url: `/api${url}`, headers: cookie ? { cookie } : {}, ...(body === undefined ? {} : { payload: body as object }) });
    const set = response.headers['set-cookie'];
    const value = Array.isArray(set) ? set.at(-1) : set;
    if (value) cookie = value.split(';')[0]!;
    return response.json() as T;
  };
  await call('POST', '/demo/presenter/login', { key: KEY });
  await call<DemoControlDto>('POST', '/demo/session', { practice });
  return { call };
}

describe('раздел «Живая библиотека»', () => {
  it('показывает атмосферу и время суток без привязки аккаунта', async () => {
    await harness.send(910_001, MENU.atmosphere);
    expect(text()).toContain('Живая библиотека');
    expect(text()).toContain('Атмосфера: Дождь');
    expect(text()).toMatch(/Сейчас: Дождлив(ое утро|ый день|ый вечер|ая ночь)/);
    expect(text()).toContain('Подключите аккаунт');
    const buttons = harness.buttons(harness.last());
    expect(buttons.map((b) => b.text)).toContain('🏛 Открыть библиотеку');
    expect(buttons.find((b) => b.text === '🏛 Открыть библиотеку')?.url).toBe('https://bookverse.example/');
    expect(buttons.some((b) => b.url?.includes('?atmosphere='))).toBe(true);
  });

  it('команда /atmosphere открывает тот же раздел', async () => {
    await harness.send(910_002, '/atmosphere');
    expect(text()).toContain('Живая библиотека');
  });

  it('не привязанный аккаунт получает подсказку вместо сохранения', async () => {
    await harness.press(910_003, 'atmos:save:evening');
    expect(text()).toContain('подключите аккаунт');
  });

  it('обычному пользователю не показывает кнопки ведущего и не даёт ими воспользоваться', async () => {
    await presenter();
    await harness.send(910_004, MENU.atmosphere);
    expect(harness.buttons(harness.last()).some((b) => b.data?.startsWith('atmos:show'))).toBe(false);
    await harness.press(910_004, 'atmos:show:night');
    expect(alert()).toMatchObject({ text: 'Управлять экраном показа может только ведущий', show_alert: true });
  });
});

describe('ведущий в Telegram', () => {
  it('подключается одноразовой ссылкой и управляет настоящим показом', async () => {
    const host = await presenter();
    const link = await host.call<PresenterTelegramLinkDto>('POST', '/demo/presenter/telegram', {});
    const token = link.command.split(' ')[1]!;
    const telegramId = 910_010;

    await harness.send(telegramId, `/start presenter_${token}`);
    expect(text()).toContain('Вы ведущий показа');
    const buttons = harness.buttons(harness.last());
    expect(buttons.map((b) => b.text)).toEqual(expect.arrayContaining(['Показать дождливое утро', 'Показать вечер', 'Показать ночь', 'Показать погоду', '🏛 Открыть библиотеку']));

    await harness.press(telegramId, 'atmos:show:evening');
    expect(alert()).toMatchObject({ text: 'На экране: Дождливый вечер' });
    await harness.press(telegramId, 'atmos:audio:off');
    await harness.press(telegramId, 'atmos:rain:on');
    await harness.press(telegramId, 'atmos:showcase');

    const { state } = await host.call<DemoControlDto>('GET', '/demo/control');
    expect(state?.atmosphere).toMatchObject({ time: 'evening', audio: false, rainBoost: true, showcase: 1, source: 'telegram' } satisfies Partial<DemoAtmosphereDto>);

    await harness.send(telegramId, MENU.atmosphere);
    expect(text()).toContain('На экране: Дождливый вечер');
    expect(text()).toContain('Звуки на экране: выключены');
    expect(harness.buttons(harness.last()).map((b) => b.text)).toContain('Включить атмосферу');
  });

  it('команда /presenter работает, когда ссылка на Telegram не настроена', async () => {
    const host = await presenter();
    const link = await host.call<PresenterTelegramLinkDto>('POST', '/demo/presenter/telegram', {});
    await harness.send(910_011, link.command);
    expect(text()).toContain('Вы ведущий показа');
  });

  it('устаревшая ссылка объясняет, что делать', async () => {
    await presenter();
    await harness.send(910_012, '/presenter неверный-токен-ведущего');
    expect(text()).toContain('Ссылка ведущего устарела');
  });
});
