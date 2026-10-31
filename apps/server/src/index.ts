import { buildApp, isAllowedOrigin } from './app.ts';
import { botConfigured, config, mailConfigured } from './config.ts';
import { prisma } from './db.ts';
import { presenterConfigured } from './demo/routes.ts';
import { initMorphology } from './dictionary/morphology.ts';
import { seedAchievements } from './game/service.ts';
import { attachRealtime } from './realtime.ts';

const app = await buildApp({ logger: false });
attachRealtime(app.server, isAllowedOrigin);

// На Vercel база Postgres, а достижения загружаются при сборке вместе с книгами.
if (!process.env.VERCEL) {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await seedAchievements();
}
await initMorphology();

const books = await prisma.book.count();
await app.listen({ port: config.SERVER_PORT, host: '0.0.0.0' });

console.log(`BOOKVERSE API: http://localhost:${config.SERVER_PORT}`);
console.log(`Книг в каталоге: ${books}${books === 0 ? ' (запустите npm run content:import)' : ''}`);
console.log(`Бот: ${botConfigured ? 'секрет задан' : 'BOT_INTERNAL_SECRET не задан, API бота закрыт'}`);
console.log(`Почта: ${mailConfigured ? 'настроена' : 'не настроена, письма не отправляются'}`);
console.log(`Demo Day: ${presenterConfigured() ? 'ключ ведущего задан, страница /demo' : 'DEMO_PRESENTER_KEY не задан, режим ведущего выключен'}`);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
