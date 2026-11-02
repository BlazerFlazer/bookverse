import type { RainIntensity } from '@bookverse/shared';
import type { AtmosphereFrame } from './keyframes.ts';

/** Сила дождя в сцене. Усиление на показе идёт выше обычного максимума. */
export const RAIN_STRENGTH: Record<RainIntensity, number> = { light: 0.42, medium: 0.7, heavy: 1 };
export const RAIN_BOOST = 1.35;

/** full: зал; page: страницы поверх зала; reading: открытая книга. */
export type AmbienceScene = 'full' | 'page' | 'reading';

export interface MixInput {
  frame: Pick<AtmosphereFrame, 'rainSound' | 'roomSound' | 'fireSound'>;
  rain: number;
  volume: number;
  enabled: boolean;
  scene: AmbienceScene;
  /** Настройка «Снижать звуки во время чтения». */
  duck: boolean;
  /** Книгу читает голос: ему ничто не должно мешать. */
  narrating: boolean;
  hidden: boolean;
}

export interface MixLevels {
  master: number;
  rain: number;
  hiss: number;
  room: number;
  fire: number;
  /** Сколько капель в секунду стучит по стеклу. */
  drops: number;
  /** Срез верхних частот: звук за стеной книги становится мягче. */
  cutoff: number;
}

const READING_LEVEL = 0.55;
const NARRATION_LEVEL = 0.28;
const PAGE_LEVEL = 0.8;
const OPEN_CUTOFF = 16_000;
const SOFT_CUTOFF = 2_600;

/** Чистая функция: по ней проверяется поведение звука, а сам Web Audio лишь следует этим числам. */
export function ambienceMix({ frame, rain, volume, enabled, scene, duck, narrating, hidden }: MixInput): MixLevels {
  const reading = scene === 'reading' && duck;
  let level = 1;
  if (reading) level = READING_LEVEL;
  else if (scene === 'page') level = PAGE_LEVEL;
  if (narrating) level = Math.min(level, NARRATION_LEVEL);
  const audible = enabled && !hidden;
  return {
    master: audible ? volume * level : 0,
    rain: frame.rainSound * (0.45 + rain * 0.6),
    hiss: frame.rainSound * rain * 0.7,
    room: frame.roomSound,
    fire: frame.fireSound,
    drops: 1 + rain * 5,
    cutoff: reading || narrating ? SOFT_CUTOFF : OPEN_CUTOFF,
  };
}
