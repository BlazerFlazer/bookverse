import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBookId, normalizeForLookup } from '@bookverse/shared';
import { prisma } from '../db.ts';
import { seedAchievements } from '../game/service.ts';
import { parseBook, type ParsedChapter } from './parse.ts';

const CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content');
const BOOKS_DIR = join(CONTENT, 'books');
const REGISTRY = join(CONTENT, 'registry.json');

interface BookManifest {
  slug: string;
  title: string;
  author: string;
  authorSort: string;
  language: 'ru' | 'en';
  genre: string;
  description: string;
  ageBand: string;
  year: number | null;
  featured: boolean;
  cover: Record<string, string>;
  license: {
    kind: string;
    title: string;
    jurisdictionNote: string;
    sourceName: string;
    sourceUrl: string | null;
    verifiedAt: string;
  };
}

interface GlossaryEntry {
  lemma: string;
  pos: string;
  definition: string;
  examples: string[];
}

interface Note {
  lemma: string;
  match: string | null;
  note: string;
}

interface QuizFile {
  chapter: number;
  title: string;
  tasks: unknown[];
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const readOptional = <T>(path: string, fallback: T): T => (existsSync(path) ? readJson<T>(path) : fallback);

/** Скорость чтения для оценки длительности: школьники читают медленнее взрослых. */
const WORDS_PER_MINUTE = { ru: 130, en: 90 };

/**
 * Реестр закрепляет номера за книгами. Номер выдаётся один раз и хранится в репозитории,
 * поэтому BV-коды не меняются при пересоздании базы и не используются повторно.
 */
function assignSequences(slugs: string[]): Record<string, number> {
  const registry = readOptional<Record<string, number>>(REGISTRY, {});
  let next = Math.max(0, ...Object.values(registry)) + 1;
  for (const slug of slugs) {
    if (!registry[slug]) {
      registry[slug] = next;
      next += 1;
    }
  }
  writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
  return registry;
}

async function importBook(slug: string, sequence: number): Promise<ParsedChapter[]> {
  const dir = join(BOOKS_DIR, slug);
  const manifest = readJson<BookManifest>(join(dir, 'book.json'));
  const chapters = parseBook(readFileSync(join(dir, 'text.txt'), 'utf8'), manifest.title);
  const totalChars = chapters.reduce((sum, c) => sum + c.charLength, 0);
  const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
  const estMinutes = Math.max(1, Math.round(totalWords / WORDS_PER_MINUTE[manifest.language]));

  const data = {
    slug: manifest.slug,
    title: manifest.title,
    titleSearch: normalizeForLookup(manifest.title),
    author: manifest.author,
    authorSearch: normalizeForLookup(manifest.author),
    language: manifest.language,
    genre: manifest.genre,
    description: manifest.description,
    ageBand: manifest.ageBand,
    year: manifest.year,
    featured: manifest.featured,
    totalChars,
    totalWords,
    estMinutes,
    coverStyle: manifest.cover,
  };

  const book = await prisma.book.upsert({
    where: { slug },
    update: data,
    create: { ...data, sequence, publicId: formatBookId(sequence) },
  });

  await prisma.$transaction(async (tx) => {
    await tx.bookLicense.upsert({
      where: { bookId: book.id },
      update: manifest.license,
      create: { ...manifest.license, bookId: book.id },
    });
    await tx.bookChapter.deleteMany({ where: { bookId: book.id } });
    for (const chapter of chapters) {
      const { blocks, ...fields } = chapter;
      const row = await tx.bookChapter.create({ data: { ...fields, bookId: book.id } });
      await tx.bookContentBlock.createMany({
        data: blocks.map((block) => ({ ...block, bookId: book.id, chapterId: row.id })),
      });
    }
  });

  await prisma.contextNote.deleteMany({ where: { bookId: book.id } });
  const allBlocks = chapters.flatMap((c) => c.blocks);
  let unmatched = 0;
  for (const note of readOptional<Note[]>(join(dir, 'notes.json'), [])) {
    const block = note.match ? allBlocks.find((b) => b.text.includes(note.match!)) : null;
    if (note.match && !block) unmatched += 1;
    await prisma.contextNote.create({
      data: { bookId: book.id, lemmaKey: normalizeForLookup(note.lemma), blockKey: block?.key ?? null, note: note.note },
    });
  }

  for (const quiz of readOptional<QuizFile[]>(join(dir, 'quiz.json'), [])) {
    const payload = { title: quiz.title, tasks: quiz.tasks as object[] };
    await prisma.quiz.upsert({
      where: { bookId_chapterOrder: { bookId: book.id, chapterOrder: quiz.chapter } },
      update: payload,
      create: { ...payload, bookId: book.id, chapterOrder: quiz.chapter },
    });
  }

  console.log(`${book.publicId}  ${manifest.title}: глав ${chapters.length}, слов ${totalWords}, ~${estMinutes} мин${unmatched ? `, заметок без места: ${unmatched}` : ''}`);
  return chapters;
}

async function importGlossary(language: 'ru' | 'en'): Promise<number> {
  const entries = readOptional<GlossaryEntry[]>(join(CONTENT, 'glossary', `${language}.json`), []);
  for (const entry of entries) {
    const data = {
      lemma: entry.lemma,
      partOfSpeech: entry.pos,
      definition: entry.definition,
      examples: entry.examples,
      sourceUrl: null,
    };
    const lemmaKey = normalizeForLookup(entry.lemma);
    await prisma.dictionaryEntry.upsert({
      where: { lemmaKey_language_source: { lemmaKey, language, source: 'bookverse' } },
      update: data,
      create: { ...data, lemmaKey, language, source: 'bookverse' },
    });
  }
  return entries.length;
}

await seedAchievements();
const slugs = readdirSync(BOOKS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(BOOKS_DIR, entry.name, 'book.json')))
  .map((entry) => entry.name)
  // Первым идёт оригинальная повесть: её удобнее показывать, порядок закреплён реестром.
  .sort((a, b) => (a === 'khranitel' ? -1 : b === 'khranitel' ? 1 : a.localeCompare(b)));

const sequences = assignSequences(slugs);
for (const slug of slugs) await importBook(slug, sequences[slug]!);
console.log(`Словарь: ru ${await importGlossary('ru')}, en ${await importGlossary('en')} статей`);
await prisma.$disconnect();
