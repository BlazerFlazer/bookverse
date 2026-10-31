// Сборка сервера на Vercel. Там база Postgres, поэтому схема переключается только на сборочной машине,
// а таблицы и книги обновляются при выпуске в production: у предпросмотров та же база.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const serverDir = join(root, 'apps/server');
const prismaCli = join(root, 'node_modules/prisma/build/index.js');
const schemaPath = join(serverDir, 'prisma/schema.prisma');

function run(args) {
  const { status } = spawnSync(process.execPath, args, { cwd: serverDir, stdio: 'inherit' });
  if (status !== 0) process.exit(status ?? 1);
}

writeFileSync(schemaPath, readFileSync(schemaPath, 'utf8').replace('provider = "sqlite"', 'provider = "postgresql"'));
run([prismaCli, 'generate']);

if (process.env.VERCEL_ENV === 'production') {
  run([prismaCli, 'db', 'push', '--skip-generate']);
  run(['--import', 'tsx', 'src/content/import.ts']);
}

// Пакеты @bookverse отданы как исходники TypeScript, поэтому они входят в сборку, остальное подключается как есть.
const { dependencies } = JSON.parse(readFileSync(join(serverDir, 'package.json'), 'utf8'));
await build({
  entryPoints: [join(serverDir, 'src/vercel.ts')],
  outfile: join(serverDir, 'dist/vercel.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(dependencies).filter((name) => !name.startsWith('@bookverse/')),
});
