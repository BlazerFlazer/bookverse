import { normalizeForLookup } from '@bookverse/shared';
import type { DefinitionSource, LookupResultDto } from '@bookverse/shared';
import { config } from '../config.ts';
import { prisma } from '../db.ts';
import { englishLemmas, russianLemmas, type LemmaCandidate } from './morphology.ts';
import { fetchWiktionary } from './wiktionary.ts';

const SOURCE_LABEL: Record<DefinitionSource, string> = {
  bookverse: 'Словарь BOOKVERSE',
  wiktionary: 'Викисловарь · CC BY-SA',
};

/** Слова, которых нет в Викисловаре: не дёргаем сеть повторно. */
const missing = new Map<string, number>();
const MISSING_TTL_MS = 3_600_000;

interface LookupRequest {
  word: string;
  language: 'ru' | 'en';
  publicId?: string;
  blockKey?: string;
  userId?: string | null;
}

async function entryFor(candidates: LemmaCandidate[], language: string) {
  const keys = candidates.map((c) => normalizeForLookup(c.lemma));
  const stored = await prisma.dictionaryEntry.findMany({ where: { lemmaKey: { in: keys }, language } });
  for (const source of ['bookverse', 'wiktionary'] as const) {
    for (const key of keys) {
      const entry = stored.find((e) => e.lemmaKey === key && e.source === source);
      if (entry) return entry;
    }
  }
  return null;
}

async function remoteEntry(candidates: LemmaCandidate[], language: string) {
  if (config.WIKTIONARY_LOOKUP !== 'on') return null;
  for (const candidate of candidates.slice(0, 3)) {
    const key = normalizeForLookup(candidate.lemma);
    const cacheKey = `${language}:${key}`;
    if ((missing.get(cacheKey) ?? 0) > Date.now()) continue;
    const remote = await fetchWiktionary(candidate.lemma, language);
    if (!remote) {
      missing.set(cacheKey, Date.now() + MISSING_TTL_MS);
      continue;
    }
    return prisma.dictionaryEntry.upsert({
      where: { lemmaKey_language_source: { lemmaKey: key, language, source: 'wiktionary' } },
      update: {},
      create: {
        lemmaKey: key,
        lemma: candidate.lemma,
        language,
        partOfSpeech: remote.partOfSpeech ?? candidate.partOfSpeech,
        definition: remote.definition,
        examples: [],
        source: 'wiktionary',
        sourceUrl: remote.sourceUrl,
      },
    });
  }
  return null;
}

async function contextNote(publicId: string | undefined, blockKey: string | undefined, keys: string[]): Promise<string | null> {
  if (!publicId) return null;
  const book = await prisma.book.findUnique({ where: { publicId }, select: { id: true } });
  if (!book) return null;
  const notes = await prisma.contextNote.findMany({ where: { bookId: book.id, lemmaKey: { in: keys } } });
  // Точное место важнее общего замечания о слове в этой книге.
  return (notes.find((n) => n.blockKey === blockKey) ?? notes.find((n) => n.blockKey === null))?.note ?? null;
}

export async function lookup(request: LookupRequest): Promise<LookupResultDto> {
  const { word, language } = request;
  const candidates = language === 'ru' ? await russianLemmas(word) : englishLemmas(word);
  if (candidates.length === 0) candidates.push({ lemma: word.toLowerCase(), partOfSpeech: null });

  const entry = (await entryFor(candidates, language)) ?? (await remoteEntry(candidates, language));
  const lemma = entry?.lemma ?? candidates[0]!.lemma;
  const keys = entry ? [entry.lemmaKey] : candidates.map((c) => normalizeForLookup(c.lemma));

  const saved = request.userId
    ? (await prisma.savedVocabulary.count({
        where: { userId: request.userId, language, lemmaKey: normalizeForLookup(lemma) },
      })) > 0
    : false;

  return {
    word,
    lemma,
    language,
    found: Boolean(entry),
    partOfSpeech: entry?.partOfSpeech ?? candidates[0]?.partOfSpeech ?? null,
    definition: entry?.definition ?? null,
    examples: (entry?.examples as string[] | undefined) ?? [],
    source: (entry?.source as DefinitionSource | undefined) ?? null,
    sourceLabel: entry ? SOURCE_LABEL[entry.source as DefinitionSource] : null,
    sourceUrl: entry?.sourceUrl ?? null,
    contextNote: await contextNote(request.publicId, request.blockKey, keys),
    saved,
  };
}
