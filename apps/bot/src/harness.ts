import { Telegram, type Telegraf } from 'telegraf';

export interface SentCall {
  method: string;
  payload: Record<string, unknown>;
}

const INTERNAL = new Set(['answerCallbackQuery']);

/**
 * Прогоняет настоящие обработчики бота без сети Telegram: исходящие вызовы API перехватываются
 * и записываются. На этом держатся и тесты, и локальный симулятор.
 */
export function attachHarness(bot: Telegraf, onSend?: (call: SentCall) => void) {
  const calls: SentCall[] = [];
  let updateId = 0;
  let messageId = 100;

  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'BOOKVERSE',
    username: 'bookverse_local_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_connect_to_business: false,
  } as NonNullable<Telegraf['botInfo']>;

  (Telegram.prototype as unknown as { callApi: unknown }).callApi = async (method: string, payload: Record<string, unknown>) => {
    const call = { method, payload };
    calls.push(call);
    if (!INTERNAL.has(method)) onSend?.(call);
    messageId += 1;
    return method === 'answerCallbackQuery' ? true : { message_id: messageId, date: 0, chat: { id: 1, type: 'private' } };
  };

  const user = (id: number, username?: string) => ({ id, is_bot: false, first_name: 'Читатель', username });

  return {
    bot,
    calls,
    async send(telegramId: number, text: string, username?: string) {
      updateId += 1;
      messageId += 1;
      const entities = text.startsWith('/')
        ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length }]
        : undefined;
      await bot.handleUpdate({
        update_id: updateId,
        message: {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: telegramId, type: 'private', first_name: 'Читатель' },
          from: user(telegramId, username),
          text,
          entities,
        },
      });
    },
    async press(telegramId: number, data: string) {
      updateId += 1;
      messageId += 1;
      await bot.handleUpdate({
        update_id: updateId,
        callback_query: {
          id: String(updateId),
          from: user(telegramId),
          chat_instance: '1',
          data,
          message: {
            message_id: messageId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: telegramId, type: 'private', first_name: 'Читатель' },
            from: user(1),
            text: 'кнопка',
          },
        },
      });
    },
    /** Последнее сообщение, которое бот отправил пользователю. */
    last(): SentCall | undefined {
      return calls.filter((c) => !INTERNAL.has(c.method)).at(-1);
    },
    /** Все кнопки сообщения: callback_data или адрес. */
    buttons(call: SentCall | undefined): { text: string; data?: string; url?: string }[] {
      const markup = call?.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string; url?: string }[][] } | undefined;
      return (markup?.inline_keyboard ?? []).flat().map((b) => ({ text: b.text, data: b.callback_data, url: b.url }));
    },
  };
}
