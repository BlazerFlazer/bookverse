import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    globalSetup: ['./apps/server/test/global-setup.ts'],
    // Одна база на все файлы: тесты API идут последовательно.
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./test.db?connection_limit=1',
      BOT_INTERNAL_SECRET: 'test-secret-0123456789abcdef',
      WIKTIONARY_LOOKUP: 'off',
      PUBLIC_WEB_URL: 'https://bookverse.example',
      TELEGRAM_BOT_USERNAME: 'bookverse_test_bot',
      DEMO_PRESENTER_KEY: 'test-presenter-key',
    },
  },
});
