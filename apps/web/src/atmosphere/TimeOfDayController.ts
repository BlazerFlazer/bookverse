import { PHASE_COUNT, wrapPosition } from '@bookverse/shared';

/** Самое быстрое движение по кругу суток: одна часть за четыре секунды. */
const MAX_RATE = 0.26;
const RESPONSE = 1.3;

/**
 * Ведёт зал к нужной точке суток кратчайшим путём. Смена никогда не бывает скачком:
 * даже ручной выбор проходит через промежуточные состояния, поэтому сцена не перезагружается.
 */
export class TimeOfDayController {
  position: number | null = null;

  update(target: number, dt: number): number {
    if (this.position === null) {
      this.position = wrapPosition(target);
      return this.position;
    }
    const half = PHASE_COUNT / 2;
    const delta = wrapPosition(target - this.position + half) - half;
    const wanted = delta * (1 - Math.exp(-dt * RESPONSE));
    const limit = MAX_RATE * dt;
    this.position = wrapPosition(this.position + Math.max(-limit, Math.min(limit, wanted)));
    return this.position;
  }
}
