import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { BookDetailDto } from '@bookverse/shared';
import { IconClose, IconPause, IconPlay } from '../ui/Icons.tsx';
import type { useSpeech } from './useSpeech.ts';

const SPEEDS = [0.75, 1, 1.25, 1.5];
const TIMERS = [0, 10, 20, 30, 60];

export function ListenPanel({
  speech,
  book,
  chapterOrder,
  language,
  onPlay,
  onChapter,
  onClose,
}: {
  speech: ReturnType<typeof useSpeech>;
  book: BookDetailDto;
  chapterOrder: number;
  language: 'ru' | 'en';
  onPlay: () => void;
  onChapter: (order: number) => void;
  onClose: () => void;
}) {
  const [sleep, setSleep] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { stop } = speech;

  useEffect(() => {
    clearTimeout(timer.current);
    if (sleep > 0) timer.current = setTimeout(stop, sleep * 60_000);
    return () => clearTimeout(timer.current);
  }, [sleep, stop]);

  return (
    <motion.aside
      className="rd-listen"
      role="dialog"
      aria-label="Слушать книгу"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.26, ease: [0.22, 0.72, 0.18, 1] }}
    >
      <div className="rd-sheet-head">
        <h2 className="display">Слушать книгу</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть"><IconClose /></button>
      </div>

      {!speech.supported ? (
        <p className="rd-sheet-note">Этот браузер не умеет читать вслух. Попробуйте Chrome или Edge.</p>
      ) : (
        <>
          {speech.voices.length === 0 && (
            <p className="rd-sheet-note">
              {language === 'ru'
                ? 'В системе не нашлось русского голоса. Его можно добавить в параметрах Windows: «Время и язык» → «Речь». Пока книга будет звучать голосом по умолчанию.'
                : 'В системе не нашлось английского голоса. Пока книга будет звучать голосом по умолчанию.'}
            </p>
          )}
          <div className="listen-main">
            <button
              type="button"
              className="listen-play"
              aria-label={speech.state === 'playing' ? 'Пауза' : 'Слушать'}
              onClick={() => {
                if (speech.state === 'playing') speech.pause();
                else if (speech.state === 'paused') speech.resume();
                else onPlay();
              }}
            >
              {speech.state === 'playing' ? <IconPause width={22} height={22} /> : <IconPlay width={22} height={22} />}
            </button>
            <button type="button" className="btn btn-ghost" onClick={speech.stop} disabled={speech.state === 'idle'}>Остановить и читать</button>
          </div>

          <label className="listen-field">
            Глава
            <select className="select" value={chapterOrder} onChange={(event) => onChapter(Number(event.target.value))}>
              {book.chapters.map((c) => <option key={c.order} value={c.order}>{c.title}</option>)}
            </select>
          </label>
          {speech.voices.length > 0 && (
            <label className="listen-field">
              Голос
              <select className="select" value={speech.voiceUri} onChange={(event) => speech.setVoiceUri(event.target.value)}>
                {speech.voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
              </select>
            </label>
          )}
          <div className="rd-option">
            <span>Скорость</span>
            <div>
              {SPEEDS.map((speed) => (
                <button key={speed} type="button" className="chip" aria-pressed={speech.rate === speed} onClick={() => speech.setRate(speed)}>{speed}×</button>
              ))}
            </div>
          </div>
          <label className="rd-slider">
            <span>Громкость<em>{Math.round(speech.volume * 100)}%</em></span>
            <input type="range" min={0} max={1} step={0.05} value={speech.volume} onChange={(event) => speech.setVolume(Number(event.target.value))} />
          </label>
          <label className="listen-field">
            Таймер сна
            <select className="select" value={sleep} onChange={(event) => setSleep(Number(event.target.value))}>
              {TIMERS.map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? 'Выключен' : `${minutes} мин`}</option>)}
            </select>
          </label>
          <p className="rd-sheet-note">Подсвечивается абзац, который звучит сейчас. Прослушанное двигает бегуна так же, как чтение.</p>
        </>
      )}
    </motion.aside>
  );
}
