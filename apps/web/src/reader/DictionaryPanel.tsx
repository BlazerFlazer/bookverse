import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sentenceAround } from '@bookverse/reading-engine';
import type { LookupResultDto } from '@bookverse/shared';
import { api, ApiError } from '../lib/api.ts';
import { useSaveWord } from '../lib/queries.ts';
import { toast } from '../stores/toasts.ts';
import { IconCheck, IconClose } from '../ui/Icons.tsx';

export interface WordTarget {
  word: string;
  rect: DOMRect;
  blockKey: string;
  offset: number;
  blockText: string;
}

const PANEL_WIDTH = 348;
const GAP = 10;

function speak(text: string, language: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'en' ? 'en-GB' : 'ru-RU';
  speechSynthesis.speak(utterance);
}

export function DictionaryPanel({ target, publicId, language, onClose }: { target: WordTarget; publicId: string; language: 'ru' | 'en'; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const save = useSaveWord();
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const [showExamples, setShowExamples] = useState(false);

  const params = new URLSearchParams({ word: target.word, language, publicId, blockKey: target.blockKey });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['lookup', language, target.word.toLowerCase(), publicId, target.blockKey],
    queryFn: () => api<LookupResultDto>(`/dictionary/lookup?${params}`),
    staleTime: 300_000,
  });

  // Панель стоит рядом со словом и не вылезает за края экрана. На телефоне она становится нижним листом.
  useLayoutEffect(() => {
    const height = panel.current?.offsetHeight ?? 230;
    const narrow = window.innerWidth < 560;
    if (narrow) {
      setPosition({ left: 8, top: window.innerHeight - height - 8, above: false });
      return;
    }
    const below = target.rect.bottom + GAP + height <= window.innerHeight - 8;
    const top = below ? target.rect.bottom + GAP : Math.max(8, target.rect.top - GAP - height);
    const left = Math.min(window.innerWidth - PANEL_WIDTH - 8, Math.max(8, target.rect.left + target.rect.width / 2 - PANEL_WIDTH / 2));
    setPosition({ left, top, above: !below });
  }, [target, data, showExamples]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    const onDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  const storeWord = async (studyLater: boolean) => {
    if (!data) return;
    try {
      await save.mutateAsync({
        word: target.word,
        lemma: data.lemma,
        language,
        definition: data.definition,
        partOfSpeech: data.partOfSpeech,
        sourceLabel: data.sourceLabel,
        publicId,
        blockKey: target.blockKey,
        context: sentenceAround(target.blockText, target.offset),
        studyLater,
      });
      client.setQueryData(['lookup', language, target.word.toLowerCase(), publicId, target.blockKey], { ...data, saved: true });
      toast(studyLater ? 'Отложено на потом' : 'Слово в вашем словаре', data.lemma);
    } catch (error) {
      toast('Не удалось сохранить слово', error instanceof ApiError ? error.message : undefined, 'error');
    }
  };

  return (
    <motion.div
      ref={panel}
      className="dict-panel"
      role="dialog"
      aria-label={`Значение слова ${target.word}`}
      style={{ left: position?.left ?? -9999, top: position?.top ?? -9999, width: Math.min(PANEL_WIDTH, window.innerWidth - 16) }}
      initial={{ opacity: 0, y: position?.above ? 6 : -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.22, 0.72, 0.18, 1] }}
    >
      <button type="button" className="dict-close" onClick={onClose} aria-label="Закрыть">
        <IconClose width={16} height={16} />
      </button>
      <h2 className="dict-word">{data?.lemma ?? target.word}</h2>
      {data?.partOfSpeech && <p className="dict-pos">{data.partOfSpeech}</p>}
      {data && data.lemma.toLowerCase() !== target.word.toLowerCase() && <p className="dict-form">в тексте: {target.word}</p>}

      {isLoading && <p className="dict-text dict-muted">Ищем значение…</p>}
      {isError && <p className="dict-text dict-muted">Словарь сейчас не отвечает. Попробуйте ещё раз чуть позже.</p>}
      {data && !data.found && (
        <p className="dict-text dict-muted">
          Точного определения пока нет, а придумывать мы не будем. Слово можно сохранить и спросить о нём учителя.
        </p>
      )}
      {data?.found && <p className="dict-text">{data.definition}</p>}

      {data?.contextNote && (
        <div className="dict-context">
          <p className="dict-label">В этом предложении</p>
          <p>{data.contextNote}</p>
        </div>
      )}

      {showExamples && data && data.examples.length > 0 && (
        <div className="dict-context">
          <p className="dict-label">Пример</p>
          {data.examples.map((example) => <p key={example}>{example}</p>)}
        </div>
      )}

      {data?.sourceLabel && (
        <p className="dict-source">
          Определение: {data.sourceUrl ? <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.sourceLabel}</a> : data.sourceLabel}
          {data.contextNote ? ' · Пояснение: редакция BOOKVERSE' : ''}
        </p>
      )}

      <div className="dict-actions">
        <button type="button" onClick={() => speak(data?.lemma ?? target.word, language)}>🔊 Прослушать слово</button>
        <button type="button" onClick={() => void storeWord(false)} disabled={!data || data.saved || save.isPending} data-testid="save-word">
          {data?.saved ? <><IconCheck width={15} height={15} /> В моём словаре</> : '🔖 Добавить в мой словарь'}
        </button>
        <button type="button" onClick={() => setShowExamples((v) => !v)} disabled={!data || data.examples.length === 0}>📚 Посмотреть примеры</button>
        <button type="button" onClick={() => void storeWord(true)} disabled={!data || data.saved || save.isPending}>✨ Изучить позже</button>
      </div>
    </motion.div>
  );
}
