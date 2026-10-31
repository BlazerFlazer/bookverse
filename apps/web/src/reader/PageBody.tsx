import { memo, useMemo } from 'react';
import { tokenize, type Page, type PageSlice } from '@bookverse/reading-engine';
import type { BlockDto, ChapterContentDto, HighlightDto } from '@bookverse/shared';
import { splitChapterTitle } from './paginator.ts';

interface SliceProps {
  block: BlockDto;
  slice: PageSlice;
  first: boolean;
  interactive: boolean;
  highlights: HighlightDto[];
  speaking: boolean;
}

/** Слова становятся кнопками только на странице, которая лежит ровно: на листе в полёте это лишний DOM. */
function SliceText({ block, slice, interactive, highlights }: Pick<SliceProps, 'block' | 'slice' | 'interactive' | 'highlights'>) {
  const text = block.text.slice(slice.start, slice.end);
  if (!interactive) return <>{text}</>;

  const marks = highlights.filter((h) => h.blockKey === block.key);
  const markAt = (offset: number) => marks.find((m) => offset >= m.start && offset < m.end);

  return (
    <>
      {tokenize(text).map((token) => {
        const offset = slice.start + token.start;
        const mark = markAt(offset);
        const inner =
          token.kind === 'word' ? (
            <span key={offset} className="w" data-o={offset}>
              {token.text}
            </span>
          ) : (
            token.text
          );
        if (!mark) return token.kind === 'word' ? inner : <span key={offset}>{inner}</span>;
        return (
          <mark key={offset} className={`rd-mark rd-mark-${mark.color}`} data-highlight={mark.id}>
            {inner}
          </mark>
        );
      })}
    </>
  );
}

function BlockSlice({ block, slice, first, interactive, highlights, speaking }: SliceProps) {
  const speakClass = speaking ? ' rd-speaking' : '';
  if (block.kind === 'ornament') return <p className="rd-ornament">{block.text}</p>;
  if (block.kind === 'verse') {
    return (
      <p className={`rd-verse${speakClass}`} data-block={block.key}>
        <SliceText block={block} slice={slice} interactive={interactive} highlights={highlights} />
      </p>
    );
  }
  const classes = ['rd-p'];
  if (slice.continuesFromPrevious) classes.push('rd-cont-from');
  if (slice.continuesOnNext) classes.push('rd-cont-to');
  if (first) classes.push('rd-first');
  return (
    <p className={classes.join(' ') + speakClass} data-block={block.key}>
      <SliceText block={block} slice={slice} interactive={interactive} highlights={highlights} />
    </p>
  );
}

export interface PageBodyProps {
  page: Page | undefined;
  index: number;
  chapter: ChapterContentDto;
  bookTitle: string;
  interactive: boolean;
  highlights?: HighlightDto[];
  speakingKey?: string | null;
}

export const PageBody = memo(function PageBody({ page, index, chapter, bookTitle, interactive, highlights = [], speakingKey }: PageBodyProps) {
  const byKey = useMemo(() => new Map(chapter.blocks.map((b) => [b.key, b])), [chapter]);
  const { eyebrow, main } = splitChapterTitle(chapter.title);
  const firstKey = useMemo(() => chapter.blocks.find((b) => b.kind === 'p')?.key, [chapter]);
  const odd = index % 2 === 1;

  if (!page) return <div className="rd-page-inner rd-blank" aria-hidden="true" />;

  return (
    <>
      <p className="rd-running" aria-hidden="true">{odd ? main : bookTitle}</p>
      <div className="rd-page-inner">
        {index === 0 && (
          <header className="rd-chapter">
            {eyebrow && <p className="rd-chapter-num">{eyebrow}</p>}
            <h1 className="rd-chapter-title">{main}</h1>
            <div className="rd-chapter-rule" />
          </header>
        )}
        {page.slices.map((slice) => {
          const block = byKey.get(slice.key)!;
          return (
            <BlockSlice
              key={`${slice.key}:${slice.start}`}
              block={block}
              slice={slice}
              first={slice.key === firstKey && slice.start === 0}
              interactive={interactive}
              highlights={highlights}
              speaking={speakingKey === slice.key}
            />
          );
        })}
      </div>
      <p className="rd-folio" aria-hidden="true">{index + 1}</p>
    </>
  );
});
