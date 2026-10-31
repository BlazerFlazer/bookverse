import { create } from 'zustand';
import type { BookSummaryDto } from '@bookverse/shared';
import { detectWebGL, prefersReducedMotion, resolveQuality, type QualityProfile, type QualitySetting } from '../lib/quality.ts';
import { setSoundEnabled } from '../lib/sound.ts';

/** intro: закрытая книга ждёт клика; library: зал; reading: зал за читалкой; chamber: комната входа. */
export type WorldStage = 'loading' | 'intro' | 'cinematic' | 'library' | 'transition' | 'reading' | 'chamber' | 'backdrop' | 'demo';

const STORAGE = {
  introSeen: 'bv.introSeen',
  quality: 'bv.quality',
  shortTransition: 'bv.shortTransition',
  sound: 'bv.sound',
  motion: 'bv.reducedMotion',
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Частный режим браузера: настройка просто не переживёт перезагрузку.
  }
}

interface WorldState {
  stage: WorldStage;
  webgl: boolean;
  qualitySetting: QualitySetting;
  quality: QualityProfile;
  reducedMotion: boolean;
  shortTransition: boolean;
  soundOn: boolean;
  loadProgress: number;
  loadLabel: string;
  /** Шейдеры сцены готовы. */
  sceneReady: boolean;
  introSeen: boolean;
  /** Книга, которая сейчас летит к читателю. */
  flying: BookSummaryDto | null;
  /** Книга, которую надо открыть при возврате в зал: победитель голосования. */
  pendingBook: string | null;
  setStage: (stage: WorldStage) => void;
  setLoad: (progress: number, label: string) => void;
  setSceneReady: () => void;
  markIntroSeen: () => void;
  replayIntro: () => void;
  setQuality: (setting: QualitySetting) => void;
  setShortTransition: (value: boolean) => void;
  setSound: (value: boolean) => void;
  setReducedMotion: (value: boolean | null) => void;
  setFlying: (book: BookSummaryDto | null) => void;
  setPendingBook: (publicId: string | null) => void;
}

const storedQuality = (read(STORAGE.quality) as QualitySetting | null) ?? 'auto';
const storedMotion = read(STORAGE.motion);
const soundOn = read(STORAGE.sound) !== 'off';
setSoundEnabled(soundOn);

export const useWorld = create<WorldState>((set) => ({
  stage: 'loading',
  webgl: detectWebGL(),
  qualitySetting: storedQuality,
  quality: resolveQuality(storedQuality),
  reducedMotion: storedMotion === null ? prefersReducedMotion() : storedMotion === 'on',
  shortTransition: read(STORAGE.shortTransition) === 'on',
  soundOn,
  loadProgress: 0,
  loadLabel: 'Открываем двери библиотеки',
  sceneReady: false,
  introSeen: read(STORAGE.introSeen) === '1',
  flying: null,
  pendingBook: null,
  setStage: (stage) => set({ stage }),
  setLoad: (loadProgress, loadLabel) => set({ loadProgress, loadLabel }),
  setSceneReady: () => set({ sceneReady: true }),
  markIntroSeen: () => {
    write(STORAGE.introSeen, '1');
    set({ introSeen: true });
  },
  replayIntro: () => {
    write(STORAGE.introSeen, null);
    set({ introSeen: false, stage: 'intro' });
  },
  setQuality: (setting) => {
    write(STORAGE.quality, setting);
    set({ qualitySetting: setting, quality: resolveQuality(setting) });
  },
  setShortTransition: (value) => {
    write(STORAGE.shortTransition, value ? 'on' : 'off');
    set({ shortTransition: value });
  },
  setSound: (value) => {
    write(STORAGE.sound, value ? 'on' : 'off');
    setSoundEnabled(value);
    set({ soundOn: value });
  },
  setReducedMotion: (value) => {
    write(STORAGE.motion, value === null ? null : value ? 'on' : 'off');
    set({ reducedMotion: value ?? prefersReducedMotion() });
  },
  setFlying: (flying) => set({ flying }),
  setPendingBook: (pendingBook) => set({ pendingBook }),
}));
