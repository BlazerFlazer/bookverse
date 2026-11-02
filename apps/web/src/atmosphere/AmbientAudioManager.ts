import { unlockAudio } from '../lib/sound.ts';
import type { MixLevels } from './mix.ts';

const LOOP_SECONDS = 9;
const FADE = 1.4;
const QUICK_FADE = 0.5;

/** Шум с плавным переходом конца в начало: петля дождя не щёлкает на стыке. */
function loopBuffer(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const overlap = Math.floor(ctx.sampleRate * 0.6);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const raw = new Float32Array(length + overlap);
    let last = 0;
    for (let i = 0; i < raw.length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + white * 0.02) / 1.02;
        raw[i] = last * 3.5;
      } else {
        raw[i] = white * 0.5;
      }
    }
    const data = buffer.getChannelData(channel);
    data.set(raw.subarray(0, length));
    for (let i = 0; i < overlap; i += 1) {
      const t = i / overlap;
      data[i] = data[i]! * t + raw[length + i]! * (1 - t);
    }
  }
  return buffer;
}

/**
 * Звуки атмосферы синтезируются на месте, как и остальные звуки сайта: файлов и лицензий нет.
 * Постоянные слои идут петлями, а капли, треск камина, скрип дерева и гром планируются случайно.
 */
