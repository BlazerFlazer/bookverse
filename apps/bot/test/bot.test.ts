import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TelegramLinkDto, VocabularyItemDto } from '@bookverse/shared';
import { buildApp } from '../../server/src/app.ts';
import { prisma } from '../../server/src/db.ts';
import { BookverseApi } from '../src/api.ts';
import { createBot, deliverDemo, isPublicUrl, MENU } from '../src/bot.ts';
import { attachHarness } from '../src/harness.ts';

let app: FastifyInstance;
let baseUrl: string;
let harness: ReturnType<typeof attachHarness>;

const SECRET = 'test-secret-0123456789abcdef';
const nextTelegramId = (() => {
  let id = 5_000_000;
  return () => (id += 1);
})();

beforeAll(async () => {
  app = await buildApp({ rateLimit: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  harness = attachHarness(createBot('test', new BookverseApi(baseUrl, SECRET)));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const text = () => {
  const call = harness.last();
  return String(call?.payload.text ?? call?.payload.caption ?? '');
};

let counter = 0;
async function site() {
  counter += 1;
  const email = `bot-reader${counter}@example.com`;
  const password = 'очень-длинный-пароль';
  let cookie = '';
  const call = async <T>(method: 'GET' | 'POST', url: string, body?: unknown) => {
    const response = await app.inject({ method, url: `/api${url}`, headers: cookie ? { cookie } : {}, ...(body === undefined ? {} : { payload: body as object }) });
    const set = response.headers['set-cookie'];
    const value = Array.isArray(set) ? set.at(-1) : set;
    if (value) cookie = value.split(';')[0]!;
    return response.json() as T;
  };
  await call('POST', '/auth/register', { displayName: `Читатель ${counter}`, email, password, confirmPassword: password });
  return { call };
}

async function linked() {
  const web = await site();
  const telegramId = nextTelegramId();
  const { code } = await web.call<TelegramLinkDto>('POST', '/telegram/link-token', {});
  await harness.send(telegramId, `/start link_${code}`, 'reader');
  return { web, telegramId, code };
}

describe('поиск книг', () => {
  it('находит книгу по коду и отвечает карточкой с обложкой и ссылками', async () => {
    await harness.send(nextTelegramId(), 'BV-000002');
    const call = harness.last();
    expect(call?.method).toBe('sendPhoto');
    expect(text()).toContain('Каштанка');
    expect(text()).toContain('Антон Павлович Чехов');
    expect(text()).toContain('BV-000002');
    const buttons = harness.buttons(call);
    expect(buttons.map((b) => b.text)).toEqual(['📖 Читать', '🎧 Слушать', '🔖 Сохранить']);
    expect(buttons[0]?.url).toBe('https://bookverse.example/read/BV-000002');
    expect(buttons[1]?.url).toBe('https://bookverse.example/read/BV-000002?listen=1');
  });

  it('понимает код, написанный по-другому', async () => {
    await harness.send(nextTelegramId(), 'bv 3');
    expect(text()).toContain('Сказка о рыбаке и рыбке');
  });

  it('объясняет, если кода нет, и предлагает поиск по названию', async () => {
    await harness.send(nextTelegramId(), 'BV-999999');
    expect(text()).toContain('Книга с таким кодом не найдена');
    expect(text()).toContain('по названию');
  });

  it('ищет по названию, автору и с опечаткой', async () => {
    const id = nextTelegramId();
    await harness.send(id, 'Чехов');
    expect(text()).toContain('Каштанка');
    await harness.send(id, 'Каштонка');
    expect(text()).toContain('Каштанка');
  });

  it('при нескольких совпадениях предлагает выбрать', async () => {
    const id = nextTelegramId();
    await harness.send(id, 'Толстой');
    const buttons = harness.buttons(harness.last());
    expect(buttons.length).toBe(2);
    await harness.press(id, buttons[0]!.data!);
    expect(text()).toContain('Толстой');
  });

  it('не показывает кнопки на локальные адреса: Telegram их не принимает', () => {
    expect(isPublicUrl('https://bookverse.example/read/BV-000001')).toBe(true);
    for (const url of ['http://localhost:5173/x', 'https://localhost/x', 'https://192.168.1.11/x', 'http://example.com']) {
      expect(isPublicUrl(url)).toBe(false);
    }
  });
});

describe('привязка аккаунта', () => {
  it('связывает Telegram с аккаунтом одноразовым токеном', async () => {
    const { telegramId } = await linked();
    expect(text()).toContain('подключён');
    const account = await prisma.telegramAccount.findUnique({ where: { telegramId: String(telegramId) } });
    expect(account?.username).toBe('reader');
  });

  it('повторно использовать токен нельзя', async () => {
    const { code } = await linked();
    const other = nextTelegramId();
    await harness.send(other, `/start link_${code}`);
    expect(text()).toContain('устарела или уже использована');
    expect(await prisma.telegramAccount.findUnique({ where: { telegramId: String(other) } })).toBeNull();
  });

  it('истёкший токен не работает', async () => {
    const web = await site();
    const { code } = await web.call<TelegramLinkDto>('POST', '/telegram/link-token', {});
    await prisma.telegramLinkToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) }, where: { usedAt: null } });
    await harness.send(nextTelegramId(), `/start link_${code}`);
    expect(text()).toContain('устарела');
  });

  it('один Telegram нельзя привязать ко второму аккаунту', async () => {
    const { telegramId } = await linked();
    const web = await site();
    const { code } = await web.call<TelegramLinkDto>('POST', '/telegram/link-token', {});
    await harness.send(telegramId, `/start link_${code}`);
    expect(text()).toContain('уже привязан к другому аккаунту');
  });

  it('в базе хранится только хеш токена', async () => {
    const web = await site();
    const { code } = await web.call<TelegramLinkDto>('POST', '/telegram/link-token', {});
    expect(await prisma.telegramLinkToken.findUnique({ where: { id: code } })).toBeNull();
  });

  it('личные разделы закрыты без привязки', async () => {
    const id = nextTelegramId();
    for (const button of [MENU.library, MENU.resume, MENU.review, MENU.achievements, MENU.progress]) {
      await harness.send(id, button);
      expect(text()).toContain('подключите аккаунт');
    }
  });
});

