import { z } from 'zod';

/** Сейчас полностью сделан дождь. Новая атмосфера добавляется сюда и в палитры сайта. */
export const ATMOSPHERE_PRESETS = ['rain'] as const;
export const TIME_PHASES = ['morning', 'day', 'evening', 'night'] as const;
/** cycle — ускоренные сутки, clock — настоящее время на часах читателя. */
export const TIME_SOURCES = ['cycle', 'clock'] as const;
export const RAIN_INTENSITIES = ['light', 'medium', 'heavy'] as const;
export const EFFECT_QUALITIES = ['auto', 'low', 'medium', 'high', 'ultra'] as const;
export const DEMO_TIME_MODES = ['cycle', ...TIME_PHASES] as const;

export type AtmospherePreset = (typeof ATMOSPHERE_PRESETS)[number];
export type TimePhase = (typeof TIME_PHASES)[number];
export type TimeSource = (typeof TIME_SOURCES)[number];
export type RainIntensity = (typeof RAIN_INTENSITIES)[number];
export type EffectQuality = (typeof EFFECT_QUALITIES)[number];
export type DemoTimeMode = (typeof DEMO_TIME_MODES)[number];

export const atmosphereSettingsSchema = z.object({
  preferredAtmospherePreset: z.enum(ATMOSPHERE_PRESETS),
  atmosphereAudioEnabled: z.boolean(),
  atmosphereVolume: z.number().min(0).max(1),
  autoTimeOfDayEnabled: z.boolean(),
  timeOfDaySource: z.enum(TIME_SOURCES),
  preferredManualTimeOfDay: z.enum(TIME_PHASES),
  effectsQuality: z.enum(EFFECT_QUALITIES),
  rainIntensity: z.enum(RAIN_INTENSITIES),
  lightningEnabled: z.boolean(),
  readingAudioDuckEnabled: z.boolean(),
});

export type AtmosphereSettings = z.infer<typeof atmosphereSettingsSchema>;

export const DEFAULT_ATMOSPHERE: AtmosphereSettings = {
  preferredAtmospherePreset: 'rain',
  atmosphereAudioEnabled: true,
  atmosphereVolume: 0.6,
  autoTimeOfDayEnabled: true,
  timeOfDaySource: 'cycle',
  preferredManualTimeOfDay: 'evening',
  effectsQuality: 'auto',
  rainIntensity: 'medium',
  // Вспышки включает сам читатель: даже мягкое мерцание подходит не всем.
  lightningEnabled: false,
  readingAudioDuckEnabled: true,
};

export const saveAtmosphereSchema = z.object({
  settings: atmosphereSettingsSchema,
  /** Смещение часового пояса: по нему бот знает, какой час сейчас у читателя. */
  utcOffsetMinutes: z.number().int().min(-840).max(840).default(0),
});

export const PRESET_LABELS: Record<AtmospherePreset, string> = { rain: 'Дождь' };

export const PHASE_LABELS: Record<TimePhase, string> = {
  morning: 'Дождливое утро',
  day: 'Дождливый день',
  evening: 'Дождливый вечер',
  night: 'Дождливая ночь',
};

export const PHASE_SHORT_LABELS: Record<TimePhase, string> = {
  morning: 'Утро',
  day: 'День',
  evening: 'Вечер',
  night: 'Ночь',
};

/** Подпись нужна и для доступности: время суток нельзя понять только по свету. */
export const PHASE_NOTES: Record<TimePhase, string> = {
  morning: 'Бледное небо и пыль в лучах света',
  day: 'Светлая пасмурность и живой зал',
  evening: 'Золотые лампы и синие сумерки',
  night: 'Тёмное небо, лампы и камин',
};

export const RAIN_LABELS: Record<RainIntensity, string> = { light: 'Слабая', medium: 'Средняя', heavy: 'Сильная' };

export const PHASE_COUNT = TIME_PHASES.length;
/** Полный круг обычных суток: каждая часть длится шесть минут. */
export const SIMULATED_DAY_MS = 24 * 60_000;
/** Ускоренные сутки на показе: зал успевает смениться за время рассказа. */
export const DEMO_DAY_MS = 80_000;

