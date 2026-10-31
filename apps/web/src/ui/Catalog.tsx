import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { normalizeBookId, type BookSummaryDto } from '@bookverse/shared';
import { useCatalog, useBook } from '../lib/queries.ts';
import { coverPreview } from '../world/assets.ts';
import { IconCheck, IconClose, IconCopy, IconInfo, IconSearch } from './Icons.tsx';

const SHELVES = [
  { id: 'all', label: 'Все книги' },
  { id: 'featured', label: 'Рекомендуем' },
  { id: 'continue', label: 'Продолжить' },
  { id: 'discover', label: 'Новые открытия' },
  { id: 'completed', label: 'Прочитанные' },
];

const LANGUAGE_LABEL = { ru: 'Русский', en: 'English' } as const;

function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export function BookCover({ book, width = 220, className = '' }: { book: BookSummaryDto; width?: number; className?: string }) {
  const src = useMemo(() => coverPreview(book, width), [book, width]);
  return <img src={src} alt="" className={`book-cover ${className}`} draggable={false} />;
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="code-button"
      aria-label={`Скопировать код ${code}`}
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <span className="book-code">{code}</span>
      {copied ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
    </button>
  );
}

function BookDetails({ publicId, onClose, onRead }: { publicId: string; onClose: () => void; onRead: (book: BookSummaryDto) => void }) {
  const { data: book, isLoading } = useBook(publicId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <motion.aside
      ref={ref}
      tabIndex={-1}
      className="book-details glass scroll-area"
      role="dialog"
      aria-label={book?.title ?? 'Книга'}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.34, ease: [0.22, 0.72, 0.18, 1] }}
    >
      <button type="button" className="icon-btn details-close" onClick={onClose} aria-label="Закрыть">
        <IconClose />
      </button>
      {isLoading || !book ? (
        <p className="text-sm" style={{ color: 'var(--text-soft)' }}>Открываем карточку…</p>
      ) : (
        <>
          <div className="details-head">
            <BookCover book={book} width={280} className="details-cover" />
            <div>
              <p className="eyebrow">{book.genre}</p>
              <h2 className="display details-title">{book.title}</h2>
              <p className="details-author">{book.author}</p>
              <CopyCode code={book.publicId} />
            </div>
          </div>
          <p className="details-text">{book.description}</p>
          <dl className="details-meta">
            <div><dt>Язык</dt><dd>{LANGUAGE_LABEL[book.language]}</dd></div>
            <div><dt>Объём</dt><dd>{book.totalWords.toLocaleString('ru-RU')} слов, ≈ {formatLength(book.estMinutes)}</dd></div>
            <div><dt>Глав</dt><dd>{book.chapterCount}</dd></div>
            <div><dt>Возраст</dt><dd>{book.ageBand}</dd></div>
            {book.year && <div><dt>Год</dt><dd>{book.year}</dd></div>}
            <div><dt>Озвучка</dt><dd>Голос браузера{book.narration.recordings > 0 ? `, записей: ${book.narration.recordings}` : ''}</dd></div>
          </dl>
          <button type="button" className="btn btn-primary details-read" onClick={() => onRead(book)}>
            {book.progress ? 'Продолжить чтение' : 'Открыть книгу'}
          </button>
          <div className="details-license">
            <p className="eyebrow">{book.license.title}</p>
            <p>{book.license.jurisdictionNote}</p>
            <p>
              Источник:{' '}
              {book.license.sourceUrl ? (
                <a href={book.license.sourceUrl} target="_blank" rel="noreferrer">{book.license.sourceName}</a>
              ) : (
                book.license.sourceName
              )}
            </p>
          </div>
        </>
      )}
    </motion.aside>
  );
}

function BookCard({ book, onRead, onDetails }: { book: BookSummaryDto; onRead: (book: BookSummaryDto) => void; onDetails: (id: string) => void }) {
  const percent = book.progress?.percent ?? 0;
  return (
    <article className="book-card">
      <button type="button" className="book-card-main" onClick={() => onRead(book)} aria-label={`Открыть книгу «${book.title}», ${book.author}`}>
        <BookCover book={book} />
        <span className="book-card-text">
          <span className="book-card-title">{book.title}</span>
          <span className="book-card-author">{book.author}</span>
          <span className="book-card-meta">
            {book.genre} · {LANGUAGE_LABEL[book.language]} · {formatLength(book.estMinutes)}
          </span>
          {book.progress && (
            <span className="progress-track" role="progressbar" aria-valuenow={percent} aria-label="Прочитано">
              <span className="progress-fill block" style={{ width: `${percent}%` }} />
            </span>
          )}
        </span>
      </button>
      <div className="book-card-foot">
        <span className="book-code">{book.publicId}</span>
        <button type="button" className="book-card-info" onClick={() => onDetails(book.publicId)} aria-label={`О книге «${book.title}»`}>
          <IconInfo width={16} height={16} />
        </button>
      </div>
    </article>
  );
}

export function Catalog({ onRead, expanded, onToggle }: { onRead: (book: BookSummaryDto) => void; expanded: boolean; onToggle: () => void }) {
  const [shelf, setShelf] = useState('all');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [genre, setGenre] = useState('');
  const [language, setLanguage] = useState('');
  const [details, setDetails] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 240);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isError, refetch } = useCatalog({ q: debounced, shelf, genre, language });
  const books = data?.books ?? [];
  const isCode = Boolean(normalizeBookId(debounced));

  return (
    <>
      <section className={`catalog ${expanded ? 'is-open' : ''}`} aria-label="Каталог книг">
        <div className="catalog-bar">
          <button type="button" className="catalog-toggle" onClick={onToggle} aria-expanded={expanded}>
            <span className="catalog-chevron" aria-hidden="true" />
            Каталог
          </button>
          <label className="search">
            <IconSearch width={17} height={17} />
            <span className="sr-only">Поиск по названию, автору, жанру или коду</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, автор или код BV-000002" />
          </label>
          <div className="catalog-shelves" role="group" aria-label="Полки">
            {SHELVES.map((item) => (
              <button key={item.id} type="button" className="chip" aria-pressed={shelf === item.id} onClick={() => setShelf(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="catalog-filters">
            <select className="select" value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="Жанр">
              <option value="">Все жанры</option>
              {(data?.genres ?? []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="select" value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Язык">
              <option value="">Все языки</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              className="catalog-rail"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.34, ease: [0.22, 0.72, 0.18, 1] }}
            >
              {isError ? (
                <div className="catalog-empty">
                  <p>Каталог не загрузился. Проверьте, что сервер запущен.</p>
                  <button type="button" className="btn btn-ghost" onClick={() => void refetch()}>Повторить</button>
                </div>
              ) : books.length === 0 && data ? (
                <div className="catalog-empty">
                  <p>
                    {isCode
                      ? `Книги с кодом ${normalizeBookId(debounced)} нет. Попробуйте найти её по названию.`
                      : shelf === 'continue'
                        ? 'Здесь появятся книги, которые вы начали читать.'
                        : shelf === 'completed'
                          ? 'Здесь появятся прочитанные книги.'
                          : 'Ничего не нашлось. Попробуйте другое название или автора.'}
                  </p>
                </div>
              ) : (
                <div className="catalog-track" tabIndex={-1}>
                  {books.map((book) => (
                    <BookCard key={book.publicId} book={book} onRead={onRead} onDetails={setDetails} />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
      <AnimatePresence>
        {details && (
          <BookDetails
            key={details}
            publicId={details}
            onClose={() => setDetails(null)}
            onRead={(book) => {
              setDetails(null);
              onRead(book);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
