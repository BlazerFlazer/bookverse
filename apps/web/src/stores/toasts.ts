import { create } from 'zustand';
import type { GameEventDto } from '@bookverse/shared';
import { playChime } from '../lib/sound.ts';

export interface Toast {
  id: number;
  kind: 'achievement' | 'level' | 'info' | 'error';
  title: string;
  body?: string;
  icon?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let counter = 0;
const LIFETIME_MS = 5200;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    counter += 1;
    const id = counter;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }));
    setTimeout(() => get().dismiss(id), LIFETIME_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (title: string, body?: string, kind: Toast['kind'] = 'info') => useToasts.getState().push({ kind, title, body });

/** Одно и то же событие приходит и в ответе запроса, и по сокету: показываем его один раз. */
const recent = new Set<string>();

function once(key: string): boolean {
  if (recent.has(key)) return false;
  recent.add(key);
  setTimeout(() => recent.delete(key), 8000);
  return true;
}

export function showGameEvent(event: GameEventDto): void {
  const { push } = useToasts.getState();
  for (const achievement of event.achievements) {
    if (!once(`a:${achievement.code}`)) continue;
    playChime();
    push({ kind: 'achievement', title: achievement.title, body: achievement.description, icon: achievement.icon });
  }
  if (event.levelUp && once(`l:${event.levelUp.level}`)) {
    push({ kind: 'level', title: `Уровень ${event.levelUp.level}`, body: event.levelUp.rank, icon: '⭐' });
  }
}
