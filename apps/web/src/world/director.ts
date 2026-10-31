import gsap from 'gsap';
import { Vector3 } from 'three';
import { playAwakening, playRustle } from '../lib/sound.ts';
import { useWorld } from '../stores/world.ts';
import { BOOK_W } from './book/geometry.ts';
import { focusPose, HOME_POSE, slotPosition, TABLE, type ShelfSlot } from './library/layout.ts';
import { rt } from './runtime.ts';

/**
 * Режиссура сцен. Здесь только таймлайны GSAP поверх rt: сами объекты сцены не знают,
 * какая сейчас стадия, поэтому порядок событий читается одним списком.
 */
// Сглаживание задержек растянуло бы интро на минуты там, где кадр длится дольше полусекунды.
// Здесь важнее длительность сцены: на слабой машине анимация пропускает кадры, но идёт вовремя.
gsap.ticker.lagSmoothing(0);

let active: gsap.core.Timeline | null = null;
let pendingReader: (() => void) | null = null;
let idle: gsap.core.Tween[] = [];

function stopAll(): void {
  active?.kill();
  active = null;
  idle.forEach((tween) => tween.kill());
  idle = [];
}

const setVec = (target: Vector3, value: readonly [number, number, number]) => target.set(value[0], value[1], value[2]);
const toXYZ = ([x, y, z]: readonly [number, number, number]) => ({ x, y, z });

function resetEffects(): void {
  rt.vortex.burst = 0;
  rt.vortex.orbit = 0;
  rt.vortex.scatter = 0;
  rt.vortex.opacity = 0;
  rt.vortex.books = 0;
  rt.shock.progress = 0;
  rt.ribbons.opacity = 0;
  rt.shafts.opacity = 0;
  rt.hero.fan = 0;
  rt.hero.glow = 0;
  rt.hero.pulse = 0;
  rt.hero.innerLight = 0;
  rt.library.spot = 0;
}

function setWhiteout(value: number): void {
  const element = document.getElementById('whiteout');
  if (element) element.style.opacity = String(value);
}

