import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BookSummaryDto, CheckpointResultDto, ChapterContentDto, LookupResultDto, QuizDto, QuizResultDto, VocabularyItemDto } from '@bookverse/shared';
import { buildApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { initMorphology } from '../src/dictionary/morphology.ts';
import { pageReader } from './helpers.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ rateLimit: false });
  await initMorphology();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** Клиент с собственной cookie: отдельный браузер для каждого пользователя. */
function browser() {
  let cookie = '';
  const call = async <T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) => {
    const response = await app.inject({
      method,
      url: `/api${url}`,
      headers: cookie ? { cookie } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const setCookie = response.headers['set-cookie'];
    const value = Array.isArray(setCookie) ? setCookie.at(-1) : setCookie;
    if (value) cookie = value.split(';')[0]!;
    return { status: response.statusCode, body: response.json() as T, headers: response.headers };
  };
  return { call, cookie: () => cookie };
}

let counter = 0;
async function register(client: ReturnType<typeof browser>) {
  counter += 1;
  const email = `reader${counter}@example.com`;
  const password = 'очень-длинный-пароль';
  const response = await client.call<{ user: { id: string } }>('POST', '/auth/register', { displayName: `Читатель ${counter}`, email, password, confirmPassword: password });
  expect(response.status).toBe(201);
  return { email, password, id: response.body.user.id };
}

describe('каталог и Book ID', () => {
  it('отдаёт реальные книги с уникальными постоянными кодами', async () => {
    const { body } = await browser().call<{ books: BookSummaryDto[] }>('GET', '/books');
    expect(body.books).toHaveLength(6);
    const ids = body.books.map((b) => b.publicId);
    expect(new Set(ids).size).toBe(6);
    for (const id of ids) expect(id).toMatch(/^BV-\d{6}$/);
    expect(body.books.find((b) => b.title === 'Каштанка')?.publicId).toBe('BV-000002');
  });

  it.each([
    ['точный код', 'BV-000002', 'Каштанка'],
    ['код другими буквами', 'bv 2', 'Каштанка'],
    ['часть названия', 'рыбке', 'Сказка о рыбаке и рыбке'],
    ['автор', 'Чехов', 'Каштанка'],
    ['опечатка', 'Каштонка', 'Каштанка'],
    ['жанр', 'Быль', 'Филипок'],
  ])('находит книгу: %s', async (_, query, title) => {
    const { body } = await browser().call<{ books: BookSummaryDto[] }>('GET', `/books?q=${encodeURIComponent(query)}`);
    expect(body.books[0]?.title).toBe(title);
  });

  it('фильтрует по языку', async () => {
    const { body } = await browser().call<{ books: BookSummaryDto[] }>('GET', '/books?language=en');
    expect(body.books.map((b) => b.title)).toEqual(["Alice's Adventures in Wonderland"]);
  });

  it('содержит настоящий текст и лицензию', async () => {
    const client = browser();
    const chapter = await client.call<ChapterContentDto>('GET', '/books/BV-000002/chapters/1');
    expect(chapter.body.blocks[0]?.text).toContain('Молодая рыжая собака');
    const detail = await client.call<{ license: { kind: string; sourceUrl: string }; chapters: unknown[] }>('GET', '/books/BV-000002');
    expect(detail.body.license.kind).toBe('PUBLIC_DOMAIN');
    expect(detail.body.chapters).toHaveLength(7);
  });

  it('отвечает 404 на несуществующий код', async () => {
    expect((await browser().call('GET', '/books/BV-999999')).status).toBe(404);
  });

  it('рисует обложку для Telegram', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/books/BV-000002/cover.png' });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('аккаунты', () => {
  it('хранит только Argon2id и ставит безопасную cookie', async () => {
    const client = browser();
    const password = 'мой-секретный-пароль';
    const response = await client.call('POST', '/auth/register', { displayName: 'Мира', email: 'mira@example.com', password, confirmPassword: password });
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'mira@example.com' } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(row)).not.toContain(password);
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const sessions = await prisma.session.findMany({ where: { userId: row.id } });
    expect(sessions[0]?.id).not.toBe(client.cookie().split('=')[1]);
  });

  it('проверяет данные на сервере', async () => {
    const response = await browser().call<{ fields: Record<string, string> }>('POST', '/auth/register', { displayName: 'М', email: 'not-email', password: '123', confirmPassword: '321' });
    expect(response.status).toBe(400);
    expect(Object.keys(response.body.fields)).toEqual(expect.arrayContaining(['displayName', 'email', 'password']));
  });

  it('не пускает с неверным паролем и не раскрывает, есть ли почта', async () => {
    const client = browser();
    const { email } = await register(client);
    const wrong = await browser().call<{ message: string }>('POST', '/auth/login', { email, password: 'неверный-пароль' });
    const unknown = await browser().call<{ message: string }>('POST', '/auth/login', { email: 'nobody@example.com', password: 'неверный-пароль' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('отклоняет повторную регистрацию почты', async () => {
    const { email, password } = await register(browser());
    const response = await browser().call('POST', '/auth/register', { displayName: 'Двойник', email, password, confirmPassword: password });
    expect(response.status).toBe(409);
  });

  it('сохраняет данные после выхода и входа', async () => {
    const client = browser();
    const { email, password } = await register(client);
    await client.call('POST', '/vocabulary', { word: 'верстака', lemma: 'верстак', language: 'ru', definition: 'Рабочий стол.' });
    expect((await client.call('POST', '/auth/logout', {})).status).toBe(200);
    expect((await client.call<{ user: unknown }>('GET', '/auth/me')).body.user).toBeNull();
    await client.call('POST', '/auth/login', { email, password, remember: true });
    const words = await client.call<{ items: VocabularyItemDto[] }>('GET', '/vocabulary');
    expect(words.body.items.map((w) => w.lemma)).toEqual(['верстак']);
  });

  it('честно сообщает, что почта не настроена', async () => {
    const response = await browser().call<{ available: boolean }>('POST', '/auth/forgot', { email: 'mira@example.com' });
    expect(response.body.available).toBe(false);
  });

  it('ограничивает частоту попыток входа', async () => {
    const limited = await buildApp();
    const attempts = [];
    for (let i = 0; i < 22; i += 1) {
      attempts.push(await limited.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.com', password: 'не-тот-пароль' } }));
    }
    await limited.close();
    expect(attempts[0]?.statusCode).toBe(401);
    expect(attempts.at(-1)?.statusCode).toBe(429);
  });

  it('отклоняет запись с чужого сайта', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.example' }, payload: {} });
    expect(response.statusCode).toBe(403);
  });
});

describe('гости', () => {
  it('читают без регистрации, а регистрация сохраняет всё накопленное', async () => {
    const client = browser();
    await client.call('POST', '/books/BV-000001/open', {});
    await client.call('POST', '/vocabulary', { word: 'пюпитре', lemma: 'пюпитр', language: 'ru', definition: 'Подставка.' });
    const me = await client.call<{ user: { isGuest: boolean; xp: number } }>('GET', '/auth/me');
    expect(me.body.user.isGuest).toBe(true);
    const xp = me.body.user.xp;

    await register(client);
    const after = await client.call<{ user: { isGuest: boolean; xp: number } }>('GET', '/auth/me');
    expect(after.body.user.isGuest).toBe(false);
    expect(after.body.user.xp).toBe(xp);
    const words = await client.call<{ items: VocabularyItemDto[] }>('GET', '/vocabulary');
    expect(words.body.items).toHaveLength(1);
  });

  it('при входе в существующий аккаунт гостевой прогресс объединяется, а награды не дублируются', async () => {
    const owner = browser();
    const { email, password } = await register(owner);
    await owner.call('POST', '/books/BV-000001/open', {});
    await owner.call('POST', '/auth/logout', {});
    const xpBefore = (await prisma.user.findUniqueOrThrow({ where: { email } })).xp;

    const guest = browser();
    await guest.call('POST', '/books/BV-000001/open', {});
    await guest.call('POST', '/vocabulary', { word: 'шелест', lemma: 'шелест', language: 'ru', definition: 'Тихий шорох.' });
    const login = await guest.call<{ mergedGuest: boolean }>('POST', '/auth/login', { email, password });
    expect(login.body.mergedGuest).toBe(true);

    const words = await guest.call<{ items: VocabularyItemDto[] }>('GET', '/vocabulary');
    expect(words.body.items.map((w) => w.lemma)).toEqual(['шелест']);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const ledger = await prisma.xPTransaction.findMany({ where: { userId: user.id } });
    expect(new Set(ledger.map((x) => x.dedupeKey)).size).toBe(ledger.length);
    expect(user.xp).toBe(ledger.reduce((sum, x) => sum + x.amount, 0));
    expect(user.xp).toBeGreaterThan(xpBefore);
  });
});

describe('чтение и прогресс', () => {
  it('«Первое путешествие» выдаётся один раз и не фармится', async () => {
    const client = browser();
    await register(client);
    const first = await client.call<{ game: { achievements: { title: string }[]; xpGained: number } }>('POST', '/books/BV-000003/open', {});
    expect(first.body.game.achievements.map((a) => a.title)).toContain('Первое путешествие');
    const second = await client.call<{ game: { achievements: unknown[]; xpGained: number } }>('POST', '/books/BV-000003/open', {});
    expect(second.body.game.achievements).toEqual([]);
    expect(second.body.game.xpGained).toBe(0);
  });

  it('параллельные запросы не дают опыт дважды', async () => {
    const client = browser();
    const { id } = await register(client);
    await Promise.all(Array.from({ length: 20 }, () => client.call('POST', '/books/BV-000005/open', {})));
    const ledger = await prisma.xPTransaction.findMany({ where: { userId: id, dedupeKey: { startsWith: 'book-open:' } } });
    expect(ledger).toHaveLength(1);
  });

  it('сохраняет точную позицию', async () => {
    const client = browser();
    await register(client);
    const chapter = await client.call<ChapterContentDto>('GET', '/books/BV-000002/chapters/2');
    const block = chapter.body.blocks[3]!;
    await client.call('POST', '/books/BV-000002/progress', { blockKey: block.key, offset: 12, visitFrom: block.charStart, visitTo: block.charStart + 200, source: 'read' });
    const saved = await client.call<{ progress: { blockKey: string; offset: number; chapterOrder: number; canonicalPos: number } }>('GET', '/books/BV-000002/progress');
    expect(saved.body.progress).toMatchObject({ blockKey: block.key, offset: 12, chapterOrder: 2, canonicalPos: block.charStart + 12 });
  });

  it('прыжок в конец не считается прочтением книги', async () => {
    const client = browser();
    await register(client);
    const last = await client.call<ChapterContentDto>('GET', '/books/BV-000002/chapters/7');
    const block = last.body.blocks.at(-1)!;
    const result = await client.call<CheckpointResultDto>('POST', '/books/BV-000002/progress', {
      blockKey: block.key,
      offset: block.charLength,
      visitFrom: 0,
      visitTo: 10_000_000,
      source: 'read',
    });
    expect(result.body.progress.status).toBe('reading');
    expect(result.body.progress.percent).toBeLessThan(30);
  });

  it('последовательное чтение завершает книгу и выдаёт награды один раз', async () => {
    const client = browser();
    const { id } = await register(client);
    await pageReader(client.call, 'BV-000005', id, prisma);
    const progress = await client.call<{ progress: { status: string; percent: number } }>('GET', '/books/BV-000005/progress');
    expect(progress.body.progress).toMatchObject({ status: 'completed', percent: 100 });
    const profile = await client.call<{ achievements: { code: string; unlockedAt: string | null }[]; stats: { booksCompleted: number } }>('GET', '/profile');
    expect(profile.body.stats.booksCompleted).toBe(1);
    const unlocked = profile.body.achievements.filter((a) => a.unlockedAt).map((a) => a.code);
    expect(unlocked).toEqual(expect.arrayContaining(['first-journey', 'first-chapter', 'halfway', 'story-conqueror']));

    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    await pageReader(client.call, 'BV-000005', id, prisma);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).xp).toBe(before.xp);
  });

  it('аудио двигает ту же позицию, что и чтение', async () => {
    const client = browser();
    await register(client);
    const chapter = await client.call<ChapterContentDto>('GET', '/books/BV-000001/chapters/1');
    const block = chapter.body.blocks[0]!;
    const result = await client.call<CheckpointResultDto>('POST', '/books/BV-000001/progress', { blockKey: block.key, offset: 0, visitFrom: block.charStart, visitTo: block.charStart + block.charLength, source: 'audio' });
    expect(result.body.progress.percent).toBeGreaterThan(0);
  });

  it('закладки принадлежат только владельцу', async () => {
    const owner = browser();
    await register(owner);
    const chapter = await owner.call<ChapterContentDto>('GET', '/books/BV-000001/chapters/1');
    const created = await owner.call<{ id: string }>('POST', '/books/BV-000001/bookmarks', { blockKey: chapter.body.blocks[0]!.key, offset: 0, snippet: 'начало' });
    const stranger = browser();
    await register(stranger);
    expect((await stranger.call('DELETE', `/bookmarks/${created.body.id}`)).status).toBe(404);
    const theirs = await stranger.call<{ bookmarks: unknown[] }>('GET', '/books/BV-000001/annotations');
    expect(theirs.body.bookmarks).toEqual([]);
  });
});

describe('словарь', () => {
  it('приводит формы слова к лемме', async () => {
    const client = browser();
    const check = async (word: string, lemma: string) => {
      const { body } = await client.call<LookupResultDto>('GET', `/dictionary/lookup?word=${encodeURIComponent(word)}&language=ru`);
      expect(body.lemma).toBe(lemma);
      return body;
    };
    const result = await check('удивительного', 'удивительный');
    expect(result.found).toBe(true);
    expect(result.source).toBe('bookverse');
    await check('Диковинный', 'диковинный');
    await check('верстака', 'верстак');
  });

  it('работает и для английской книги: определение на русском', async () => {
    const client = browser();
    const { body } = await client.call<LookupResultDto>('GET', '/dictionary/lookup?word=hedges&language=en');
    expect(body.found).toBe(true);
    expect(body.lemma).toBe('hedge');
    expect(body.definition).toMatch(/[а-я]/i);
    const verb = await client.call<LookupResultDto>('GET', '/dictionary/lookup?word=dozing&language=en');
    expect(verb.body.lemma).toBe('doze');
  });

  it('показывает контекстное пояснение только для проверенного места', async () => {
    const client = browser();
    const notes = await prisma.contextNote.findMany({ where: { book: { publicId: 'BV-000002' }, blockKey: { not: null } }, take: 1 });
    const note = notes[0]!;
    const entry = await prisma.dictionaryEntry.findFirstOrThrow({ where: { lemmaKey: note.lemmaKey, language: 'ru' } });
    const url = `/dictionary/lookup?word=${encodeURIComponent(entry.lemma)}&language=ru&publicId=BV-000002&blockKey=${note.blockKey}`;
    const { body } = await client.call<LookupResultDto>('GET', url);
    expect(body.contextNote).toBe(note.note);
  });

  it('не выдумывает определение для неизвестного слова', async () => {
    const { body } = await browser().call<LookupResultDto>('GET', `/dictionary/lookup?word=${encodeURIComponent('бумбарабашка')}&language=ru`);
    expect(body.found).toBe(false);
    expect(body.definition).toBeNull();
  });
});

describe('мой словарь', () => {
  const word = { word: 'верстаком', lemma: 'верстак', language: 'ru', definition: 'Рабочий стол столяра.', partOfSpeech: 'сущ.', sourceLabel: 'Словарь BOOKVERSE' };

  it('не дублирует слово, но запоминает новые места', async () => {
    const client = browser();
    await register(client);
    const chapter = await client.call<ChapterContentDto>('GET', '/books/BV-000002/chapters/1');
    const [a, b] = chapter.body.blocks;
    await client.call('POST', '/vocabulary', { ...word, publicId: 'BV-000002', blockKey: a!.key, context: 'первое место' });
    await client.call('POST', '/vocabulary', { ...word, publicId: 'BV-000002', blockKey: b!.key, context: 'второе место' });
    const { body } = await client.call<{ items: VocabularyItemDto[] }>('GET', '/vocabulary');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.contexts).toHaveLength(2);
    expect(body.items[0]?.contexts[0]?.bookTitle).toBe('Каштанка');
  });

  it('удаление и повторное сохранение не приносят опыта', async () => {
    const client = browser();
    const { id } = await register(client);
    const first = await client.call<{ item: VocabularyItemDto }>('POST', '/vocabulary', word);
    const xp = (await prisma.user.findUniqueOrThrow({ where: { id } })).xp;
    await client.call('DELETE', `/vocabulary/${first.body.item.id}`);
    await client.call('POST', '/vocabulary', word);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).xp).toBe(xp);
  });

  it('повторение двигает расписание, а десять слов дают «Собирателя слов»', async () => {
    const client = browser();
    await register(client);
    let last: { achievements: { title: string }[] } | undefined;
    let itemId = '';
    for (let i = 0; i < 10; i += 1) {
      const saved = await client.call<{ item: VocabularyItemDto; game: { achievements: { title: string }[] } }>('POST', '/vocabulary', { ...word, lemma: `слово${i}` });
      last = saved.body.game;
      itemId = saved.body.item.id;
    }
    expect(last?.achievements.map((a) => a.title)).toContain('Собиратель слов');

    const reviewed = await client.call<{ item: VocabularyItemDto }>('POST', `/vocabulary/${itemId}/review`, { rating: 'know' });
    expect(reviewed.body.item.box).toBe(1);
    expect(new Date(reviewed.body.item.nextReviewAt).getTime()).toBeGreaterThan(Date.now() + 3_600_000);
  });

  it('гость без сессии не может повторять чужие слова', async () => {
    expect((await browser().call('POST', '/vocabulary/any-id/review', { rating: 'know' })).status).toBe(401);
  });
});

