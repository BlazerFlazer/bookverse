/**
 * Единая модель позиции. Чтение и озвучка пишут в одну координату: смещение символа
 * от начала всей книги. Поэтому смена шрифта или темы не сдвигает закладки и прогресс,
 * а аудио двигает бегуна на дорожке так же, как чтение.
 */
export interface BlockRef {
  key: string;
  charStart: number;
  charLength: number;
}

export interface ChapterRef {
  order: number;
  charStart: number;
  charLength: number;
}

export type Range = [from: number, to: number];

export function toCanonical(block: BlockRef, offset: number): number {
  return block.charStart + Math.min(Math.max(offset, 0), block.charLength);
}

/** Блок, в котором лежит каноническая позиция. Ожидает блоки по порядку. */
export function blockAt<T extends BlockRef>(blocks: readonly T[], position: number): T | null {
  if (blocks.length === 0) return null;
  let low = 0;
  let high = blocks.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (blocks[mid]!.charStart <= position) low = mid;
    else high = mid - 1;
  }
  return blocks[low]!;
}

/** Нормализует набор отрезков: сортирует и склеивает пересекающиеся и соседние. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter(([a, b]) => b > a).map(([a, b]): Range => [a, b]);
  sorted.sort((x, y) => x[0] - y[0]);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

export function addRange(ranges: readonly Range[], range: Range): Range[] {
  return mergeRanges([...ranges, range]);
}

export function coveredLength(ranges: readonly Range[]): number {
  return ranges.reduce((sum, [a, b]) => sum + (b - a), 0);
}

/** Сколько символов отрезка [from, to) покрыто. */
export function coverageWithin(ranges: readonly Range[], from: number, to: number): number {
  let total = 0;
  for (const [a, b] of ranges) {
    const left = Math.max(a, from);
    const right = Math.min(b, to);
    if (right > left) total += right - left;
  }
  return total;
}

/** Глава считается прочитанной, когда просмотрено не меньше этой доли её текста. */
export const CHAPTER_DONE_RATIO = 0.85;

export function completedChapters(chapters: readonly ChapterRef[], ranges: readonly Range[]): number[] {
  return chapters
    .filter((c) => {
      if (c.charLength === 0) return false;
      const covered = coverageWithin(ranges, c.charStart, c.charStart + c.charLength);
      return covered / c.charLength >= CHAPTER_DONE_RATIO;
    })
    .map((c) => c.order);
}

export function percentOf(ranges: readonly Range[], totalChars: number): number {
  if (totalChars <= 0) return 0;
  return Math.min(100, Math.round((coveredLength(ranges) / totalChars) * 1000) / 10);
}

/**
 * Лимит скорости зачёта. Это не проверка понимания, а защита от накрутки: приложение
 * оценивает вовлечённость и не может доказать, что страница действительно прочитана.
 * Ведро пополняется с запасом, чтобы быстро читающий человек не упирался в потолок.
 */
export const CREDIT_PER_SECOND = 400;
export const CREDIT_CAPACITY = 9000;

export interface CreditState {
  tokens: number;
  at: number;
}

export function refillCredit(state: CreditState, now: number): CreditState {
  const elapsed = Math.max(0, now - state.at) / 1000;
  return { tokens: Math.min(CREDIT_CAPACITY, state.tokens + elapsed * CREDIT_PER_SECOND), at: now };
}

/** Зачитывает новый отрезок целиком или обрезает его по остатку кредита. */
export function creditVisit(
  ranges: readonly Range[],
  visit: Range,
  state: CreditState,
  now: number,
): { ranges: Range[]; state: CreditState; credited: number } {
  const refilled = refillCredit(state, now);
  const [from, to] = visit;
  const fresh = to - from - coverageWithin(ranges, from, to);
  if (fresh <= 0) return { ranges: [...ranges], state: refilled, credited: 0 };
  const credited = Math.min(fresh, Math.floor(refilled.tokens));
  if (credited <= 0) return { ranges: [...ranges], state: refilled, credited: 0 };
  const end = credited === fresh ? to : from + credited;
  return {
    ranges: addRange(ranges, [from, end]),
    state: { tokens: refilled.tokens - credited, at: now },
    credited,
  };
}
