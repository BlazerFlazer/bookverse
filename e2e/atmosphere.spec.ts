import { expect, test, type Page } from '@playwright/test';
import type { AtmosphereSettings, DemoAtmosphereDto, DemoControlDto } from '@bookverse/shared';

interface Snapshot {
  position: number;
  phase: string;
  rain: number;
  rainTime: number;
  flash: number;
  layers: number;
  motion: number;
  audioState: string;
  levels: { master: number; cutoff: number } | null;
}

const KEY = 'e2e-presenter-key';
const SECRET = 'e2e-secret-0123456789abcdef';
const API = 'http://localhost:4100';

const snapshot = (page: Page) => page.evaluate(() => (window as unknown as { __bookverseAtmosphere: () => Snapshot }).__bookverseAtmosphere());

async function enterLibrary(page: Page) {
  await page.addInitScript(() => localStorage.setItem('bv.introSeen', '1'));
  await page.goto('/');
  await expect(page.getByTestId('atmosphere-pill')).toBeVisible({ timeout: 60_000 });
}

const openPanel = async (page: Page) => {
  await page.getByRole('button', { name: 'Живая библиотека' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Живая библиотека' })).toBeVisible();
};

const panel = (page: Page) => page.getByRole('dialog', { name: 'Живая библиотека' });

test('живая библиотека: от дождя в зале до Telegram', async ({ page, request }) => {
  test.setTimeout(330_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await test.step('зал открывается под дождём, и капли идут', async () => {
    await enterLibrary(page);
    await expect(page.getByTestId('atmosphere-pill')).toHaveText(/Дождлив/);
    const first = await snapshot(page);
    expect(first.rain).toBeGreaterThan(0);
    await expect.poll(async () => (await snapshot(page)).rainTime).toBeGreaterThan(first.rainTime + 0.5);
  });

  await test.step('звук ждёт действия пользователя и начинается после него', async () => {
    expect((await snapshot(page)).audioState).toBe('waiting');
    await openPanel(page);
    await expect.poll(async () => (await snapshot(page)).audioState, { timeout: 15_000 }).toBe('playing');
    await expect(panel(page)).toContainText('Дождь, комната и камин слышны сейчас');
  });

  await test.step('звук и громкость подчиняются панели', async () => {
    await panel(page).getByLabel('Громкость атмосферы').fill('0.3');
    await expect.poll(async () => (await snapshot(page)).levels?.master).toBeCloseTo(0.3, 2);
    await panel(page).getByLabel('Звуки атмосферы').uncheck();
    await expect.poll(async () => (await snapshot(page)).audioState).toBe('off');
    expect((await snapshot(page)).levels?.master).toBe(0);
    await panel(page).getByLabel('Звуки атмосферы').check();
    await expect.poll(async () => (await snapshot(page)).audioState).toBe('playing');
  });

  await test.step('ручной выбор меняет зал плавно и без перезагрузки', async () => {
    const before = (await snapshot(page)).position;
    await page.evaluate(() => {
      (window as unknown as { __marker: number }).__marker = 1;
    });
    await panel(page).getByRole('button', { name: /^Ночь/ }).click();
    // Сразу после нажатия зал ещё в пути: промежуточное состояние и есть плавность.
    const moving = await snapshot(page);
    expect(Math.abs(moving.position - 3)).toBeGreaterThan(0.05);
    await expect(page.getByTestId('atmosphere-pill')).toHaveText('Дождливая ночь', { timeout: 40_000 });
    await expect.poll(async () => (await snapshot(page)).position, { timeout: 40_000 }).toBeCloseTo(3, 1);
    expect(before).not.toBe(3);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
  });

  await test.step('автоматический режим снова ведёт сутки сам', async () => {
    await panel(page).getByRole('button', { name: /^Автоматически/ }).click();
    await expect(panel(page).getByRole('button', { name: /^Автоматически/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).getByLabel('Автоматическая смена времени суток')).toBeChecked();
    await panel(page).getByRole('button', { name: /^Вечер/ }).click();
    await expect(panel(page).getByLabel('Автоматическая смена времени суток')).not.toBeChecked();
    await expect(page.getByTestId('atmosphere-pill')).toHaveText('Дождливый вечер', { timeout: 60_000 });
  });

  await test.step('панель работает с клавиатуры и закрывается клавишей Escape', async () => {
    await expect(panel(page).getByRole('button', { name: 'Закрыть панель' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  await test.step('в книге звук тише и мягче, а зал остаётся за страницами', async () => {
    const library = (await snapshot(page)).levels!;
    await page.getByRole('button', { name: /Открыть книгу «Каштанка»/ }).click();
    await page.waitForURL('**/read/BV-000002', { timeout: 60_000 });
    await expect(page.locator('.rd-root')).toHaveCSS('opacity', '1', { timeout: 30_000 });
    await expect.poll(async () => (await snapshot(page)).levels?.master).toBeLessThan(library.master);
    expect((await snapshot(page)).levels!.cutoff).toBeLessThan(library.cutoff);
    await expect(page.locator('.world-canvas canvas')).toBeVisible();
    await expect(page.locator('.rd-page').first()).toHaveCSS('background-color', /rgb/);
  });

  await test.step('выход из книги возвращает полный звук', async () => {
    await page.getByRole('button', { name: 'Выйти в библиотеку' }).click();
    await expect(page.getByTestId('atmosphere-pill')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await snapshot(page)).levels?.master).toBeCloseTo(0.3, 2);
  });

  await test.step('настройки гостя переживают перезагрузку', async () => {
    await page.reload();
    await expect(page.getByTestId('atmosphere-pill')).toHaveText('Дождливый вечер', { timeout: 60_000 });
    await openPanel(page);
    await expect(panel(page).getByRole('button', { name: /^Вечер/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).getByLabel('Громкость атмосферы')).toHaveValue('0.3');
    await expect(panel(page)).toContainText('сохранены в этом браузере');
    await page.keyboard.press('Escape');
  });

  const email = `atmos-${Date.now()}@example.com`;
  await test.step('регистрация переносит настройки гостя в аккаунт', async () => {
    const password = 'очень-длинный-пароль';
    const result = await page.request.post('/api/auth/register', { data: { displayName: 'Читатель дождя', email, password, confirmPassword: password } });
    expect(result.status()).toBe(201);
    await page.reload();
    await expect(page.getByTestId('atmosphere-pill')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => {
      const saved = await page.request.get('/api/atmosphere');
      return ((await saved.json()) as { settings: AtmosphereSettings | null }).settings?.preferredManualTimeOfDay;
    }, { timeout: 15_000 }).toBe('evening');
  });

  await test.step('новое значение уходит в аккаунт', async () => {
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Сильная' }).click();
    await expect(panel(page)).toContainText('сохранены в аккаунте', { timeout: 15_000 });
    await page.keyboard.press('Escape');
    const saved = await page.request.get('/api/atmosphere');
    expect(((await saved.json()) as { settings: AtmosphereSettings }).settings.rainIntensity).toBe('heavy');
  });

  await test.step('бот читает состояние того же аккаунта', async () => {
    const { code } = (await (await page.request.post('/api/telegram/link-token', { data: {} })).json()) as { code: string };
    const telegramId = String(Date.now()).slice(-9);
    const headers = { 'x-bot-secret': SECRET };
    expect((await request.post(`${API}/internal/bot/link`, { headers, data: { token: code, telegramId, username: null } })).status()).toBe(200);
    const view = (await (await request.get(`${API}/internal/bot/atmosphere?telegramId=${telegramId}`, { headers })).json()) as { phase: string; linked: boolean; settings: AtmosphereSettings };
    expect(view).toMatchObject({ linked: true, phase: 'evening' });
    expect(view.settings.rainIntensity).toBe('heavy');
  });

  expect(errors).toEqual([]);
});

test('меньше движения: капли стоят, а время суток меняется', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterLibrary(page);
  const first = await snapshot(page);
  expect(first.motion).toBe(0);
  await page.waitForTimeout(1200);
  expect((await snapshot(page)).rainTime).toBe(first.rainTime);
  await openPanel(page);
  await expect(panel(page)).toContainText('капли и пламя стоят на месте');
  await panel(page).getByRole('button', { name: /^Утро/ }).click();
  await expect(page.getByTestId('atmosphere-pill')).toHaveText('Дождливое утро', { timeout: 60_000 });
});

test('без WebGL работает плоская атмосфера, и сайт остаётся рабочим', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return original.call(this, type as '2d', ...(rest as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await enterLibrary(page);
  await expect(page.locator('.flat-window canvas')).toBeVisible();
  await expect(page.locator('.book-card').first()).toBeVisible();
  await openPanel(page);
  await expect(panel(page)).toContainText('плоская версия');
  await panel(page).getByRole('button', { name: /^Ночь/ }).click();
  await expect(page.getByTestId('atmosphere-pill')).toHaveText('Дождливая ночь', { timeout: 40_000 });
});

test('ссылка из бота открывает выбранное время суток и не меняет настройки', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bv.introSeen', '1'));
  await page.goto('/?atmosphere=night');
  await expect(page.getByTestId('atmosphere-pill')).toHaveText('Дождливая ночь', { timeout: 60_000 });
  await expect(page).toHaveURL(/\/$/);
  await openPanel(page);
  await expect(panel(page)).toContainText('Открыто по ссылке');
  await expect(panel(page).getByRole('button', { name: /^Автоматически/ })).toHaveAttribute('aria-pressed', 'true');
});

test('показ: ведущий и репетиция Telegram управляют залом, чужие нет', async ({ page, request }) => {
  test.setTimeout(240_000);

  await test.step('ведущий начинает репетицию', async () => {
    await page.addInitScript(() => localStorage.setItem('bv.introSeen', '1'));
    await page.goto('/demo');
    await page.getByLabel('Ключ ведущего').fill(KEY, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.locator('.demo-stage, .demo-start').first()).toBeVisible();
    await page.request.post('/api/demo/end', { data: {} });
    const control = (await (await page.request.post('/api/demo/session', { data: { practice: true } })).json()) as DemoControlDto;
    expect(control.state?.atmosphere.time).toBeNull();
    await page.goto('/');
    await expect(page.getByTestId('atmosphere-pill')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Сценарий показа' }).click();
    await expect(page.getByRole('region', { name: 'Живая библиотека на показе' })).toBeVisible();
  });

  const show = () => page.getByRole('region', { name: 'Живая библиотека на показе' });

  await test.step('кнопка ведущего меняет зал без перезагрузки', async () => {
    await show().getByRole('button', { name: 'Ночь' }).click();
    await expect(page.getByTestId('atmosphere-pill')).toHaveText('Дождливая ночь', { timeout: 60_000 });
    await show().getByRole('button', { name: 'Сильный дождь' }).click();
    await expect.poll(async () => (await snapshot(page)).rain, { timeout: 30_000 }).toBeGreaterThan(1);
    await show().getByRole('button', { name: 'Сутки по кругу' }).click();
    await expect(show().getByRole('button', { name: 'Сутки по кругу' })).toHaveAttribute('aria-pressed', 'true');
    const start = (await snapshot(page)).position;
    await expect.poll(async () => (await snapshot(page)).position, { timeout: 30_000 }).not.toBeCloseTo(start, 0);
  });

  await test.step('имитация Telegram проходит как команда и честно подписана', async () => {
    await show().getByLabel(/Имитация Telegram/).check();
    await show().getByRole('button', { name: 'Вечер' }).click();
    await expect(page.getByText('Имитация Telegram', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('atmosphere-pill')).toHaveText('Дождливый вечер', { timeout: 60_000 });
  });

  await test.step('показ погоды даёт вспышку и сильный дождь', async () => {
    await show().getByRole('button', { name: 'Показать погоду' }).click();
    await expect.poll(async () => (await snapshot(page)).flash, { timeout: 20_000, intervals: [60] }).toBeGreaterThan(0.05);
  });

  await test.step('посторонний не может управлять залом', async () => {
    const stranger = await request.post(`${API}/api/demo/atmosphere`, { data: { time: 'day' } });
    expect(stranger.status()).toBe(401);
    const bot = await request.post(`${API}/internal/bot/demo/atmosphere`, { headers: { 'x-bot-secret': SECRET }, data: { telegramId: '123456', patch: { time: 'day' } } });
    expect(bot.status()).toBe(403);
    const state = (await (await page.request.get('/api/demo/control')).json()) as DemoControlDto;
    expect((state.state?.atmosphere as DemoAtmosphereDto).time).toBe('evening');
    await page.request.post('/api/demo/end', { data: {} });
  });
});