describe('общие данные с сайтом', () => {
  it('«Продолжить чтение» ведёт на сохранённое место', async () => {
    const { web, telegramId } = await linked();
    await web.call('POST', '/books/BV-000002/open', {});
    const chapter = await web.call<{ blocks: { key: string; charStart: number }[] }>('GET', '/books/BV-000002/chapters/3');
    const block = chapter.blocks[4]!;
    await web.call('POST', '/books/BV-000002/progress', { blockKey: block.key, offset: 7, visitFrom: block.charStart, visitTo: block.charStart + 500, source: 'read' });

    await harness.send(telegramId, MENU.resume);
    expect(text()).toContain('Глава 3 из 7');
    const [button] = harness.buttons(harness.last());
    expect(button?.url).toBe(`https://bookverse.example/read/BV-000002?b=${block.key}&o=7`);
  });

  it('слово с сайта повторяется в боте, и результат виден на сайте', async () => {
    const { web, telegramId } = await linked();
    const saved = await web.call<{ item: VocabularyItemDto }>('POST', '/vocabulary', { word: 'верстаком', lemma: 'верстак', language: 'ru', definition: 'Рабочий стол столяра.' });

    await harness.send(telegramId, MENU.review);
    expect(text()).toContain('верстак');
    expect(text()).not.toContain('Рабочий стол');

    const [reveal] = harness.buttons(harness.last());
    await harness.press(telegramId, reveal!.data!);
    expect(text()).toContain('Рабочий стол столяра');

    await harness.press(telegramId, `rate:${saved.item.id}:know`);
    const after = await web.call<{ items: VocabularyItemDto[] }>('GET', '/vocabulary');
    expect(after.items[0]?.box).toBe(1);
    expect(after.items[0]?.reviewCount).toBe(1);
    const review = await prisma.vocabularyReview.findFirst({ where: { vocabularyId: saved.item.id } });
    expect(review?.source).toBe('telegram');
  });

  it('чужие слова недоступны', async () => {
    const owner = await site();
    const saved = await owner.call<{ item: VocabularyItemDto }>('POST', '/vocabulary', { word: 'тайна', lemma: 'тайна', language: 'ru', definition: 'Секрет.' });
    const { telegramId } = await linked();
    await harness.press(telegramId, `rate:${saved.item.id}:know`);
    expect(text()).toContain('Слово не найдено');
    const row = await prisma.savedVocabulary.findUniqueOrThrow({ where: { id: saved.item.id } });
    expect(row.reviewCount).toBe(0);
  });

  it('показывает достижения и прогресс', async () => {
    const { web, telegramId } = await linked();
    await web.call('POST', '/books/BV-000001/open', {});
    await harness.send(telegramId, MENU.achievements);
    expect(text()).toContain('Первое путешествие');
    await harness.send(telegramId, MENU.progress);
    expect(text()).toContain('Открыто книг: 1');
  });

  it('поиск по коду в боте приносит «Книжного следопыта» на сайте', async () => {
    const { web, telegramId } = await linked();
    await harness.send(telegramId, 'BV-000006');
    const profile = await web.call<{ achievements: { code: string; unlockedAt: string | null }[] }>('GET', '/profile');
    expect(profile.achievements.find((a) => a.code === 'book-tracker')?.unlockedAt).toBeTruthy();
  });

  it('кнопка «Сохранить» добавляет книгу в библиотеку', async () => {
    const { telegramId } = await linked();
    await harness.press(telegramId, 'save:BV-000004');
    await harness.send(telegramId, MENU.library);
    expect(text()).toContain("Alice's Adventures in Wonderland");
  });

  it('задаёт вопрос кнопками и объясняет ответ', async () => {
    const { web, telegramId } = await linked();
    await web.call('POST', '/books/BV-000001/open', {});
    await harness.send(telegramId, MENU.tasks);
    const buttons = harness.buttons(harness.last());
    expect(buttons.length).toBe(4);
    await harness.press(telegramId, buttons[0]!.data!);
    expect(text().length).toBeGreaterThan(20);
  });

  it('советует ещё не открытые книги', async () => {
    const { web, telegramId } = await linked();
    await web.call('POST', '/books/BV-000002/open', {});
    await harness.send(telegramId, MENU.recommend);
    const buttons = harness.buttons(harness.last());
    expect(buttons.length).toBe(3);
    expect(buttons.map((b) => b.text).join()).not.toContain('Каштанка');
  });

  it('напоминания включаются только по желанию', async () => {
    const { web, telegramId } = await linked();
    await web.call('POST', '/books/BV-000001/open', {});
    await harness.send(telegramId, MENU.settings);
    expect(text()).toContain('выключены');
    const list = () => new BookverseApi(baseUrl, SECRET).reminders();
    expect((await list()).reminders.map((r) => r.telegramId)).not.toContain(String(telegramId));
    await harness.press(telegramId, 'remind:on');
    expect((await list()).reminders.map((r) => r.telegramId)).toContain(String(telegramId));
  });
});

