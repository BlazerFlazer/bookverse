import { useEffect } from 'react';
import { motion } from 'motion/react';
import type { ReaderFontId, ReaderSettings } from '@bookverse/shared';
import { IconClose } from '../ui/Icons.tsx';
import { scheduleSettingsSave, THEMES, useReaderSettings } from './store.ts';

const FONTS: { id: ReaderFontId | 'auto'; label: string }[] = [
  { id: 'auto', label: 'Как в теме' },
  { id: 'literata', label: 'Литерата' },
  { id: 'oldstandard', label: 'Старый стандарт' },
  { id: 'cormorant', label: 'Корморант' },
  { id: 'manrope', label: 'Манроуп' },
  { id: 'nunito', label: 'Нунито' },
];

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="rd-slider">
      <span>{label}<em>{format(value)}</em></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ThemePreview({ theme, active, onPick }: { theme: (typeof THEMES)[number]; active: boolean; onPick: () => void }) {
  return (
    <button type="button" className="theme-card" aria-pressed={active} onClick={onPick}>
      <span className="theme-book" style={{ background: theme.surround }}>
        <span className="theme-page" style={{ background: theme.page }}>
          <i style={{ background: theme.accent, width: '46%' }} />
          <i style={{ background: theme.ink }} />
          <i style={{ background: theme.ink }} />
          <i style={{ background: theme.ink, width: '64%' }} />
        </span>
        <span className="theme-page" style={{ background: theme.page }}>
          <i style={{ background: theme.ink }} />
          <i style={{ background: theme.ink }} />
          <i style={{ background: theme.ink }} />
          <i style={{ background: theme.ink, width: '40%' }} />
        </span>
      </span>
      <span className="theme-name">{theme.name}</span>
      <span className="theme-note">{theme.note}</span>
    </button>
  );
}

/** «Оформление книги»: смена темы меняет только переменные CSS, поэтому страница не перезагружается. */
export function ThemePanel({ publicId, onClose }: { publicId: string; onClose: () => void }) {
  const settings = useReaderSettings((s) => s.settings);
  const perBook = useReaderSettings((s) => s.perBook);
  const update = useReaderSettings((s) => s.update);
  const setPerBook = useReaderSettings((s) => s.setPerBook);

  const change = (patch: Partial<ReaderSettings>) => {
    update(patch);
    scheduleSettingsSave(publicId);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.aside
      className="rd-sheet scroll-area"
      role="dialog"
      aria-label="Оформление книги"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.28, ease: [0.22, 0.72, 0.18, 1] }}
    >
      <div className="rd-sheet-head">
        <h2 className="display">Оформление книги</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть"><IconClose /></button>
      </div>

      <div className="theme-grid">
        {THEMES.map((theme) => (
          <ThemePreview key={theme.id} theme={theme} active={settings.themeId === theme.id} onPick={() => change({ themeId: theme.id })} />
        ))}
      </div>

      <h3 className="rd-sheet-title">Текст</h3>
      <div className="font-row" role="group" aria-label="Шрифт">
        {FONTS.map((font) => (
          <button key={font.id} type="button" className="chip" aria-pressed={settings.fontId === font.id} onClick={() => change({ fontId: font.id })}>
            {font.label}
          </button>
        ))}
      </div>
      <Slider label="Размер шрифта" value={settings.fontScale} min={0.75} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(fontScale) => change({ fontScale })} />
      <Slider label="Межстрочный интервал" value={settings.lineHeight} min={1.3} max={2.1} step={0.05} format={(v) => v.toFixed(2)} onChange={(lineHeight) => change({ lineHeight })} />
      <Slider label="Поля" value={settings.margin} min={0.6} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(margin) => change({ margin })} />
      <Slider label="Ширина страницы" value={settings.pageWidth} min={0.78} max={1.08} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onChange={(pageWidth) => change({ pageWidth })} />
      <Slider label="Яркость фона" value={settings.brightness} min={0.65} max={1.05} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(brightness) => change({ brightness })} />

      <div className="rd-option">
        <span>Выравнивание</span>
        <div>
          <button type="button" className="chip" aria-pressed={settings.align === 'justify'} onClick={() => change({ align: 'justify' })}>По ширине</button>
          <button type="button" className="chip" aria-pressed={settings.align === 'left'} onClick={() => change({ align: 'left' })}>По левому краю</button>
        </div>
      </div>
      <div className="rd-option">
        <span>Перелистывание</span>
        <div>
          <button type="button" className="chip" aria-pressed={settings.pageTurn === 'full'} onClick={() => change({ pageTurn: 'full' })}>Изгиб</button>
          <button type="button" className="chip" aria-pressed={settings.pageTurn === 'soft'} onClick={() => change({ pageTurn: 'soft' })}>Мягкое</button>
          <button type="button" className="chip" aria-pressed={settings.pageTurn === 'off'} onClick={() => change({ pageTurn: 'off' })}>Без анимации</button>
        </div>
      </div>
      <label className="rd-check">
        <input type="checkbox" checked={settings.reducedMotion} onChange={(event) => change({ reducedMotion: event.target.checked })} />
        Меньше движения
      </label>
      <label className="rd-check">
        <input
          type="checkbox"
          checked={perBook}
          onChange={(event) => {
            setPerBook(event.target.checked);
            scheduleSettingsSave(publicId);
          }}
        />
        Сохранить оформление только для этой книги
      </label>
    </motion.aside>
  );
}
