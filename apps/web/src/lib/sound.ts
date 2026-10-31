/**
 * Звук синтезируется на месте: файлов нет, а контекст создаётся только после жеста пользователя,
 * поэтому браузер ничего не воспроизводит сам по себе.
 */
let context: AudioContext | null = null;
let enabled = true;

function audio(): AudioContext | null {
  if (!enabled) return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Низкий нарастающий гул пробуждения книги. */
export function playAwakening(): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.16, now + 0.9);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + 3.6);
  gain.connect(ctx.destination);
  for (const [frequency, detune] of [[55, 0], [82.4, 6], [110, -5]] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + 2.8);
    osc.detune.value = detune;
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 3.7);
  }
}

/** Шорох бумаги: отфильтрованный шум. Интенсивность задаёт длину и громкость. */
export function playRustle(intensity = 1, duration = 1.4): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, duration);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2400, now);
  filter.frequency.exponentialRampToValueAtTime(900, now + duration);
  filter.Q.value = 0.6;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.09 * intensity, now + duration * 0.25);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);
}

export function playPageTurn(): void {
  playRustle(0.55, 0.32);
}

/** Мягкий аккорд достижения. */
export function playChime(): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const start = now + index * 0.09;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.06, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0006, start + 1.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 1.4);
  });
}
