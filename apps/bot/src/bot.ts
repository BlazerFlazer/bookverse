import { Markup, Telegraf, type Context } from 'telegraf';
import { normalizeBookId, PHASE_LABELS, PHASE_SHORT_LABELS, PRESET_LABELS, RAIN_LABELS, TIME_PHASES } from '@bookverse/shared';
import type { AtmosphereBotDto, DemoActivityDto, DemoAtmospherePatch, TimePhase } from '@bookverse/shared';
import type { InlineKeyboardButton } from 'telegraf/types';
import { ApiFailure, NotLinkedError, type BookverseApi } from './api.ts';

export const MENU = {
  library: '📚 Моя библиотека',
  search: '🔎 Найти книгу',
  byCode: '🔢 Найти по Book ID',
  resume: '📖 Продолжить чтение',
  listen: '🎧 Слушать книгу',
  review: '🧠 Повторить слова',
  achievements: '🏆 Достижения',
  tasks: '🎯 Мои задания',
  progress: '📊 Мой прогресс',
  recommend: '✨ Подобрать книгу',
  atmosphere: '🏛 Живая библиотека',
  settings: '⚙️ Настройки',
} as const;

const keyboard = Markup.keyboard([
  [MENU.library, MENU.search],
  [MENU.byCode, MENU.resume],
  [MENU.listen, MENU.review],
  [MENU.achievements, MENU.tasks],
  [MENU.progress, MENU.recommend],
  [MENU.atmosphere, MENU.settings],
]).resize();

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const LANGUAGE = { ru: 'русский', en: 'английский' } as const;
const NOT_LINKED = 'Сначала подключите аккаунт: на сайте откройте «Моя библиотека» и нажмите «Подключить Telegram». Искать книги можно и без этого.';

/**
 * Telegram не принимает кнопки-ссылки на localhost и адреса локальной сети.
 * В таком случае адрес идёт текстом, чтобы бот работал и при запуске на одном компьютере.
 */
export const isPublicUrl = (url: string) => /^https:\/\/(?!localhost|127\.|10\.|192\.168\.)/i.test(url);

function linkButton(text: string, url: string): InlineKeyboardButton | null {
  return isPublicUrl(url) ? Markup.button.url(text, url) : null;
}

const asKeyboard = (buttons: (InlineKeyboardButton | null)[][]) =>
  Markup.inlineKeyboard(buttons.map((row) => row.filter((b): b is InlineKeyboardButton => b !== null)).filter((row) => row.length > 0));

const textLink = (label: string, url: string) => (isPublicUrl(url) ? '' : `\n${label}: ${url}`);

/** Текст состояния библиотеки: сайт и бот считают время суток одной формулой. */
export function atmosphereText(view: AtmosphereBotDto): string {
  const { settings } = view;
  const lines = [
    '🏛 <b>Живая библиотека</b>',
    '',
    `Атмосфера: ${PRESET_LABELS[settings.preferredAtmospherePreset]}`,
    `Сейчас: ${PHASE_LABELS[view.phase]}`,
    `Смена времени суток: ${settings.autoTimeOfDayEnabled ? (settings.timeOfDaySource === 'clock' ? 'по вашим часам' : 'автоматически') : 'вручную'}`,
    `Звуки атмосферы: ${settings.atmosphereAudioEnabled ? `включены, ${Math.round(settings.atmosphereVolume * 100)}%` : 'выключены'}`,
    `Интенсивность дождя: ${RAIN_LABELS[settings.rainIntensity].toLowerCase()}`,
  ];
  if (view.demo?.presenter) {
    const { atmosphere, phase } = view.demo;
    const screen = atmosphere.time === 'cycle' ? 'сутки идут по кругу' : phase ? PHASE_LABELS[phase] : 'настройки экрана';
    lines.push('', `Вы ведущий показа ${view.demo.code}.`, `На экране: ${screen}`);
    lines.push(`Звуки на экране: ${atmosphere.audio === null ? 'как настроено' : atmosphere.audio ? 'включены' : 'выключены'}`);
    if (atmosphere.rainBoost) lines.push('Дождь усилен.');
  } else if (view.linked) {
    lines.push('', 'Кнопками ниже можно сохранить время суток в вашем аккаунте.');
  } else {
    lines.push('', 'Показаны настройки по умолчанию. Подключите аккаунт на сайте, чтобы видеть свои.');
  }
  return lines.join('\n');
}

