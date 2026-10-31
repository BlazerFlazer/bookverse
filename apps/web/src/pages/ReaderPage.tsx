import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { invalidate } from '@react-three/fiber';
import { blockAt, pageForPosition, type Page } from '@bookverse/reading-engine';
import type { BlockDto, BookDetailDto, BookmarkDto, BookProgressDto, ChapterContentDto, CheckpointResultDto, GameEventDto, HighlightDto, PreferenceDto } from '@bookverse/shared';
import { FlatJourney } from '../journey/FlatJourney.tsx';
import { biomeAt } from '../journey/biomes.ts';
import { api, ApiError } from '../lib/api.ts';
import { useBook } from '../lib/queries.ts';
import { playPageTurn } from '../lib/sound.ts';
import { DictionaryPanel, type WordTarget } from '../reader/DictionaryPanel.tsx';
import { computeSpread } from '../reader/layout.ts';
import { ListenPanel } from '../reader/ListenPanel.tsx';
import { PageBody } from '../reader/PageBody.tsx';
import { PageLeaf } from '../reader/PageLeaf.tsx';
import { layoutChapter } from '../reader/paginator.ts';
import { QuizPanel } from '../reader/QuizPanel.tsx';
import { useReaderSettings } from '../reader/store.ts';
import { ThemePanel } from '../reader/ThemePanel.tsx';
import { TocPanel } from '../reader/TocPanel.tsx';
import { useSpeech } from '../reader/useSpeech.ts';
import { showGameEvent, toast } from '../stores/toasts.ts';
import { useWorld } from '../stores/world.ts';
import { WebGLBoundary } from '../ui/WebGLBoundary.tsx';
import { IconBookmark, IconChevronLeft, IconChevronRight, IconExpand, IconFeather, IconHeadphones, IconHighlight, IconHome, IconList, IconPalette, IconQuote } from '../ui/Icons.tsx';
import { leaveReader, settleBehindReader, stageBackdrop } from '../world/director.ts';

const JourneyTrack = lazy(() => import('../journey/JourneyTrack.tsx').then((m) => ({ default: m.JourneyTrack })));

type Panel = 'theme' | 'toc' | 'listen' | 'quiz' | null;

interface Turn {
  key: number;
  direction: 'next' | 'prev';
  from: number;
  to: number;
}

interface Selected {
  blockKey: string;
  text: string;
  start: number;
  end: number;
  rect: DOMRect;
  highlightId: string | null;
}

const FONT_FAMILIES: Record<string, string> = {
  literata: '"Literata Variable", Georgia, serif',
  oldstandard: '"Old Standard TT", Georgia, serif',
  cormorant: '"Cormorant Garamond", Georgia, serif',
  manrope: '"Manrope Variable", system-ui, sans-serif',
  nunito: '"Nunito Variable", system-ui, sans-serif',
};

