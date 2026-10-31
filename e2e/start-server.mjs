// Playwright запускает webServer раньше globalSetup, поэтому база готовится здесь.
import { execSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'server');

for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(join(server, 'prisma', `e2e.db${suffix}`), { force: true });
execSync('npx prisma migrate deploy', { cwd: server, stdio: 'pipe' });
execSync('npx tsx src/content/import.ts', { cwd: server, stdio: 'pipe' });

const child = spawn('npx tsx src/index.ts', { cwd: server, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
