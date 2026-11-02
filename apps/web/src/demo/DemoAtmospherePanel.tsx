import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { demoPhase, PHASE_LABELS, PHASE_SHORT_LABELS, TIME_PHASES } from '@bookverse/shared';
import type { DemoAtmosphereDto, DemoAtmospherePatch, DemoControlDto, DemoStateDto, PresenterTelegramLinkDto } from '@bookverse/shared';
import { useAtmosphere } from '../atmosphere/store.ts';
import { api, ApiError } from '../lib/api.ts';
import { useCatalog } from '../lib/queries.ts';
import { toast } from '../stores/toasts.ts';
import { useWorld } from '../stores/world.ts';
import { focusWindow } from '../world/director.ts';
import { useDemoState } from './useDemoState.ts';

function describeChange(atmosphere: DemoAtmosphereDto): string {
  const phase = demoPhase(atmosphere, Date.now());
  if (atmosphere.time === 'cycle') return 'Сутки идут по кругу';
  if (phase) return PHASE_LABELS[phase];
  return 'Атмосфера изменилась';
}

/**
 * Показ сильнее личных настроек. Экран ведущего слушает состояние показа на любой странице,
 * поэтому команда из Telegram меняет зал, даже если открыта книга.
 */
export function useDemoAtmosphereSync(presenter: boolean): DemoStateDto | null {
  const { data: control } = useQuery({
    queryKey: ['demo-control'],
    queryFn: () => api<DemoControlDto>('/demo/control'),
    enabled: presenter,
  });
  const { state } = useDemoState(presenter ? (control?.state?.code ?? null) : null, control?.state ?? null);
  const setDemo = useAtmosphere((s) => s.setDemo);
  const lastChange = useRef<string | null>(null);

  const live = state && state.status !== 'ended' ? state : null;
  const atmosphere = live?.atmosphere ?? null;

  useEffect(() => {
    setDemo(atmosphere);
    if (!atmosphere?.changedAt || atmosphere.changedAt === lastChange.current) return;
    const first = lastChange.current === null;
    lastChange.current = atmosphere.changedAt;
    if (first) return;
    if (atmosphere.source === 'telegram') toast('Команда из Telegram', describeChange(atmosphere));
    if (atmosphere.source === 'practice') toast('Имитация Telegram', describeChange(atmosphere));
  }, [atmosphere, setDemo]);

  useEffect(() => () => setDemo(null), [setDemo]);

  return live;
}

function TelegramLink() {
  const [link, setLink] = useState<PresenterTelegramLinkDto | null>(null);
  const create = useMutation({
    mutationFn: () => api<PresenterTelegramLinkDto>('/demo/presenter/telegram', { method: 'POST', body: {} }),
    onSuccess: setLink,
    onError: (error) => toast('Не получилось', error instanceof ApiError ? error.message : undefined, 'error'),
  });
  if (!link) {
    return <button type="button" className="demo-atmos-btn" disabled={create.isPending} onClick={() => create.mutate()}>Подключить Telegram ведущего</button>;
  }
  return (
    <p className="demo-atmos-link">
      {link.url ? <a href={link.url} target="_blank" rel="noreferrer">Открыть в Telegram</a> : 'Отправьте боту команду:'}
      <code>{link.command}</code>
      <small>Ссылка одноразовая и действует 10 минут. Экран ведущего не показывайте залу, пока она открыта.</small>
    </p>
  );
}

/** Кнопки атмосферы для ведущего. Все команды идут через сервер, как и из Telegram. */
export function DemoAtmospherePanel({ state }: { state: DemoStateDto | null }) {
  const navigate = useNavigate();
  const setPendingBook = useWorld((s) => s.setPendingBook);
  const stage = useWorld((s) => s.stage);
  const setDemo = useAtmosphere((s) => s.setDemo);
  const { data: catalog } = useCatalog();
  const [simulate, setSimulate] = useState(false);

  const send = useMutation({
    mutationFn: (patch: DemoAtmospherePatch) => api<DemoAtmosphereDto>('/demo/atmosphere', { method: 'POST', body: { ...patch, simulateTelegram: simulate } }),
    // Ответ применяется сразу: зал откликается, даже если сокет переподключается.
    onSuccess: setDemo,
    onError: (error) => toast('Не получилось', error instanceof ApiError ? error.message : undefined, 'error'),
  });

  if (!state) return <p className="demo-atmos-hint">Атмосферой можно управлять после начала показа на странице ведущего.</p>;

  const { atmosphere } = state;
  const audioOn = atmosphere.audio !== false;
  const featured = catalog?.books.find((book) => book.featured);

  return (
    <section className="demo-atmos" aria-label="Живая библиотека на показе">
      <h2>Живая библиотека</h2>
      <div className="demo-atmos-row">
        {TIME_PHASES.map((phase) => (
          <button key={phase} type="button" className="demo-atmos-btn" aria-pressed={atmosphere.time === phase} onClick={() => send.mutate({ time: phase })}>{PHASE_SHORT_LABELS[phase]}</button>
        ))}
      </div>
      <div className="demo-atmos-row">
        <button type="button" className="demo-atmos-btn" aria-pressed={atmosphere.time === 'cycle'} onClick={() => send.mutate({ time: 'cycle' })}>Сутки по кругу</button>
        <button type="button" className="demo-atmos-btn" aria-pressed={atmosphere.time === null} onClick={() => send.mutate({ time: null, audio: null, rainBoost: false })}>Обычный режим</button>
      </div>
      <div className="demo-atmos-row">
        <button type="button" className="demo-atmos-btn" aria-pressed={atmosphere.rainBoost} onClick={() => send.mutate({ rainBoost: !atmosphere.rainBoost })}>Сильный дождь</button>
        <button type="button" className="demo-atmos-btn" aria-pressed={audioOn} onClick={() => send.mutate({ audio: !audioOn })}>{audioOn ? 'Звуки включены' : 'Звуки выключены'}</button>
      </div>
      <div className="demo-atmos-row">
        <button type="button" className="demo-atmos-btn" onClick={() => send.mutate({ showcase: true })}>Показать погоду</button>
        <button type="button" className="demo-atmos-btn" disabled={stage !== 'library'} onClick={focusWindow}>Подойти к окну</button>
      </div>
      {featured && (
        <button
          type="button"
          className="demo-atmos-btn"
          onClick={() => {
            setPendingBook(featured.publicId);
            void navigate('/');
          }}
        >
          Открыть книгу «{featured.title}»
        </button>
      )}
      <TelegramLink />
      {state.practice && (
        <label className="demo-atmos-simulate">
          <input type="checkbox" className="switch" checked={simulate} onChange={(event) => setSimulate(event.target.checked)} />
          <span>Имитация Telegram: команды помечаются на экране как имитация</span>
        </label>
      )}
    </section>
  );
}
