import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVER_PORT: z.coerce.number().int().default(4000),
  PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
  BOT_INTERNAL_SECRET: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().default(''),
  WIKTIONARY_LOOKUP: z.enum(['on', 'off']).default('on'),
  DEMO_PRESENTER_KEY: z.string().default(''),
  DEMO_PUBLIC_URL: z.string().default(''),
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default(''),
});

export const config = schema.parse(process.env);

export const isProduction = config.NODE_ENV === 'production';
export const mailConfigured = Boolean(config.SMTP_URL && config.MAIL_FROM);
export const botConfigured = config.BOT_INTERNAL_SECRET.length >= 16 && config.BOT_INTERNAL_SECRET !== 'change-me-to-a-long-random-string';
