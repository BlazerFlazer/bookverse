import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidate } from '@react-three/fiber';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { DemoActivityDto, DemoControlDto, DemoOptionDto, DemoStateDto, ProfileDto } from '@bookverse/shared';
import { api, ApiError } from '../lib/api.ts';
import { useCatalog, useMe } from '../lib/queries.ts';
import { toast } from '../stores/toasts.ts';
import { useWorld } from '../stores/world.ts';
import { BookCover } from '../ui/Catalog.tsx';
import { IconExpand, IconMute, IconSound } from '../ui/Icons.tsx';
import { playDemoBurst, playFinale, stageDemo } from '../world/director.ts';
import { useDemoState } from './useDemoState.ts';

const VOTE_BOOKS = 4;

function KeyForm({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api('/demo/presenter/login', { method: 'POST', body: { key } });
      onDone();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось войти');
    }
  };
  return (
    <form className="demo-gate glass" onSubmit={(event) => void submit(event)}>
      <p className="eyebrow">Demo Day</p>
      <h1 className="display">Вход ведущего</h1>
      <p>Ключ задан в файле .env в строке DEMO_PRESENTER_KEY.</p>
      {error && <p className="demo-error" role="alert">{error}</p>}
      <label>
        <span className="sr-only">Ключ ведущего</span>
        <input className="field" type="password" value={key} autoComplete="current-password" onChange={(event) => setKey(event.target.value)} autoFocus />
      </label>
      <button type="submit" className="btn btn-primary" disabled={!key}>Войти</button>
    </form>
  );
}

function StartScreen({ onStart, pending }: { onStart: (practice: boolean) => void; pending: boolean }) {
  return (
    <div className="demo-gate demo-start glass">
      <p className="eyebrow">Demo Day</p>
      <h1 className="display">Новый показ</h1>
      <div className="demo-start-options">
        <button type="button" className="mode-card" disabled={pending} onClick={() => onStart(false)}>
          <span className="display">Начать показ</span>
          <span>Только настоящие зрители. На экране появится QR-код для входа.</span>
        </button>
        <button type="button" className="mode-card" disabled={pending} onClick={() => onStart(true)}>
          <span className="display">Репетиция</span>
          <span>С имитированными участниками. На всех экранах будет пометка о репетиции.</span>
        </button>
      </div>
    </div>
  );
}