export class AmbientAudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private rain: GainNode | null = null;
  private hiss: GainNode | null = null;
  private room: GainNode | null = null;
  private fire: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private nextDrop = 0;
  private nextCrackle = 0;
  private nextCreak = 0;
  /** На слабых устройствах остаются только постоянные слои. */
  simple = false;
  failed = false;
  levels: MixLevels | null = null;

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  private loop(buffer: AudioBuffer, shape: (source: AudioBufferSourceNode) => AudioNode, offset: number): GainNode {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    shape(source).connect(gain).connect(this.master!);
    source.start(0, offset);
    return gain;
  }

  private filterNode(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const node = this.ctx!.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  /** Вызывается только из обработчика клика или клавиши: иначе браузер не даст играть звук. */
  start(): void {
    if (this.failed) return;
    try {
      this.ctx = unlockAudio();
      if (this.master) return;
      const ctx = this.ctx;
      this.white = loopBuffer(ctx, LOOP_SECONDS, false);
      this.brown = loopBuffer(ctx, LOOP_SECONDS, true);
      this.filter = this.filterNode('lowpass', 16_000);
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.filter).connect(ctx.destination);

      const lowRain = (source: AudioBufferSourceNode) => source.connect(this.filterNode('bandpass', 900, 0.4));
      const highRain = (source: AudioBufferSourceNode) => source.connect(this.filterNode('highpass', 4200));
      const roomTone = (source: AudioBufferSourceNode) => source.connect(this.filterNode('lowpass', 210));
      const fireBed = (source: AudioBufferSourceNode) => source.connect(this.filterNode('bandpass', 420, 0.5));
      this.rain = this.loop(this.white, lowRain, 0);
      this.hiss = this.loop(this.white, highRain, 3.1);
      this.room = this.loop(this.brown, roomTone, 1.4);
      this.fire = this.loop(this.brown, fireBed, 5.2);
    } catch (error) {
      // Без звука сайт остаётся полностью рабочим, а панель честно покажет, что его нет.
      console.error(error);
      this.failed = true;
    }
  }

  /** Плавно подводит слои к нужным уровням и планирует случайные звуки на ближайшие мгновения. */
  update(levels: MixLevels, horizon: number): void {
    this.levels = levels;
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.master.gain.setTargetAtTime(levels.master * 0.5, now, FADE / 2);
    this.filter!.frequency.setTargetAtTime(levels.cutoff, now, FADE / 2);
    this.rain!.gain.setTargetAtTime(levels.rain * 0.72, now, FADE);
    this.hiss!.gain.setTargetAtTime(this.simple ? 0 : levels.hiss * 0.2, now, FADE);
    this.room!.gain.setTargetAtTime(levels.room * 0.5, now, FADE);
    this.fire!.gain.setTargetAtTime(this.simple ? 0 : levels.fire * 0.5, now, FADE);
    if (this.simple || levels.master <= 0.001) return;
    const until = now + horizon;
    this.nextDrop = Math.max(this.nextDrop, now);
    while (this.nextDrop < until) {
      this.tapGlass(this.nextDrop);
      this.nextDrop += (0.3 + Math.random() * 1.4) / levels.drops;
    }
    if (levels.fire > 0.05) {
      this.nextCrackle = Math.max(this.nextCrackle, now);
      while (this.nextCrackle < until) {
        this.crackle(this.nextCrackle, levels.fire);
        this.nextCrackle += 0.08 + Math.random() ** 2 * 2.4;
      }
    }
    if (this.nextCreak === 0) this.nextCreak = now + 20 + Math.random() * 40;
    if (now >= this.nextCreak) {
      this.creak(now + 0.1);
      this.nextCreak = now + 50 + Math.random() * 90;
    }
  }

  /** Быстрое выключение: ползунок и кнопка должны откликаться сразу. */
  silence(): void {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, QUICK_FADE / 3);
  }

  private burst(buffer: AudioBuffer, at: number, duration: number, offset: number): { source: AudioBufferSourceNode; gain: GainNode } {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.start(at, offset, duration);
    return { source, gain };
  }

  private pan(value: number): StereoPannerNode {
    const node = this.ctx!.createStereoPanner();
    node.pan.value = value;
    return node;
  }

  /** Капля на стекле: короткий щелчок с окраской и случайным местом в комнате. */
  private tapGlass(at: number): void {
    const { source, gain } = this.burst(this.white!, at, 0.05, Math.random() * (LOOP_SECONDS - 0.1));
    const strength = 0.03 + Math.random() ** 3 * 0.11;
    gain.gain.setValueAtTime(strength, at);
    gain.gain.exponentialRampToValueAtTime(0.0004, at + 0.04 + Math.random() * 0.03);
    source.connect(this.filterNode('bandpass', 1300 + Math.random() * 3200, 2.4)).connect(gain).connect(this.pan(Math.random() * 1.6 - 0.8)).connect(this.master!);
  }

  private crackle(at: number, level: number): void {
    const { source, gain } = this.burst(this.white!, at, 0.04, Math.random() * (LOOP_SECONDS - 0.1));
    gain.gain.setValueAtTime((0.05 + Math.random() ** 2 * 0.22) * level, at);
    gain.gain.exponentialRampToValueAtTime(0.0004, at + 0.03);
    source.connect(this.filterNode('highpass', 1800 + Math.random() * 2400)).connect(gain).connect(this.pan(-0.5)).connect(this.master!);
  }

  /** Деревянный зал чуть слышно отзывается: очень редкий низкий скрип. */
  private creak(at: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const base = 70 + Math.random() * 50;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, at);
    osc.frequency.linearRampToValueAtTime(base * 1.16, at + 0.5);
    osc.frequency.linearRampToValueAtTime(base * 0.94, at + 1);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.014, at + 0.25);
    gain.gain.linearRampToValueAtTime(0, at + 1.05);
    osc.connect(this.filterNode('bandpass', 340, 3)).connect(gain).connect(this.pan(Math.random() - 0.5)).connect(this.master!);
    osc.start(at);
    osc.stop(at + 1.1);
  }

  /** Далёкий раскат: глухой шум без резкого начала. */
  thunder(delay: number, strength = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.brown) return;
    const at = ctx.currentTime + delay;
    const length = 5 + Math.random() * 2.5;
    const source = ctx.createBufferSource();
    source.buffer = this.brown;
    source.loop = true;
    const filter = this.filterNode('lowpass', 240);
    filter.frequency.setValueAtTime(240, at);
    filter.frequency.exponentialRampToValueAtTime(70, at + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1.1 * strength, at + 0.9);
    gain.gain.linearRampToValueAtTime(0.55 * strength, at + 1.8);
    gain.gain.linearRampToValueAtTime(0.75 * strength, at + 2.5);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(at, Math.random() * 4);
    source.stop(at + length + 0.1);
  }
}
