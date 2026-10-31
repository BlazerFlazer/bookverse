import { create } from 'zustand';
import { DEFAULT_READER_SETTINGS, type ReaderSettings, type ReaderThemeId } from '@bookverse/shared';
import { api } from '../lib/api.ts';

const STORAGE_KEY = 'bv.reader';

function load(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_READER_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettings>) } : DEFAULT_READER_SETTINGS;
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

interface ReaderSettingsState {
  settings: ReaderSettings;
  /** Настройки применяются только к этой книге. */
  perBook: boolean;
  update: (patch: Partial<ReaderSettings>) => void;
  hydrate: (settings: ReaderSettings, perBook: boolean) => void;
  setPerBook: (value: boolean) => void;
}

export const useReaderSettings = create<ReaderSettingsState>((set, get) => ({
  settings: load(),
  perBook: false,
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Без хранилища настройки просто живут до закрытия вкладки.
    }
  },
  hydrate: (settings, perBook) => set({ settings, perBook }),
  setPerBook: (perBook) => set({ perBook }),
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Сохраняет на сервер с задержкой: ползунок не порождает десятки запросов. */
export function scheduleSettingsSave(publicId: string): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { settings, perBook } = useReaderSettings.getState();
    void api('/preferences', { method: 'PUT', body: { settings, ...(perBook ? { publicId } : {}) } }).catch(() => undefined);
  }, 900);
}

export interface ThemeInfo {
  id: ReaderThemeId;
  name: string;
  note: string;
  page: string;
  ink: string;
  accent: string;
  surround: string;
}

export const THEMES: ThemeInfo[] = [
  { id: 'parchment', name: 'Классический пергамент', note: 'Тёплая слоновая кость и старое золото', page: '#f6ecd6', ink: '#3b2a1c', accent: '#a9772f', surround: '#1b130e' },
  { id: 'academia', name: 'Тёмная академия', note: 'Кремовые страницы, кожа и тёмное дерево', page: '#efe3cb', ink: '#2c211a', accent: '#7a2f3a', surround: '#17100d' },
  { id: 'midnight', name: 'Ночной читатель', note: 'Глубокий синий, мягкий белый текст', page: '#121a2b', ink: '#d7deea', accent: '#7fa3d6', surround: '#090d16' },
  { id: 'royal', name: 'Королевская библиотека', note: 'Изумруд, золото и орнаментальная рамка', page: '#f4eedb', ink: '#20332c', accent: '#2f6b57', surround: '#0d1f1a' },
  { id: 'minimal', name: 'Чистый белый', note: 'Редакторская типографика без украшений', page: '#fbfaf7', ink: '#1f1f1f', accent: '#555555', surround: '#d9d6cf' },
  { id: 'sunset', name: 'Тёплый закат', note: 'Персиковая бумага и янтарь для вечера', page: '#f8e4cf', ink: '#4a2c1c', accent: '#c56a2d', surround: '#2a1610' },
  { id: 'forest', name: 'Волшебный лес', note: 'Лесная зелень и ботанический орнамент', page: '#eff0dc', ink: '#26362a', accent: '#4e7a4f', surround: '#0f1d15' },
  { id: 'storybook', name: 'Книжка-сказка', note: 'Мягкие цвета и дружелюбный шрифт', page: '#fdf3e4', ink: '#44313f', accent: '#c4577a', surround: '#2b2140' },
];