function presenterKeyboard(view: AtmosphereBotDto): InlineKeyboardButton[][] {
  const audioOn = view.demo?.atmosphere.audio !== false;
  const boosted = view.demo?.atmosphere.rainBoost ?? false;
  return [
    [Markup.button.callback('Показать дождливое утро', 'atmos:show:morning'), Markup.button.callback('Показать день', 'atmos:show:day')],
    [Markup.button.callback('Показать вечер', 'atmos:show:evening'), Markup.button.callback('Показать ночь', 'atmos:show:night')],
    [Markup.button.callback('Сутки по кругу', 'atmos:show:cycle')],
    [
      Markup.button.callback(audioOn ? 'Выключить звуки' : 'Включить атмосферу', `atmos:audio:${audioOn ? 'off' : 'on'}`),
      Markup.button.callback(boosted ? 'Обычный дождь' : 'Усилить дождь', `atmos:rain:${boosted ? 'off' : 'on'}`),
    ],
    [Markup.button.callback('Показать погоду', 'atmos:showcase')],
  ];
}

function readerKeyboard(): InlineKeyboardButton[][] {
  return [
    [Markup.button.callback('Автоматически', 'atmos:save:auto')],
    TIME_PHASES.map((phase) => Markup.button.callback(PHASE_SHORT_LABELS[phase], `atmos:save:${phase}`)),
  ];
}

function atmosphereKeyboard(view: AtmosphereBotDto) {
  const rows = view.demo?.presenter ? presenterKeyboard(view) : view.linked ? readerKeyboard() : [];
  return asKeyboard([
    ...rows,
    [linkButton('🏛 Открыть библиотеку', view.links.library), linkButton(PHASE_LABELS[view.phase], view.links.phases[view.phase])],
  ]);
}

const TIME_LABELS: Record<TimePhase | 'cycle', string> = { ...PHASE_LABELS, cycle: 'Сутки идут по кругу' };

/** Текст итога голосования или вопроса. */
export function demoResultText(activity: DemoActivityDto): string {
  const lines = activity.options.map((option, index) => `${index === activity.correct || index === activity.winner ? '✅' : '▫️'} ${option.label}: ${activity.counts[index] ?? 0}`);
  const head = activity.kind === 'vote' ? 'Голосование закрыто.' : 'Правильный ответ отмечен.';
  return [head, ...lines, activity.explanation ?? ''].filter(Boolean).join('\n');
}

/** Рассылает вопросы и итоги участникам показа из Telegram. Вызывается периодически. */
export async function deliverDemo(telegram: Telegraf['telegram'], api: BookverseApi): Promise<void> {
  const { messages } = await api.demoPending();
  for (const { telegramId, activity } of messages) {
    const send =
      activity.status === 'open'
        ? telegram.sendMessage(
            telegramId,
            activity.prompt,
            Markup.inlineKeyboard(activity.options.map((option, index) => [Markup.button.callback(option.label.slice(0, 60), `demo:${activity.id}:${index}`)])),
          )
        : telegram.sendMessage(telegramId, demoResultText(activity));
    await send.catch((error: unknown) => console.error('Сообщение показа не доставлено:', error));
  }
}

