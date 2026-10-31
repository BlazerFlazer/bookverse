import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

interface AzParse {
  normalize(): { word: string };
  tag: { POS?: string };
  score: number;
}
interface AzStatic {
  Morph: ((word: string) => AzParse[]) & { init(path: string, done: (error?: unknown) => void): void };
}

const require = createRequire(import.meta.url);
const Az = require('az') as AzStatic;
const DICTS = join(dirname(require.resolve('az')), '..', 'dicts');

let ready: Promise<void> | null = null;

/** Словари OpenCorpora грузятся один раз, примерно за 100 мс. */
export function initMorphology(): Promise<void> {
  ready ??= new Promise((resolve, reject) => {
    Az.Morph.init(DICTS, (error) => (error ? reject(error instanceof Error ? error : new Error(String(error))) : resolve()));
  });
  return ready;
}

const POS_LABELS: Record<string, string> = {
  NOUN: 'сущ.',
  ADJF: 'прил.',
  ADJS: 'прил.',
  COMP: 'прил.',
  VERB: 'гл.',
  INFN: 'гл.',
  PRTF: 'гл.',
  PRTS: 'гл.',
  GRND: 'гл.',
  ADVB: 'нар.',
  NPRO: 'мест.',
  CONJ: 'союз',
  INTJ: 'межд.',
  PRCL: 'част.',
  PREP: 'предл.',
  NUMR: 'числ.',
};

export interface LemmaCandidate {
  lemma: string;
  partOfSpeech: string | null;
}

/** Разборы русской формы слова от самого вероятного: «удивительного» → «удивительный». */
export async function russianLemmas(word: string): Promise<LemmaCandidate[]> {
  await initMorphology();
  const seen = new Set<string>();
  const candidates: LemmaCandidate[] = [];
  for (const parse of Az.Morph(word)) {
    const lemma = parse.normalize().word.toLowerCase();
    if (seen.has(lemma)) continue;
    seen.add(lemma);
    candidates.push({ lemma, partOfSpeech: POS_LABELS[parse.tag.POS ?? ''] ?? null });
  }
  return candidates;
}

const ENGLISH_IRREGULAR: Record<string, string> = {
  went: 'go', gone: 'go', said: 'say', saw: 'see', seen: 'see', took: 'take', taken: 'take', came: 'come',
  thought: 'think', found: 'find', felt: 'feel', got: 'get', made: 'make', knew: 'know', known: 'know',
  began: 'begin', begun: 'begin', ran: 'run', fell: 'fall', fallen: 'fall', grew: 'grow', grown: 'grow',
  sat: 'sit', stood: 'stand', heard: 'hear', spoke: 'speak', spoken: 'speak', better: 'good', best: 'good',
  worse: 'bad', worst: 'bad', children: 'child', feet: 'foot', mice: 'mouse', men: 'man', women: 'woman',
};

/** Для английского хватает правил суффиксов: кандидаты проверяются по словарю по очереди. */
export function englishLemmas(word: string): LemmaCandidate[] {
  const w = word.toLowerCase().replace(/['’]s$/, '');
  const forms = [w];
  const irregular = ENGLISH_IRREGULAR[w];
  if (irregular) forms.unshift(irregular);
  if (w.endsWith('ies')) forms.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) forms.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) forms.push(w.slice(0, -1));
  if (w.endsWith('ied')) forms.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ed')) forms.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) forms.push(w.slice(0, -3), `${w.slice(0, -3)}e`);
  if (/(ed|ing)$/.test(w)) {
    const stem = w.replace(/(ed|ing)$/, '');
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) forms.push(stem.slice(0, -1));
  }
  if (w.endsWith('ly')) forms.push(w.slice(0, -2));
  if (w.endsWith('er')) forms.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est')) forms.push(w.slice(0, -3), w.slice(0, -2));
  return [...new Set(forms)].filter((f) => f.length > 1).map((lemma) => ({ lemma, partOfSpeech: null }));
}
