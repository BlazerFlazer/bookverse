import { z } from 'zod';
import { PAGE_TURN_MODES, READER_FONT_IDS, READER_THEME_IDS } from './themes.ts';

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(2, 'Имя должно быть не короче 2 символов').max(40, 'Слишком длинное имя'),
    email: z.email('Проверьте адрес почты').max(254).transform((v) => v.toLowerCase()),
    password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(128, 'Слишком длинный пароль'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Пароли не совпадают',
  });

export const loginSchema = z.object({
  email: z.email('Проверьте адрес почты').transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Введите пароль').max(128),
  remember: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.email('Проверьте адрес почты').transform((v) => v.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(128),
  password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(128),
});

export const bookQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  genre: z.string().max(60).optional(),
  language: z.enum(['ru', 'en']).optional(),
  shelf: z.enum(['all', 'featured', 'continue', 'discover', 'completed']).default('all'),
});

/** Отметка чтения: текущая позиция и прочитанный отрезок в каноническом тексте. */
export const checkpointSchema = z.object({
  blockKey: z.string().min(1).max(32),
  offset: z.number().int().min(0).max(100_000),
  /** Канонические границы увиденного участка: сервер сам проверяет их и лимит скорости. */
  visitFrom: z.number().int().min(0),
  visitTo: z.number().int().min(0),
  source: z.enum(['read', 'audio']).default('read'),
});

export const lookupQuerySchema = z.object({
  word: z.string().trim().min(1).max(64),
  language: z.enum(['ru', 'en']).default('ru'),
  publicId: z.string().max(16).optional(),
  blockKey: z.string().max(32).optional(),
});

export const saveWordSchema = z.object({
  word: z.string().trim().min(1).max(64),
  lemma: z.string().trim().min(1).max(64),
  language: z.enum(['ru', 'en']).default('ru'),
  definition: z.string().trim().min(1).max(600).nullable(),
  partOfSpeech: z.string().max(24).nullable().optional(),
  sourceLabel: z.string().max(80).nullable().optional(),
  publicId: z.string().max(16).optional(),
  blockKey: z.string().max(32).optional(),
  context: z.string().max(300).optional(),
  studyLater: z.boolean().default(false),
});

export const reviewSchema = z.object({
  rating: z.enum(['forgot', 'almost', 'know']),
  source: z.enum(['web', 'telegram']).default('web'),
});

export const bookmarkSchema = z.object({
  blockKey: z.string().min(1).max(32),
  offset: z.number().int().min(0),
  snippet: z.string().max(200).default(''),
});

export const highlightSchema = z.object({
  blockKey: z.string().min(1).max(32),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  color: z.enum(['gold', 'rose', 'green']).default('gold'),
});

export const quoteSchema = z.object({
  blockKey: z.string().min(1).max(32),
  text: z.string().trim().min(1).max(1200),
});

export const readerSettingsSchema = z.object({
  themeId: z.enum(READER_THEME_IDS),
  fontId: z.union([z.enum(READER_FONT_IDS), z.literal('auto')]),
  fontScale: z.number().min(0.7).max(1.7),
  lineHeight: z.number().min(1.2).max(2.2),
  align: z.enum(['left', 'justify']),
  margin: z.number().min(0.5).max(1.6),
  pageWidth: z.number().min(0.75).max(1.1),
  brightness: z.number().min(0.6).max(1.1),
  pageTurn: z.enum(PAGE_TURN_MODES),
  reducedMotion: z.boolean(),
});

export const savePreferenceSchema = z.object({
  /** Без publicId настройки становятся общими для всех книг. */
  publicId: z.string().max(16).optional(),
  settings: readerSettingsSchema,
});

export const quizSubmitSchema = z.object({
  /** Индекс выбранного варианта для single, порядок исходных индексов для order, пары индексов для match. */
  answers: z.array(z.union([z.number().int(), z.array(z.number().int())])).max(12),
});

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type CheckpointInput = z.input<typeof checkpointSchema>;
export type SaveWordInput = z.input<typeof saveWordSchema>;
export type ReviewRating = z.infer<typeof reviewSchema>['rating'];
