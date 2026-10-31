export interface TextToken {
  kind: 'word' | 'gap';
  text: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*/gu;

/** Делит текст на слова и промежутки, сохраняя точные смещения в исходной строке. */
export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(WORD)) {
    const start = match.index;
    if (start > cursor) {
      tokens.push({ kind: 'gap', text: text.slice(cursor, start), start: cursor, end: start });
    }
    const end = start + match[0].length;
    tokens.push({ kind: 'word', text: match[0], start, end });
    cursor = end;
  }
  if (cursor < text.length) {
    tokens.push({ kind: 'gap', text: text.slice(cursor), start: cursor, end: text.length });
  }
  return tokens;
}

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** Границы предложения вокруг позиции: это контекст слова в «Моём словаре». */
export function sentenceAround(text: string, offset: number, maxLength = 220): string {
  const stops = /[.!?…]+[»"”)]*\s+/g;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(stops)) {
    const boundary = match.index + match[0].length;
    if (boundary <= offset) start = boundary;
    else {
      end = boundary;
      break;
    }
  }
  const sentence = text.slice(start, end).trim();
  if (sentence.length <= maxLength) return sentence;
  const center = Math.min(Math.max(offset - start, 0), sentence.length);
  const from = Math.max(0, center - maxLength / 2);
  return `…${sentence.slice(from, from + maxLength).trim()}…`;
}
