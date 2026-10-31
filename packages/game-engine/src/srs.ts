export type Rating = 'forgot' | 'almost' | 'know';

/** Интервалы коробок Лейтнера в днях. Коробка 5 и выше означает, что слово выучено. */
export const BOX_INTERVAL_DAYS = [0.02, 1, 3, 7, 14, 30, 60] as const;
export const MASTERED_BOX = 5;

const DAY_MS = 86_400_000;

export interface SrsState {
  box: number;
  mastery: 'new' | 'learning' | 'mastered';
  nextReviewAt: Date;
  lapses: number;
}

export function initialSrs(now: Date): SrsState {
  return { box: 0, mastery: 'new', nextReviewAt: now, lapses: 0 };
}

export function scheduleReview(state: Pick<SrsState, 'box' | 'lapses'>, rating: Rating, now: Date): SrsState {
  const top = BOX_INTERVAL_DAYS.length - 1;
  let box = state.box;
  let lapses = state.lapses;
  if (rating === 'know') box = Math.min(top, box + 1);
  else if (rating === 'forgot') {
    box = 0;
    lapses += 1;
  }
  // «Почти помню» оставляет слово в той же коробке, но возвращает его вдвое раньше.
  const days = BOX_INTERVAL_DAYS[box]! * (rating === 'almost' ? 0.5 : 1);
  return {
    box,
    lapses,
    mastery: box >= MASTERED_BOX ? 'mastered' : 'learning',
    nextReviewAt: new Date(now.getTime() + days * DAY_MS),
  };
}