describe('показ в зале', () => {
  const KEY = 'test-presenter-key';

  async function hostShow() {
    let cookie = '';
    const call = async <T>(url: string, body: unknown = {}) => {
      const response = await app.inject({ method: 'POST', url: `/api${url}`, headers: cookie ? { cookie } : {}, payload: body as object });
      const set = response.headers['set-cookie'];
      const value = Array.isArray(set) ? set[0] : set;
      if (value) cookie = value.split(';')[0]!;
      return response.json() as T;
    };
    await call('/demo/presenter/login', { key: KEY });
    const { state } = await call<{ state: { code: string } }>('/demo/session', { practice: false });
    return { call, code: state.code };
  }

  it('участник входит по ссылке, получает вопрос кнопками, голосует и видит итог', async () => {
    const show = await hostShow();
    const id = nextTelegramId();
    await harness.send(id, `/start demo_${show.code}`);
    expect(text()).toContain('Вы в зале');

    await show.call('/demo/activity', { kind: 'vote', publicIds: ['BV-000001', 'BV-000002'] });
    const api = new BookverseApi(baseUrl, SECRET);
    await deliverDemo(harness.bot.telegram, api);
    const question = harness.last();
    expect(question?.payload.chat_id).toBe(String(id));
    expect(text()).toBe('Какую книгу откроем вместе?');
    const buttons = harness.buttons(question);
    expect(buttons.map((b) => b.text)).toEqual(['Хранитель последней страницы', 'Каштанка']);

    await harness.press(id, buttons[1]!.data!);
    // Вторая рассылка не повторяет уже отправленный вопрос.
    const sent = harness.calls.length;
    await deliverDemo(harness.bot.telegram, api);
    expect(harness.calls.length).toBe(sent);

    await show.call('/demo/activity/close');
    await deliverDemo(harness.bot.telegram, api);
    expect(text()).toContain('Голосование закрыто');
    expect(text()).toContain('✅ Каштанка: 1');
  });

  it('команда /demo тоже работает, а неверный код объясняется', async () => {
    const show = await hostShow();
    const id = nextTelegramId();
    await harness.send(id, '/demo ZZZZZ');
    expect(text()).toContain('не найден');
    await harness.send(id, `/demo ${show.code}`);
    expect(text()).toContain('Вы в зале');
  });

  it('посторонний не может проголосовать кнопкой', async () => {
    const show = await hostShow();
    await show.call('/demo/activity', { kind: 'vote', publicIds: ['BV-000001', 'BV-000002'] });
    const activity = await prisma.demoActivity.findFirstOrThrow({ orderBy: { openedAt: 'desc' } });
    await harness.press(nextTelegramId(), `demo:${activity.id}:0`);
    expect(await prisma.demoVote.count({ where: { activityId: activity.id } })).toBe(0);
  });

  it('Telegram ID удаляется после показа', async () => {
    const show = await hostShow();
    const id = nextTelegramId();
    await harness.send(id, `/start demo_${show.code}`);
    await show.call('/demo/end');
    expect(await prisma.demoParticipant.count({ where: { telegramId: String(id) } })).toBe(0);
  });
});
