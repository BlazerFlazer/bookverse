import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { declension, editDistance, normalizeForLookup, type GameEventDto, type ReviewRating, type VocabularyItemDto } from '@bookverse/shared';
import { api } from '../lib/api.ts';
import { useVocabulary } from '../lib/queries.ts';
import { showGameEvent, toast } from '../stores/toasts.ts';
import { IconTrash } from '../ui/Icons.tsx';
import { TopBar } from '../ui/TopBar.tsx';
import { useBackdrop } from './usePageStage.ts';

const MODES = [
  { id: 'flash', title: 'Карточки', note: 'Вспомните значение и оцените себя' },
  { id: 'choose', title: 'Выбери значение', note: 'Одно из четырёх определений' },
  { id: 'fill', title: 'Вставь слово', note: 'Предложение из книги с пропуском' },
  { id: 'match', title: 'Найди пару', note: 'Соедините слова и значения' },
  { id: 'memory', title: 'По памяти', note: 'Напишите слово по его значению' },
] as const;

type Mode = (typeof MODES)[number]['id'];

const MASTERY = { new: 'Новое', learning: 'Учу', mastered: 'Выучено' } as const;

function shuffle<T>(items: readonly T[]): T[] {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

function useReview() {
  const client = useQueryClient();
  return async (id: string, rating: ReviewRating) => {
    const result = await api<{ game: GameEventDto }>(`/vocabulary/${id}/review`, { method: 'POST', body: { rating } });
    showGameEvent(result.game);
    void client.invalidateQueries({ queryKey: ['vocabulary'] });
    void client.invalidateQueries({ queryKey: ['profile'] });
  };
}

function Done({ onExit, count }: { onExit: () => void; count: number }) {
  return (
    <div className="study-card study-done">
      <p className="display">Повторение закончено</p>
      <p>{count} {declension(count, ['слово', 'слова', 'слов'])} за эту сессию. Следующий повтор сервер назначит сам.</p>
      <button type="button" className="btn btn-primary" onClick={onExit}>К словарю</button>
    </div>
  );
}

function Flashcards({ words, onExit }: { words: VocabularyItemDto[]; onExit: () => void }) {
  const review = useReview();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const word = words[index];
  if (!word) return <Done onExit={onExit} count={words.length} />;

  const rate = async (rating: ReviewRating) => {
    await review(word.id, rating);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  return (
    <div className="study-stage">
      <p className="study-count">{index + 1} из {words.length}</p>
      <button type="button" className={`flash ${revealed ? 'is-open' : ''}`} onClick={() => setRevealed((v) => !v)} aria-label={revealed ? 'Скрыть значение' : 'Показать значение'}>
        <span className="flash-inner">
          <span className="flash-face"><span className="display flash-word">{word.lemma}</span><span className="flash-hint">Нажмите, чтобы проверить себя</span></span>
          <span className="flash-face flash-back">
            <span className="flash-definition">{word.definition ?? 'Определения нет: вспомните, где встретилось это слово.'}</span>
            {word.contexts[0] && <span className="flash-context">«{word.contexts[0].snippet}»</span>}
          </span>
        </span>
      </button>
      {revealed && (
        <div className="rate-row">
          <button type="button" className="btn btn-ghost" onClick={() => void rate('forgot')}>Не помню</button>
          <button type="button" className="btn btn-ghost" onClick={() => void rate('almost')}>Почти помню</button>
          <button type="button" className="btn btn-primary" onClick={() => void rate('know')}>Знаю</button>
        </div>
      )}
    </div>
  );
}

function Choose({ words, pool, onExit }: { words: VocabularyItemDto[]; pool: VocabularyItemDto[]; onExit: () => void }) {
  const review = useReview();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const word = words[index];
  const options = useMemo(
    () => (word ? shuffle([word, ...shuffle(pool.filter((w) => w.id !== word.id)).slice(0, 3)]) : []),
    [word, pool],
  );
  if (!word) return <Done onExit={onExit} count={words.length} />;

  const pick = async (id: string) => {
    if (picked) return;
    setPicked(id);
    await review(word.id, id === word.id ? 'know' : 'forgot');
    setTimeout(() => {
      setPicked(null);
      setIndex((i) => i + 1);
    }, 1100);
  };

  return (
    <div className="study-stage">
      <p className="study-count">{index + 1} из {words.length}</p>
      <div className="study-card">
        <p className="display flash-word">{word.lemma}</p>
        <div className="study-options">
          {options.map((option) => {
            const state = picked ? (option.id === word.id ? 'right' : option.id === picked ? 'wrong' : '') : '';
            return (
              <button key={option.id} type="button" className={`study-option ${state}`} onClick={() => void pick(option.id)}>
                {option.definition}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Вырезает форму слова из предложения. Если формы там нет, задание для этого слова не строится. */
function blanked(word: VocabularyItemDto): { sentence: string; answer: string } | null {
  const snippet = word.contexts[0]?.snippet;
  if (!snippet) return null;
  const index = normalizeForLookup(snippet).indexOf(normalizeForLookup(word.word));
  if (index < 0) return null;
  const answer = snippet.slice(index, index + word.word.length);
  return { sentence: `${snippet.slice(0, index)}_____${snippet.slice(index + word.word.length)}`, answer };
}

function Fill({ words, pool, onExit }: { words: VocabularyItemDto[]; pool: VocabularyItemDto[]; onExit: () => void }) {
  const review = useReview();
  const playable = useMemo(() => words.filter((w) => blanked(w)), [words]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const word = playable[index];
  const options = useMemo(() => (word ? shuffle([word, ...shuffle(pool.filter((w) => w.id !== word.id)).slice(0, 3)]) : []), [word, pool]);
  if (playable.length === 0) return <div className="study-card"><p>Для этого режима нужны слова, сохранённые прямо из книги.</p><button type="button" className="btn btn-ghost" onClick={onExit}>Назад</button></div>;
  if (!word) return <Done onExit={onExit} count={playable.length} />;
  const task = blanked(word)!;

  const pick = async (id: string) => {
    if (picked) return;
    setPicked(id);
    await review(word.id, id === word.id ? 'know' : 'forgot');
    setTimeout(() => {
      setPicked(null);
      setIndex((i) => i + 1);
    }, 1100);
  };

  return (
    <div className="study-stage">
      <p className="study-count">{index + 1} из {playable.length}</p>
      <div className="study-card">
        <p className="study-sentence">{task.sentence}</p>
        <div className="study-options study-options-words">
          {options.map((option) => {
            const state = picked ? (option.id === word.id ? 'right' : option.id === picked ? 'wrong' : '') : '';
            return <button key={option.id} type="button" className={`study-option ${state}`} onClick={() => void pick(option.id)}>{option.word}</button>;
          })}
        </div>
      </div>
    </div>
  );
}

function Match({ words, onExit }: { words: VocabularyItemDto[]; onExit: () => void }) {
  const review = useReview();
  const round = useMemo(() => shuffle(words).slice(0, 4), [words]);
  const right = useMemo(() => shuffle(round), [round]);
  const [left, setLeft] = useState<string | null>(null);
  const [solved, setSolved] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState<string[]>([]);

  const pick = (id: string) => {
    if (!left) return;
    if (id === left) {
      setSolved((list) => [...list, id]);
      void review(id, mistakes.includes(id) ? 'almost' : 'know');
    } else {
      setMistakes((list) => [...list, left]);
      toast('Не совпало', 'Попробуйте другую пару');
    }
    setLeft(null);
  };

  if (solved.length === round.length) return <Done onExit={onExit} count={round.length} />;

  return (
    <div className="study-card study-match">
      <div>
        {round.map((word) => (
          <button key={word.id} type="button" className={`study-option ${solved.includes(word.id) ? 'right' : ''}`} aria-pressed={left === word.id} disabled={solved.includes(word.id)} onClick={() => setLeft(word.id)}>
            {word.lemma}
          </button>
        ))}
      </div>
      <div>
        {right.map((word) => (
          <button key={word.id} type="button" className={`study-option ${solved.includes(word.id) ? 'right' : ''}`} disabled={solved.includes(word.id)} onClick={() => pick(word.id)}>
            {word.definition}
          </button>
        ))}
      </div>
    </div>
  );
}

function Memory({ words, onExit }: { words: VocabularyItemDto[]; onExit: () => void }) {
  const review = useReview();
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState('');
  const [verdict, setVerdict] = useState<ReviewRating | null>(null);
  const word = words[index];
  if (!word) return <Done onExit={onExit} count={words.length} />;

  const check = async (event: React.FormEvent) => {
    event.preventDefault();
    const distance = editDistance(normalizeForLookup(value), normalizeForLookup(word.lemma), 2);
    const rating: ReviewRating = distance === 0 ? 'know' : distance <= 2 ? 'almost' : 'forgot';
    setVerdict(rating);
    await review(word.id, rating);
  };

  return (
    <form className="study-card" onSubmit={(event) => void check(event)}>
      <p className="study-count">{index + 1} из {words.length}</p>
      <p className="flash-definition">{word.definition}</p>
      <label>
        <span className="sr-only">Напишите слово</span>
        <input className="field" value={value} onChange={(event) => setValue(event.target.value)} disabled={Boolean(verdict)} autoFocus placeholder="Какое это слово?" />
      </label>
      {verdict ? (
        <>
          <p className="study-verdict">{verdict === 'know' ? 'Верно!' : verdict === 'almost' ? `Почти: ${word.lemma}` : `Правильно: ${word.lemma}`}</p>
          <button type="button" className="btn btn-primary" onClick={() => { setVerdict(null); setValue(''); setIndex((i) => i + 1); }}>Дальше</button>
        </>
      ) : (
        <button type="submit" className="btn btn-primary" disabled={!value.trim()}>Проверить</button>
      )}
    </form>
  );
}

function WordCard({ word, onDelete, index }: { word: VocabularyItemDto; onDelete: (id: string) => void; index: number }) {
  return (
    <motion.article
      className="word-card"
      data-testid="word-card"
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.34, delay: Math.min(index * 0.03, 0.3) }}
    >
      <div className="word-head">
        <h3 className="display">{word.lemma}</h3>
        <span className={`word-state word-${word.mastery}`}>{word.studyLater ? 'На потом' : MASTERY[word.mastery]}</span>
      </div>
      {word.partOfSpeech && <p className="word-pos">{word.partOfSpeech}</p>}
      <p className="word-definition">{word.definition ?? 'Определения пока нет.'}</p>
      {word.contexts.slice(0, 2).map((context) => (
        <p key={context.snippet} className="word-context">
          «{context.snippet}»
          {context.bookTitle && <span> — {context.bookTitle}{context.chapterOrder ? `, глава ${context.chapterOrder}` : ''}</span>}
        </p>
      ))}
      <div className="word-foot">
        {word.sourceLabel && <span>{word.sourceLabel}</span>}
        <button type="button" className="icon-btn" onClick={() => onDelete(word.id)} aria-label={`Удалить слово ${word.lemma}`}><IconTrash width={16} height={16} /></button>
      </div>
    </motion.article>
  );
}

export function VocabularyPage() {
  useBackdrop();
  const client = useQueryClient();
  const { data, isLoading } = useVocabulary();
  const [mode, setMode] = useState<Mode | null>(null);
  const [session, setSession] = useState<VocabularyItemDto[]>([]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const summary = data?.summary;
  const withDefinition = useMemo(() => items.filter((w) => w.definition), [items]);

  const begin = (next: Mode) => {
    const now = Date.now();
    const due = withDefinition.filter((w) => new Date(w.nextReviewAt).getTime() <= now);
    // Если срочных слов нет, тренировка идёт по всем словам: SRS учтёт её как обычное повторение.
    setSession(shuffle(due.length > 0 ? due : withDefinition).slice(0, 12));
    setMode(next);
  };

  const remove = async (id: string) => {
    await api(`/vocabulary/${id}`, { method: 'DELETE' });
    void client.invalidateQueries({ queryKey: ['vocabulary'] });
  };

  const exit = () => setMode(null);

  return (
    <div className="page-shell">
      <TopBar />
      <div className="page-wrap">
        <p className="eyebrow">Коллекция слов</p>
        <h1 className="display page-title">Мой словарь</h1>
        <p className="page-lead">Слова из ваших книг. Они живут в аккаунте, поэтому повторять их можно и здесь, и в Telegram.</p>

        <div className="stat-grid">
          <div className="stat"><span className="stat-value" data-testid="words-total">{summary?.total ?? 0}</span><span className="stat-label">Всего слов</span></div>
          <div className="stat"><span className="stat-value">{summary?.mastered ?? 0}</span><span className="stat-label">Выучено</span></div>
          <div className="stat"><span className="stat-value">{summary?.due ?? 0}</span><span className="stat-label">Ждут повторения</span></div>
          <div className="stat"><span className="stat-value">{summary?.recent ?? 0}</span><span className="stat-label">Новых за неделю</span></div>
        </div>

        <h2 className="display section-title">Тренировка</h2>
        {withDefinition.length === 0 ? (
          <p className="empty-note">Откройте книгу, нажмите на незнакомое слово и добавьте его в словарь. Здесь появятся упражнения.</p>
        ) : mode === null ? (
          <div className="mode-grid">
            {MODES.map((item) => {
              const locked = (item.id === 'choose' || item.id === 'fill' || item.id === 'match') && withDefinition.length < 4;
              return (
                <button key={item.id} type="button" className="mode-card" disabled={locked} onClick={() => begin(item.id)}>
                  <span className="display">{item.title}</span>
                  <span>{locked ? 'Нужно хотя бы 4 слова' : item.note}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="study">
            <button type="button" className="btn btn-ghost" onClick={exit}>Закончить</button>
            {mode === 'flash' && <Flashcards words={session} onExit={exit} />}
            {mode === 'choose' && <Choose words={session} pool={withDefinition} onExit={exit} />}
            {mode === 'fill' && <Fill words={session} pool={withDefinition} onExit={exit} />}
            {mode === 'match' && <Match words={session} onExit={exit} />}
            {mode === 'memory' && <Memory words={session} onExit={exit} />}
          </div>
        )}

        <h2 className="display section-title">Все слова</h2>
        {isLoading ? (
          <p className="empty-note">Открываем словарь…</p>
        ) : items.length === 0 ? (
          <p className="empty-note">Пока пусто. <Link to="/">Выберите книгу</Link>, и первое слово принесёт достижение «Первое открытие».</p>
        ) : (
          <div className="word-grid">
            <AnimatePresence>
              {items.map((word, index) => <WordCard key={word.id} word={word} index={index} onDelete={(id) => void remove(id)} />)}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
