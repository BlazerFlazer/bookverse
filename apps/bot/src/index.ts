import { BookverseApi } from './api.ts';
import { createBot, deliverDemo } from './bot.ts';

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.BOT_INTERNAL_SECRET ?? '';
const baseUrl = process.env.BOOKVERSE_API_URL ?? 'http://localhost:4000';

if (!token) {
  console.log('TELEGRAM_BOT_TOKEN не задан, поэтому бот не запущен.');
  console.log('Получите токен у @BotFather и добавьте его в .env (см. README).');
  console.log('Проверить бота без Telegram можно локальным симулятором: npm run bot:sim');
  process.exit(0);
}

const api = new BookverseApi(baseUrl, secret);
const bot = createBot(token, api);

const REMINDER_HOUR = 18;
let lastReminderDay = '';

/** Напоминания по подписке: раз в день в 18:00 и только тем, кто сам их включил. */
async function sendReminders(): Promise<void> {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getHours() !== REMINDER_HOUR || lastReminderDay === day) return;
  lastReminderDay = day;
  const { reminders } = await api.reminders();
  for (const reminder of reminders) {
    await bot.telegram
      .sendMessage(reminder.telegramId, `Книга «${reminder.title}» ждёт вас: прочитано ${Math.round(reminder.percent)}%.\n${reminder.url}`)
      .catch((error: unknown) => console.error('Напоминание не доставлено:', error));
  }
}

setInterval(() => void sendReminders().catch((error: unknown) => console.error(error)), 10 * 60_000);

// Вопросы показа должны приходить почти сразу, поэтому проверка частая.
setInterval(() => void deliverDemo(bot.telegram, api).catch(() => undefined), 2000);

void bot.launch();
console.log('Бот BOOKVERSE запущен.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
