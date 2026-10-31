import { afterEach, describe, expect, it, vi } from 'vitest';

/** Настройки читаются при загрузке модуля, поэтому приложение импортируется уже после подмены. */
async function appWithHops(hops: string) {
  vi.stubEnv('TRUST_PROXY_HOPS', hops);
  vi.resetModules();
  const { buildApp } = await import('../src/app.ts');
  return buildApp();
}

async function remaining(app: Awaited<ReturnType<typeof appWithHops>>, visitor: string) {
  const response = await app.inject({
    url: '/api/health',
    remoteAddress: '10.0.0.2',
    headers: { 'x-forwarded-for': `${visitor}, 10.0.0.1` },
  });
  return Number(response.headers['x-ratelimit-remaining']);
}

describe('работа за прокси', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('за двумя прокси лимит считается отдельно для каждого посетителя', async () => {
    const app = await appWithHops('2');
    const first = await remaining(app, '203.0.113.7');
    expect(await remaining(app, '203.0.113.7')).toBe(first - 1);
    expect(await remaining(app, '198.51.100.9')).toBe(first);
    await app.close();
  });

  it('без настройки заголовок X-Forwarded-For не даёт обойти лимит', async () => {
    const app = await appWithHops('0');
    const first = await remaining(app, '203.0.113.7');
    expect(await remaining(app, '198.51.100.9')).toBe(first - 1);
    await app.close();
  });
});
