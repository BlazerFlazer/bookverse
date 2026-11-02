import { DEMO_DAY_MS, phaseAt, phaseIndex, positionForSettings, positionFromCycle, type TimePhase } from '@bookverse/shared';
import { useWorld, type WorldStage } from '../stores/world.ts';
import { rt } from '../world/runtime.ts';
import { AmbientAudioManager } from './AmbientAudioManager.ts';
import { sampleFrame } from './keyframes.ts';
import { syncLighting } from './lighting.ts';
import { ambienceMix, RAIN_BOOST, RAIN_STRENGTH, type AmbienceScene, type MixLevels } from './mix.ts';
import { useAtmosphere, utcOffsetMinutes } from './store.ts';
import { TimeOfDayController } from './TimeOfDayController.ts';

const TICK_MS = 250;
const MAX_STEP = 0.25;
const RAIN_RESPONSE = 0.9;
const SHOWCASE_MS = 14_000;
/** Гром редкий и только в тёмные части суток, если его не вызвал ведущий. */
const STORM_FIRST_MS = [70_000, 160_000] as const;
const STORM_NEXT_MS = [170_000, 340_000] as const;
const STORM_FROM = 1.55;
const STORM_TO = 3.45;

const between = ([from, to]: readonly [number, number]) => from + Math.random() * (to - from);

const SCENES: Partial<Record<WorldStage, AmbienceScene>> = { reading: 'reading', backdrop: 'page', chamber: 'page' };

/** Вспышка мягкая: подъём, спад и слабое эхо. Резких миганий нет. */
function flashEnvelope(age: number): number {
  if (age < 0 || age > 1.5) return 0;
  const first = Math.min(1, age / 0.07) * Math.exp(-Math.max(0, age - 0.07) * 7);
  const echo = age > 0.42 ? 0.5 * Math.min(1, (age - 0.42) / 0.09) * Math.exp(-Math.max(0, age - 0.51) * 6) : 0;
  return Math.max(first, echo);
}

/**
 * Единственный хозяин живой библиотеки: решает, какое сейчас время суток, какой дождь и какой звук.
 * Работает и без холста, поэтому звук и плоский режим не зависят от WebGL. Сцена только читает rt.atmos.
 */
class AtmosphereManager {
  readonly audio = new AmbientAudioManager();
  private readonly time = new TimeOfDayController();
  private last = 0;
  private started = false;
  private narrating = false;
  private showcaseUntil = 0;
  private flashAt = -1;
  private nextStorm = 0;
  private seenShowcase = -1;
  private hidden = false;
  private audioClock = 0;
  private layerLimit = 3;

  /** Запускается один раз. Звук ждёт первого действия пользователя: так требует браузер. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.last = performance.now();
    this.nextStorm = this.last + between(STORM_FIRST_MS);
    this.tick(this.last);
    setInterval(() => this.tick(), TICK_MS);

    const unlock = () => {
      const { settings, demo } = useAtmosphere.getState();
      if (settings.atmosphereAudioEnabled || demo?.audio) this.audio.start();
      this.updateAudioState();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.visibilityState === 'hidden';
      this.tick();
    });
    window.__bookverseAtmosphere = () => this.snapshot();
  }

  setNarrating(value: boolean): void {
    this.narrating = value;
  }

  /** Машина не справляется: в режиме «Авто» убираем слой капель. Выбранное вручную качество не трогаем. */
  reduceLoad(): void {
    if (useWorld.getState().qualitySetting === 'auto') this.layerLimit = Math.max(1, this.layerLimit - 1);
  }

  /** Кадры снова идут ровно: слой возвращается. */
  restoreLoad(): void {
    this.layerLimit = Math.min(3, this.layerLimit + 1);
  }

  /** Куда должен прийти зал: показ важнее ссылки, а ссылка важнее настроек. */
  private target(now: number): number {
    const { settings, demo, linkPhase } = useAtmosphere.getState();
    if (demo?.time === 'cycle') return positionFromCycle(now, DEMO_DAY_MS);
    if (demo?.time) return phaseIndex(demo.time);
    if (linkPhase) return phaseIndex(linkPhase);
    return positionForSettings(settings, now, utcOffsetMinutes());
  }

  private soundWanted(): boolean {
    const { settings, demo } = useAtmosphere.getState();
    if (!useWorld.getState().soundOn) return false;
    return demo?.audio ?? settings.atmosphereAudioEnabled;
  }

