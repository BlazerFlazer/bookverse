import { devices, expect, test, type Browser, type Page } from '@playwright/test';

const KEY = 'e2e-presenter-key';

async function enterAsPresenter(page: Page) {
  await page.addInitScript(() => localStorage.setItem('bv.introSeen', '1'));
  await page.goto('/demo');
  await page.getByLabel('Ключ ведущего').fill(KEY, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('.demo-stage, .demo-start').first()).toBeVisible();
  // Тест не зависит от того, чем закончился предыдущий.
  await page.request.post('/api/demo/end', { data: {} });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Новый показ' })).toBeVisible({ timeout: 60_000 });
}

const zalCode = async (page: Page) => (await page.locator('.demo-code b').innerText()).trim();

async function audience(browser: Browser, code: string) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.goto(`/join/${code}`);
  await expect(page.getByRole('heading', { name: 'Вы в зале' })).toBeVisible({ timeout: 30_000 });
  return page;
}

test('живой показ: ведущий и телефоны зрителей', async ({ page, browser }) => {
  test.setTimeout(300_000);
  page.on('dialog', (dialog) => void dialog.accept());

  await test.step('страница ведущего закрыта ключом', async () => {
    await page.addInitScript(() => localStorage.setItem('bv.introSeen', '1'));
    await page.goto('/demo');
    await page.getByLabel('Ключ ведущего').fill('неверный-ключ', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Неверный ключ ведущего')).toBeVisible();
    await page.getByLabel('Ключ ведущего').fill(KEY);
    await page.getByRole('button', { name: 'Войти' }).click();
  });

  await page.getByRole('button', { name: /Начать показ/ }).click();
  await expect(page.locator('.demo-qr img')).toBeVisible();
  await expect.poll(() => page.locator('.demo-qr img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId('demo-participants')).toContainText('0');
  await expect(page.getByText('Репетиция: участники имитированы')).toHaveCount(0);
  const code = await zalCode(page);

  const first = await audience(browser, code);
  const second = await audience(browser, code);

  await test.step('экран видит вошедших сразу, без обновления', async () => {
    await expect(page.getByTestId('demo-participants')).toContainText('2');
    await expect(first.locator('.join-name')).not.toHaveText('');
    await expect(first.locator('.three, canvas')).toHaveCount(0);
  });

  await test.step('голосование идёт вживую', async () => {
    await page.getByRole('button', { name: 'Голосование за книгу' }).click();
    await expect(page.getByRole('heading', { name: 'Какую книгу откроем вместе?' })).toBeVisible();
    await expect(first.getByRole('heading', { name: 'Какую книгу откроем вместе?' })).toBeVisible();

    await first.locator('.join-option').filter({ hasText: 'Каштанка' }).click();
    await expect(first.getByRole('heading', { name: 'Голос принят' })).toBeVisible();
    await expect(page.getByTestId('demo-total')).toHaveText('1');

    await second.locator('.join-option').filter({ hasText: 'Каштанка' }).click();
    await expect(page.getByTestId('demo-total')).toHaveText('2');
  });

  await test.step('обновление страницы зрителя не даёт проголосовать повторно', async () => {
    await first.reload();
    await expect(first.getByRole('heading', { name: 'Голос принят' })).toBeVisible();
    await expect(page.getByTestId('demo-total')).toHaveText('2');
  });

  await test.step('перезагрузка ведущего восстанавливает показ', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Какую книгу откроем вместе?' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('demo-total')).toHaveText('2');
  });

  await test.step('итоги видны на всех экранах', async () => {
    await page.getByRole('button', { name: 'Закрыть и показать итог' }).click();
    await expect(page.getByRole('button', { name: 'Открыть «Каштанка»' })).toBeVisible();
    await expect(first.locator('.join-result.is-best')).toContainText('Каштанка');
  });

  await test.step('вопрос залу с разбором после закрытия', async () => {
    await page.getByRole('button', { name: 'Вопрос залу' }).click();
    await page.locator('.demo-menu li button').first().click();
    await expect(first.locator('.join-option')).toHaveCount(4);
    await expect(first.locator('.join-explanation')).toHaveCount(0);
    await first.locator('.join-option').first().click();
    await expect(page.getByTestId('demo-total')).toHaveText('1');
    await page.getByRole('button', { name: 'Закрыть и показать итог' }).click();
    await expect(page.locator('.demo-explanation')).toBeVisible();
    await expect(first.locator('.join-explanation')).toBeVisible();
    await expect(first.locator('.join-verdict')).toBeVisible();
  });

  await test.step('финал виден ведущему и зрителям', async () => {
    await page.getByRole('button', { name: 'Финал', exact: true }).click();
    await expect(page.getByText('Каждая книга — новая вселенная.')).toBeVisible({ timeout: 20_000 });
    await expect(first.getByRole('heading', { name: 'Спасибо!' })).toBeVisible();
    await page.getByRole('button', { name: 'Вернуться в зал' }).click();
  });

  await test.step('победитель голосования открывается настоящей книгой', async () => {
    await page.getByRole('button', { name: 'Голосование за книгу' }).click();
    await first.locator('.join-option').filter({ hasText: 'Каштанка' }).click();
    await expect(page.getByTestId('demo-total')).toHaveText('1');
    await page.getByRole('button', { name: 'Закрыть и показать итог' }).click();
    await page.getByRole('button', { name: 'Открыть «Каштанка»' }).click();
    await page.waitForURL('**/read/BV-000002', { timeout: 60_000 });
    await expect(page.locator('.rd-stage')).toContainText('Молодая рыжая собака', { timeout: 30_000 });
    await expect(page.locator('.rd-root')).toHaveCSS('opacity', '1');
  });

  await test.step('панель сценария доступна ведущему', async () => {
    await page.getByRole('button', { name: 'Сценарий показа' }).click();
    await page.getByRole('button', { name: 'Зал голосует' }).click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  await test.step('завершение показывает зрителям благодарность', async () => {
    await page.getByRole('button', { name: 'Завершить' }).click();
    await expect(page.getByRole('heading', { name: 'Новый показ' })).toBeVisible();
    await expect(second.getByRole('heading', { name: 'Спасибо!' })).toBeVisible();
  });
});

test('репетиция работает без зрителей и Telegram и помечена на всех экранах', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await enterAsPresenter(page);
  await page.getByRole('button', { name: /Репетиция/ }).click();
  await expect(page.getByText('Репетиция: участники имитированы')).toBeVisible();

  await page.getByRole('button', { name: 'Ещё 10 участников' }).click();
  await expect(page.getByTestId('demo-participants')).toContainText('10');

  const viewer = await audience(browser, await zalCode(page));
  await expect(viewer.getByText('Репетиция: часть участников имитирована')).toBeVisible();

  await page.getByRole('button', { name: 'Голосование за книгу' }).click();
  await expect.poll(async () => Number(await page.getByTestId('demo-total').innerText()), { timeout: 20_000 }).toBeGreaterThanOrEqual(5);
  await page.getByRole('button', { name: 'Закрыть и показать итог' }).click();
  await expect(page.getByRole('button', { name: /Открыть «/ })).toBeVisible();
  await page.getByRole('button', { name: 'Вихрь страниц' }).click();
});

test('страница зрителя принимает код вручную и лёгкая для телефона', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const scripts: string[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('.js') || response.url().includes('.js?')) scripts.push(response.url());
  });
  await page.goto('/join');
  await expect(page.getByRole('heading', { name: 'Войти в зал' })).toBeVisible();
  await page.getByLabel('Код показа').fill('ZZZZZ');
  await page.getByRole('button', { name: 'Присоединиться' }).click();
  await expect(page.getByText('Показ с таким кодом не найден')).toBeVisible();
  expect(scripts.filter((url) => /three|WorldCanvas/.test(url))).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
