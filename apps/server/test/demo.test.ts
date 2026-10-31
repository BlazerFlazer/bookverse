import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DemoControlDto, DemoJoinDto, DemoStateDto } from '@bookverse/shared';
import { buildApp, isAllowedOrigin } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { attachRealtime } from '../src/realtime.ts';

let app: FastifyInstance;
let baseUrl: string;

const KEY = 'test-presenter-key';

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

/** Браузер с собственными cookie: у ведущего и каждого зрителя свой. */
function client() {
  const jar = new Map<string, string>();
  const call = async <T = unknown>(method: 'GET' | 'POST', url: string, body?: unknown) => {
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

async function presenter() {
  const browser = client();
  const login = await browser.call('POST', '/demo/presenter/login', { key: KEY });
  expect(login.status).toBe(200);
  return browser;
}

async function start(host: Awaited<ReturnType<typeof presenter>>, practice = false) {
  const { body } = await host.call<DemoControlDto>('POST', '/demo/session', { practice });
  return body.state!;
}

async function openVote(host: Awaited<ReturnType<typeof presenter>>) {
  const response = await host.call('POST', '/demo/activity', { kind: 'vote', publicIds: ['BV-000001', 'BV-000002', 'BV-000003'] });
  expect(response.status).toBe(200);
  const { body } = await host.call<DemoControlDto>('GET', '/demo/control');
  return body.state!.activity!;
}

describe('доступ ведущего', () => {
  it('закрывает все действия без входа', async () => {
    const stranger = client();
    for (const path of ['/demo/session', '/demo/reset', '/demo/end', '/demo/activity', '/demo/activity/close', '/demo/finale', '/demo/practice']) {
      expect((await stranger.call('POST', path, {})).status).toBe(401);
    }
    expect((await stranger.call('GET', '/demo/control')).status).toBe(401);
  });

  it('не пускает с неверным ключом', async () => {
    expect((await client().call('POST', '/demo/presenter/login', { key: 'неверный-ключ' })).status).toBe(401);
  });

  it('вход пользователя сайта не даёт прав ведущего', async () => {
    const reader = client();
    const password = 'очень-длинный-пароль';
    await reader.call('POST', '/auth/register', { displayName: 'Читатель', email: 'demo-reader@example.com', password, confirmPassword: password });
    expect((await reader.call('POST', '/demo/session', { practice: false })).status).toBe(401);
  });

  it('хранит только хеш токена ведущего', async () => {
    await presenter();
    const sessions = await prisma.presenterSession.findMany();
    for (const session of sessions) expect(session.id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('участие зрителей', () => {
  it('входят без личных данных и получают псевдоним', async () => {
    const host = await presenter();
    const state = await start(host);
    const { status, body } = await client().call<DemoJoinDto>('POST', `/demo/join/${state.code}`, {});
    expect(status).toBe(200);
    expect(body.nickname).toMatch(/^[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+$/);
    expect(body.state.participants).toBe(1);
  });

  it('обновление страницы не создаёт второго участника', async () => {
    const host = await presenter();
    const state = await start(host);
    const viewer = client();
    const first = await viewer.call<DemoJoinDto>('POST', `/demo/join/${state.code}`, {});
    const second = await viewer.call<DemoJoinDto>('POST', `/demo/join/${state.code}`, {});
    expect(second.body.nickname).toBe(first.body.nickname);
    expect(second.body.state.participants).toBe(1);
  });

  it('несуществующий код получает понятный ответ', async () => {
    const { status } = await client().call('POST', '/demo/join/ZZZZZ', {});
    expect(status).toBe(404);
  });

  it('один голос на человека: двойное нажатие считается один раз', async () => {
    const host = await presenter();
    const state = await start(host);
    const viewer = client();
    await viewer.call('POST', `/demo/join/${state.code}`, {});
    const activity = await openVote(host);
    await viewer.call('POST', '/demo/vote', { activityId: activity.id, choice: 1 });
    await viewer.call('POST', '/demo/vote', { activityId: activity.id, choice: 2 });
    const { body } = await host.call<DemoControlDto>('GET', '/demo/control');
    expect(body.state!.activity!.counts).toEqual([0, 1, 0]);
  });

  it('параллельные нажатия тоже дают один голос', async () => {
    const host = await presenter();
    const state = await start(host);
    const viewer = client();
    await viewer.call('POST', `/demo/join/${state.code}`, {});
    const activity = await openVote(host);
    await Promise.all(Array.from({ length: 8 }, () => viewer.call('POST', '/demo/vote', { activityId: activity.id, choice: 0 })));
    expect(await prisma.demoVote.count({ where: { activityId: activity.id } })).toBe(1);
  });

  it('нельзя голосовать без входа, после закрытия и за несуществующий вариант', async () => {
    const host = await presenter();
    const state = await start(host);
    const viewer = client();
    await viewer.call('POST', `/demo/join/${state.code}`, {});
    const activity = await openVote(host);
    expect((await client().call('POST', '/demo/vote', { activityId: activity.id, choice: 0 })).status).toBe(401);
    expect((await viewer.call('POST', '/demo/vote', { activityId: activity.id, choice: 5 })).status).toBe(400);
    await host.call('POST', '/demo/activity/close', {});
    expect((await viewer.call('POST', '/demo/vote', { activityId: activity.id, choice: 0 })).status).toBe(409);
  });

  it('определяет победителя по настоящим голосам', async () => {
    const host = await presenter();
    const state = await start(host);
    const viewers = [client(), client(), client()];
    for (const viewer of viewers) await viewer.call('POST', `/demo/join/${state.code}`, {});
    const activity = await openVote(host);
    await viewers[0]!.call('POST', '/demo/vote', { activityId: activity.id, choice: 2 });
    await viewers[1]!.call('POST', '/demo/vote', { activityId: activity.id, choice: 2 });
    await viewers[2]!.call('POST', '/demo/vote', { activityId: activity.id, choice: 0 });
    await host.call('POST', '/demo/activity/close', {});
    const { body } = await host.call<DemoControlDto>('GET', '/demo/control');
    expect(body.state!.activity).toMatchObject({ status: 'closed', winner: 2, total: 3 });
    expect(body.state!.activity!.options[2]!.publicId).toBe('BV-000003');
  });
});

describe('вопрос залу', () => {
  it('использует только проверенные вопросы и не раскрывает ответ заранее', async () => {
    const host = await presenter();
    const state = await start(host);
    const { body: control } = await host.call<DemoControlDto>('GET', '/demo/control');
    expect(control.questions.length).toBeGreaterThan(2);
    expect(JSON.stringify(control.questions)).not.toContain('"answer"');

    const viewer = client();
    await viewer.call('POST', `/demo/join/${state.code}`, {});
    const question = control.questions[0]!;
    await host.call('POST', '/demo/activity', { kind: 'quiz', questionId: question.id });

    const open = await viewer.call<DemoJoinDto>('POST', `/demo/join/${state.code}`, {});
    expect(open.body.state.activity).toMatchObject({ status: 'open', correct: null, explanation: null });

    await host.call('POST', '/demo/activity/close', {});
    const closed = await viewer.call<DemoJoinDto>('POST', `/demo/join/${state.code}`, {});
    expect(closed.body.state.activity!.correct).toEqual(expect.any(Number));
    expect(closed.body.state.activity!.explanation!.length).toBeGreaterThan(5);
  });

  it('отклоняет выдуманный вопрос', async () => {
    const host = await presenter();
    await start(host);
    expect((await host.call('POST', '/demo/activity', { kind: 'quiz', questionId: 'выдуманный' })).status).toBe(404);
  });
});

describe('живое обновление', () => {
  let socket: Socket;

  beforeEach(() => socket?.disconnect());
  afterAll(() => socket?.disconnect());

  const nextState = (match: (state: DemoStateDto) => boolean) =>
    new Promise<DemoStateDto>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Состояние не пришло')), 5000);
      const listener = (state: DemoStateDto) => {
        if (!match(state)) return;
        clearTimeout(timer);
        socket.off('demo:state', listener);
        resolve(state);
      };
      socket.on('demo:state', listener);
    });

  it('экран получает участника и голос через настоящий WebSocket', async () => {
    const host = await presenter();
    const state = await start(host);
    socket = io(baseUrl, { path: '/socket.io', transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', resolve));

    const snapshot = nextState((s) => s.code === state.code);
    socket.emit('demo:watch', state.code);
    expect((await snapshot).participants).toBe(0);

    const viewer = client();
    const joined = nextState((s) => s.participants === 1);
    await viewer.call('POST', `/demo/join/${state.code}`, {});
    await joined;

    const activity = await openVote(host);
    const voted = nextState((s) => s.activity?.total === 1);
    await viewer.call('POST', '/demo/vote', { activityId: activity.id, choice: 1 });
    expect((await voted).activity!.counts).toEqual([0, 1, 0]);
  });

  it('игнорирует мусор вместо кода', async () => {
    socket = io(baseUrl, { path: '/socket.io', transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', resolve));
    socket.emit('demo:watch', { $ne: null });
    socket.emit('demo:watch', '../../etc');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(socket.connected).toBe(true);
  });
});

describe('репетиция', () => {
  it('имитированные участники запрещены на настоящем показе', async () => {
    const host = await presenter();
    await start(host, false);
    expect((await host.call('POST', '/demo/practice', { count: 5 })).status).toBe(403);
    expect((await host.call<DemoControlDto>('GET', '/demo/control')).body.state!.bySource.practice).toBe(0);
  });

  it('в репетиции имитация помечена и голосует сама', async () => {
    const host = await presenter();
    const state = await start(host, true);
    expect(state.practice).toBe(true);
    await host.call('POST', '/demo/practice', { count: 6 });
    const activity = await openVote(host);
    const { body } = await host.call<DemoControlDto>('GET', '/demo/control');
    expect(body.state!.bySource).toMatchObject({ practice: 6, web: 0, telegram: 0 });

    await expect.poll(() => prisma.demoVote.count({ where: { activityId: activity.id } }), { timeout: 12_000 }).toBe(6);
  });
});

describe('нагрузка зала', () => {
  it('сто телефонов входят и голосуют одновременно, и ни один голос не теряется', async () => {
    const host = await presenter();
    const state = await start(host);
    const viewers = Array.from({ length: 100 }, () => client());

    const joinStart = performance.now();
    const joins = await Promise.all(viewers.map((viewer) => viewer.call('POST', `/demo/join/${state.code}`, {})));
    const joinMs = performance.now() - joinStart;
    expect(joins.every((j) => j.status === 200)).toBe(true);

    const activity = await openVote(host);
    const voteStart = performance.now();
    const votes = await Promise.all(viewers.map((viewer, index) => viewer.call('POST', '/demo/vote', { activityId: activity.id, choice: index % 3 })));
    const voteMs = performance.now() - voteStart;
    expect(votes.every((v) => v.status === 200)).toBe(true);

    const { body } = await host.call<DemoControlDto>('GET', '/demo/control');
    expect(body.state!.participants).toBe(100);
    expect(body.state!.activity!.total).toBe(100);
    expect(body.state!.activity!.counts).toEqual([34, 33, 33]);
    console.log(`100 входов: ${Math.round(joinMs)} мс, 100 голосов: ${Math.round(voteMs)} мс`);
    expect(joinMs).toBeLessThan(15_000);
    expect(voteMs).toBeLessThan(15_000);
  });
});

describe('ход показа', () => {
  it('восстанавливается после перезагрузки страницы ведущего', async () => {
    const host = await presenter();
    const state = await start(host);
    const activity = await openVote(host);
    const again = await presenter();
    const { body } = await again.call<DemoControlDto>('GET', '/demo/control');
    expect(body.state).toMatchObject({ code: state.code });
    expect(body.state!.activity).toMatchObject({ id: activity.id, status: 'open' });
  });

  it('сброс очищает голоса, но оставляет код зала', async () => {
    const host = await presenter();
    const state = await start(host);
    const viewer = client();
    await viewer.call('POST', `/demo/join/${state.code}`, {});
    await openVote(host);
    const { body } = await host.call<DemoControlDto>('POST', '/demo/reset', {});
    expect(body.state).toMatchObject({ code: state.code, participants: 0, activity: null });
  });

  it('новый показ завершает прежний', async () => {
    const host = await presenter();
    const first = await start(host);
    const second = await start(host);
    expect(second.code).not.toBe(first.code);
    expect((await client().call('POST', `/demo/join/${first.code}`, {})).status).toBe(404);
  });

  it('завершение удаляет участников и голоса, но сохраняет итоговые числа', async () => {
    const host = await presenter();
    const state = await start(host);
    const viewer = client();
    await viewer.call('POST', `/demo/join/${state.code}`, {});
    const activity = await openVote(host);
    await viewer.call('POST', '/demo/vote', { activityId: activity.id, choice: 0 });
    await host.call('POST', '/demo/end', {});

    const session = await prisma.demoSession.findUniqueOrThrow({ where: { code: state.code } });
    expect(await prisma.demoParticipant.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.demoVote.count({ where: { activityId: activity.id } })).toBe(0);
    const stored = await prisma.demoActivity.findUniqueOrThrow({ where: { id: activity.id } });
    expect(stored.resultCounts).toEqual([1, 0, 0]);
  });

  it('QR-код ведёт на страницу входа', async () => {
    const host = await presenter();
    const state = await start(host);
    const { body } = await host.call<DemoControlDto>('GET', '/demo/control');
    expect(body.links!.web).toMatch(new RegExp(`/join/${state.code}$`));
    const response = await app.inject({ method: 'GET', url: `/api/demo/qr/${state.code}.svg` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
    expect(response.body).toContain('<svg');
  });
});
