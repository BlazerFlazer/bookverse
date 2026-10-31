export const RANKS = [
  { title: 'Новичок', fromLevel: 1 },
  { title: 'Искатель историй', fromLevel: 3 },
  { title: 'Книжный исследователь', fromLevel: 6 },
  { title: 'Хранитель знаний', fromLevel: 10 },
  { title: 'Мастер литературы', fromLevel: 15 },
  { title: 'Легенда BOOKVERSE', fromLevel: 22 },
] as const;

/** XP на переход с уровня n на n + 1. Рост плавный, чтобы ранние уровни давались легко. */
export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 40;
}

export function levelFromXp(xp: number): { level: number; xpIntoLevel: number; xpForLevel: number } {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return { level, xpIntoLevel: remaining, xpForLevel: xpForLevel(level) };
}

export function rankForLevel(level: number): string {
  let current: string = RANKS[0].title;
  for (const rank of RANKS) if (level >= rank.fromLevel) current = rank.title;
  return current;
}

export function nextRank(level: number): string | null {
  return RANKS.find((rank) => rank.fromLevel > level)?.title ?? null;
}
