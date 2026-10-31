import { paginate, type Page, type PageSlice } from '@bookverse/reading-engine';
import type { BlockDto, ChapterContentDto } from '@bookverse/shared';

function sliceHtml(block: BlockDto, slice: PageSlice, first: boolean): string {
  const text = block.text
    .slice(slice.start, slice.end)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
  if (block.kind === 'ornament') return `<p class="rd-ornament">${text}</p>`;
  if (block.kind === 'verse') return `<p class="rd-verse">${text}</p>`;
  const classes = ['rd-p'];
  if (slice.continuesFromPrevious) classes.push('rd-cont-from');
  if (slice.continuesOnNext) classes.push('rd-cont-to');
  if (first) classes.push('rd-first');
  return `<p class="${classes.join(' ')}">${text}</p>`;
}

/** Заголовок главы занимает место на первой странице, поэтому участвует в замере. */
export function chapterHeadHtml(eyebrow: string | null, title: string): string {
  return `<header class="rd-chapter">${eyebrow ? `<p class="rd-chapter-num">${eyebrow}</p>` : ''}<h1 class="rd-chapter-title">${title}</h1><div class="rd-chapter-rule"></div></header>`;
}

export function splitChapterTitle(title: string): { eyebrow: string | null; main: string } {
  const match = title.match(/^((?:Глава|Chapter)\s+[^.]+)\.\s*(.+)$/);
  if (match) return { eyebrow: match[1]!, main: match[2]! };
  return { eyebrow: null, main: title };
}

/** Разбивает главу на страницы. Измеряет настоящую вёрстку в скрытом блоке с теми же стилями. */
export function layoutChapter(measure: HTMLElement, chapter: ChapterContentDto): Page[] {
  const byKey = new Map(chapter.blocks.map((b) => [b.key, b]));
  const { eyebrow, main } = splitChapterTitle(chapter.title);
  const head = chapterHeadHtml(eyebrow, main);
  const firstKey = chapter.blocks.find((b) => b.kind === 'p')?.key;

  const fits = (slices: readonly PageSlice[], pageIndex: number) => {
    measure.innerHTML =
      (pageIndex === 0 ? head : '') +
      slices.map((slice) => sliceHtml(byKey.get(slice.key)!, slice, slice.key === firstKey && slice.start === 0)).join('');
    return measure.scrollHeight <= measure.clientHeight + 1;
  };

  const pages = paginate(chapter.blocks, fits);
  measure.innerHTML = '';
  return pages;
}