export function createBot(token: string, api: BookverseApi): Telegraf {
  const bot = new Telegraf(token);

  const fromId = (ctx: Context) => String(ctx.from!.id);

  async function sendBook(ctx: Context, publicId: string): Promise<void> {
    const book = await api.book(publicId, fromId(ctx));
    const caption =
      `<b>${escapeHtml(book.title)}</b>\n${escapeHtml(book.author)}\n\n${escapeHtml(book.description)}\n\n` +
      `Жанр: ${escapeHtml(book.genre)}\nЯзык: ${LANGUAGE[book.language]}\nКод: <code>${book.publicId}</code>\n` +
      `Глав: ${book.chapterCount}, чтение ≈ ${book.estMinutes} мин` +
      textLink('Читать', book.readUrl) +
      textLink('Слушать', book.listenUrl);
    const buttons = asKeyboard([
      [linkButton('📖 Читать', book.readUrl), linkButton('🎧 Слушать', book.listenUrl)],
      [Markup.button.callback('🔖 Сохранить', `save:${book.publicId}`)],
    ]);
    const cover = await api.cover(book.publicId);
    if (cover) await ctx.replyWithPhoto({ source: cover }, { caption, parse_mode: 'HTML', ...buttons });
    else await ctx.reply(caption, { parse_mode: 'HTML', ...buttons });
  }

  async function joinDemo(ctx: Context, code: string): Promise<void> {
    const { nickname } = await api.joinDemo(code, fromId(ctx));
    await ctx.reply(`Вы в зале! Ваше имя на сегодня: ${escapeHtml(nickname)}. Смотрите на экран: вопросы придут сюда.`, keyboard);
  }

  async function search(ctx: Context, query: string): Promise<void> {
    const { books } = await api.searchBooks(query);
    if (books.length === 0) {
      await ctx.reply('Ничего не нашлось. Попробуйте другое название или автора.', keyboard);
    } else if (books.length === 1) {
      await sendBook(ctx, books[0]!.publicId);
    } else {
      await ctx.reply(
        'Вот что нашлось:',
        Markup.inlineKeyboard(books.map((b) => [Markup.button.callback(`${b.title} — ${b.publicId}`, `book:${b.publicId}`)])),
      );
    }
  }

  async function showNextWord(ctx: Context): Promise<void> {
    const { word, due } = await api.nextReview(fromId(ctx));
    if (!word) {
      await ctx.reply('Все слова повторены. Новые появятся, когда вы сохраните их при чтении.', keyboard);
      return;
    }
    await ctx.reply(
      `Слово для повторения (осталось: ${due})\n\n<b>${escapeHtml(word.lemma)}</b>\n\nВспомните значение.`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Показать значение', `reveal:${word.id}`)]]) },
    );
  }

  async function showContinue(ctx: Context, listen: boolean): Promise<void> {
    const { book } = await api.continueReading(fromId(ctx));
    if (!book) {
      await ctx.reply('Начатых книг пока нет. Найдите книгу и откройте её на сайте.', keyboard);
      return;
    }
    const url = listen ? `${book.url}${book.url.includes('?') ? '&' : '?'}listen=1` : book.url;
    const label = listen ? '🎧 Слушать дальше' : '📖 Читать дальше';
    const button = linkButton(label, url);
    await ctx.reply(
      `<b>${escapeHtml(book.title)}</b>\nГлава ${book.chapterOrder} из ${book.chapterCount}${book.chapterTitle ? `: ${escapeHtml(book.chapterTitle)}` : ''}\n${Math.round(book.percent)}% прочитано${textLink('Ссылка', url)}`,
      { parse_mode: 'HTML', ...(button ? Markup.inlineKeyboard([button]) : keyboard) },
    );
  }

  async function showAtmosphere(ctx: Context): Promise<void> {
    const view = await api.atmosphere(fromId(ctx));
    await ctx.reply(atmosphereText(view) + textLink('Библиотека', view.links.library), { parse_mode: 'HTML', ...atmosphereKeyboard(view) });
  }

  async function claimPresenter(ctx: Context, token: string): Promise<void> {
    await api.claimPresenter(token, fromId(ctx));
    await ctx.reply('Готово: этот Telegram управляет экраном показа. Подключение действует до конца показа.', keyboard);
    await showAtmosphere(ctx);
  }

  /** Команда ведущего. Право проверяет сервер: отказ показывается всплывающим сообщением. */
  async function controlShow(ctx: Context & { answerCbQuery: (text?: string, extra?: { show_alert?: boolean }) => Promise<unknown> }, patch: DemoAtmospherePatch, done: string): Promise<void> {
    try {
      await api.controlAtmosphere(fromId(ctx), patch);
    } catch (error) {
      if (error instanceof ApiFailure && (error.status === 403 || error.status === 409)) {
        await ctx.answerCbQuery(error.message, { show_alert: true });
        return;
      }
      throw error;
    }
    await ctx.answerCbQuery(done);
  }

  bot.start(async (ctx) => {
    const payload = ctx.startPayload;
    if (payload.startsWith('demo_')) {
      await joinDemo(ctx, payload.slice(5));
      return;
    }
    if (payload.startsWith('presenter_')) {
      await claimPresenter(ctx, payload.slice(10));
      return;
    }
    if (payload.startsWith('link_')) {
      const { displayName } = await api.link(payload.slice(5), fromId(ctx), ctx.from.username ?? null);
      await ctx.reply(`Готово, ${escapeHtml(displayName)}! Аккаунт BOOKVERSE подключён.`, keyboard);
      return;
    }
    await ctx.reply(
      'Я BOOKVERSE, спутник вашей живой библиотеки. Пришлите код книги вроде BV-000002 или её название. Чтобы продолжать чтение и повторять слова, подключите аккаунт на сайте.',
      keyboard,
    );
  });

  bot.command('demo', async (ctx) => {
    const code = ctx.message.text.split(/\s+/)[1];
    if (code) await joinDemo(ctx, code);
    else await ctx.reply('Напишите код с экрана так: /demo КОД');
  });

  bot.command('presenter', async (ctx) => {
    const token = ctx.message.text.split(/\s+/)[1];
    if (token) await claimPresenter(ctx, token);
    else await ctx.reply('Напишите команду с экрана ведущего так: /presenter КОД');
  });

  bot.command('atmosphere', showAtmosphere);

  bot.action(/^demo:(.+):(\d)$/, async (ctx) => {
    await api.voteDemo(fromId(ctx), ctx.match[1]!, Number(ctx.match[2]));
    await ctx.answerCbQuery('Голос принят');
    await ctx.editMessageReplyMarkup(undefined);
  });

  bot.action(/^atmos:save:(auto|morning|day|evening|night)$/, async (ctx) => {
    const time = ctx.match[1] as TimePhase | 'auto';
    await api.saveAtmosphere(fromId(ctx), time);
    await ctx.answerCbQuery(time === 'auto' ? 'Время суток снова меняется само' : `Сохранено: ${PHASE_LABELS[time]}`);
  });

  bot.action(/^atmos:show:(cycle|morning|day|evening|night)$/, (ctx) => {
    const time = ctx.match[1] as TimePhase | 'cycle';
    return controlShow(ctx, { time }, `На экране: ${TIME_LABELS[time]}`);
  });

  bot.action(/^atmos:audio:(on|off)$/, (ctx) => {
    const audio = ctx.match[1] === 'on';
    return controlShow(ctx, { audio }, audio ? 'Звуки атмосферы включены' : 'Звуки атмосферы выключены');
  });

  bot.action(/^atmos:rain:(on|off)$/, (ctx) => {
    const rainBoost = ctx.match[1] === 'on';
    return controlShow(ctx, { rainBoost }, rainBoost ? 'Дождь усилен' : 'Обычный дождь');
  });

  bot.action('atmos:showcase', (ctx) => controlShow(ctx, { showcase: true }, 'Показываем погоду'));

  bot.hears(MENU.search, (ctx) => ctx.reply('Напишите название книги, автора или жанр.'));

  bot.hears(MENU.byCode, (ctx) => ctx.reply('Пришлите код книги, например BV-000002.'));

  bot.hears(MENU.resume, (ctx) => showContinue(ctx, false));
  bot.hears(MENU.listen, (ctx) => showContinue(ctx, true));
  bot.hears(MENU.review, showNextWord);
  bot.hears(MENU.atmosphere, showAtmosphere);

  bot.hears(MENU.library, async (ctx) => {
    const { books } = await api.library(fromId(ctx));
    if (books.length === 0) {
      await ctx.reply('В вашей библиотеке пока пусто.', keyboard);
      return;
    }
    const lines = books.map((b) => `${b.status === 'completed' ? '✅' : '📖'} ${escapeHtml(b.title)} — ${Math.round(b.percent)}% (<code>${b.publicId}</code>)`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.hears(MENU.achievements, async (ctx) => {
    const { profile } = await api.profile(fromId(ctx));
    const earned = profile.achievements.filter((a) => a.unlockedAt);
    const list = earned.length > 0 ? earned.map((a) => `${a.icon} ${escapeHtml(a.title)}`).join('\n') : 'Пока ни одного: первое появится, когда вы откроете книгу.';
    await ctx.reply(`Опыт: ${profile.user.xp} XP · уровень ${profile.level.level} · ${profile.level.rank}\n\n${list}`);
  });

  bot.hears(MENU.progress, async (ctx) => {
    const { profile, vocabulary } = await api.profile(fromId(ctx));
    const s = profile.stats;
    await ctx.reply(
      `Открыто книг: ${s.booksOpened}\nЧитаю сейчас: ${s.booksInProgress}\nПрочитано: ${s.booksCompleted}\nСлов в словаре: ${vocabulary.total}\nВыучено слов: ${vocabulary.mastered}\nЖдут повторения: ${vocabulary.due}\nЗаданий пройдено: ${s.quizzesCompleted}`,
    );
  });

  bot.hears(MENU.tasks, async (ctx) => {
    const { quiz } = await api.quiz(fromId(ctx));
    if (!quiz) {
      await ctx.reply('Заданий пока нет: сначала откройте книгу.', keyboard);
      return;
    }
    await ctx.reply(
      `<b>${escapeHtml(quiz.bookTitle)}</b>\n${escapeHtml(quiz.task.prompt)}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(quiz.task.options.map((option, i) => [Markup.button.callback(option.slice(0, 60), `quiz:${quiz.id}:${quiz.taskIndex}:${i}`)])),
      },
    );
  });

  bot.hears(MENU.recommend, async (ctx) => {
    const { books } = await api.recommend(fromId(ctx));
    if (books.length === 0) {
      await ctx.reply('Вы уже открыли все книги каталога!', keyboard);
      return;
    }
    await ctx.reply(
      'Советую начать с этих книг:',
      Markup.inlineKeyboard(books.map((b) => [Markup.button.callback(`${b.title} (${b.genre})`, `book:${b.publicId}`)])),
    );
  });

  bot.hears(MENU.settings, async (ctx) => {
    const { reminders } = await api.profile(fromId(ctx));
    await ctx.reply(
      `Напоминания о чтении: ${reminders ? 'включены (раз в день вечером)' : 'выключены'}.\nОтключить бота от аккаунта можно на сайте в разделе «Моя библиотека».`,
      Markup.inlineKeyboard([[Markup.button.callback(reminders ? 'Выключить напоминания' : 'Включить напоминания', `remind:${reminders ? 'off' : 'on'}`)]]),
    );
  });

  bot.action(/^book:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await sendBook(ctx, ctx.match[1]!);
  });

  bot.action(/^save:(.+)$/, async (ctx) => {
    const { created } = await api.addToShelf(fromId(ctx), ctx.match[1]!);
    await ctx.answerCbQuery(created ? 'Книга добавлена в вашу библиотеку' : 'Эта книга уже в библиотеке');
  });

  bot.action(/^reveal:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const { word } = await api.nextReview(fromId(ctx));
    if (!word || word.id !== ctx.match[1]) {
      await ctx.reply('Это слово уже повторено.');
      return;
    }
    const context = word.contexts[0]?.snippet;
    await ctx.editMessageText(
      `<b>${escapeHtml(word.lemma)}</b>\n\n${escapeHtml(word.definition ?? 'Определения нет.')}${context ? `\n\n<i>«${escapeHtml(context)}»</i>` : ''}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Не помню', `rate:${word.id}:forgot`)],
          [Markup.button.callback('Почти помню', `rate:${word.id}:almost`)],
          [Markup.button.callback('Знаю', `rate:${word.id}:know`)],
        ]),
      },
    );
  });

  bot.action(/^rate:(.+):(forgot|almost|know)$/, async (ctx) => {
    await api.submitReview(fromId(ctx), ctx.match[1]!, ctx.match[2]!);
    await ctx.answerCbQuery('Записано');
    await showNextWord(ctx);
  });

  bot.action(/^quiz:(.+):(\d+):(\d+)$/, async (ctx) => {
    const result = await api.answerQuiz(fromId(ctx), ctx.match[1]!, Number(ctx.match[2]), Number(ctx.match[3]));
    await ctx.answerCbQuery(result.correct ? 'Верно!' : 'Не совсем');
    await ctx.reply(`${result.correct ? '✅ Верно.' : `Правильный ответ: ${escapeHtml(result.correctAnswer)}.`}\n${escapeHtml(result.explanation)}`);
  });

  bot.action(/^remind:(on|off)$/, async (ctx) => {
    const { enabled } = await api.setReminders(fromId(ctx), ctx.match[1] === 'on');
    await ctx.answerCbQuery(enabled ? 'Напоминания включены' : 'Напоминания выключены');
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const code = normalizeBookId(text);
    if (code) {
      await sendBook(ctx, code);
      return;
    }
    // Похоже на код, но такого формата нет: подсказываем, а не ищем вслепую.
    if (/^(bv|бв)\b/i.test(text)) {
      await ctx.reply('Код выглядит так: BV-000002. Можно также прислать название книги.');
      return;
    }
    await search(ctx, text);
  });

  bot.catch(async (error, ctx) => {
    if (error instanceof NotLinkedError) {
      await ctx.reply(NOT_LINKED);
      return;
    }
    if (error instanceof ApiFailure) {
      // Несуществующий код: объясняем и предлагаем искать по названию.
      await ctx.reply(error.status === 404 ? `${escapeHtml(error.message)}. Попробуйте найти её по названию.` : escapeHtml(error.message));
      return;
    }
    console.error('Ошибка бота:', error);
    await ctx.reply('Что-то пошло не так. Попробуйте ещё раз чуть позже.').catch(() => undefined);
  });

  return bot;
}