function Lobby({ state, links }: { state: DemoStateDto; links: NonNullable<DemoControlDto['links']> }) {
  return (
    <section className="demo-lobby">
      <div className="demo-qr">
        <img src={`/api/demo/qr/${state.code}.svg`} alt={`QR-код для входа: ${links.web}`} />
      </div>
      <div className="demo-lobby-text">
        <p className="eyebrow">Присоединяйтесь</p>
        <h1 className="display">Откройте камеру и&nbsp;наведите на&nbsp;код</h1>
        <p className="demo-url">{links.web.replace(/^https?:\/\//, '')}</p>
        <p className="demo-code">Код зала: <b>{state.code}</b></p>
        {links.telegram && <p className="demo-telegram">Или в Telegram: <span>/demo {state.code}</span></p>}
        <p className="demo-count" data-testid="demo-participants">
          <motion.span key={state.participants} initial={{ scale: 1.25 }} animate={{ scale: 1 }} transition={{ duration: 0.35 }}>{state.participants}</motion.span>
          в зале
        </p>
      </div>
    </section>
  );
}

function OptionRow({ option, count, total, highlight, peak }: { option: DemoOptionDto; count: number; total: number; highlight: boolean; peak: number }) {
  const share = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`demo-row ${highlight ? 'is-best' : ''}`}>
      {option.cover && (
        <span className="demo-cover" style={{ background: `linear-gradient(150deg, ${option.cover.leather}, ${option.cover.leatherDeep})`, color: option.cover.foil }} aria-hidden="true">
          {option.label.slice(0, 1)}
        </span>
      )}
      <div className="demo-row-main">
        <p className="demo-row-label">
          <span>{option.label}</span>
          {option.note && <small>{option.note}</small>}
        </p>
        <div className="demo-bar"><motion.i animate={{ width: `${(count / Math.max(1, peak)) * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} /></div>
      </div>
      <p className="demo-row-count" data-testid="demo-count">{count}<small>{share}%</small></p>
    </div>
  );
}

function Board({ activity, state, onOpenWinner }: { activity: DemoActivityDto; state: DemoStateDto; onOpenWinner: (publicId: string) => void }) {
  const peak = Math.max(...activity.counts, 1);
  const best = activity.correct ?? activity.winner;
  const winnerBook = activity.winner !== null ? activity.options[activity.winner] : null;
  return (
    <section className="demo-board">
      <header>
        <p className="eyebrow">{activity.status === 'open' ? (activity.kind === 'vote' ? 'Идёт голосование' : 'Вопрос залу') : 'Итоги'}</p>
        <h1 className="display">{activity.prompt}</h1>
      </header>
      <div className="demo-rows">
        {activity.options.map((option, index) => (
          <OptionRow key={option.label} option={option} count={activity.counts[index] ?? 0} total={activity.total} peak={peak} highlight={index === best} />
        ))}
      </div>
      <footer>
        <p>Ответили: <b data-testid="demo-total">{activity.total}</b> из {state.participants}</p>
        {activity.explanation && <p className="demo-explanation">{activity.explanation}</p>}
        {winnerBook?.publicId && (
          <button type="button" className="btn btn-primary" onClick={() => onOpenWinner(winnerBook.publicId!)}>
            Открыть «{winnerBook.label}»
          </button>
        )}
      </footer>
      <aside className="demo-corner">
        <img src={`/api/demo/qr/${state.code}.svg`} alt="" />
        <span>{state.code}</span>
      </aside>
    </section>
  );
}

function Finale({ state }: { state: DemoStateDto }) {
  const { data: me } = useMe();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: () => api<ProfileDto>('/profile'), enabled: Boolean(me?.user), retry: false });
  const { data: catalog } = useCatalog();
  const earned = profile?.achievements.filter((a) => a.unlockedAt) ?? [];
  const shelf = catalog?.books.filter((b) => b.progress) ?? [];

  return (
    <motion.section className="demo-finale" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, delay: 4 }}>
      <p className="display demo-finale-line">Каждая книга — новая вселенная.</p>
      <p className="demo-finale-mark">BOOKVERSE</p>
      {state.participants > 0 && <p className="demo-finale-stat">Сегодня в зале: {state.participants}</p>}
      {(shelf.length > 0 || earned.length > 0) && (
        <div className="demo-finale-shelf">
          {shelf.slice(0, 5).map((book) => <BookCover key={book.publicId} book={book} width={120} />)}
          {earned.slice(0, 4).map((achievement) => (
            <span key={achievement.code} className="demo-finale-badge" title={achievement.description}>
              <i aria-hidden="true">{achievement.icon}</i>
              {achievement.title}
            </span>
          ))}
        </div>
      )}
    </motion.section>
  );
}

function Controls({ control, state, onChanged }: { control: DemoControlDto; state: DemoStateDto; onChanged: () => void }) {
  const soundOn = useWorld((s) => s.soundOn);
  const setSound = useWorld((s) => s.setSound);
  const { data: catalog } = useCatalog();
  const [menu, setMenu] = useState(false);

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(path, { method: 'POST', body: body ?? {} }),
    onSuccess: onChanged,
    onError: (error) => toast('Не получилось', error instanceof ApiError ? error.message : undefined, 'error'),
  });

  const open = state.activity?.status === 'open';
  const startVote = () => {
    const books = catalog?.books.filter((b) => b.featured).slice(0, VOTE_BOOKS) ?? [];
    act.mutate({ path: '/demo/activity', body: { kind: 'vote', publicIds: books.map((b) => b.publicId) } });
  };

  return (
    <footer className="demo-controls glass" aria-label="Управление показом">
      <div className="demo-controls-group">
        <button type="button" className="btn btn-primary" onClick={startVote} disabled={open}>Голосование за книгу</button>
        <div className="demo-menu">
          <button type="button" className="btn btn-ghost" aria-expanded={menu} onClick={() => setMenu((value) => !value)} disabled={open}>Вопрос залу</button>
          {menu && (
            <ul>
              {control.questions.map((question) => (
                <li key={question.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      act.mutate({ path: '/demo/activity', body: { kind: 'quiz', questionId: question.id } });
                    }}
                  >
                    <small>{question.bookTitle}</small>
                    {question.prompt}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {open && <button type="button" className="btn btn-primary" onClick={() => act.mutate({ path: '/demo/activity/close' })}>Закрыть и показать итог</button>}
        {state.activity && !open && state.status === 'lobby' && <span className="demo-hint">Итог на экране</span>}
      </div>

      <div className="demo-controls-group">
        <button type="button" className="btn btn-ghost" onClick={playDemoBurst}>Вихрь страниц</button>
        {state.status === 'finale' ? (
          <button type="button" className="btn btn-ghost" onClick={() => act.mutate({ path: '/demo/lobby' })}>Вернуться в зал</button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => act.mutate({ path: '/demo/finale' })}>Финал</button>
        )}
        {state.practice && <button type="button" className="btn btn-ghost" onClick={() => act.mutate({ path: '/demo/practice', body: { count: 10 } })}>Ещё 10 участников</button>}
      </div>

      <div className="demo-controls-group">
        <button type="button" className="icon-btn" aria-pressed={soundOn} aria-label={soundOn ? 'Выключить звук' : 'Включить звук'} onClick={() => setSound(!soundOn)}>
          {soundOn ? <IconSound /> : <IconMute />}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Во весь экран"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen().catch(() => undefined);
          }}
        >
          <IconExpand />
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            if (window.confirm('Сбросить показ? Все голоса и участники будут удалены, код зала останется прежним.')) act.mutate({ path: '/demo/reset' });
          }}
        >
          Сброс
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            if (window.confirm('Завершить показ? Зрители увидят экран благодарности.')) act.mutate({ path: '/demo/end' });
          }}
        >
          Завершить
        </button>
      </div>
    </footer>
  );
}

function Console() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const setPendingBook = useWorld((s) => s.setPendingBook);
  const [panel, setPanel] = useState(true);

  const { data: control } = useQuery({ queryKey: ['demo-control'], queryFn: () => api<DemoControlDto>('/demo/control') });
  const refresh = () => void client.invalidateQueries({ queryKey: ['demo-control'] });

  const start = useMutation({
    mutationFn: (practice: boolean) => api<DemoControlDto>('/demo/session', { method: 'POST', body: { practice } }),
    onSuccess: (data) => client.setQueryData(['demo-control'], data),
  });

  const { state } = useDemoState(control?.state?.code ?? null, control?.state ?? null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      if (event.key === 'h' || event.key === 'р') setPanel((value) => !value);
      if (event.key === 'f' || event.key === 'а') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Этап «Финал» из панели сценария открывает эту же страницу с параметром.
  const code = control?.state?.code;
  useEffect(() => {
    if (params.get('finale') !== '1' || !code) return;
    setParams({}, { replace: true });
    void api('/demo/finale', { method: 'POST', body: {} });
  }, [params, setParams, code]);

  const finale = state?.status === 'finale';
  const wasFinale = useRef(false);
  useEffect(() => {
    if (finale && !wasFinale.current) playFinale();
    if (!finale && wasFinale.current) stageDemo();
    wasFinale.current = Boolean(finale);
  }, [finale]);

  if (!control) return null;

  // Показ закончился или ещё не начат: ведущий выбирает, что запускать.
  if (!state || state.status === 'ended' || !control.links) {
    return <StartScreen onStart={(practice) => start.mutate(practice)} pending={start.isPending} />;
  }

  const openWinner = (publicId: string) => {
    setPendingBook(publicId);
    void navigate('/');
  };

  return (
    <div className="demo-stage">
      {state.practice && <p className="demo-practice" role="status">Репетиция: участники имитированы</p>}
      <AnimatePresence mode="wait">
        <motion.div key={finale ? 'finale' : (state.activity?.id ?? 'lobby')} className="demo-view" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
          {finale ? <Finale state={state} /> : state.activity ? <Board activity={state.activity} state={state} onOpenWinner={openWinner} /> : <Lobby state={state} links={control.links} />}
        </motion.div>
      </AnimatePresence>
      {panel && <Controls control={control} state={state} onChanged={refresh} />}
    </div>
  );
}

/** Страница ведущего. Ключ проверяет сервер, а все действия идут через защищённые маршруты. */
export function DemoPage() {
  const client = useQueryClient();
  const setStage = useWorld((s) => s.setStage);
  const { data: access, isLoading } = useQuery({
    queryKey: ['demo-presenter'],
    queryFn: () => api<{ configured: boolean; authorized: boolean }>('/demo/presenter'),
  });

  useEffect(() => {
    setStage('demo');
    stageDemo();
    const timer = setTimeout(() => invalidate(), 60);
    return () => clearTimeout(timer);
  }, [setStage]);

  if (isLoading) return null;

  if (!access?.configured) {
    return (
      <div className="demo-gate glass">
        <p className="eyebrow">Demo Day</p>
        <h1 className="display">Режим ведущего выключен</h1>
        <p>Задайте ключ в файле .env в строке DEMO_PRESENTER_KEY и перезапустите сервер.</p>
      </div>
    );
  }

  if (!access.authorized) return <KeyForm onDone={() => void client.invalidateQueries({ queryKey: ['demo-presenter'] })} />;

  return <Console />;
}
