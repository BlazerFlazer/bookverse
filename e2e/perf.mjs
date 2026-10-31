// Замер частоты кадров собранного сайта на настоящей видеокарте, без окна на экране.
// Нужны запущенные сервер и сборка: npm run build, затем npm run start, затем npm run perf.
import { chromium } from '@playwright/test';

const URL = process.env.PERF_URL ?? 'http://localhost:5173';
const VIEWPORT = { width: 1366, height: 768 };
const LEVELS = (process.env.PERF_LEVELS ?? 'low,medium,high').split(',');

const sample = (page, ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const start = performance.now();
        let last = start;
        let frames = 0;
        let worst = 0;
        let worstAt = 0;
        const tick = () => {
          const now = performance.now();
          if (now - last > worst) {
            worst = now - last;
            worstAt = (last - start) / 1000;
          }
          last = now;
          frames += 1;
          if (now - start > duration) resolve({ fps: Math.round(frames / (duration / 1000)), worst: Math.round(worst), worstAt: worstAt.toFixed(1) });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });

const rows = [];
for (const level of LEVELS) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.addInitScript((value) => localStorage.setItem('bv.quality', value), level);
  // Long Animation Frames показывает, чем именно занят долгий кадр.
  await page.addInitScript(() => {
    window.__frames = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__frames.push({
          at: Math.round(entry.startTime),
          ms: Math.round(entry.duration),
          layout: Math.round(entry.styleAndLayoutStart ? entry.renderStart - entry.styleAndLayoutStart : 0),
          forced: Math.round(entry.scripts.reduce((sum, s) => sum + s.forcedStyleAndLayoutDuration, 0)),
          scripts: entry.scripts.map((s) => `${s.sourceFunctionName || s.invoker || '?'}:${Math.round(s.duration)}`).slice(0, 3),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  });

  const opened = Date.now();
  await page.goto(URL);
  await page.waitForSelector('.intro-hit', { timeout: 60_000 });
  const load = ((Date.now() - opened) / 1000).toFixed(1);

  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'нет данных';
  });

  await page.waitForTimeout(3000);
  const intro = await sample(page, 2500);
  await page.click('.intro-hit');
  const cinematic = await sample(page, 9000);
  await page.waitForSelector('.book-card', { timeout: 30_000 });
  await page.waitForTimeout(800);
  const library = await sample(page, 3000);
  await page.locator('.book-card-main').nth(1).click();
  const transition = await sample(page, 6000);

  if (process.env.PERF_FRAMES) {
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(() => window.__frames.filter((f) => f.ms > 150).slice(-8));
    console.log(level, JSON.stringify(frames, null, 0));
  }

  rows.push({ level, load, intro, cinematic, library, transition });
  if (rows.length === 1) console.log(`GPU: ${gpu}\nОкно: ${VIEWPORT.width}×${VIEWPORT.height}\n`);
  await context.close();
}
await browser.close();

const cell = (value) => `${value.fps} (${value.worst} мс @${value.worstAt}с)`.padEnd(22);
console.log('качество  загрузка  интро                 раскрытие             зал                   перелёт');
for (const row of rows) {
  console.log(`${row.level.padEnd(10)}${(row.load + ' с').padEnd(10)}${cell(row.intro)}${cell(row.cinematic)}${cell(row.library)}${cell(row.transition)}`);
}
console.log('\nВ ячейках средний FPS, самый долгий кадр и секунда, на которой он случился.');
