/**
 * Постраничная разбивка без привязки к DOM. Вся работа с браузером спрятана в `fits`,
 * поэтому алгоритм проверяется в тестах, а страницы хранят только срезы блоков:
 * смена шрифта пересчитывает срезы, а позиция читателя остаётся в канонических координатах.
 */
export interface PaginatedBlock {
  key: string;
  text: string;
  charStart: number;
}

export interface PageSlice {
  key: string;
  /** Смещения внутри блока. */
  start: number;
  end: number;
  continuesFromPrevious: boolean;
  continuesOnNext: boolean;
}

export interface Page {
  slices: PageSlice[];
  canonicalStart: number;
  canonicalEnd: number;
}

export type FitsFn = (slices: readonly PageSlice[], pageIndex: number) => boolean;

/** Возможные точки разрыва внутри блока: после пробелов и переводов строки. */
function breakPoints(text: string): number[] {
  const points: number[] = [];
  for (const match of text.matchAll(/\s+/g)) points.push(match.index + match[0].length);
  return points;
}

export function paginate(blocks: readonly PaginatedBlock[], fits: FitsFn): Page[] {
  const pages: Page[] = [];
  let current: PageSlice[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current.at(-1)!;
    const firstBlock = blocks.find((b) => b.key === first.key)!;
    const lastBlock = blocks.find((b) => b.key === last.key)!;
    pages.push({
      slices: current,
      canonicalStart: firstBlock.charStart + first.start,
      canonicalEnd: lastBlock.charStart + last.end,
    });
    current = [];
  };

  for (const block of blocks) {
    let start = 0;
    while (start < block.text.length || block.text.length === 0) {
      const whole: PageSlice = {
        key: block.key,
        start,
        end: block.text.length,
        continuesFromPrevious: start > 0,
        continuesOnNext: false,
      };
      if (fits([...current, whole], pages.length)) {
        current.push(whole);
        break;
      }

      // Блок целиком не помещается: бинарным поиском находим последнюю точку разрыва.
      const points = breakPoints(block.text).filter((p) => p > start && p < block.text.length);
      let low = 0;
      let high = points.length - 1;
      let best = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const slice: PageSlice = { ...whole, end: points[mid]!, continuesOnNext: true };
        if (fits([...current, slice], pages.length)) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (best >= 0) {
        const end = points[best]!;
        current.push({ ...whole, end, continuesOnNext: true });
        flush();
        start = end;
        continue;
      }

      if (current.length === 0) {
        // Ни слова не влезло на пустую страницу: ставим блок принудительно, иначе зациклимся.
        current.push(whole);
        break;
      }
      flush();
    }
    if (block.text.length === 0) continue;
  }
  flush();
  return pages;
}

/** Индекс страницы с канонической позицией. Так разворот восстанавливается после смены шрифта. */
export function pageForPosition(pages: readonly Page[], position: number): number {
  for (let i = 0; i < pages.length; i += 1) {
    if (position < pages[i]!.canonicalEnd) return i;
  }
  return Math.max(0, pages.length - 1);
}
