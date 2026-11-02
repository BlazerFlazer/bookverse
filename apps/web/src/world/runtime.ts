import { Vector3 } from 'three';
import { createFrame } from '../atmosphere/keyframes.ts';

/**
 * Живые значения сцены. Их двигает GSAP, а читает useFrame: это не React-состояние,
 * поэтому покадровая анимация не вызывает перерисовку компонентов.
 */
export const rt = {
  cam: {
    pos: new Vector3(0, 0.3, 9),
    look: new Vector3(0, 0, 0),
    fov: 34,
    roll: 0,
    /** Сила реакции на движение мыши. */
    parallax: 0,
    /** Сколько пользователь может поворачивать взгляд. */
    freeLook: 0,
    shake: 0,
  },
  hero: {
    visible: false,
    pos: new Vector3(),
    rot: new Vector3(),
    scale: 1,
    /** 0 — закрыта, 1 — полностью раскрыта. */
    open: 0,
    /** Перелистывание страниц. */
    fan: 0,
    /** Доля страниц слева при раскрытии. */
    openRatio: 0.5,
    glow: 0,
    pulse: 0,
    innerLight: 0,
    thickness: 0.26,
  },
  intro: {
    light: 0,
    particles: 0,
  },
  library: {
    visible: false,
    /** 0 — зал в темноте, 1 — зал освещён. */
    reveal: 0,
    fog: 0.042,
    dim: 1,
    spot: 0,
    spotPos: new Vector3(),
  },
  vortex: {
    center: new Vector3(),
    burst: 0,
    orbit: 0,
    scatter: 0,
    opacity: 0,
    radius: 1.6,
    height: 2.4,
    scale: 1,
    books: 0,
  },
  shock: { progress: 0, center: new Vector3(), scale: 1 },
  ribbons: { head: 0, opacity: 0, center: new Vector3(), radius: 1.2, height: 1.8 },
  shafts: { opacity: 0 },
  /** Живая библиотека: значения пишет менеджер атмосферы, а сцена только читает. */
  atmos: {
    frame: createFrame(),
    /** Точка на круге суток: 0 утро, 1 день, 2 вечер, 3 ночь. */
    position: 0,
    /** Сила дождя: 1 — сильный, выше единицы только на показе. */
    rain: 0,
    /** Часы дождя: не идут при включённом «Меньше движения». */
    rainTime: 0,
    flash: 0,
    /** Сколько слоёв капель рисовать сейчас: падает, если машина не справляется. */
    layers: 2,
    /** Лёгкие живые движения: дрожание ламп, дыхание камеры. */
    motion: 1,
  },
  time: 0,
};

export type Runtime = typeof rt;
