import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame } from '../src/atmosphere/keyframes.ts';
import { ambienceMix, RAIN_BOOST, RAIN_STRENGTH, type MixInput } from '../src/atmosphere/mix.ts';
import { TimeOfDayController } from '../src/atmosphere/TimeOfDayController.ts';
import { QUALITY_PROFILES } from '../src/lib/quality.ts';

const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => r * 0.2126 + g * 0.7152 + b * 0.0722;

describe('палитры суток', () => {
  const at = (position: number) => sampleFrame(position, createFrame());

  it('каждая часть суток узнаваема по свету', () => {
    const [morning, day, evening, night] = [0, 1, 2, 3].map(at);
    expect(luminance(day!.skyLow)).toBeGreaterThan(luminance(morning!.skyLow));
    expect(luminance(morning!.skyLow)).toBeGreaterThan(luminance(evening!.skyLow));
    expect(luminance(evening!.skyLow)).toBeGreaterThan(luminance(night!.skyLow));
    expect(evening!.lamp).toBeGreaterThan(day!.lamp);
    expect(day!.daylight).toBeGreaterThan(night!.daylight);
    expect(night!.fire).toBeGreaterThan(day!.fire);
    expect(night!.reflect).toBeGreaterThan(day!.reflect);
  });

  it('лампы горят в любое время: зал не становится холодным', () => {
    for (const position of [0, 1, 2, 3]) expect(at(position).lamp).toBeGreaterThan(0.5);
  });

  it('весь круг проходит без скачков ни в одном значении', () => {
    const steps = 2400;
    const previous = at(0);
    const frame = createFrame();
    const numeric = ['window', 'reflect', 'lamp', 'daylight', 'ambient', 'exposure', 'dust', 'beam', 'fire', 'rainSound', 'roomSound', 'fireSound'] as const;
    for (let i = 1; i <= steps; i += 1) {
      sampleFrame((i / steps) * 4, frame);
      for (const key of numeric) {
        expect(Math.abs(frame[key] - previous[key])).toBeLessThan(0.01);
        previous[key] = frame[key];
      }
      expect(Math.abs(luminance(frame.skyLow) - luminance(previous.skyLow))).toBeLessThan(0.01);
      previous.skyLow.copy(frame.skyLow);
    }
  });

  it('конец круга совпадает с началом', () => {
    expect(at(3.9999).lamp).toBeCloseTo(at(0).lamp, 3);
    expect(at(4).window).toBeCloseTo(at(0).window, 6);
  });
});

describe('смена времени суток', () => {
  it('не прыгает к цели, а идёт постепенно', () => {
    const time = new TimeOfDayController();
    time.update(0, 0.016);
    let previous = 0;
    for (let i = 0; i < 40; i += 1) {
      const position = time.update(1, 0.05);
      expect(position - previous).toBeLessThanOrEqual(0.05 * 0.26 + 1e-9);
      expect(position).toBeGreaterThanOrEqual(previous);
      previous = position;
    }
    expect(previous).toBeLessThan(1);
  });

  it('приходит к цели и останавливается', () => {
    const time = new TimeOfDayController();
    time.update(0, 0.016);
    for (let i = 0; i < 600; i += 1) time.update(1, 0.05);
    expect(time.position).toBeCloseTo(1, 3);
  });

  it('из ночи в утро идёт через конец круга, а не назад через день', () => {
    const time = new TimeOfDayController();
    time.update(3, 0.016);
    time.update(0, 0.1);
    expect(time.position).toBeGreaterThan(3);
  });

  it('первое значение принимает сразу: при загрузке зал не перематывается', () => {
    const time = new TimeOfDayController();
    expect(time.update(2.5, 0.016)).toBe(2.5);
  });
});

describe('звук атмосферы', () => {
  const base: MixInput = {
    frame: { rainSound: 1, roomSound: 1, fireSound: 0.7 },
    rain: RAIN_STRENGTH.medium,
    volume: 0.6,
    enabled: true,
    scene: 'full',
    duck: true,
    narrating: false,
    hidden: false,
  };

  it('в зале играет на выбранной громкости, выключатель убирает звук', () => {
    expect(ambienceMix(base).master).toBeCloseTo(0.6);
    expect(ambienceMix({ ...base, volume: 0.3 }).master).toBeCloseTo(0.3);
    expect(ambienceMix({ ...base, enabled: false }).master).toBe(0);
  });

  it('при чтении становится тише и мягче, а в зале возвращается', () => {
    const library = ambienceMix(base);
    const reading = ambienceMix({ ...base, scene: 'reading' });
    expect(reading.master).toBeLessThan(library.master);
    expect(reading.master).toBeGreaterThan(0);
    expect(reading.cutoff).toBeLessThan(library.cutoff);
    expect(ambienceMix({ ...base, scene: 'full' })).toEqual(library);
  });

  it('настройка «Снижать звуки во время чтения» отключает приглушение', () => {
    expect(ambienceMix({ ...base, scene: 'reading', duck: false })).toEqual(ambienceMix(base));
  });

  it('под голос книги дождь уходит на дальний план даже без приглушения', () => {
    const narration = ambienceMix({ ...base, scene: 'reading', duck: false, narrating: true });
    expect(narration.master).toBeLessThan(ambienceMix({ ...base, scene: 'reading' }).master);
  });

  it('в скрытой вкладке молчит', () => {
    expect(ambienceMix({ ...base, hidden: true }).master).toBe(0);
  });

  it('сильный дождь громче слабого, а усиление на показе громче всех', () => {
    const level = (rain: number) => ambienceMix({ ...base, rain }).rain;
    expect(level(RAIN_STRENGTH.heavy)).toBeGreaterThan(level(RAIN_STRENGTH.light));
    expect(level(RAIN_BOOST)).toBeGreaterThan(level(RAIN_STRENGTH.heavy));
  });

  it('камин слышен только там, где он горит', () => {
    expect(ambienceMix({ ...base, frame: { rainSound: 1, roomSound: 1, fireSound: 0 } }).fire).toBe(0);
    expect(ambienceMix(base).fire).toBeGreaterThan(0);
  });
});

describe('профили качества', () => {
  const levels = [QUALITY_PROFILES.low, QUALITY_PROFILES.medium, QUALITY_PROFILES.high, QUALITY_PROFILES.ultra];

  it('каждый следующий уровень не дешевле предыдущего', () => {
    for (let i = 1; i < levels.length; i += 1) {
      const [weak, strong] = [levels[i - 1]!, levels[i]!];
      for (const key of ['rainLayers', 'sideWindows', 'dustCount', 'shelfBooks', 'backdropFps', 'maxDpr'] as const) {
        expect(strong[key]).toBeGreaterThanOrEqual(weak[key]);
      }
    }
  });

  it('на низком качестве дождь самый простой и нет дорогих слоёв', () => {
    expect(QUALITY_PROFILES.low).toMatchObject({ rainLayers: 1, lightShafts: false, backdropFps: 0, audioLayers: 'simple' });
  });
});
