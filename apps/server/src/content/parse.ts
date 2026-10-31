import { countWords } from '@bookverse/reading-engine';
import type { BlockKind } from '@bookverse/shared';

export interface ParsedBlock {
  key: string;
  order: number;
  kind: BlockKind;
  text: string;
  charStart: number;
  charLength: number;
}

export interface ParsedChapter {
  order: number;
  title: string;
  charStart: number;
  charLength: number;
  wordCount: number;
  blocks: ParsedBlock[];
}

const ORNAMENT = '❦';
/** Стихи делятся на блоки примерно по строфам: якорь и озвучка работают с этими блоками. */
const MAX_VERSE_LINES = 8;
const VERSE_BREAK = /[.!?…:;]["»]?$/;

function splitVerse(lines: string[]): string[] {
  const stanzas: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    current.push(line);
    const ripe = current.length >= 4 && VERSE_BREAK.test(line);
    if (ripe || current.length >= MAX_VERSE_LINES) {
      stanzas.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length > 0) stanzas.push(current.join('\n'));
  return stanzas;
}

/**
 * Разбирает исходник книги (формат описан в content/README.md).
 * Ключи блоков зависят только от главы и порядкового номера, поэтому сохранённые
 * закладки переживают повторный импорт, пока текст абзацев не меняется.
 */
export function parseBook(source: string, fallbackTitle: string): ParsedChapter[] {
  const raw: { title: string; kinds: { kind: BlockKind; text: string }[] }[] = [];
  let chapter: (typeof raw)[number] | null = null;
  let verse: string[] = [];

  const currentChapter = () => {
    chapter ??= { title: fallbackTitle, kinds: [] };
    if (!raw.includes(chapter)) raw.push(chapter);
    return chapter;
  };
  const flushVerse = () => {
    if (verse.length === 0) return;
    const target = currentChapter();
    for (const stanza of splitVerse(verse)) target.kinds.push({ kind: 'verse', text: stanza });
    verse = [];
  };

  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const text = line.trim();
    if (text.startsWith('# ')) {
      flushVerse();
      chapter = { title: text.slice(2).trim(), kinds: [] };
      raw.push(chapter);
    } else if (text.startsWith('>')) {
      verse.push(text.slice(1).trim());
    } else if (!text) {
      flushVerse();
    } else if (text === '~') {
      flushVerse();
      currentChapter().kinds.push({ kind: 'ornament', text: ORNAMENT });
    } else {
      flushVerse();
      currentChapter().kinds.push({ kind: 'p', text });
    }
  }
  flushVerse();

  let position = 0;
  return raw.map((entry, chapterIndex) => {
    const order = chapterIndex + 1;
    const charStart = position;
    const blocks = entry.kinds.map(({ kind, text }, index): ParsedBlock => {
      const block: ParsedBlock = {
        key: `c${order}-p${String(index + 1).padStart(4, '0')}`,
        order: index + 1,
        kind,
        text,
        charStart: position,
        charLength: text.length,
      };
      position += text.length;
      return block;
    });
    return {
      order,
      title: entry.title,
      charStart,
      charLength: position - charStart,
      wordCount: blocks.reduce((sum, b) => sum + countWords(b.text), 0),
      blocks,
    };
  });
}
