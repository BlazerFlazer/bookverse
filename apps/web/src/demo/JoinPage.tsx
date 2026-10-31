import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { DemoActivityDto, DemoJoinDto, DemoOptionDto } from '@bookverse/shared';
import { useDemoState } from './useDemoState.ts';

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T | null; message: string | null }> {
  try {
    const response = await fetch(`/api/demo/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
    return { status: response.status, data: response.ok ? data : null, message: response.ok ? null : (data?.message ?? 'Что-то пошло не так') };
  } catch {
    return { status: 0, data: null, message: 'Нет связи. Проверьте, что телефон подключён к школьной сети.' };
  }
}

function MiniCover({ option }: { option: DemoOptionDto }) {
  if (!option.cover) return null;
  return (
    <span className="join-cover" style={{ background: `linear-gradient(150deg, ${option.cover.leather}, ${option.cover.leatherDeep})`, color: option.cover.foil }} aria-hidden="true">
      <span>{option.label.slice(0, 1)}</span>
    </span>
  );
}

function Results({ activity, choice }: { activity: DemoActivityDto; choice: number | null }) {
  const peak = Math.max(1, ...activity.counts);
  const best = activity.correct ?? activity.winner;
  return (
    <div className="join-results" role="status">
      {activity.kind === 'quiz' && choice !== null && (
        <p className={`join-verdict ${choice === activity.correct ? 'is-right' : ''}`}>
          {choice === activity.correct ? 'Верно!' : 'Почти. Посмотрите правильный ответ'}
        </p>
      )}
      {activity.options.map((option, index) => (
        <div key={option.label} className={`join-result ${index === best ? 'is-best' : ''}`}>
          <span className="join-result-label">{option.label}{index === choice ? ' · ваш выбор' : ''}</span>
          <span className="join-result-bar"><i style={{ width: `${((activity.counts[index] ?? 0) / peak) * 100}%` }} /></span>
          <span className="join-result-count">{activity.counts[index] ?? 0}</span>
        </div>
      ))}
      {activity.explanation && <p className="join-explanation">{activity.explanation}</p>}
    </div>
  );
}

function CodeForm({ error, onSubmit }: { error: string | null; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(code.trim().toUpperCase());
  };
  return (
    <form className="join-card" onSubmit={submit}>
      <h1 className="display">Войти в зал</h1>
      <p>Введите код с большого экрана.</p>
      {error && <p className="join-error" role="alert">{error}</p>}
      <label>
        <span className="sr-only">Код показа</span>
        <input className="field join-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={5} autoCapitalize="characters" autoComplete="off" />
      </label>
      <button type="submit" className="btn btn-primary" disabled={code.trim().length < 5}>Присоединиться</button>
    </form>
  );
}

/** Страница зрителя: без регистрации и личных данных, работает на любом телефоне. */
export function JoinPage() {
  const initialCode = useMemo(() => window.location.pathname.split('/')[2]?.toUpperCase() ?? '', []);
  const [code, setCode] = useState(initialCode);
  const [joined, setJoined] = useState<DemoJoinDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);

  const join = useCallback(async (target: string) => {
    const result = await post<DemoJoinDto>(`join/${target}`, {});
    if (!result.data) {
      setError(result.message);
      setCode('');
      return null;
    }
    setError(null);
    setCode(target);
    setJoined(result.data);
    const activityId = result.data.state.activity?.id;
    const previous = result.data.choice;
    if (activityId && previous !== null) setChoices((list) => ({ ...list, [activityId]: previous }));
    return result.data;
  }, []);

  // Вход один раз на страницу: два одновременных запроса без cookie дали бы двух участников.
  const entered = useRef(false);
  useEffect(() => {
    if (!initialCode || entered.current) return;
    entered.current = true;
    void join(initialCode);
  }, [initialCode, join]);

  const { state, connected } = useDemoState(joined ? code : null, joined?.state ?? null);
  const activity = state?.activity ?? null;
  const choice = activity ? (choices[activity.id] ?? null) : null;

  const vote = async (index: number) => {
    if (!activity || sending) return;
    setSending(true);
    setChoices((list) => ({ ...list, [activity.id]: index }));
    let result = await post<DemoJoinDto>('vote', { activityId: activity.id, choice: index });
    // После сброса показа прежний участник удалён: заходим заново и повторяем голос.
    if (result.status === 401) {
      await join(code);
      result = await post<DemoJoinDto>('vote', { activityId: activity.id, choice: index });
    }
    setSending(false);
    if (!result.data) {
      setError(result.message);
      setChoices(({ [activity.id]: _removed, ...rest }) => rest);
    } else setError(null);
  };

  if (!joined) {
    return (
      <main className="join-root">
        <p className="join-brand">BOOKVERSE</p>
        {code && !error ? <p className="join-wait">Открываем зал…</p> : <CodeForm error={error} onSubmit={(next) => void join(next)} />}
      </main>
    );
  }

  const ended = state?.status === 'ended';
  const finale = state?.status === 'finale';

  return (
    <main className="join-root">
      <header className="join-head">
        <p className="join-brand">BOOKVERSE</p>
        <p className="join-name">{joined.nickname}</p>
      </header>
      {state?.practice && <p className="join-practice">Репетиция: часть участников имитирована</p>}
      {!connected && !ended && <p className="join-offline">Восстанавливаем связь…</p>}
      {error && <p className="join-error" role="alert">{error}</p>}

      {ended || finale ? (
        <section className="join-card">
          <h1 className="display">Спасибо!</h1>
          <p>Каждая книга — новая вселенная.</p>
        </section>
      ) : !activity ? (
        <section className="join-card">
          <h1 className="display">Вы в зале</h1>
          <p>Смотрите на большой экран. Вопрос появится здесь сам.</p>
          <p className="join-count">В зале: {state?.participants ?? 0}</p>
        </section>
      ) : activity.status === 'open' && choice === null ? (
        <section className="join-card">
          <h1 className="display join-prompt">{activity.prompt}</h1>
          <div className="join-options">
            {activity.options.map((option, index) => (
              <button key={option.label} type="button" className="join-option" disabled={sending} onClick={() => void vote(index)}>
                <MiniCover option={option} />
                <span>
                  {option.label}
                  {option.note && <small>{option.note}</small>}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : activity.status === 'open' ? (
        <section className="join-card">
          <h1 className="display">Голос принят</h1>
          <p>Ваш выбор: {activity.options[choice!]?.label}</p>
          <p className="join-count">Проголосовало: {activity.total}</p>
        </section>
      ) : (
        <section className="join-card">
          <h1 className="display join-prompt">{activity.prompt}</h1>
          <Results activity={activity} choice={choice} />
        </section>
      )}
    </main>
  );
}
