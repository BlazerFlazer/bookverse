import { useNavigate } from 'react-router-dom';
import { detectQuality, type QualitySetting } from '../lib/quality.ts';
import { useWorld } from '../stores/world.ts';
import { TopBar } from '../ui/TopBar.tsx';
import { useBackdrop } from './usePageStage.ts';

const QUALITY: { id: QualitySetting; label: string; note: string }[] = [
  { id: 'auto', label: 'Авто', note: 'Подбирается под этот компьютер' },
  { id: 'low', label: 'Низкое', note: 'Для слабых устройств и телефонов' },
  { id: 'medium', label: 'Среднее', note: 'Для встроенной графики' },
  { id: 'high', label: 'Высокое', note: 'Больше листов и свечение' },
  { id: 'ultra', label: 'Ультра', note: 'Для мощной видеокарты' },
];

const QUALITY_NAMES = { low: 'низкое', medium: 'среднее', high: 'высокое', ultra: 'ультра' } as const;

function Toggle({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row">
      <span>
        <b>{label}</b>
        <small>{note}</small>
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function SettingsPage() {
  useBackdrop();
  const navigate = useNavigate();
  const webgl = useWorld((s) => s.webgl);
  const qualitySetting = useWorld((s) => s.qualitySetting);
  const setQuality = useWorld((s) => s.setQuality);
  const reducedMotion = useWorld((s) => s.reducedMotion);
  const setReducedMotion = useWorld((s) => s.setReducedMotion);
  const shortTransition = useWorld((s) => s.shortTransition);
  const setShortTransition = useWorld((s) => s.setShortTransition);
  const soundOn = useWorld((s) => s.soundOn);
  const setSound = useWorld((s) => s.setSound);
  const replayIntro = useWorld((s) => s.replayIntro);

  return (
    <div className="page-shell">
      <TopBar />
      <div className="page-wrap settings">
        <h1 className="display page-title">Настройки</h1>
        {!webgl && <p className="guest-banner">На этом устройстве 3D недоступно, поэтому BOOKVERSE работает в плоском режиме. Каталог и чтение доступны полностью.</p>}

        <h2 className="display section-title">Качество графики</h2>
        <div className="quality-grid" role="group" aria-label="Качество графики">
          {QUALITY.map((item) => (
            <button key={item.id} type="button" className="mode-card" aria-pressed={qualitySetting === item.id} onClick={() => setQuality(item.id)}>
              <span className="display">{item.label}</span>
              <span>{item.id === 'auto' ? `${item.note}: ${QUALITY_NAMES[detectQuality()]}` : item.note}</span>
            </button>
          ))}
        </div>

        <h2 className="display section-title">Движение и звук</h2>
        <div className="glass panel">
          <Toggle label="Меньше движения" note="Вместо полётов книг и перелистывания будут плавные появления" checked={reducedMotion} onChange={setReducedMotion} />
          <Toggle label="Короткий переход к книге" note="Вся анимация выбора книги идёт примерно за две секунды" checked={shortTransition} onChange={setShortTransition} />
          <Toggle label="Звуки" note="Шорох страниц и мягкие сигналы достижений" checked={soundOn} onChange={setSound} />
        </div>

        <h2 className="display section-title">Вступление</h2>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!webgl}
          onClick={() => {
            replayIntro();
            void navigate('/');
          }}
        >
          Показать вступление ещё раз
        </button>
      </div>
    </div>
  );
}
