import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { EFFECT_QUALITIES, PHASE_LABELS, PHASE_NOTES, PHASE_SHORT_LABELS, PRESET_LABELS, RAIN_INTENSITIES, RAIN_LABELS, TIME_PHASES } from '@bookverse/shared';
import type { EffectQuality, TimePhase } from '@bookverse/shared';
import { useAtmosphere, type AudioState, type SaveState } from '../atmosphere/store.ts';
import { useWorld } from '../stores/world.ts';
import { focusFireplace, focusWindow, returnHome } from '../world/director.ts';
import { IconClose } from './Icons.tsx';

const QUALITY_LABELS: Record<EffectQuality, string> = { auto: 'Авто', low: 'Низкое', medium: 'Среднее', high: 'Высокое', ultra: 'Ультра' };

const AUDIO_NOTES: Record<AudioState, string> = {
  off: 'Сейчас выключены',
  waiting: 'Заиграют после первого нажатия на странице',
  playing: 'Дождь, комната и камин слышны сейчас',
  unavailable: 'Браузер не дал включить звук',
};

const SAVE_NOTES: Record<SaveState, string> = {
  local: 'Настройки сохранены в этом браузере. После регистрации они перейдут в аккаунт.',
  saving: 'Сохраняем в аккаунте…',
  saved: 'Настройки сохранены в аккаунте.',
  failed: 'Не удалось сохранить в аккаунте: настройки остались в этом браузере.',
};

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

function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="atmos-choice">
      <legend>{label}</legend>
      <div className="atmos-options">{children}</div>
    </fieldset>
  );
}

function Option({ pressed, onClick, note, children }: { pressed: boolean; onClick: () => void; note?: string; children: ReactNode }) {
  return (
    <button type="button" className="atmos-option" aria-pressed={pressed} onClick={onClick}>
      <span>{children}</span>
      {note && <small>{note}</small>}
    </button>
  );
}

