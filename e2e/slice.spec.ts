import { expect, test, type Page } from '@playwright/test';

const SECRET = 'e2e-secret-0123456789abcdef';
const API = 'http://localhost:4100';

async function skipIntro(page: Page) {
  await page.addInitScript(() => localStorage.setItem('bv.introSeen', '1'));
}

async function firstWordsOnPage(page: Page) {
  return (await page.locator('.rd-page-left .rd-page-inner, .is-single .rd-page-inner').first().innerText()).slice(0, 80);
}

const journey = (page: Page) => page.getByTestId('journey-status');
const expectReaderVisible = (page: Page) => expect(page.locator('.rd-root')).toHaveCSS('opacity', '1');

test('главный сценарий: от интро до Telegram', async ({ page, request }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await test.step('первый визит показывает закрытую книгу и приглашение', async () => {
    await page.goto('/');
    await expect(page.getByText('Каждая книга — новая вселенная.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Нажмите, чтобы открыть.')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  await test.step('клик запускает интро и приводит в библиотеку', async () => {
    await page.getByRole('button', { name: 'Открыть книгу и войти в библиотеку' }).click();
    await expect(page.getByText('Добро пожаловать в BOOKVERSE.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('region', { name: 'Каталог книг' })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.book-card')).toHaveCount(6);
  });

  await test.step('повторный визит не проигрывает интро', async () => {
    await page.reload();
    await expect(page.getByRole('region', { name: 'Каталог книг' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Открыть книгу и войти в библиотеку' })).toHaveCount(0);
  });

  await test.step('поиск находит книгу по коду', async () => {
    await page.getByPlaceholder('Название, автор или код BV-000002').fill('bv-2');
    await expect(page.locator('.book-card')).toHaveCount(1);
    await expect(page.locator('.book-card-title')).toHaveText('Каштанка');
  });

  await test.step('выбор книги ведёт через анимацию к настоящему тексту', async () => {
    const achievement = expect(page.getByText('Первое путешествие')).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: /Открыть книгу «Каштанка»/ }).click();
    await achievement;
    await page.waitForURL('**/read/BV-000002', { timeout: 60_000 });
    await expect(page.locator('.rd-stage')).toContainText('Молодая рыжая собака', { timeout: 30_000 });
    await expectReaderVisible(page);
  });

  await test.step('слово открывает определение и сохраняется', async () => {
    await page.locator('.w', { hasText: /^дворняжкой$/ }).first().click();
    const panel = page.getByRole('dialog', { name: /Значение слова/ });
    await expect(panel.locator('.dict-word')).toHaveText('дворняжка');
    await expect(panel).toContainText('Словарь BOOKVERSE');
    await page.getByTestId('save-word').click();
    await expect(page.getByText('Первое открытие')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  await test.step('страницы листаются, а бегун получает прогресс', async () => {
    await expect(journey(page)).toContainText('Глава 1 из 7', { timeout: 15_000 });
    const before = await firstWordsOnPage(page);
    await page.locator('.rd-stage').hover();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => firstWordsOnPage(page)).not.toBe(before);
    await expect(journey(page)).toContainText(/[1-9]\d*% прочитано/, { timeout: 15_000 });
  });

  await test.step('смена темы и шрифта не теряет место', async () => {
    await page.getByRole('button', { name: 'Оформление книги' }).click();
    const position = (await page.locator('.rd-page-left [data-block]').first().getAttribute('data-block'))!;
    await page.getByRole('button', { name: /Ночной читатель/ }).click();
    await expect(page.locator('.rd-root')).toHaveAttribute('data-theme', 'midnight');
    await page.getByLabel('Размер шрифта').fill('1.3');
    await expect(page.locator(`.rd-page-right [data-block], .rd-page-left [data-block]`).first()).toBeVisible();
    const blocks = await page.locator('.rd-stage [data-block]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.block));
    expect(blocks).toContain(position);
    await page.keyboard.press('Escape');
  });

  await test.step('слово видно в «Моём словаре»', async () => {
    await page.goto('/words');
    await expect(page.getByTestId('words-total')).toHaveText('1');
    await expect(page.getByTestId('word-card')).toContainText('дворняжка');
    await expect(page.getByTestId('word-card')).toContainText('Каштанка');
  });

  await test.step('регистрация сохраняет гостевой прогресс', async () => {
    await page.goto('/auth');
    await page.getByLabel('Имя на сайте').fill('Мира');
    await page.getByLabel('Почта').fill('mira.e2e@example.com');
    await page.locator('#auth-password').fill('очень-длинный-пароль');
    await page.locator('#auth-confirm').fill('очень-длинный-пароль');
    await page.getByRole('button', { name: 'Создать аккаунт' }).click();
    await page.waitForURL('**/me');
    await expect(page.getByRole('heading', { name: 'Моя библиотека' })).toBeVisible();
    await expect(page.getByTestId('badge-first-journey')).toBeVisible();
    await expect(page.locator('.shelf-item')).toContainText('Каштанка');
  });

  await test.step('данные переживают выход и вход', async () => {
    await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();
    await page.waitForURL('/');
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByLabel('Почта').fill('mira.e2e@example.com');
    await page.locator('#auth-password').fill('очень-длинный-пароль');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForURL('**/me');
    await page.goto('/words');
    await expect(page.getByTestId('word-card')).toContainText('дворняжка');
  });

  await test.step('место чтения восстанавливается', async () => {
    await page.goto('/read/BV-000002');
    await expect(page.locator('.rd-stage')).not.toContainText('Молодая рыжая собака', { timeout: 30_000 });
    await expect(page.locator('.rd-stage [data-block]').first()).toBeVisible();
  });

  await test.step('Telegram: сайт выдаёт токен, бот привязывает, ссылка ведёт на сохранённое место', async () => {
    await page.goto('/me');
    await page.getByRole('button', { name: 'Подключить Telegram' }).click();
    const command = await page.getByTestId('link-code').innerText();
    const token = command.replace('/start link_', '').trim();

    const link = await request.post(`${API}/internal/bot/link`, {
      headers: { 'x-bot-secret': SECRET },
      data: { token, telegramId: '424242', username: 'mira' },
    });
    expect(link.ok()).toBe(true);
    await expect(page.getByText('Telegram подключён')).toBeVisible();

    const resume = await request.get(`${API}/internal/bot/users/424242/continue`, { headers: { 'x-bot-secret': SECRET } });
    const { book } = (await resume.json()) as { book: { url: string; publicId: string } };
    expect(book.publicId).toBe('BV-000002');
    expect(book.url).toContain('?b=');

    await page.goto(book.url);
    const anchor = new URL(book.url).searchParams.get('b')!;
    await expect(page.locator(`.rd-stage [data-block="${anchor}"]`).first()).toBeVisible({ timeout: 30_000 });
  });

  expect(errors).toEqual([]);
});

test('читалка: закладка, цитата, оглавление и задание', async ({ page }) => {
  await skipIntro(page);
  await page.goto('/read/BV-000001');
  await expect(page.locator('.rd-stage')).toContainText('В городе, где дожди', { timeout: 60_000 });
  await expectReaderVisible(page);

  await page.getByRole('button', { name: 'Поставить закладку' }).click();
  await expect(page.getByRole('button', { name: 'Убрать закладку' })).toBeVisible();

  await page.getByRole('button', { name: 'Оглавление' }).click();
  await page.getByRole('button', { name: 'Глава третья. Хранитель последней страницы' }).click();
  await expect(page.locator('.rd-stage')).toContainText('Внутри книги был вечер', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Литературное задание' }).click();
  await expect(page.getByRole('button', { name: 'Проверить ответы' })).toBeVisible();
});

test('слово с формой приводится к начальной форме и без определения панель честна', async ({ page }) => {
  await skipIntro(page);
  await page.goto('/read/BV-000001');
  await expect(page.locator('.rd-stage')).toContainText('В городе, где дожди', { timeout: 60_000 });
  await page.locator('.w', { hasText: /^девочка$/ }).first().click();
  const panel = page.getByRole('dialog', { name: /Значение слова/ });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.dict-word')).toHaveText('девочка');
  await expect(panel).toContainText('придумывать мы не будем');
});

test.describe('устройства и доступность', () => {
  test('телефон: одна страница, каталог и чтение работают', async ({ page }) => {
    await skipIntro(page);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Каталог книг' })).toBeVisible({ timeout: 60_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto('/read/BV-000002');
    await expect(page.locator('.rd-book.is-single')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.rd-stage')).toContainText('Молодая рыжая собака');
    await expectReaderVisible(page);
    await page.locator('.w', { hasText: /^дворняжкой$/ }).first().click();
    const panel = page.getByRole('dialog', { name: /Значение слова/ });
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(780);
  });

  test('меньше движения: книга открывается без полёта и листания', async ({ page }) => {
    await skipIntro(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.book-card')).toHaveCount(6, { timeout: 60_000 });
    const started = Date.now();
    await page.getByRole('button', { name: /Открыть книгу «Каштанка»/ }).click();
    await expect(page.locator('.rd-stage')).toContainText('Молодая рыжая собака', { timeout: 30_000 });
    expect(Date.now() - started).toBeLessThan(15_000);
    await page.locator('.rd-stage').hover();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.leaf')).toHaveCount(0);
  });

  test('без WebGL: плоский каталог и чтение', async ({ page }) => {
    await skipIntro(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type.startsWith('webgl')) return null;
        return original.call(this, type as '2d', ...(rest as [])) as never;
      } as typeof original;
    });
    await page.goto('/');
    await expect(page.locator('.flat-backdrop')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.book-card')).toHaveCount(6);
    await page.getByRole('button', { name: /Открыть книгу «Каштанка»/ }).click();
    await page.waitForURL('**/read/BV-000002');
    await expect(page.locator('.rd-stage')).toContainText('Молодая рыжая собака', { timeout: 30_000 });
    await expectReaderVisible(page);
    await expect(page.locator('.flat-journey')).toBeVisible();
  });

  test('весь каталог проходится с клавиатуры', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');
    await expect(page.locator('.book-card')).toHaveCount(6, { timeout: 60_000 });
    await page.locator('.book-card-main').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/read/BV-000001', { timeout: 60_000 });
    await expect(page.locator('.rd-stage')).toContainText('В городе, где дожди', { timeout: 30_000 });
  });
});
