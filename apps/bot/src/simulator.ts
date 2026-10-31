import { createInterface } from 'node:readline/promises';
import { BookverseApi } from './api.ts';
import { createBot, deliverDemo } from './bot.ts';
import { attachHarness, type SentCall } from './harness.ts';

/**
 * Локальный симулятор: настоящие обработчики бота и настоящий сервер, но вместо Telegram консоль.
 * Токен не нужен. Текст уходит боту как сообщение, а номер кнопки нажимает её.
 */
const SIMULATED_USER = 777_000_001;
const secret = process.env.BOT_INTERNAL_SECRET ?? '';
const baseUrl = process.env.BOOKVERSE_API_URL ?? 'http://localhost:4000';

const api = new BookverseApi(baseUrl, secret);
const bot = createBot('simulator', api);
let buttons: { text: string; data?: string; url?: string }[] = [];

const stripHtml = (text: string) => text.replace(/<[^>]+>/g, '');

const harness = attachHarness(bot, (call: SentCall) => {
  const text = (call.payload.text ?? call.payload.caption) as string | undefined;
  if (call.method === 'sendPhoto') console.log('\n[обложка книги]');
  if (text) console.log(`\n${stripHtml(text)}`);
  buttons = harness.buttons(call);
  buttons.forEach((button, i) => console.log(`  [${i + 1}] ${button.text}${button.url ? ` → ${button.url}` : ''}`));
});

setInterval(() => void deliverDemo(bot.telegram, api).catch(() => undefined), 2000).unref();

console.log('Симулятор BOOKVERSE. Это не Telegram: команды идут напрямую в обработчики бота.');
console.log('Напишите /start link_КОД (код выдаёт сайт), /demo КОД (код показа), BV-000002, название книги или текст кнопки меню.');
console.log('Число нажимает кнопку из последнего сообщения, exit завершает работу.');

const rl = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const line = (await rl.question('\n> ')).trim();
  if (line === 'exit') break;
  if (!line) continue;
  const index = Number(line) - 1;
  const button = buttons[index];
  if (button?.data) await harness.press(SIMULATED_USER, button.data);
  else await harness.send(SIMULATED_USER, line, 'simulator');
}
rl.close();
