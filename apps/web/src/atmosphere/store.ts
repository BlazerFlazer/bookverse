import { create } from 'zustand';
import { atmosphereSettingsSchema, DEFAULT_ATMOSPHERE, phaseAt, positionForSettings } from '@bookverse/shared';
import type { AtmosphereSettings, DemoAtmosphereDto, EffectQuality, TimePhase } from '@bookverse/shared';
import { api } from '../lib/api.ts';
import { useWorld } from '../stores/world.ts';

const STORAGE_KEY = 'bv.atmosphere';
const SAVE_DELAY_MS = 600;

export type AudioState = 'off' | 'waiting' | 'playing' | 'unavailable';
export type SaveState = 'local' | 'saving' | 'saved' | 'failed';

interface AtmosphereState {
  settings: AtmosphereSettings;
  phase: TimePhase;
  audioState: AudioState;
  saveState: SaveState;
  panelOpen: boolean;
  /** Время суток из ссылки: действует до перезагрузки и не меняет настройки. */
  linkPhase: TimePhase | null;
  /** Что сейчас показывает ведущий. На время показа это важнее личных настроек. */
  demo: DemoAtmosphereDto | null;
  update: (patch: Partial<AtmosphereSettings>) => void;
  applyRemote: (settings: AtmosphereSettings) => void;
  setPanelOpen: (open: boolean) => void;
  setLinkPhase: (phase: TimePhase | null) => void;
  setDemo: (demo: DemoAtmosphereDto | null) => void;
}

function readStored(): AtmosphereSettings {
  const quality = useWorld.getState().qualitySetting;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = atmosphereSettingsSchema.safeParse({ ...DEFAULT_ATMOSPHERE, ...(raw ? (JSON.parse(raw) as object) : {}) });
    return { ...(parsed.success ? parsed.data : DEFAULT_ATMOSPHERE), effectsQuality: quality };
  } catch {
    return { ...DEFAULT_ATMOSPHERE, effectsQuality: quality };
  }
}

function writeStored(settings: AtmosphereSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Частный режим браузера: настройки просто не переживут перезагрузку.
  }
}

/** Смещение часового пояса: бот не видит часы браузера, а время суток должен называть верно. */
export const utcOffsetMinutes = () => -new Date().getTimezoneOffset();

let accountId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function pushToAccount(settings: AtmosphereSettings): Promise<void> {
  useAtmosphere.setState({ saveState: 'saving' });
  try {
    await api('/atmosphere', { method: 'PUT', body: { settings, utcOffsetMinutes: utcOffsetMinutes() } });
    useAtmosphere.setState({ saveState: 'saved' });
  } catch {
    useAtmosphere.setState({ saveState: 'failed' });
  }
}

const initial = readStored();

export const useAtmosphere = create<AtmosphereState>((set, get) => ({
  settings: initial,
  phase: phaseAt(positionForSettings(initial, Date.now(), utcOffsetMinutes())),
  audioState: initial.atmosphereAudioEnabled ? 'waiting' : 'off',
  saveState: 'local',
  panelOpen: false,
  linkPhase: null,
  demo: null,
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    writeStored(settings);
    if (patch.effectsQuality) useWorld.getState().setQuality(patch.effectsQuality as EffectQuality);
    if (!accountId) return;
    if (saveTimer) clearTimeout(saveTimer);
    set({ saveState: 'saving' });
    saveTimer = setTimeout(() => void pushToAccount(get().settings), SAVE_DELAY_MS);
  },
  applyRemote: (settings) => {
    set({ settings, saveState: 'saved' });
    writeStored(settings);
    if (settings.effectsQuality !== useWorld.getState().qualitySetting) useWorld.getState().setQuality(settings.effectsQuality);
  },
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setLinkPhase: (linkPhase) => set({ linkPhase }),
  setDemo: (demo) => set({ demo }),
}));

/**
 * Связывает настройки с аккаунтом. Если на сервере уже что-то сохранено, главный там;
 * иначе в аккаунт переносится то, что гость настроил в браузере.
 */
export async function syncAccount(userId: string | null): Promise<void> {
  if (userId === accountId) return;
  accountId = userId;
  if (!userId) {
    useAtmosphere.setState({ saveState: 'local' });
    return;
  }
  try {
    const { settings } = await api<{ settings: AtmosphereSettings | null }>('/atmosphere');
    if (accountId !== userId) return;
    if (settings) useAtmosphere.getState().applyRemote(settings);
    else await pushToAccount(useAtmosphere.getState().settings);
  } catch {
    useAtmosphere.setState({ saveState: 'failed' });
  }
}
