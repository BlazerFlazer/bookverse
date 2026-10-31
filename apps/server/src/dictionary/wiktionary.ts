/**
 * Резервный источник определений: русский Викисловарь (CC BY-SA). Сетевых ключей не требует.
 * Разбираем только раздел «Значение» нужного языка; если он пуст или это отсылка на другую
 * форму, определения нет. Придумывать его мы не будем.
 */
const TIMEOUT_MS = 2500;
const LANGUAGE_SECTION: Record<string, string> = { ru: '-ru-', en: '-en-' };
const REFERENCE_ONLY = /^(?:форма|действие по значению|состояние по значению|свойство по значению)/i;

const POS_BY_TEMPLATE: [RegExp, string][] = [
  [/\{\{(?:сущ|Сущ)\b/, 'сущ.'],
  [/\{\{(?:прил|Прил|мест ru|числ)\b/, 'прил.'],
  [/\{\{(?:гл|Гл|спряжения|спр ru)\b/, 'гл.'],
  [/\{\{(?:adv|нареч|Нареч)\b/, 'нар.'],
  [/\{\{(?:interj|межд)\b/, 'межд.'],
];

export interface WiktionaryEntry {
  definition: string;
  partOfSpeech: string | null;
  sourceUrl: string;
}

function stripTemplates(line: string): string {
  let text = line;
  // Сначала убираем примеры и пометы, затем разворачиваем ссылки.
  for (let pass = 0; pass < 4; pass += 1) {
    text = text
      .replace(/\{\{(?:пример|example)\|[^{}]*\}\}/g, '')
      .replace(/\{\{=\|([^{}|]*)[^{}]*\}\}/g, 'то же, что $1')
      .replace(/\{\{помета\|([^{}|]*)[^{}]*\}\}/g, '')
      .replace(/\{\{[^{}]*\}\}/g, '');
  }
  return text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>.*?<\/ref>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#\d+;|&[a-z]+;/g, ' ')
    .replace(/'{2,}/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:—-]+/, '')
    .trim();
}

export function parseWiktionary(wikitext: string, language: string): Omit<WiktionaryEntry, 'sourceUrl'> | null {
  const marker = LANGUAGE_SECTION[language];
  if (!marker) return null;
  const sections = wikitext.split(/^=\s*\{\{\s*(-[a-z-]+-)[^}]*\}\}\s*=\s*$/m);
  const index = sections.indexOf(marker);
  if (index < 0) return null;
  const section = sections[index + 1] ?? '';

  const meaning = section.match(/^={3,4}\s*Значение\s*={3,4}\s*$([\s\S]*?)(?=^={2,4}[^=])/m);
  if (!meaning?.[1]) return null;

  const definition = meaning[1]
    .split('\n')
    .filter((line) => /^#[^#*:]/.test(line))
    .map((line) => stripTemplates(line.slice(1)))
    .find((line) => line.length > 3 && !REFERENCE_ONLY.test(line));
  if (!definition) return null;

  const partOfSpeech = POS_BY_TEMPLATE.find(([pattern]) => pattern.test(section))?.[1] ?? null;
  const sentence = definition.replace(/[;:,]$/, '');
  return { definition: /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`, partOfSpeech };
}

export async function fetchWiktionary(lemma: string, language: string): Promise<WiktionaryEntry | null> {
  const title = encodeURIComponent(lemma);
  try {
    const response = await fetch(`https://ru.wiktionary.org/w/index.php?title=${title}&action=raw`, {
      headers: { 'user-agent': 'BookVerse/0.1 (educational reading platform)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = parseWiktionary(await response.text(), language);
    return parsed ? { ...parsed, sourceUrl: `https://ru.wiktionary.org/wiki/${title}` } : null;
  } catch {
    return null;
  }
}
