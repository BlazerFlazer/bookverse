import type { ReaderSettings } from './themes.ts';

export interface CoverStyle {
  leather: string;
  leatherDeep: string;
  foil: string;
  motif: string;
}

export interface UserDto {
  id: string;
  displayName: string;
  email: string | null;
  isGuest: boolean;
  xp: number;
  level: number;
  rank: string;
}

export interface BookProgressDto {
  percent: number;
  status: 'reading' | 'completed';
  chapterOrder: number;
  blockKey: string | null;
  offset: number;
  canonicalPos: number;
  updatedAt: string;
}

export interface BookSummaryDto {
  publicId: string;
  slug: string;
  title: string;
  author: string;
  language: 'ru' | 'en';
  genre: string;
  description: string;
  ageBand: string;
  year: number | null;
  featured: boolean;
  estMinutes: number;
  totalWords: number;
  chapterCount: number;
  cover: CoverStyle;
  progress: BookProgressDto | null;
}

export interface ChapterSummaryDto {
  order: number;
  title: string;
  charStart: number;
  charLength: number;
  wordCount: number;
}

export interface LicenseDto {
  kind: 'PUBLIC_DOMAIN' | 'ORIGINAL' | 'LICENSED';
  title: string;
  jurisdictionNote: string;
  sourceName: string;
  sourceUrl: string | null;
  verifiedAt: string;
}

export interface BookDetailDto extends BookSummaryDto {
  totalChars: number;
  chapters: ChapterSummaryDto[];
  license: LicenseDto;
  narration: { tts: boolean; recordings: number };
  hasQuizzes: boolean;
}

export type BlockKind = 'p' | 'verse' | 'ornament';

export interface BlockDto {
  key: string;
  order: number;
  kind: BlockKind;
  text: string;
  charStart: number;
  charLength: number;
}

export interface ChapterContentDto extends ChapterSummaryDto {
  publicId: string;
  blocks: BlockDto[];
}

export type DefinitionSource = 'bookverse' | 'wiktionary';

export interface LookupResultDto {
  word: string;
  lemma: string;
  language: 'ru' | 'en';
  found: boolean;
  partOfSpeech: string | null;
  definition: string | null;
  examples: string[];
  source: DefinitionSource | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  /** Пояснение редакции к этому месту книги. Есть только там, где оно проверено вручную. */
  contextNote: string | null;
  saved: boolean;
}

export type Mastery = 'new' | 'learning' | 'mastered';

export interface VocabularyContextDto {
  bookTitle: string | null;
  publicId: string | null;
  snippet: string;
  chapterOrder: number | null;
}

export interface VocabularyItemDto {
  id: string;
  word: string;
  lemma: string;
  language: 'ru' | 'en';
  definition: string | null;
  partOfSpeech: string | null;
  sourceLabel: string | null;
  mastery: Mastery;
  box: number;
  nextReviewAt: string;
  reviewCount: number;
  studyLater: boolean;
  createdAt: string;
  contexts: VocabularyContextDto[];
}

export interface VocabularySummaryDto {
  total: number;
  mastered: number;
  due: number;
  recent: number;
  /** Слова по неделям: для графика роста. */
  growth: { week: string; count: number }[];
}

export interface AchievementDto {
  code: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: string | null;
}

export interface GameEventDto {
  xpGained: number;
  achievements: { code: string; title: string; description: string; icon: string }[];
  levelUp: { level: number; rank: string } | null;
}

export interface ProfileDto {
  user: UserDto;
  level: {
    level: number;
    rank: string;
    xpIntoLevel: number;
    xpForLevel: number;
    nextRank: string | null;
  };
  stats: {
    booksOpened: number;
    booksInProgress: number;
    booksCompleted: number;
    savedWords: number;
    masteredWords: number;
    quizzesCompleted: number;
    reviewSessions: number;
  };
  achievements: AchievementDto[];
  telegram: { linked: boolean; username: string | null };
}

export interface CheckpointResultDto {
  progress: BookProgressDto;
  game: GameEventDto;
  /** Завершённые главы: для вех на дорожке приключения. */
  completedChapters: number[];
}

export interface PreferenceDto {
  global: ReaderSettings | null;
  book: ReaderSettings | null;
}

export interface BookmarkDto {
  id: string;
  blockKey: string;
  offset: number;
  chapterOrder: number;
  snippet: string;
  createdAt: string;
}

export interface HighlightDto {
  id: string;
  blockKey: string;
  start: number;
  end: number;
  color: 'gold' | 'rose' | 'green';
  text: string;
}

export interface QuoteDto {
  id: string;
  blockKey: string;
  chapterOrder: number;
  text: string;
  createdAt: string;
  bookTitle: string;
  publicId: string;
}

export type QuizTask =
  | { type: 'single'; prompt: string; options: string[]; explanation: string }
  | { type: 'order'; prompt: string; items: string[]; explanation: string }
  | { type: 'match'; prompt: string; left: string[]; right: string[]; explanation: string };

export interface QuizDto {
  id: string;
  chapterOrder: number;
  title: string;
  tasks: QuizTask[];
  bestScore: number | null;
}

export interface QuizResultDto {
  score: number;
  total: number;
  results: { correct: boolean; explanation: string; correctAnswer: string }[];
  game: GameEventDto;
}

export interface TelegramLinkDto {
  configured: boolean;
  url: string | null;
  code: string;
  expiresAt: string;
}