/** Сами настройки: они же стоят на странице «Настройки». */
export function AtmosphereControls({ hideQuality = false }: { hideQuality?: boolean }) {
  const settings = useAtmosphere((s) => s.settings);
  const update = useAtmosphere((s) => s.update);
  const phase = useAtmosphere((s) => s.phase);
  const audioState = useAtmosphere((s) => s.audioState);
  const saveState = useAtmosphere((s) => s.saveState);
  const linkPhase = useAtmosphere((s) => s.linkPhase);
  const setLinkPhase = useAtmosphere((s) => s.setLinkPhase);
  const demo = useAtmosphere((s) => s.demo);
  const soundOn = useWorld((s) => s.soundOn);
  const reducedMotion = useWorld((s) => s.reducedMotion);
  const webgl = useWorld((s) => s.webgl);

  const choosePhase = (next: TimePhase | 'auto') => {
    setLinkPhase(null);
    update(next === 'auto' ? { autoTimeOfDayEnabled: true } : { autoTimeOfDayEnabled: false, preferredManualTimeOfDay: next });
  };

  return (
    <div className="atmos-controls">
      <p className="atmos-now" aria-live="polite" data-testid="atmosphere-now">
        <span>Сейчас</span>
        <b>{PHASE_LABELS[phase]}</b>
      </p>

      {demo?.time && <p className="atmos-note">Сейчас временем суток управляет ведущий показа.</p>}
      {linkPhase && !demo?.time && (
        <p className="atmos-note">
          Открыто по ссылке: {PHASE_LABELS[linkPhase]}.{' '}
          <button type="button" className="link-button" onClick={() => setLinkPhase(null)}>Вернуть мои настройки</button>
        </p>
      )}

      <Choice label="Атмосфера библиотеки">
        <Option pressed={settings.preferredAtmospherePreset === 'rain'} onClick={() => update({ preferredAtmospherePreset: 'rain' })} note="Окна, капли и шум дождя">
          {PRESET_LABELS.rain}
        </Option>
      </Choice>

      <div className="atmos-rows">
        <Toggle
          label="Звуки атмосферы"
          note={!soundOn ? 'Общий звук сайта выключен: значок динамика вверху' : AUDIO_NOTES[audioState]}
          checked={settings.atmosphereAudioEnabled}
          onChange={(value) => update({ atmosphereAudioEnabled: value })}
        />
        <label className="setting-row atmos-volume">
          <span>
            <b>Громкость атмосферы</b>
            <small>{Math.round(settings.atmosphereVolume * 100)}%</small>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.atmosphereVolume}
            disabled={!settings.atmosphereAudioEnabled}
            onChange={(event) => update({ atmosphereVolume: Number(event.target.value) })}
          />
        </label>
        <Toggle
          label="Снижать звуки во время чтения"
          note="Книга открыта: дождь становится тише и мягче"
          checked={settings.readingAudioDuckEnabled}
          onChange={(value) => update({ readingAudioDuckEnabled: value })}
        />
        <Toggle
          label="Автоматическая смена времени суток"
          note="Утро, день, вечер и ночь плавно сменяют друг друга"
          checked={settings.autoTimeOfDayEnabled}
          onChange={(value) => choosePhase(value ? 'auto' : phase)}
        />
      </div>

      <Choice label="Текущее время суток">
        <Option pressed={settings.autoTimeOfDayEnabled} onClick={() => choosePhase('auto')} note="Само по кругу">Автоматически</Option>
        {TIME_PHASES.map((item) => (
          <Option key={item} pressed={!settings.autoTimeOfDayEnabled && settings.preferredManualTimeOfDay === item} onClick={() => choosePhase(item)} note={PHASE_NOTES[item]}>
            {PHASE_SHORT_LABELS[item]}
          </Option>
        ))}
      </Choice>

      {settings.autoTimeOfDayEnabled && (
        <Choice label="Как идёт время">
          <Option pressed={settings.timeOfDaySource === 'cycle'} onClick={() => update({ timeOfDaySource: 'cycle' })} note="Полный круг за 24 минуты">Быстрые сутки</Option>
          <Option pressed={settings.timeOfDaySource === 'clock'} onClick={() => update({ timeOfDaySource: 'clock' })} note="Как за вашим окном">По часам</Option>
        </Choice>
      )}

      <Choice label="Интенсивность дождя">
        {RAIN_INTENSITIES.map((item) => (
          <Option key={item} pressed={settings.rainIntensity === item} onClick={() => update({ rainIntensity: item })}>{RAIN_LABELS[item]}</Option>
        ))}
      </Choice>

      {!hideQuality && (
        <Choice label="Качество эффектов">
          {EFFECT_QUALITIES.map((item) => (
            <Option key={item} pressed={settings.effectsQuality === item} onClick={() => update({ effectsQuality: item })}>{QUALITY_LABELS[item]}</Option>
          ))}
        </Choice>
      )}

      <div className="atmos-rows">
        <Toggle
          label="Показывать молнии"
          note={reducedMotion ? 'При «Меньше движения» вспышек нет, слышен только гром' : 'Редкие и мягкие вспышки вечером и ночью'}
          checked={settings.lightningEnabled}
          onChange={(value) => update({ lightningEnabled: value })}
        />
      </div>

      {reducedMotion && <p className="atmos-note">Включено «Меньше движения»: капли и пламя стоят на месте, а время суток меняется плавным светом.</p>}
      {!webgl && <p className="atmos-note">На этом устройстве работает плоская версия: окно с дождём вместо 3D-зала.</p>}
      <p className="atmos-save" role="status">{SAVE_NOTES[saveState]}</p>
    </div>
  );
}

/** Панель поверх живого зала: изменения видны и слышны сразу. */
export function AtmosphereDrawer() {
  const open = useAtmosphere((s) => s.panelOpen);
  const setOpen = useAtmosphere((s) => s.setPanelOpen);
  const stage = useWorld((s) => s.stage);
  const webgl = useWorld((s) => s.webgl);
  const location = useLocation();
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Фокус возвращается на кнопку, которая открыла панель.
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, setOpen]);

  const inHall = location.pathname === '/' && stage === 'library' && webgl;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="atmos-drawer glass"
          role="dialog"
          aria-labelledby="atmos-title"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.28, ease: [0.22, 0.72, 0.18, 1] }}
        >
          <header>
            <h2 id="atmos-title" className="display">Живая библиотека</h2>
            <button ref={closeButton} type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть панель"><IconClose /></button>
          </header>
          {inHall && (
            <div className="atmos-camera">
              <button type="button" className="btn btn-ghost" onClick={focusWindow}>К окну</button>
              <button type="button" className="btn btn-ghost" onClick={focusFireplace}>К камину</button>
              <button type="button" className="btn btn-ghost" onClick={returnHome}>В центр зала</button>
            </div>
          )}
          <AtmosphereControls />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** Подпись времени суток: его нельзя понимать только по оттенку света. */
export function AtmospherePill() {
  const phase = useAtmosphere((s) => s.phase);
  const setOpen = useAtmosphere((s) => s.setPanelOpen);
  return (
    <button type="button" className="atmos-pill glass" data-testid="atmosphere-pill" onClick={() => setOpen(true)}>
      {PHASE_LABELS[phase]}
    </button>
  );
}