function useViewport() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export function ReaderPage() {
  const { publicId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const setStage = useWorld((s) => s.setStage);
  const setFlying = useWorld((s) => s.setFlying);
  const worldReduced = useWorld((s) => s.reducedMotion);
  const webgl = useWorld((s) => s.webgl);
  const settings = useReaderSettings((s) => s.settings);
  const hydrate = useReaderSettings((s) => s.hydrate);

  const { data: book, error: bookError } = useBook(publicId);
  const code = book?.publicId ?? publicId;

  const viewport = useViewport();
  const spread = useMemo(() => computeSpread(viewport.width, viewport.height, settings.pageWidth), [viewport, settings.pageWidth]);
  const step = spread.twoPages ? 2 : 1;

  const [order, setOrder] = useState<number | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [panel, setPanel] = useState<Panel>(() => (params.get('listen') ? 'listen' : null));
  const [wordTarget, setWordTarget] = useState<WordTarget | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [progress, setProgress] = useState<BookProgressDto | null>(null);
  const [completed, setCompleted] = useState<number[]>([]);
  const [celebrate, setCelebrate] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [fontsTick, setFontsTick] = useState(0);
  const [shown, setShown] = useState(false);
  const [journeyOn, setJourneyOn] = useState(false);

  const measure = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const turnCounter = useRef(0);
  const touchX = useRef<number | null>(null);
  const anchorRef = useRef<{ key: string; offset: number } | null>(null);

  const { data: chapter } = useQuery({
    queryKey: ['chapter', code, order],
    queryFn: () => api<ChapterContentDto>(`/books/${code}/chapters/${order}`),
    enabled: order !== null && Boolean(book),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { data: annotations } = useQuery({
    queryKey: ['annotations', code],
    queryFn: () => api<{ bookmarks: BookmarkDto[]; highlights: HighlightDto[] }>(`/books/${code}/annotations`),
    enabled: Boolean(book),
  });

  // Открытие книги и начальная позиция: ссылка важнее сохранённого места.
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    void (async () => {
      const opened = await api<{ game: GameEventDto }>(`/books/${book.publicId}/open`, { method: 'POST', body: {} }).catch(() => null);
      if (opened) showGameEvent(opened.game);
      void client.invalidateQueries({ queryKey: ['me'] });
      const saved = await api<{ progress: BookProgressDto | null; completedChapters: number[] }>(`/books/${book.publicId}/progress`).catch(() => null);
      const preferences = await api<PreferenceDto>(`/preferences?publicId=${book.publicId}`).catch(() => null);
      if (cancelled) return;
      if (preferences?.book) hydrate(preferences.book, true);
      else if (preferences?.global) hydrate(preferences.global, false);
      setProgress(saved?.progress ?? null);
      setCompleted(saved?.completedChapters ?? []);

      const blockParam = params.get('b');
      const fromLink = blockParam?.match(/^c(\d+)-/)?.[1];
      if (blockParam && fromLink) {
        anchorRef.current = { key: blockParam, offset: Number(params.get('o') ?? 0) };
        setOrder(Number(fromLink));
      } else if (saved?.progress?.blockKey) {
        position.current = saved.progress.canonicalPos;
        setOrder(saved.progress.chapterOrder);
      } else {
        setOrder(1);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Загружается один раз на книгу; параметры ссылки читаются только при входе.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.publicId]);

  useEffect(() => {
    if (!chapter) return;
    const anchor = anchorRef.current;
    if (anchor) {
      const block = chapter.blocks.find((b) => b.key === anchor.key);
      if (block) position.current = block.charStart + anchor.offset;
      anchorRef.current = null;
    }
    if (position.current < chapter.charStart) position.current = chapter.charStart;
  }, [chapter]);

  useEffect(() => {
    void document.fonts.ready.then(() => setFontsTick((t) => t + 1));
  }, [settings.fontId, settings.themeId]);

  // Переразбивка: любые изменения размеров текста заново считают страницы,
  // а позиция остаётся канонической, поэтому читатель не теряет место.
  useLayoutEffect(() => {
    if (!chapter || !measure.current) return;
    if (position.current < chapter.charStart) position.current = chapter.charStart;
    const next = layoutChapter(measure.current, chapter);
    setPages(next);
    const raw = pageForPosition(next, position.current);
    setPageIndex(step === 2 ? raw - (raw % 2) : raw);
    setTurn(null);
  }, [chapter, spread.pageWidth, spread.pageHeight, step, settings.fontScale, settings.lineHeight, settings.margin, settings.align, settings.fontId, settings.themeId, fontsTick]);

  // Читалка появилась: сцена уходит на задний план и больше не тратит GPU.
  useEffect(() => {
    if (pages.length === 0 || shown) return;
    setShown(true);
    setStage('reading');
  }, [pages.length, shown, setStage]);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => {
      settleBehindReader();
      setFlying(null);
      invalidate();
      // Мини-мир открывает свой WebGL-контекст: это тяжёлый момент, поэтому он идёт, когда всё уже замерло.
      setJourneyOn(true);
    }, 560);
    return () => clearTimeout(timer);
  }, [shown, setFlying]);

  useEffect(() => {
    // По прямой ссылке зал ещё не настроен: ставим камеру, как для страниц поверх зала.
    if (!location.state?.cinematic) stageBackdrop();
  }, [location.state]);

  const visible = useMemo(() => pages.slice(pageIndex, pageIndex + step), [pages, pageIndex, step]);

  const sendCheckpoint = useCallback(
    async (from: number, to: number, blockKey: string, offset: number, source: 'read' | 'audio') => {
      if (!book) return;
      try {
        const result = await api<CheckpointResultDto>(`/books/${book.publicId}/progress`, {
          method: 'POST',
          body: { blockKey, offset, visitFrom: from, visitTo: to, source },
        });
        setProgress((previous) => {
          if (result.progress.status === 'completed' && previous?.status !== 'completed') setCelebrate(true);
          return result.progress;
        });
        setCompleted(result.completedChapters);
        showGameEvent(result.game);
        if (result.game.xpGained > 0) void client.invalidateQueries({ queryKey: ['me'] });
      } catch {
        // Следующая отметка отправит ту же позицию: чтение не прерываем.
      }
    },
    [book, client],
  );

  // Страница считается увиденной, только если читатель задержался на ней.
  useEffect(() => {
    if (turn || visible.length === 0) return;
    const first = visible[0]!;
    const last = visible.at(-1)!;
    const slice = first.slices[0];
    if (!slice) return;
    position.current = first.canonicalStart;
    const timer = setTimeout(() => void sendCheckpoint(first.canonicalStart, last.canonicalEnd, slice.key, slice.start, 'read'), 1100);
    return () => clearTimeout(timer);
  }, [visible, turn, sendCheckpoint]);

  // Закрытая вкладка не должна терять позицию.
  useEffect(() => {
    const flush = () => {
      const first = visible[0];
      const slice = first?.slices[0];
      if (!book || !first || !slice) return;
      const body = JSON.stringify({ blockKey: slice.key, offset: slice.start, visitFrom: first.canonicalStart, visitTo: first.canonicalStart, source: 'read' });
      navigator.sendBeacon(`/api/books/${book.publicId}/progress`, new Blob([body], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [book, visible]);

  const animated = settings.pageTurn !== 'off' && !settings.reducedMotion && !worldReduced;

  const goChapter = useCallback(
    (nextOrder: number, where: 'start' | 'end' | number = 'start') => {
      const target = book?.chapters.find((c) => c.order === nextOrder);
      if (!target) return;
      setTurn(null);
      position.current = where === 'start' ? target.charStart : where === 'end' ? Number.MAX_SAFE_INTEGER : where;
      if (nextOrder === order) {
        const raw = pageForPosition(pages, position.current);
        setPageIndex(step === 2 ? raw - (raw % 2) : raw);
      } else {
        setPages([]);
        setOrder(nextOrder);
      }
    },
    [book, order, pages, step],
  );

  const flip = useCallback(
    (direction: 'next' | 'prev') => {
      if (turn || pages.length === 0 || order === null || !book) return;
      setWordTarget(null);
      setSelected(null);
      const to = pageIndex + (direction === 'next' ? step : -step);
      if (to < 0) {
        if (order > 1) goChapter(order - 1, 'end');
        return;
      }
      if (to >= pages.length) {
        if (order < book.chapters.length) goChapter(order + 1, 'start');
        else toast('Это конец книги', progress?.status === 'completed' ? undefined : 'Если какие-то главы пропущены, их можно открыть в оглавлении.');
        return;
      }
      if (!animated) {
        setPageIndex(to);
        return;
      }
      playPageTurn();
      turnCounter.current += 1;
      setTurn({ key: turnCounter.current, direction, from: pageIndex, to });
    },
    [turn, pages.length, order, book, pageIndex, step, animated, goChapter, progress?.status],
  );

  const finishTurn = useCallback(() => {
    setTurn((current) => {
      if (current) setPageIndex(current.to);
      return null;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, select, textarea, [role="dialog"]')) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        flip('next');
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        flip('prev');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flip]);

  // ---------- Озвучка ----------

  const language = book?.language ?? 'ru';
  const speech = useSpeech({
    language,
    onBlockStart: (block) => {
      setSpeakingKey(block.key);
      position.current = block.charStart;
      const raw = pageForPosition(pages, block.charStart);
      setPageIndex(step === 2 ? raw - (raw % 2) : raw);
    },
    onBlockDone: (block) => void sendCheckpoint(block.charStart, block.charStart + block.charLength, block.key, 0, 'audio'),
    onChapterEnd: () => {
      setSpeakingKey(null);
      if (book && order !== null && order < book.chapters.length) {
        pendingAudio.current = true;
        goChapter(order + 1, 'start');
      }
    },
  });
  const pendingAudio = useRef(false);

  const playFromHere = useCallback(() => {
    if (!chapter) return;
    const current = blockAt(chapter.blocks, position.current);
    speech.start(chapter.blocks, current ? chapter.blocks.indexOf(current) : 0);
  }, [chapter, speech]);

  useEffect(() => {
    if (pendingAudio.current && chapter) {
      pendingAudio.current = false;
      speech.start(chapter.blocks, 0);
    }
  }, [chapter, speech]);

  useEffect(() => {
    if (speech.state === 'idle') setSpeakingKey(null);
  }, [speech.state]);

  // ---------- Слова, выделения, закладки ----------

  const blocksByKey = useMemo(() => new Map<string, BlockDto>(chapter?.blocks.map((b) => [b.key, b]) ?? []), [chapter]);

  const onPageClick = (event: React.MouseEvent) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const word = (event.target as HTMLElement).closest<HTMLElement>('.w');
    if (!word) return;
    const key = word.closest<HTMLElement>('[data-block]')?.dataset.block;
    const block = key ? blocksByKey.get(key) : undefined;
    if (!key || !block) return;
    setSelected(null);
    setWordTarget({
      word: word.textContent ?? '',
      rect: word.getBoundingClientRect(),
      blockKey: key,
      offset: Number(word.dataset.o ?? 0),
      blockText: block.text,
    });
  };

  const onPointerUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelected(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.parentElement;
    const host = startElement?.closest<HTMLElement>('[data-block]');
    const key = host?.dataset.block;
    const block = key ? blocksByKey.get(key) : undefined;
    const text = selection.toString().trim();
    if (!key || !block || !text) return;
    const start = block.text.indexOf(text);
    setWordTarget(null);
    setSelected({
      blockKey: key,
      text,
      start,
      end: start < 0 ? -1 : start + text.length,
      rect: range.getBoundingClientRect(),
      highlightId: startElement?.closest<HTMLElement>('[data-highlight]')?.dataset.highlight ?? null,
    });
  };

  const addHighlight = useMutation({
    mutationFn: (input: Selected) => api(`/books/${code}/highlights`, { method: 'POST', body: { blockKey: input.blockKey, start: input.start, end: input.end, color: 'gold' } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['annotations', code] }),
    onError: (error) => toast('Не получилось выделить', error instanceof ApiError ? error.message : undefined, 'error'),
  });

  const removeHighlight = useMutation({
    mutationFn: (id: string) => api(`/highlights/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['annotations', code] }),
  });

  const addQuote = useMutation({
    mutationFn: (input: Selected) => api(`/books/${code}/quotes`, { method: 'POST', body: { blockKey: input.blockKey, text: input.text } }),
    onSuccess: () => toast('Цитата сохранена', 'Она появится в разделе «Моя библиотека»'),
  });

  const currentBookmark = useMemo(() => {
    if (!annotations || !chapter) return null;
    const first = visible[0];
    const last = visible.at(-1);
    if (!first || !last) return null;
    return (
      annotations.bookmarks.find((mark) => {
        const block = blocksByKey.get(mark.blockKey);
        if (!block) return false;
        const position = block.charStart + mark.offset;
        return position >= first.canonicalStart && position < last.canonicalEnd;
      }) ?? null
    );
  }, [annotations, chapter, visible, blocksByKey]);

  const toggleBookmark = useMutation({
    mutationFn: async () => {
      if (currentBookmark) {
        await api(`/bookmarks/${currentBookmark.id}`, { method: 'DELETE' });
        return;
      }
      const slice = visible[0]?.slices[0];
      const block = slice ? blocksByKey.get(slice.key) : undefined;
      if (!slice || !block) return;
      await api(`/books/${code}/bookmarks`, {
        method: 'POST',
        body: { blockKey: slice.key, offset: slice.start, snippet: block.text.slice(slice.start, slice.start + 90) },
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['annotations', code] }),
  });

  const exit = () => {
    speech.stop();
    leaveReader();
    setStage('library');
    void client.invalidateQueries({ queryKey: ['books'] });
    void navigate('/');
  };

  // ---------- Вывод ----------

  if (bookError) {
    return (
      <div className="reader-error">
        <h1 className="display">Такой книги нет</h1>
        <p>{bookError instanceof ApiError ? bookError.message : 'Не удалось открыть книгу.'}</p>
        <button type="button" className="btn btn-primary" onClick={() => void navigate('/')}>В библиотеку</button>
      </div>
    );
  }

  const percent = progress?.percent ?? 0;
  const journeyProps = (detail: BookDetailDto) => ({
    percent,
    chapters: detail.chapters,
    totalChars: detail.totalChars,
    completed,
    finished: progress?.status === 'completed',
  });
  const pageWidth = spread.pageWidth;
  const fontFamily = settings.fontId === 'auto' ? undefined : FONT_FAMILIES[settings.fontId];
  const chapterCount = book?.chapters.length ?? 0;

  const staticLeft = turn ? (turn.direction === 'next' ? turn.from : turn.to) : pageIndex;
  const staticRight = turn ? (turn.direction === 'next' ? turn.to + 1 : turn.from + 1) : pageIndex + 1;
  const single = !spread.twoPages;
  const singleBase = turn ? (turn.direction === 'next' ? turn.to : turn.from) : pageIndex;

  const body = (index: number, interactive: boolean) =>
    chapter && book ? (
      <PageBody
        page={pages[index]}
        index={index}
        chapter={chapter}
        bookTitle={book.title}
        interactive={interactive}
        highlights={annotations?.highlights}
        speakingKey={speakingKey}
      />
    ) : null;

  return (
    <div
      className={`rd-root ${shown ? 'is-shown' : ''}`}
      lang={book?.language ?? 'ru'}
      data-theme={settings.themeId}
      style={
        {
          '--rd-scale': settings.fontScale,
          '--rd-lh': settings.lineHeight,
          '--rd-margin': settings.margin,
          '--rd-align': settings.align,
          '--rd-brightness': settings.brightness,
          '--page-w': `${spread.pageWidth}px`,
          '--page-h': `${spread.pageHeight}px`,
          ...(fontFamily ? { '--rd-font': fontFamily } : {}),
        } as React.CSSProperties
      }
    >
      <header className="rd-bar">
        <button type="button" className="icon-btn" onClick={exit} aria-label="Выйти в библиотеку"><IconHome /></button>
        <div className="rd-bar-title">
          <span>{book?.title}</span>
          <span className="rd-bar-chapter">{chapter?.title}</span>
        </div>
        <div className="rd-bar-tools">
          <button type="button" className="icon-btn" aria-pressed={panel === 'toc'} onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="Оглавление"><IconList /></button>
          <button type="button" className="icon-btn" aria-pressed={Boolean(currentBookmark)} onClick={() => toggleBookmark.mutate()} aria-label={currentBookmark ? 'Убрать закладку' : 'Поставить закладку'}><IconBookmark fill={currentBookmark ? 'currentColor' : 'none'} /></button>
          <button type="button" className="icon-btn" aria-pressed={panel === 'listen'} onClick={() => setPanel(panel === 'listen' ? null : 'listen')} aria-label="Слушать книгу"><IconHeadphones /></button>
          {book?.hasQuizzes && (
            <button type="button" className="icon-btn" aria-pressed={panel === 'quiz'} onClick={() => setPanel(panel === 'quiz' ? null : 'quiz')} aria-label="Литературное задание"><IconFeather /></button>
          )}
          <button type="button" className="icon-btn" aria-pressed={panel === 'theme'} onClick={() => setPanel(panel === 'theme' ? null : 'theme')} aria-label="Оформление книги"><IconPalette /></button>
          <button
            type="button"
            className="icon-btn rd-hide-narrow"
            aria-label="Во весь экран"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen().catch(() => undefined);
            }}
          >
            <IconExpand />
          </button>
        </div>
      </header>

      <main
        className="rd-stage"
        style={{ left: spread.left, top: spread.top, width: spread.width, height: spread.height }}
        onTouchStart={(event) => {
          touchX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchX.current;
          const end = event.changedTouches[0]?.clientX;
          touchX.current = null;
          if (start === null || end === undefined || Math.abs(end - start) < 50) return;
          flip(end < start ? 'next' : 'prev');
        }}
      >
        <div className={`rd-book ${single ? 'is-single' : ''}`}>
          <div className="rd-edges rd-edges-right" aria-hidden="true" />
          {!single && <div className="rd-edges rd-edges-left" aria-hidden="true" />}

          {single ? (
            <section className="rd-page rd-page-right" onClick={onPageClick} onPointerUp={onPointerUp} aria-live="polite">
              {body(singleBase, !turn)}
            </section>
          ) : (
            <>
              <section className="rd-page rd-page-left" onClick={onPageClick} onPointerUp={onPointerUp}>{body(staticLeft, !turn)}</section>
              <section className="rd-page rd-page-right" onClick={onPageClick} onPointerUp={onPointerUp}>{body(staticRight, !turn)}</section>
            </>
          )}

          {turn && (
            <div className="rd-turn" style={{ left: single ? 0 : pageWidth, width: pageWidth }}>
              <PageLeaf
                key={turn.key}
                width={pageWidth}
                height={spread.pageHeight}
                direction={turn.direction}
                sweep={single ? 118 : 180}
                flexible={settings.pageTurn === 'full'}
                duration={settings.pageTurn === 'full' ? 0.72 : 0.5}
                onDone={finishTurn}
                front={<div className="rd-page rd-page-right rd-leaf-page">{body(single ? (turn.direction === 'next' ? turn.from : turn.to) : turn.direction === 'next' ? turn.from + 1 : turn.to + 1, false)}</div>}
                back={<div className="rd-page rd-page-left rd-leaf-page">{single ? null : body(turn.direction === 'next' ? turn.to : turn.from, false)}</div>}
              />
            </div>
          )}
        </div>

        <button type="button" className="rd-nav rd-nav-prev" onClick={() => flip('prev')} aria-label="Предыдущая страница"><IconChevronLeft /></button>
        <button type="button" className="rd-nav rd-nav-next" onClick={() => flip('next')} aria-label="Следующая страница"><IconChevronRight /></button>
      </main>

      {/* Скрытая копия страницы с теми же стилями: по ней считается разбивка */}
      <div className="rd-page rd-measure-host" aria-hidden="true" style={{ width: spread.pageWidth, height: spread.pageHeight }}>
        <p className="rd-running">&nbsp;</p>
        <div className="rd-page-inner" ref={measure} />
        <p className="rd-folio">&nbsp;</p>
      </div>

      <footer className="rd-journey" aria-label="Путешествие читателя">
        {book && journeyOn && (webgl ? (
          <WebGLBoundary fallback={<FlatJourney {...journeyProps(book)} />}>
            <Suspense fallback={null}>
              <JourneyTrack {...journeyProps(book)} />
            </Suspense>
          </WebGLBoundary>
        ) : (
          <FlatJourney {...journeyProps(book)} />
        ))}
        <div className="journey-info">
          <p className="journey-main" data-testid="journey-status">
            Глава {order ?? 1} из {chapterCount} — {Math.round(percent)}% прочитано
          </p>
          <p className="journey-sub">{biomeAt(percent)}{percent < 50 ? ' · впереди награда «На полпути»' : percent < 100 ? ' · финишные врата уже близко' : ''}</p>
        </div>
      </footer>

      <AnimatePresence>
        {panel === 'theme' && <ThemePanel key="theme" publicId={code} onClose={() => setPanel(null)} />}
        {panel === 'quiz' && order !== null && <QuizPanel key="quiz" publicId={code} chapterOrder={order} onClose={() => setPanel(null)} />}
        {panel === 'toc' && book && order !== null && (
          <TocPanel
            key="toc"
            book={book}
            currentOrder={order}
            completed={completed}
            bookmarks={annotations?.bookmarks ?? []}
            onChapter={(next) => {
              setPanel(null);
              goChapter(next);
            }}
            onBookmark={(mark) => {
              setPanel(null);
              anchorRef.current = { key: mark.blockKey, offset: mark.offset };
              if (mark.chapterOrder === order) {
                const block = blocksByKey.get(mark.blockKey);
                goChapter(order, block ? block.charStart + mark.offset : 'start');
                anchorRef.current = null;
              } else {
                setPages([]);
                setOrder(mark.chapterOrder);
              }
            }}
            onDeleteBookmark={(id) => void api(`/bookmarks/${id}`, { method: 'DELETE' }).then(() => client.invalidateQueries({ queryKey: ['annotations', code] }))}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'listen' && book && order !== null && (
          <ListenPanel key="listen" speech={speech} book={book} chapterOrder={order} language={language} onPlay={playFromHere} onChapter={(next) => { speech.stop(); goChapter(next); }} onClose={() => setPanel(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {wordTarget && book && (
          <DictionaryPanel key={`${wordTarget.blockKey}:${wordTarget.offset}`} target={wordTarget} publicId={book.publicId} language={book.language} onClose={() => setWordTarget(null)} />
        )}
      </AnimatePresence>

      {selected && (
        <div className="rd-selection" style={{ left: Math.min(window.innerWidth - 260, Math.max(8, selected.rect.left + selected.rect.width / 2 - 125)), top: Math.max(60, selected.rect.top - 52) }}>
          {selected.highlightId ? (
            <button type="button" onClick={() => { removeHighlight.mutate(selected.highlightId!); setSelected(null); }}><IconHighlight width={16} height={16} /> Снять</button>
          ) : (
            selected.start >= 0 && <button type="button" onClick={() => { addHighlight.mutate(selected); setSelected(null); window.getSelection()?.removeAllRanges(); }}><IconHighlight width={16} height={16} /> Выделить</button>
          )}
          <button type="button" onClick={() => { addQuote.mutate(selected); setSelected(null); window.getSelection()?.removeAllRanges(); }}><IconQuote width={16} height={16} /> В цитаты</button>
        </div>
      )}

      <AnimatePresence>
        {celebrate && book && (
          <motion.div className="rd-finish" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            <motion.div className="rd-finish-card" initial={{ y: 22, scale: 0.97 }} animate={{ y: 0, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 0.72, 0.18, 1] }}>
              <p className="eyebrow">Финишные врата открыты</p>
              <h2 className="display">Книга прочитана</h2>
              <p>«{book.title}» теперь стоит на вашей полке прочитанных книг.</p>
              <div className="rd-finish-actions">
                {book.hasQuizzes && <button type="button" className="btn btn-primary" onClick={() => { setCelebrate(false); setPanel('quiz'); }}>Пройти задание</button>}
                <button type="button" className="btn btn-ghost" onClick={() => setCelebrate(false)}>Закрыть</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