describe('задания', () => {
  it('не отдаёт правильные ответы клиенту', async () => {
    const { body } = await browser().call<QuizDto[]>('GET', '/books/BV-000002/quizzes');
    expect(body.length).toBe(7);
    const text = JSON.stringify(body);
    expect(text).not.toContain('"answer"');
    expect(text).not.toContain('"pairs"');
    expect(body[0]?.tasks[0]?.explanation).toBe('');
  });

  it('разбирает ошибку и награждает только за успех, один раз', async () => {
    const client = browser();
    const { id } = await register(client);
    const [quiz] = (await client.call<QuizDto[]>('GET', '/books/BV-000001/quizzes')).body;
    const stored = (await prisma.quiz.findUniqueOrThrow({ where: { id: quiz!.id } })).tasks as { type: string; answer?: number; items?: string[]; pairs?: string[][] }[];

    const wrong = await client.call<QuizResultDto>('POST', `/quizzes/${quiz!.id}/submit`, { answers: [99, [], []] });
    expect(wrong.body.score).toBe(0);
    expect(wrong.body.results[0]?.explanation.length).toBeGreaterThan(5);
    expect(wrong.body.game.xpGained).toBe(0);

    // Правильные ответы в порядке, который показан клиенту.
    const answers = quiz!.tasks.map((task, i) => {
      const source = stored[i]!;
      if (task.type === 'single') return source.answer!;
      if (task.type === 'order') return source.items!.map((item) => task.items.indexOf(item));
      return source.pairs!.map(([, right]) => (task.type === 'match' ? task.right.indexOf(right!) : -1));
    });
    const right = await client.call<QuizResultDto>('POST', `/quizzes/${quiz!.id}/submit`, { answers });
    expect(right.body.score).toBe(right.body.total);
    expect(right.body.game.achievements.map((a) => a.title)).toContain('Литературный детектив');

    const xp = (await prisma.user.findUniqueOrThrow({ where: { id } })).xp;
    const again = await client.call<QuizResultDto>('POST', `/quizzes/${quiz!.id}/submit`, { answers });
    expect(again.body.game.xpGained).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).xp).toBe(xp);
  });
});

describe('внутренний API бота', () => {
  it('закрыт без секрета, даже для вошедшего пользователя', async () => {
    const client = browser();
    await register(client);
    const response = await app.inject({ method: 'GET', url: '/internal/bot/books?q=a', headers: { cookie: client.cookie() } });
    expect(response.statusCode).toBe(401);
    const wrong = await app.inject({ method: 'GET', url: '/internal/bot/books?q=a', headers: { 'x-bot-secret': 'неверный-секрет-той-же-длины!' } });
    expect(wrong.statusCode).toBe(401);
  });

  it('браузер не может сам назначить себе Telegram ID', async () => {
    const client = browser();
    await register(client);
    const response = await client.call('POST', '/telegram/link', { telegramId: '123' });
    expect(response.status).toBe(404);
  });

  it('гостю привязка недоступна', async () => {
    const client = browser();
    await client.call('POST', '/books/BV-000001/open', {});
    expect((await client.call('POST', '/telegram/link-token', {})).status).toBe(403);
  });
});
