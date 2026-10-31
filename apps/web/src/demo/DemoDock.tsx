import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useWorld } from '../stores/world.ts';

/** Шесть этапов показа. Каждый ведёт на настоящую страницу, а не на её имитацию. */
const STEPS = [
  { id: 1, label: 'Открытие', path: '/', intro: true },
  { id: 2, label: 'Выбор книги', path: '/', intro: false },
  { id: 3, label: 'Чтение и слово', path: '/read/BV-000002', intro: false },
  { id: 4, label: 'Прогресс', path: '/me', intro: false },
  { id: 5, label: 'Зал голосует', path: '/demo', intro: false },
  { id: 6, label: 'Финал', path: '/demo?finale=1', intro: false },
];

export function useIsPresenter(): boolean {
  const { data } = useQuery({
    queryKey: ['demo-presenter'],
    queryFn: () => api<{ configured: boolean; authorized: boolean }>('/demo/presenter'),
    staleTime: 60_000,
  });
  return Boolean(data?.authorized);
}

/** Панель сценария видна только ведущему и переживает переходы между страницами. */
export function DemoDock() {
  const presenter = useIsPresenter();
  const navigate = useNavigate();
  const location = useLocation();
  const replayIntro = useWorld((s) => s.replayIntro);
  const markIntroSeen = useWorld((s) => s.markIntroSeen);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      if (event.key === 'h' || event.key === 'р') setHidden((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!presenter || hidden) return null;

  return (
    <nav className={`demo-dock ${open ? 'is-open' : ''}`} aria-label="Сценарий показа">
      {open && (
        <ol>
          {STEPS.map((step) => (
            <li key={step.id}>
              <button
                type="button"
                aria-current={location.pathname + location.search === step.path ? 'step' : undefined}
                onClick={() => {
                  if (step.intro) replayIntro();
                  else markIntroSeen();
                  setOpen(false);
                  void navigate(step.path);
                }}
              >
                <span>{step.id}</span>
                {step.label}
              </button>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="demo-dock-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Сценарий показа
      </button>
    </nav>
  );
}
