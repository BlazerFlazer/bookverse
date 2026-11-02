import { Color } from 'three';
import { PHASE_COUNT, wrapPosition } from '@bookverse/shared';

/** Один момент суток: всё, что меняется в зале, собрано в одной записи. */
interface PhaseKey {
  skyTop: string;
  skyLow: string;
  haze: string;
  /** Яркость вида за окном. */
  window: number;
  /** Насколько стекло отражает тёплый зал: ночью это почти зеркало. */
  reflect: number;
  lamp: number;
  lampColor: string;
  daylight: number;
  daylightColor: string;
  ambient: number;
  ambientColor: string;
  env: number;
  fogColor: string;
  exposure: number;
  dust: number;
  dustColor: string;
  beam: number;
  beamColor: string;
  fire: number;
  /** Слои звука: у каждой части суток свой баланс дождя, комнаты и камина. */
  rainSound: number;
  roomSound: number;
  fireSound: number;
}

/**
 * Палитры четырёх частей суток. Значения подобраны вместе: тёплые лампы всегда остаются,
 * меняется только то, насколько их перебивает холодный свет с улицы.
 */
const PHASES: PhaseKey[] = [
  {
    skyTop: '#8d9cab',
    skyLow: '#c7d1d6',
    haze: '#a9b5bb',
    window: 1.06,
    reflect: 0.1,
    lamp: 0.74,
    lampColor: '#ffd2a0',
    daylight: 1.05,
    daylightColor: '#c6d6e6',
    ambient: 1.3,
    ambientColor: '#dfe3e4',
    env: 0.36,
    fogColor: '#3a3b3e',
    exposure: 1.14,
    dust: 1,
    dustColor: '#e8e2d2',
    beam: 0.2,
    beamColor: '#c9dcea',
    fire: 0.1,
    rainSound: 0.82,
    roomSound: 0.7,
    fireSound: 0,
  },
  {
    skyTop: '#9aa8b4',
    skyLow: '#d3dbdf',
    haze: '#b7c1c6',
    window: 1.2,
    reflect: 0.07,
    lamp: 0.62,
    lampColor: '#ffd9ae',
    daylight: 1.4,
    daylightColor: '#cfdde9',
    ambient: 1.55,
    ambientColor: '#e4e9ec',
    env: 0.42,
    fogColor: '#44474a',
    exposure: 1.18,
    dust: 0.7,
    dustColor: '#e4e4dc',
    beam: 0.15,
    beamColor: '#d6e4ee',
    fire: 0,
    rainSound: 1,
    roomSound: 0.8,
    fireSound: 0,
  },
  {
    skyTop: '#1f2d42',
    skyLow: '#4b5c74',
    haze: '#36445a',
    window: 0.86,
    reflect: 0.3,
    lamp: 1.1,
    lampColor: '#ffbe78',
    daylight: 0.17,
    daylightColor: '#7f9cc4',
    ambient: 0.98,
    ambientColor: '#ffd3a2',
    env: 0.3,
    fogColor: '#1b130f',
    exposure: 1.1,
    dust: 0.85,
    dustColor: '#ffc983',
    beam: 0.05,
    beamColor: '#9fb5d6',
    fire: 0.72,
    rainSound: 0.9,
    roomSound: 0.9,
    fireSound: 0.7,
  },
  {
    skyTop: '#060c1a',
    skyLow: '#14213a',
    haze: '#101a2e',
    window: 0.62,
    reflect: 0.54,
    lamp: 1.02,
    lampColor: '#ffb56b',
    daylight: 0.055,
    daylightColor: '#5e7cae',
    ambient: 0.72,
    ambientColor: '#f4c394',
    env: 0.26,
    fogColor: '#130d0d',
    exposure: 1.06,
    dust: 0.55,
    dustColor: '#ffbe78',
    beam: 0.02,
    beamColor: '#6d87b4',
    fire: 1,
    rainSound: 0.74,
    roomSound: 1,
    fireSound: 1,
  },
];

type NumberKey = { [K in keyof PhaseKey]: PhaseKey[K] extends number ? K : never }[keyof PhaseKey];
type ColorKey = { [K in keyof PhaseKey]: PhaseKey[K] extends string ? K : never }[keyof PhaseKey];

const NUMBER_KEYS: NumberKey[] = ['window', 'reflect', 'lamp', 'daylight', 'ambient', 'env', 'exposure', 'dust', 'beam', 'fire', 'rainSound', 'roomSound', 'fireSound'];
const COLOR_KEYS: ColorKey[] = ['skyTop', 'skyLow', 'haze', 'lampColor', 'daylightColor', 'ambientColor', 'fogColor', 'dustColor', 'beamColor'];

export type AtmosphereFrame = Record<NumberKey, number> & Record<ColorKey, Color>;

/** Цвета разбираются один раз: кадр не тратит время на чтение строк. */
const PALETTES = PHASES.map((phase) => Object.fromEntries(COLOR_KEYS.map((key) => [key, new Color(phase[key])])) as Record<ColorKey, Color>);

export function createFrame(): AtmosphereFrame {
  const frame = {} as AtmosphereFrame;
  for (const key of NUMBER_KEYS) frame[key] = 0;
  for (const key of COLOR_KEYS) frame[key] = new Color();
  return frame;
}

/** Части суток держатся и перетекают друг в друга, а не меняются равномерно весь круг. */
export function easeBetweenPhases(t: number): number {
  const x = Math.min(1, Math.max(0, (t - 0.08) / 0.84));
  return x * x * (3 - 2 * x);
}

/** Записывает в кадр состояние зала для точки на круге суток. Память не выделяется. */
export function sampleFrame(position: number, frame: AtmosphereFrame): AtmosphereFrame {
  const wrapped = wrapPosition(position);
  const index = Math.floor(wrapped);
  const a = PHASES[index % PHASE_COUNT]!;
  const b = PHASES[(index + 1) % PHASE_COUNT]!;
  const colorsA = PALETTES[index % PHASE_COUNT]!;
  const colorsB = PALETTES[(index + 1) % PHASE_COUNT]!;
  const t = easeBetweenPhases(wrapped - index);
  for (const key of NUMBER_KEYS) frame[key] = a[key] + (b[key] - a[key]) * t;
  for (const key of COLOR_KEYS) frame[key].lerpColors(colorsA[key], colorsB[key], t);
  return frame;
}