/** Закрытая книга в темноте. Ждёт клика. */
export function stageIntro(): void {
  stopAll();
  resetEffects();
  const { hero, cam, library, intro } = rt;
  library.visible = false;
  library.reveal = 0;
  library.dim = 1;
  library.fog = 0.02;
  hero.visible = true;
  hero.open = 0;
  hero.openRatio = 0.5;
  hero.thickness = 0.27;
  hero.scale = 3.05;
  hero.pos.set(0, -0.05, 0);
  hero.rot.set(-0.1, 0.24, 0.02);
  cam.pos.set(0.2, 0.25, 9.6);
  cam.look.set(0, 0, 0);
  cam.fov = 34;
  cam.roll = 0;
  cam.parallax = 0.14;
  cam.freeLook = 0;
  intro.light = 0;
  intro.particles = 0;

  // Свет разгорается медленно, а камера едва заметно дышит.
  idle.push(gsap.to(hero, { glow: 0.2, duration: 3, ease: 'power1.inOut' }));
  idle.push(gsap.to(intro, { light: 1, duration: 2.8, ease: 'power2.inOut' }));
  idle.push(gsap.to(intro, { particles: 0.9, duration: 3.4, delay: 0.6, ease: 'power1.inOut' }));
  idle.push(gsap.to(hero.rot, { y: 0.14, x: -0.07, duration: 7, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
  idle.push(gsap.to(hero.pos, { y: 0.03, duration: 4.4, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
  idle.push(gsap.to(cam.pos, { z: 9.1, x: -0.1, duration: 11, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
}

/** Сразу в зал, без кинематографии: повторный визит, глубокая ссылка или резервный режим. */
export function stageLibrary(): void {
  stopAll();
  resetEffects();
  const { hero, cam, library, intro } = rt;
  hero.visible = false;
  intro.light = 0;
  intro.particles = 0;
  library.visible = true;
  library.reveal = 1;
  library.dim = 1;
  library.fog = 0.042;
  setVec(cam.pos, HOME_POSE.pos);
  setVec(cam.look, HOME_POSE.look);
  cam.fov = 44;
  cam.roll = 0;
  cam.parallax = 0.1;
  cam.freeLook = 1;
  setWhiteout(0);
}

/** Плавное появление зала из темноты: общая концовка интро. */
function revealLibrary(timeline: gsap.core.Timeline, at: gsap.Position): void {
  const { library, cam } = rt;
  timeline.call(
    () => {
      rt.hero.visible = false;
      rt.intro.light = 0;
      rt.intro.particles = 0;
      resetEffects();
      library.visible = true;
      library.reveal = 0;
      library.fog = 0.42;
      setVec(cam.pos, [0, 1.6, 14]);
      setVec(cam.look, HOME_POSE.look);
      cam.fov = 58;
      cam.roll = 0;
    },
    undefined,
    at,
  );
  timeline.to(cam.pos, { ...toXYZ(HOME_POSE.pos), duration: 3.4, ease: 'power3.out' }, at);
  timeline.to(cam, { fov: 44, duration: 3.4, ease: 'power3.out' }, at);
  timeline.to(library, { fog: 0.042, duration: 3, ease: 'power2.out' }, at);
  timeline.to(library, { reveal: 1, duration: 2.6, ease: 'power1.inOut' }, at);
}

export interface IntroCallbacks {
  onWelcome: () => void;
  onDone: () => void;
}

export function playIntro({ onWelcome, onDone }: IntroCallbacks): void {
  const { reducedMotion } = useWorld.getState();
  stopAll();
  const { hero, cam, vortex, shock, shafts, intro } = rt;

  if (reducedMotion) {
    const quiet = gsap.timeline({ onComplete: onDone });
    active = quiet;
    quiet.to(intro, { light: 0, duration: 0.3 });
    quiet.call(() => {
      stageLibrary();
      rt.library.reveal = 0;
    });
    quiet.to(rt.library, { reveal: 1, duration: 0.5 });
    quiet.call(onWelcome);
    return;
  }

  playAwakening();
  setVec(vortex.center, [0, 0.1, 0]);
  vortex.radius = 2.9;
  vortex.height = 4.2;
  vortex.scale = 1.05;
  shock.center.set(0, 0.1, 0.3);
  shock.scale = 1.5;

  const tl = gsap.timeline({ onComplete: onDone });
  active = tl;

  // Этап А: пробуждение
  tl.addLabel('awaken');
  tl.to(hero, { glow: 0.85, duration: 0.9, ease: 'power2.out' }, 'awaken');
  tl.fromTo(hero, { pulse: 0.001 }, { pulse: 1, duration: 1.15, ease: 'power1.out' }, 'awaken+=0.1');
  tl.to(cam.pos, { x: 0, y: 0.5, z: 8.2, duration: 1.1, ease: 'power2.inOut' }, 'awaken');
  tl.to(hero.pos, { y: 0.32, duration: 1.05, ease: 'power2.out' }, 'awaken');
  tl.to(hero.rot, { x: -0.3, y: -0.08, z: 0, duration: 1.1, ease: 'power2.inOut' }, 'awaken');
  tl.to(intro, { light: 0.8, duration: 0.9 }, 'awaken');
  tl.to(cam, { parallax: 0, duration: 0.6 }, 'awaken');

  // Этап Б: раскрытие
  tl.addLabel('open', 1.05);
  tl.call(() => playRustle(0.8, 2.2), undefined, 'open');
  tl.to(hero, { open: 1, duration: 2.15, ease: 'power2.inOut' }, 'open');
  tl.to(hero, { fan: 0.46, duration: 1.7, ease: 'power1.inOut' }, 'open+=0.7');
  tl.to(hero, { innerLight: 0.55, glow: 0.4, duration: 1.5, ease: 'power2.in' }, 'open+=0.5');
  tl.to(shafts, { opacity: 0.8, duration: 1.3, ease: 'power2.in' }, 'open+=0.8');
  tl.to(hero.rot, { x: -0.62, y: 0, duration: 2.2, ease: 'power2.inOut' }, 'open');
  tl.to(hero, { scale: 2.5, duration: 2.1, ease: 'power2.inOut' }, 'open');
  tl.to(hero.pos, { y: -0.2, duration: 2, ease: 'power2.inOut' }, 'open');
  tl.to(cam.pos, { y: 1.5, z: 7.4, duration: 2.1, ease: 'sine.inOut' }, 'open');

  // Этап В: литературный взрыв
  tl.addLabel('burst', 3.05);
  tl.call(() => playRustle(1.4, 3), undefined, 'burst');
  tl.to(shock, { progress: 1, duration: 1.5, ease: 'power2.out' }, 'burst');
  tl.to(hero, { innerLight: 0.95, duration: 0.4, ease: 'power3.out' }, 'burst');
  tl.to(cam, { shake: 1, duration: 0.12, yoyo: true, repeat: 1 }, 'burst');
  tl.set(vortex, { opacity: 1, books: 1 }, 'burst');
  tl.to(vortex, { burst: 1, duration: 1.9, ease: 'power2.out' }, 'burst');
  tl.to(vortex, { orbit: 1, duration: 1.6, ease: 'power1.inOut' }, 'burst+=0.5');
  // Камера облетает книгу сквозь вихрь листов
  tl.to(cam.pos, { x: -3.1, y: 2.1, z: 5.6, duration: 1.3, ease: 'sine.inOut' }, 'burst+=0.1');
  tl.to(cam.pos, { x: 2.3, y: 1.2, z: 4.3, duration: 1.3, ease: 'sine.inOut' }, 'burst+=1.4');
  tl.to(cam, { roll: 0.09, duration: 1.3, ease: 'sine.inOut' }, 'burst+=0.1');
  tl.to(cam, { roll: -0.07, duration: 1.3, ease: 'sine.inOut' }, 'burst+=1.4');
  tl.to(shafts, { opacity: 0.35, duration: 1.8 }, 'burst+=0.6');

  // Этап Г: сквозь книгу в библиотеку
  tl.addLabel('dive', 5.75);
  tl.call(() => {
    onWelcome();
  }, undefined, 'dive+=1.9');
  tl.to(vortex, { scatter: 1, duration: 1.3, ease: 'power2.in' }, 'dive');
  tl.to(cam.pos, { x: 0, y: 0.9, z: 0.5, duration: 1.15, ease: 'power3.in' }, 'dive');
  tl.to(cam.look, { y: -0.3, duration: 1.15, ease: 'power2.in' }, 'dive');
  tl.to(cam, { roll: 0, fov: 66, duration: 1.15, ease: 'power3.in' }, 'dive');
  tl.to(hero, { innerLight: 1.6, duration: 1, ease: 'power3.in' }, 'dive');
  tl.to('#whiteout', { opacity: 1, duration: 0.55, ease: 'power2.in' }, 'dive+=0.62');
  revealLibrary(tl, 'dive+=1.2');
  tl.to('#whiteout', { opacity: 0, duration: 1.5, ease: 'power2.out' }, 'dive+=1.25');
}

/** Пропуск интро сразу открывает зал: никакой обязательной выдержки. */
export function skipIntro(): void {
  stageLibrary();
}

export function focusBay(side: -1 | 1, bay: number): void {
  const pose = focusPose(side, bay);
  gsap.to(rt.cam.pos, { ...toXYZ(pose.pos), duration: 1.5, ease: 'power3.inOut', overwrite: true });
  gsap.to(rt.cam.look, { ...toXYZ(pose.look), duration: 1.5, ease: 'power3.inOut', overwrite: true });
  gsap.to(rt.cam, { fov: 40, duration: 1.5, ease: 'power2.inOut', overwrite: 'auto' });
}

export function returnHome(): void {
  gsap.to(rt.cam.pos, { ...toXYZ(HOME_POSE.pos), duration: 1.5, ease: 'power3.inOut', overwrite: true });
  gsap.to(rt.cam.look, { ...toXYZ(HOME_POSE.look), duration: 1.5, ease: 'power3.inOut', overwrite: true });
  gsap.to(rt.cam, { fov: 44, duration: 1.5, ease: 'power2.inOut', overwrite: 'auto' });
}

export interface ScreenRect {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/** Масштаб и положение открытой книги, при которых разворот совпадает с HTML-страницами читалки. */
function readingPose(rect: ScreenRect, camera: Vector3, forward: Vector3, thickness: number, fov: number) {
  const distance = 2.6;
  const viewHeight = 2 * distance * Math.tan((fov * Math.PI) / 360);
  const unitsPerPixel = viewHeight / window.innerHeight;
  const spreadWorld = rect.width * unitsPerPixel;
  const scale = spreadWorld / (BOOK_W * 2 + thickness);
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
  const position = camera
    .clone()
    .addScaledVector(forward, distance)
    .addScaledVector(right, (rect.centerX - window.innerWidth / 2) * unitsPerPixel)
    .add(new Vector3(0, -(rect.centerY - window.innerHeight / 2) * unitsPerPixel, 0));
  return { scale, position };
}

export interface TransitionOptions {
  slot: ShelfSlot;
  thickness: number;
  /** Доля страниц слева: книга открывается там, где читатель остановился. */
  openRatio: number;
  rect: ScreenRect;
  onReadyForReader: () => void;
}

/**
 * Перелёт выбранной книги: полка → левитация → вихрь → полёт к камере → посадка → раскрытие.
 * Вся сцена непрерывна, поэтому читалка появляется поверх уже раскрытой 3D-книги.
 */
export function playBookTransition({ slot, thickness, openRatio, rect, onReadyForReader }: TransitionOptions): void {
  const { reducedMotion, shortTransition, quality } = useWorld.getState();
  stopAll();
  resetEffects();
  pendingReader = onReadyForReader;
  const { hero, cam, library, vortex, ribbons, shock } = rt;

  if (reducedMotion) {
    library.dim = 0.5;
    onReadyForReader();
    return;
  }

  const side = slot.side;
  const pose = focusPose(side, slot.bay);
  const [sx, sy, sz] = slotPosition(slot);
  const forward = new Vector3(side, 0, 0);
  const cameraEnd = new Vector3(...pose.pos);
  const target = readingPose(rect, cameraEnd, forward, thickness, 40);

  hero.visible = true;
  hero.open = 0;
  hero.fan = 0;
  hero.thickness = thickness;
  hero.openRatio = openRatio;
  hero.scale = 0.24;
  hero.pos.set(sx, sy, sz);
  // Корешок смотрит в зал: так книга стоит на полке.
  hero.rot.set(0, side === -1 ? Math.PI : 0, 0);
  rt.intro.light = 0;

  const hover = new Vector3(sx - side * 0.62, sy + 0.1, sz);
  vortex.center.copy(hover);
  vortex.radius = 0.92;
  vortex.height = 1.4;
  vortex.scale = 0.4;
  ribbons.center.copy(hover);
  ribbons.radius = 0.56;
  ribbons.height = 0.95;
  shock.center.copy(hover);
  shock.scale = 0.34;
  library.spotPos.set(sx - side * 1.6, sy + 1.4, sz + 0.9);

  // В коротком режиме те же этапы идут быстрее; вихрь и полёт не выбрасываются, а сжимаются.
  const speed = shortTransition ? 2.6 : 1;
  const tl = gsap.timeline();
  tl.timeScale(speed);
  active = tl;

  // Этап 1: выбор
  tl.addLabel('select');
  tl.to(cam.pos, { ...toXYZ(pose.pos), duration: 1.1, ease: 'power3.inOut' }, 'select');
  tl.to(cam.look, { x: sx, y: sy, z: sz, duration: 1.1, ease: 'power3.inOut' }, 'select');
  tl.to(cam, { fov: 40, freeLook: 0, parallax: 0, duration: 1.1, ease: 'power2.inOut' }, 'select');
  tl.to(library, { spot: 1, dim: 0.55, duration: 0.8, ease: 'power2.out' }, 'select+=0.15');
  tl.to(hero, { glow: 0.7, duration: 0.7 }, 'select+=0.3');

  // Этап 2: левитация
  tl.addLabel('float', 1);
  tl.call(() => playRustle(0.5, 1), undefined, 'float');
  tl.to(hero.pos, { x: sx - side * 0.34, duration: 0.5, ease: 'power2.out' }, 'float');
  tl.to(hero.pos, { x: hover.x, y: hover.y, z: hover.z, duration: 0.65, ease: 'sine.inOut' }, 'float+=0.42');
  tl.to(hero.rot, { y: side === -1 ? Math.PI / 2 : -Math.PI / 2, duration: 0.95, ease: 'power2.inOut' }, 'float+=0.28');
  tl.to(hero, { scale: 0.34, duration: 0.9, ease: 'power2.inOut' }, 'float+=0.3');
  tl.to(cam.look, { x: hover.x, y: hover.y, z: hover.z, duration: 0.8, ease: 'power2.inOut' }, 'float+=0.3');

  // Этап 3: вихрь из книг и страниц
  tl.addLabel('swirl', 2.1);
  tl.call(() => playRustle(1, 2), undefined, 'swirl');
  tl.set(vortex, { opacity: 1, books: 1 }, 'swirl');
  tl.to(shock, { progress: 1, duration: 1.1, ease: 'power2.out' }, 'swirl');
  tl.to(vortex, { burst: 1, duration: 1.15, ease: 'power2.out' }, 'swirl');
  tl.to(vortex, { orbit: 1, duration: 1, ease: 'power1.inOut' }, 'swirl+=0.3');
  if (quality.level !== 'low') {
    tl.set(ribbons, { opacity: 1, head: -0.1 }, 'swirl+=0.1');
    tl.to(ribbons, { head: 1.6, duration: 1.7, ease: 'sine.inOut' }, 'swirl+=0.1');
  }
  tl.to(hero.rot, { y: `+=${side * Math.PI * 2}`, duration: 1.75, ease: 'sine.inOut' }, 'swirl');
  tl.to(hero.rot, { x: 0.22, z: side * 0.1, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 'swirl');
  tl.to(hero, { glow: 1.3, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 'swirl');

  // Этап 4: полёт к зрителю. Листы расступаются, а книга заполняет кадр.
  tl.addLabel('fly', 3.75);
  tl.to(vortex, { scatter: 1, duration: 0.85, ease: 'power2.in' }, 'fly');
  tl.to(library, { dim: 0.32, duration: 0.8 }, 'fly');
  tl.to(hero.pos, { x: target.position.x, y: target.position.y, z: target.position.z, duration: 0.85, ease: 'power3.in' }, 'fly');
  tl.to(hero, { scale: target.scale * 1.09, duration: 0.85, ease: 'power3.in' }, 'fly');
  tl.to(cam.look, { x: side * 6, y: pose.pos[1], z: pose.pos[2], duration: 0.85, ease: 'power2.inOut' }, 'fly');
  tl.to(hero.rot, { x: 0, z: 0, duration: 0.8, ease: 'power2.inOut' }, 'fly');

  // Этап 5: посадка с мягким отскоком
  tl.addLabel('land', 4.6);
  tl.to(hero, { scale: target.scale, duration: 0.5, ease: 'back.out(2.4)' }, 'land');
  tl.to(hero, { glow: 0.18, duration: 0.4 }, 'land');
  tl.set(vortex, { opacity: 0, books: 0, burst: 0, scatter: 0, orbit: 0 }, 'land+=0.3');
  tl.set(ribbons, { opacity: 0 }, 'land');
  tl.to(library, { spot: 0, duration: 0.4 }, 'land');

  // Этап 6: раскрытие. Сдвиг к центру разворота уже заложен в механизм книги.
  tl.addLabel('open', 4.95);
  tl.call(() => playRustle(0.6, 1), undefined, 'open');
  tl.to(hero, { open: 1, duration: 1.15, ease: 'power2.inOut' }, 'open');
  tl.to(hero, { fan: 1, duration: 1.05, ease: 'power1.inOut' }, 'open+=0.18');
  tl.call(onReadyForReader, undefined, 'open+=1.05');
}

/** Страницы словаря и профиля: зал остаётся размытым фоном. */
export function stageBackdrop(): void {
  stopAll();
  resetEffects();
  const { hero, library, cam, intro } = rt;
  hero.visible = false;
  intro.light = 0;
  intro.particles = 0;
  library.visible = true;
  library.reveal = 1;
  library.dim = 0.8;
  library.fog = 0.042;
  setVec(cam.pos, HOME_POSE.pos);
  setVec(cam.look, HOME_POSE.look);
  cam.fov = 44;
  cam.roll = 0;
  cam.freeLook = 0;
  cam.parallax = 0;
}

/** Комната входа: книга парит над столом читального зала и держит форму на своих страницах. */
export function stageChamber(rect: ScreenRect): void {
  stopAll();
  resetEffects();
  const { hero, library, cam, intro } = rt;
  const position = new Vector3(0, 1.62, TABLE.centerZ + 3.7);
  intro.light = 0.32;
  intro.particles = 0.5;
  library.visible = true;
  library.reveal = 1;
  library.dim = 0.62;
  library.fog = 0.075;
  cam.pos.copy(position);
  cam.look.set(0, 1.62, TABLE.centerZ);
  cam.fov = 40;
  cam.roll = 0;
  cam.freeLook = 0;
  cam.parallax = 0.04;

  const pose = readingPose(rect, position, new Vector3(0, 0, -1), 0.16, 40);
  hero.visible = true;
  hero.thickness = 0.16;
  hero.openRatio = 0.5;
  hero.open = 1;
  hero.fan = 1;
  hero.glow = 0.35;
  hero.innerLight = 0.12;
  hero.scale = pose.scale;
  hero.pos.copy(pose.position);
  hero.rot.set(0, 0, 0);
  idle.push(gsap.to(hero.pos, { y: pose.position.y + 0.012, duration: 3.2, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
}

/** Кнопка «Сразу к чтению»: анимация обрывается, читалка открывается немедленно. */
export function skipBookTransition(): void {
  const open = pendingReader;
  if (!open) return;
  pendingReader = null;
  stopAll();
  resetEffects();
  rt.hero.visible = false;
  open();
}

/** Зал как живой фон большого экрана на Demo Day. */
export function stageDemo(): void {
  stopAll();
  resetEffects();
  const { hero, library, cam, intro } = rt;
  hero.visible = false;
  intro.light = 0;
  intro.particles = 0;
  library.visible = true;
  library.reveal = 1;
  library.dim = 0.85;
  library.fog = 0.042;
  setVec(cam.pos, HOME_POSE.pos);
  setVec(cam.look, HOME_POSE.look);
  cam.fov = 44;
  cam.roll = 0;
  cam.freeLook = 0;
  cam.parallax = 0.06;
  setWhiteout(0);
  idle.push(gsap.to(cam.pos, { z: HOME_POSE.pos[2] - 1.4, duration: 18, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
}

/** Разрешённая анимация ведущего: вихрь страниц посреди зала. Сцена остаётся той же. */
export function playDemoBurst(): void {
  active?.kill();
  const { vortex, shock, ribbons } = rt;
  vortex.center.set(0, 3, 2.4);
  vortex.radius = 2.5;
  vortex.height = 3.6;
  vortex.scale = 0.95;
  shock.center.set(0, 3, 2);
  shock.scale = 1;
  ribbons.center.set(0, 3, 2.4);
  ribbons.radius = 1.7;
  ribbons.height = 2.8;
  playRustle(1.2, 2.6);

  const tl = gsap.timeline();
  active = tl;
  tl.set(vortex, { opacity: 1, books: 1, burst: 0, orbit: 0, scatter: 0 }, 0);
  tl.fromTo(shock, { progress: 0 }, { progress: 1, duration: 1.4, ease: 'power2.out' }, 0);
  tl.to(vortex, { burst: 1, duration: 1.7, ease: 'power2.out' }, 0);
  tl.to(vortex, { orbit: 1, duration: 1.5, ease: 'power1.inOut' }, 0.4);
  tl.set(ribbons, { opacity: 1, head: -0.1 }, 0.1);
  tl.to(ribbons, { head: 1.6, duration: 2.6, ease: 'sine.inOut' }, 0.1);
  tl.to(vortex, { scatter: 1, duration: 1.3, ease: 'power2.in' }, 3.4);
  tl.set(ribbons, { opacity: 0 }, 3.4);
  tl.set(vortex, { opacity: 0, books: 0, burst: 0, orbit: 0, scatter: 0 }, 4.8);
}

/** Финал показа: фирменная книга раскрывается посреди зала, а листы продолжают кружить. */
export function playFinale(): void {
  stopAll();
  resetEffects();
  const { hero, library, cam, intro, vortex, shock, shafts } = rt;
  const center: [number, number, number] = [0, 2.05, 3.4];
  useWorld.getState().setFlying(null);
  library.visible = true;
  library.reveal = 1;
  setVec(cam.pos, [0, 2.3, 9.4]);
  setVec(cam.look, [0, 1.9, 0]);
  cam.fov = 38;
  cam.parallax = 0.05;
  hero.visible = true;
  hero.open = 0;
  hero.fan = 0;
  hero.openRatio = 0.5;
  hero.thickness = 0.27;
  hero.scale = 1.5;
  hero.pos.set(...center);
  hero.rot.set(-0.14, 0.2, 0);
  setVec(vortex.center, center);
  vortex.radius = 2.5;
  vortex.height = 3.4;
  vortex.scale = 0.9;
  shock.center.set(center[0], center[1], center[2] + 0.2);
  shock.scale = 1.1;

  playAwakening();
  const tl = gsap.timeline();
  active = tl;
  tl.to(library, { dim: 0.5, duration: 1.2 }, 0);
  tl.to(intro, { light: 0.8, particles: 0.8, duration: 1.2 }, 0);
  tl.to(hero, { glow: 0.8, duration: 0.8 }, 0);
  tl.fromTo(hero, { pulse: 0.001 }, { pulse: 1, duration: 1.1, ease: 'power1.out' }, 0.1);
  tl.to(hero.rot, { x: -0.5, y: 0, duration: 1.8, ease: 'power2.inOut' }, 0.7);
  tl.to(hero, { open: 1, duration: 1.9, ease: 'power2.inOut' }, 0.8);
  tl.to(hero, { fan: 0.46, duration: 1.6, ease: 'power1.inOut' }, 1.4);
  tl.to(hero, { innerLight: 0.7, glow: 0.4, duration: 1.4, ease: 'power2.in' }, 1.2);
  tl.to(shafts, { opacity: 0.6, duration: 1.2 }, 1.4);
  tl.call(() => playRustle(1.4, 3), undefined, 2.7);
  tl.set(vortex, { opacity: 1, books: 1 }, 2.7);
  tl.to(shock, { progress: 1, duration: 1.5, ease: 'power2.out' }, 2.7);
  tl.to(vortex, { burst: 1, duration: 1.9, ease: 'power2.out' }, 2.7);
  tl.to(vortex, { orbit: 1, duration: 1.6 }, 3.1);
  idle.push(gsap.to(cam.pos, { x: 1.2, z: 8.6, duration: 12, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
}

/** Читалка закрылась: возвращаем зал и камеру. */
export function leaveReader(): void {
  stopAll();
  resetEffects();
  const { hero, library, cam } = rt;
  hero.visible = false;
  library.visible = true;
  gsap.to(library, { dim: 1, reveal: 1, duration: 0.7 });
  cam.freeLook = 1;
  cam.parallax = 0.1;
  returnHome();
}

/** Сцена за читалкой: зал на месте, но не рисуется лишний раз. */
export function settleBehindReader(): void {
  rt.hero.visible = false;
  rt.library.visible = true;
  rt.library.dim = 0.7;
  rt.library.reveal = 1;
  rt.cam.freeLook = 0;
  rt.cam.parallax = 0;
}
