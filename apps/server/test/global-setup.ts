import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Отдельная база для тестов: миграции и импорт каталога идут теми же командами, что и в работе. */
export default function setup(): void {
  const env = { ...process.env, DATABASE_URL: 'file:./test.db?connection_limit=1' };
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(join(server, 'prisma', `test.db${suffix}`), { force: true });
  execSync('npx prisma migrate deploy', { cwd: server, env, stdio: 'pipe' });
  execSync('npx tsx src/content/import.ts', { cwd: server, env, stdio: 'pipe' });
}
