import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockDto } from '@bookverse/shared';

export type SpeechState = 'idle' | 'playing' | 'paused';

/** Длинные фрагменты браузеры обрывают, поэтому текст идёт короткими кусками по предложениям. */
function chunks(text: string): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*["»)]*\s*/g) ?? [text];
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length > 220 && current) {
      parts.push(current);
      current = sentence;
    } else current += sentence;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export interface SpeechOptions {
  language: 'ru' | 'en';
  onBlockStart: (block: BlockDto) => void;
  onBlockDone: (block: BlockDto) => void;
  onChapterEnd: () => void;
}

/**
 * Озвучка голосом браузера. Синхронизация идёт по абзацам: точного времени каждого слова
 * браузер не даёт, поэтому караоке по словам мы и не изображаем.
 */
export function useSpeech({ language, onBlockStart, onBlockDone, onChapterEnd }: SpeechOptions) {
  const supported = 'speechSynthesis' in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState('');
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [state, setState] = useState<SpeechState>('idle');

  const queue = useRef<BlockDto[]>([]);
  const index = useRef(0);
  const session = useRef(0);
  const settings = useRef({ rate, volume, voiceUri });
  settings.current = { rate, volume, voiceUri };
  const callbacks = useRef({ onBlockStart, onBlockDone, onChapterEnd });
  callbacks.current = { onBlockStart, onBlockDone, onChapterEnd };

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      const all = speechSynthesis.getVoices();
      const matching = all.filter((v) => v.lang.toLowerCase().startsWith(language));
      setVoices(matching);
      setVoiceUri((current) => current || (matching.find((v) => /natural|online|google/i.test(v.name)) ?? matching[0])?.voiceURI || '');
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load);
      speechSynthesis.cancel();
    };
  }, [language, supported]);

  const speakBlock = useCallback(
    (run: number) => {
      const block = queue.current[index.current];
      if (!block) {
        setState('idle');
        callbacks.current.onChapterEnd();
        return;
      }
      if (block.kind === 'ornament') {
        index.current += 1;
        speakBlock(run);
        return;
      }
      callbacks.current.onBlockStart(block);
      const parts = chunks(block.text);
      let part = 0;
      const next = () => {
        if (run !== session.current) return;
        const text = parts[part];
        if (text === undefined) {
          callbacks.current.onBlockDone(block);
          index.current += 1;
          speakBlock(run);
          return;
        }
        part += 1;
        const utterance = new SpeechSynthesisUtterance(text);
        const { rate: r, volume: v, voiceUri: uri } = settings.current;
        utterance.lang = language === 'en' ? 'en-GB' : 'ru-RU';
        utterance.rate = r;
        utterance.volume = v;
        const voice = speechSynthesis.getVoices().find((item) => item.voiceURI === uri);
        if (voice) utterance.voice = voice;
        utterance.onend = next;
        utterance.onerror = (event) => {
          if (event.error !== 'canceled' && event.error !== 'interrupted') setState('idle');
        };
        speechSynthesis.speak(utterance);
      };
      next();
    },
    [language],
  );

  const start = useCallback(
    (blocks: BlockDto[], from = 0) => {
      if (!supported) return;
      speechSynthesis.cancel();
      session.current += 1;
      queue.current = blocks;
      index.current = from;
      setState('playing');
      speakBlock(session.current);
    },
    [speakBlock, supported],
  );

  const pause = useCallback(() => {
    speechSynthesis.pause();
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    speechSynthesis.resume();
    setState('playing');
  }, []);

  const stop = useCallback(() => {
    session.current += 1;
    if (supported) speechSynthesis.cancel();
    setState('idle');
  }, [supported]);

  return { supported, voices, voiceUri, setVoiceUri, rate, setRate, volume, setVolume, state, start, pause, resume, stop };
}
