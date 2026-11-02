import { describe, expect, it } from 'vitest';
import {
  atmosphereSettingsSchema,
  DEFAULT_ATMOSPHERE,
  DEMO_DAY_MS,
  demoAtmospherePatchSchema,
  demoPhase,
  NEUTRAL_DEMO_ATMOSPHERE,
  phaseAt,
  positionForSettings,
  positionFromCycle,
  positionFromHour,
  SIMULATED_DAY_MS,
  wrapPosition,
} from '../src/index.ts';

describe('настройки атмосферы', () => {
  it('по умолчанию дождь, звук и автоматическая смена суток', () => {
    expect(atmosphereSettingsSchema.parse(DEFAULT_ATMOSPHERE)).toMatchObject({
      preferredAtmospherePreset: 'rain',
      atmosphereAudioEnabled: true,
      autoTimeOfDayEnabled: true,
      effectsQuality: 'auto',
      rainIntensity: 'medium',
      readingAudioDuckEnabled: true,
    });
  });

  it('не принимает значения вне списка и громкость выше предела', () => {
    expect(atmosphereSettingsSchema.safeParse({ ...DEFAULT_ATMOSPHERE, preferredManualTimeOfDay: 'полдень' }).success).toBe(false);
    expect(atmosphereSettingsSchema.safeParse({ ...DEFAULT_ATMOSPHERE, atmosphereVolume: 1.5 }).success).toBe(false);
  });

  it('команда ведущего принимает только известные действия', () => {
    expect(demoAtmospherePatchSchema.safeParse({ time: 'evening', rainBoost: true }).success).toBe(true);
    expect(demoAtmospherePatchSchema.safeParse({ time: 'полночь' }).success).toBe(false);
    expect(demoAtmospherePatchSchema.safeParse({ showcase: false }).success).toBe(false);
  });
});

describe('круг суток', () => {
  it('ускоренные сутки проходят все четыре части по порядку и замыкаются', () => {
    const quarter = SIMULATED_DAY_MS / 4;
    const start = SIMULATED_DAY_MS * 1000;
    expect([0, 1, 2, 3].map((i) => phaseAt(positionFromCycle(start + i * quarter)))).toEqual(['morning', 'day', 'evening', 'night']);
    expect(phaseAt(positionFromCycle(start + SIMULATED_DAY_MS))).toBe('morning');
  });

  it('час на часах попадает в свою часть суток', () => {
    expect(phaseAt(positionFromHour(9))).toBe('morning');
    expect(phaseAt(positionFromHour(14))).toBe('day');
    expect(phaseAt(positionFromHour(19))).toBe('evening');
    expect(phaseAt(positionFromHour(1))).toBe('night');
    expect(phaseAt(positionFromHour(23.5))).toBe('night');
  });

  it('положение по часам непрерывно через полночь и через начало круга', () => {
    let previous = positionFromHour(9);
    for (let hour = 9.25; hour < 33; hour += 0.25) {
      const position = positionFromHour(hour % 24);
      const step = wrapPosition(position - previous + 2) - 2;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(0.1);
      previous = position;
    }
  });

  it('ручной выбор важнее автоматики, а часы учитывают часовой пояс', () => {
    const noonUtc = Date.UTC(2026, 10, 2, 12);
    expect(positionForSettings({ ...DEFAULT_ATMOSPHERE, autoTimeOfDayEnabled: false, preferredManualTimeOfDay: 'night' }, noonUtc, 0)).toBe(3);
    const clock = { ...DEFAULT_ATMOSPHERE, timeOfDaySource: 'clock' as const };
    expect(phaseAt(positionForSettings(clock, noonUtc, 0))).toBe('day');
    expect(phaseAt(positionForSettings(clock, noonUtc, 7 * 60))).toBe('evening');
  });

  it('показ либо держит выбранное время, либо идёт быстрым кругом', () => {
    expect(demoPhase(NEUTRAL_DEMO_ATMOSPHERE, 0)).toBeNull();
    expect(demoPhase({ ...NEUTRAL_DEMO_ATMOSPHERE, time: 'night' }, 0)).toBe('night');
    const cycle = { ...NEUTRAL_DEMO_ATMOSPHERE, time: 'cycle' as const };
    expect(demoPhase(cycle, DEMO_DAY_MS * 10 + DEMO_DAY_MS / 2)).toBe('evening');
  });
});