/** Часы, на которые приходится середина каждой части суток. Последнее значение замыкает круг. */
const PHASE_HOURS = [9, 14, 19, 25, 33];

export const wrapPosition = (position: number) => ((position % PHASE_COUNT) + PHASE_COUNT) % PHASE_COUNT;

/**
 * Положение на круге суток: 0 утро, 1 день, 2 вечер, 3 ночь, у 4 круг замыкается.
 * Ускоренные сутки считаются от абсолютного времени, поэтому сайт и бот видят одно и то же.
 */
export const positionFromCycle = (nowMs: number, dayMs = SIMULATED_DAY_MS) => ((nowMs % dayMs) / dayMs) * PHASE_COUNT;

export function positionFromHour(hour: number): number {
  const h = hour < PHASE_HOURS[0]! ? hour + 24 : hour;
  for (let i = 0; i < PHASE_COUNT; i += 1) {
    const from = PHASE_HOURS[i]!;
    const to = PHASE_HOURS[i + 1]!;
    if (h <= to) return i + (h - from) / (to - from);
  }
  return 0;
}

export const phaseAt = (position: number): TimePhase => TIME_PHASES[Math.round(wrapPosition(position)) % PHASE_COUNT]!;

export const phaseIndex = (phase: TimePhase) => TIME_PHASES.indexOf(phase);

/** Где на круге суток должен быть зал по настройкам читателя. */
export function positionForSettings(settings: Pick<AtmosphereSettings, 'autoTimeOfDayEnabled' | 'timeOfDaySource' | 'preferredManualTimeOfDay'>, nowMs: number, utcOffsetMinutes: number): number {
  if (!settings.autoTimeOfDayEnabled) return phaseIndex(settings.preferredManualTimeOfDay);
  if (settings.timeOfDaySource === 'cycle') return positionFromCycle(nowMs);
  const local = new Date(nowMs + utcOffsetMinutes * 60_000);
  return positionFromHour(local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600);
}

export const presenterLinkSchema = z.object({ telegramId: z.string().regex(/^\d{1,20}$/), token: z.string().min(16).max(64) });

export const demoAtmospherePatchSchema = z.object({
  /** null возвращает экран к настройкам ведущего. */
  time: z.enum(DEMO_TIME_MODES).nullable().optional(),
  audio: z.boolean().nullable().optional(),
  rainBoost: z.boolean().optional(),
  showcase: z.literal(true).optional(),
});

export const demoAtmosphereRequestSchema = demoAtmospherePatchSchema.extend({
  /** Только в репетиции: команда проходит тем же путём, что из Telegram, и помечается как имитация. */
  simulateTelegram: z.boolean().optional(),
});

export type DemoAtmospherePatch = z.infer<typeof demoAtmospherePatchSchema>;
export type DemoAtmosphereSource = 'presenter' | 'telegram' | 'practice';

export interface DemoAtmosphereDto {
  /** null: ведущий не вмешивался, экран следует своим настройкам. */
  time: DemoTimeMode | null;
  audio: boolean | null;
  rainBoost: boolean;
  /** Растёт с каждым показом погоды: экран запускает сцену один раз на новое число. */
  showcase: number;
  source: DemoAtmosphereSource | null;
  changedAt: string | null;
}

export const NEUTRAL_DEMO_ATMOSPHERE: DemoAtmosphereDto = { time: null, audio: null, rainBoost: false, showcase: 0, source: null, changedAt: null };

export function demoPhase(atmosphere: DemoAtmosphereDto, nowMs: number): TimePhase | null {
  if (atmosphere.time === null) return null;
  return atmosphere.time === 'cycle' ? phaseAt(positionFromCycle(nowMs, DEMO_DAY_MS)) : atmosphere.time;
}

/** Что бот рассказывает о библиотеке. */
export interface AtmosphereBotDto {
  linked: boolean;
  settings: AtmosphereSettings;
  phase: TimePhase;
  links: { library: string; phases: Record<TimePhase, string> };
  demo: { code: string; practice: boolean; presenter: boolean; atmosphere: DemoAtmosphereDto; phase: TimePhase | null } | null;
}

export interface PresenterTelegramLinkDto {
  /** Команда для бота: работает и там, где ссылка на Telegram не настроена. */
  command: string;
  url: string | null;
  expiresAt: string;
}
