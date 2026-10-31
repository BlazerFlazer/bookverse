import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = 4100;
const WEB_PORT = 5199;

const env = {
  DATABASE_URL: 'file:./e2e.db?connection_limit=1',
  SERVER_PORT: String(SERVER_PORT),
  PUBLIC_WEB_URL: `http://localhost:${WEB_PORT}`,
  BOOKVERSE_API_URL: `http://localhost:${SERVER_PORT}`,
  BOT_INTERNAL_SECRET: 'e2e-secret-0123456789abcdef',
  WIKTIONARY_LOOKUP: 'off',
  DEMO_PRESENTER_KEY: 'e2e-presenter-key',
};

/**
 * Сквозные тесты идут на отдельной базе и портах, поэтому не мешают запущенному сайту.
 * WebGL в headless-режиме считается программно: это медленнее настоящей видеокарты,
 * поэтому у кинематографичных шагов большие таймауты.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 150_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
  ],
  webServer: [
    {
      command: 'node e2e/start-server.mjs',
      port: SERVER_PORT,
      env,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: 'apps/web',
      port: WEB_PORT,
      env,
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
});
