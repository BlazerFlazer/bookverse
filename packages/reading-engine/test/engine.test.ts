import { describe, expect, it } from 'vitest';
import {
  blockAt,
  completedChapters,
  coveredLength,
  creditVisit,
  CREDIT_CAPACITY,
  mergeRanges,
  pageForPosition,
  paginate,
  percentOf,
  sentenceAround,
  tokenize,
  type Page,
  type PageSlice,
  type PaginatedBlock,
  type Range,
} from '../src/index.ts';

describe('tokenize', () => {
  it('сохраняет точные смещения и восстанавливает исходный текст', () => {
    const text = 'Молодая рыжая собака — помесь такса с дворняжкой!';
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.text).join('')).toBe(text);
    const word = tokens.find((t) => t.text === 'дворняжкой')!;
    expect(text.slice(word.start, word.end)).toBe('дворняжкой');
  });

  it('считает слова с дефисом и апострофом одним токеном', () => {
    const words = tokenize('какую-то Alice’s rabbit-hole').filter((t) => t.kind === 'word');
    expect(words.map((t) => t.text)).toEqual(['какую-то', 'Alice’s', 'rabbit-hole']);
  });
});

describe('sentenceAround', () => {
  it('возвращает предложение, в котором стоит слово', () => {
    const text = 'Первое предложение. Второе про собаку! Третье.';
    expect(sentenceAround(text, text.indexOf('собаку'))).toBe('Второе про собаку!');
  });
});

describe('позиция и покрытие', () => {
  it('склеивает пересекающиеся отрезки', () => {
    expect(mergeRanges([[10, 20], [0, 5], [15, 30], [5, 6]])).toEqual([[0, 6], [10, 30]]);
  });

  it('находит блок по канонической позиции', () => {
    const blocks = [
      { key: 'a', charStart: 0, charLength: 10 },
      { key: 'b', charStart: 10, charLength: 5 },
      { key: 'c', charStart: 15, charLength: 7 },
    ];
    expect(blockAt(blocks, 0)?.key).toBe('a');
    expect(blockAt(blocks, 12)?.key).toBe('b');
    expect(blockAt(blocks, 21)?.key).toBe('c');
  });

  it('считает главу прочитанной только при 85% покрытия', () => {
    const chapters = [{ order: 1, charStart: 0, charLength: 100 }];
    expect(completedChapters(chapters, [[0, 84]])).toEqual([]);
    expect(completedChapters(chapters, [[0, 85]])).toEqual([1]);
  });

  it('процент считает только увиденный текст, а не текущую позицию', () => {
    expect(percentOf([[900, 1000]], 1000)).toBe(10);
  });
});

describe('лимит скорости', () => {
  const now = 1_000_000;
  const full = { tokens: CREDIT_CAPACITY, at: now };

  it('засчитывает обычную страницу целиком', () => {
    const result = creditVisit([], [0, 2000], full, now);
    expect(result.credited).toBe(2000);
    expect(coveredLength(result.ranges)).toBe(2000);
  });

  it('не даёт кредита за уже прочитанное', () => {
    const result = creditVisit([[0, 2000]], [0, 2000], full, now);
    expect(result.credited).toBe(0);
    expect(result.state.tokens).toBe(CREDIT_CAPACITY);
  });

  it('обрезает зачёт, когда кредит кончился', () => {
    const result = creditVisit([], [0, 5000], { tokens: 1000, at: now }, now);
    expect(result.credited).toBe(1000);
    expect(result.ranges).toEqual([[0, 1000]]);
  });

  it('не позволяет отметить книгу мгновенной серией запросов', () => {
    let ranges: Range[] = [];
    let state = full;
    for (let start = 0; start < 100_000; start += 3000) {
      const step = creditVisit(ranges, [start, start + 3000], state, now);
      ranges = step.ranges;
      state = step.state;
    }
    expect(coveredLength(ranges)).toBe(CREDIT_CAPACITY);
  });
});

function blocks(count: number, length: number): PaginatedBlock[] {
  const list: PaginatedBlock[] = [];
  let position = 0;
  for (let i = 0; i < count; i += 1) {
    const text = 'слово '.repeat(length / 6).trimEnd();
    list.push({ key: `b${i}`, text, charStart: position });
    position += text.length;
  }
  return list;
}

const fitsChars = (limit: number) => (slices: readonly PageSlice[]) => slices.reduce((sum, s) => sum + s.end - s.start, 0) <= limit;

describe('разбивка на страницы', () => {
  it('раскладывает весь текст без потерь и повторов', () => {
    const source = blocks(12, 600);
    const pages = paginate(source, fitsChars(900));
    const total = pages.flatMap((p) => p.slices).reduce((sum, s) => sum + s.end - s.start, 0);
    expect(total).toBe(source.reduce((sum, b) => sum + b.text.length, 0));
    for (let i = 1; i < pages.length; i += 1) expect(pages[i]!.canonicalStart).toBe(pages[i - 1]!.canonicalEnd);
  });

  it('рвёт длинный абзац только между словами', () => {
    const [block] = blocks(1, 3000);
    const pages = paginate([block!], fitsChars(1000));
    expect(pages.length).toBeGreaterThan(1);
    for (const slice of pages.flatMap((p) => p.slices)) {
      if (slice.continuesOnNext) expect(block!.text[slice.end - 1]).toBe(' ');
    }
    expect(pages[0]!.slices[0]!.continuesOnNext).toBe(true);
    expect(pages[1]!.slices[0]!.continuesFromPrevious).toBe(true);
  });

  it('не зацикливается, если блок не помещается совсем', () => {
    const pages = paginate(blocks(2, 300), () => false);
    expect(pages).toHaveLength(2);
  });

  it('сохраняет место читателя при смене размера шрифта', () => {
    const source = blocks(20, 500);
    const large: Page[] = paginate(source, fitsChars(600));
    const small: Page[] = paginate(source, fitsChars(1500));
    const position = large[11]!.canonicalStart + 40;
    const page = small[pageForPosition(small, position)]!;
    expect(position).toBeGreaterThanOrEqual(page.canonicalStart);
    expect(position).toBeLessThan(page.canonicalEnd);
  });
});