  private updateAudioState(): void {
    const state = !this.soundWanted() ? 'off' : this.audio.failed ? 'unavailable' : this.audio.running ? 'playing' : 'waiting';
    if (useAtmosphere.getState().audioState !== state) useAtmosphere.setState({ audioState: state });
  }

  /** Вспышка видна только там, где это разрешено. Гром слышен в любом случае. */
  private strike(strength: number, forced: boolean, wall: number): void {
    const { settings } = useAtmosphere.getState();
    const allowed = forced || settings.lightningEnabled;
    if (allowed && !useWorld.getState().reducedMotion) this.flashAt = wall;
    this.audio.thunder(1.6 + Math.random() * 2.4, strength);
  }

  /** Показ погоды для зала: дождь усиливается, затем следует вспышка и гром. */
  playShowcase(): void {
    const wall = performance.now();
    this.showcaseUntil = wall + SHOWCASE_MS;
    setTimeout(() => this.strike(1, true, performance.now()), 1800);
  }

  private storm(now: number): void {
    if (now < this.nextStorm) return;
    const reading = useWorld.getState().stage === 'reading';
    this.nextStorm = now + between(STORM_NEXT_MS) * (reading ? 2 : 1);
    if (rt.atmos.position >= STORM_FROM && rt.atmos.position <= STORM_TO) this.strike(0.7, false, now);
  }

  /** Сердце менеджера. Вызывается из кадра сцены и из таймера, когда кадров нет. */
  tick(now = performance.now()): void {
    const dt = Math.min(MAX_STEP, (now - this.last) / 1000);
    if (dt <= 0) return;
    this.last = now;

    const { settings, demo } = useAtmosphere.getState();
    const { reducedMotion, stage, quality } = useWorld.getState();
    const atmos = rt.atmos;

    const wall = Date.now();
    const position = this.time.update(this.target(wall), dt);
    atmos.position = position;
    sampleFrame(position, atmos.frame);

    const boosted = Boolean(demo?.rainBoost) || now < this.showcaseUntil;
    const wanted = boosted ? RAIN_BOOST : RAIN_STRENGTH[settings.rainIntensity];
    atmos.rain = atmos.rain === 0 ? wanted : atmos.rain + (wanted - atmos.rain) * (1 - Math.exp(-dt * RAIN_RESPONSE));
    if (!reducedMotion) atmos.rainTime += dt * (0.72 + atmos.rain * 0.4);
    atmos.flash = this.flashAt < 0 ? 0 : flashEnvelope((now - this.flashAt) / 1000);
    atmos.motion = reducedMotion ? 0 : 1;
    atmos.layers = Math.min(this.layerLimit, quality.rainLayers);
    syncLighting();

    const phase: TimePhase = phaseAt(position);
    if (useAtmosphere.getState().phase !== phase) useAtmosphere.setState({ phase });

    if (demo && demo.showcase !== this.seenShowcase) {
      if (this.seenShowcase >= 0 && demo.showcase > this.seenShowcase) this.playShowcase();
      this.seenShowcase = demo.showcase;
    }
    if (!demo) this.seenShowcase = -1;

    this.storm(now);

    // Звук меняется медленно: четырёх обновлений в секунду ему достаточно.
    if (now - this.audioClock >= TICK_MS - 20) {
      this.audioClock = now;
      this.audio.simple = quality.audioLayers === 'simple';
      this.audio.update(this.levels(stage), (TICK_MS / 1000) * 1.6);
      this.updateAudioState();
    }
  }

  private levels(stage: WorldStage): MixLevels {
    const { settings } = useAtmosphere.getState();
    return ambienceMix({
      frame: rt.atmos.frame,
      rain: rt.atmos.rain,
      volume: settings.atmosphereVolume,
      enabled: this.soundWanted(),
      scene: SCENES[stage] ?? 'full',
      duck: settings.readingAudioDuckEnabled,
      narrating: this.narrating,
      hidden: this.hidden,
    });
  }

  private snapshot() {
    const { position, rain, rainTime, flash, layers, motion } = rt.atmos;
    const { phase, audioState } = useAtmosphere.getState();
    return { position, phase, rain, rainTime, flash, layers, motion, audioState, levels: this.audio.levels };
  }
}

export const atmosphere = new AtmosphereManager();

declare global {
  interface Window {
    /** Только чтение: снимок для проверки перед показом и для сквозных тестов. */
    __bookverseAtmosphere?: () => unknown;
  }
}
