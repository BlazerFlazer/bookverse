// Запуск на хостинге: база и книги готовятся до старта, затем сервер и бот живут в одном контейнере.
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const serverDir = join(root, 'apps/server');
const botDir = join(root, 'apps/bot');
const prismaCli = join(root, 'node_modules/prisma/build/index.js');

const port = process.env.PORT ?? process.env.SERVER_PORT ?? '4000';
const env = {
  ...process.env,
  SERVER_PORT: port,
  // Бот работает рядом с сервером и обращается к нему напрямую, минуя внешний адрес.
  BOOKVERSE_API_URL: process.env.BOOKVERSE_API_URL ?? `http://127.0.0.1:${port}`,
};

function prepare(args) {
  const { status } = spawnSync(process.execPath, args, { cwd: serverDir, env, stdio: 'inherit' });
  if (status !== 0) process.exit(status ?? 1);
}

const run = (cwd) => spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd, env, stdio: 'inherit' });

prepare([prismaCli, 'migrate', 'deploy']);
prepare(['--import', 'tsx', 'src/content/import.ts']);

let stopping = false;
let bot = null;

function startBot() {
  bot = run(botDir);
  bot.on('exit', (code) => {
    // Без токена бот завершается сам, и это штатно. Сбой бота не должен останавливать сайт.
    if (stopping || code === 0) return;
    console.error(`Бот завершился с кодом ${code}, перезапуск через 15 секунд.`);
    setTimeout(startBot, 15_000);
  });
}

const server = run(serverDir);
startBot();

server.on('exit', (code) => {
  stopping = true;
  bot?.kill();
  process.exit(code ?? 1);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    bot?.kill(signal);
    server.kill(signal);
  });
}
