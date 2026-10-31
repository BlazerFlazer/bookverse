export interface GameStats {
  booksOpened: number;
  chaptersCompleted: number;
  maxBookPercent: number;
  booksCompleted: number;
  uniqueWords: number;
  masteredWords: number;
  quizzesPassed: number;
  reviewSessions: number;
  foundByCode: number;
}

export interface AchievementDefinition {
  code: string;
  title: string;
  description: string;
  icon: string;
  xp: number;
  earned: (stats: GameStats) => boolean;
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { code: 'first-journey', title: 'Первое путешествие', description: 'Откройте свою первую настоящую книгу.', icon: '🗝️', xp: 30, earned: (s) => s.booksOpened >= 1 },
  { code: 'first-chapter', title: 'Начинающий читатель', description: 'Дочитайте первую главу.', icon: '📖', xp: 40, earned: (s) => s.chaptersCompleted >= 1 },
  { code: 'halfway', title: 'На полпути', description: 'Прочитайте половину книги.', icon: '🧭', xp: 50, earned: (s) => s.maxBookPercent >= 50 },
  { code: 'story-conqueror', title: 'Покоритель историй', description: 'Дочитайте книгу до конца.', icon: '🏰', xp: 120, earned: (s) => s.booksCompleted >= 1 },
  { code: 'story-collector', title: 'Коллекционер историй', description: 'Дочитайте пять разных книг.', icon: '🏛️', xp: 300, earned: (s) => s.booksCompleted >= 5 },
  { code: 'book-tracker', title: 'Книжный следопыт', description: 'Найдите книгу по её коду.', icon: '🔎', xp: 25, earned: (s) => s.foundByCode >= 1 },
  { code: 'literary-detective', title: 'Литературный детектив', description: 'Пройдите задание по книге.', icon: '🕵️', xp: 60, earned: (s) => s.quizzesPassed >= 1 },
  { code: 'first-discovery', title: 'Первое открытие', description: 'Сохраните первое слово.', icon: '✨', xp: 20, earned: (s) => s.uniqueWords >= 1 },
  { code: 'word-gatherer', title: 'Собиратель слов', description: 'Сохраните десять разных слов.', icon: '🪶', xp: 60, earned: (s) => s.uniqueWords >= 10 },
  { code: 'word-lord', title: 'Повелитель слов', description: 'Выучите пятьдесят слов.', icon: '👑', xp: 200, earned: (s) => s.masteredWords >= 50 },
  { code: 'lexicon-master', title: 'Мастер лексики', description: 'Выучите сто слов.', icon: '🎓', xp: 400, earned: (s) => s.masteredWords >= 100 },
  { code: 'memory-master', title: 'Мастер памяти', description: 'Пройдите пять сессий повторения слов.', icon: '🧠', xp: 80, earned: (s) => s.reviewSessions >= 5 },
];

export function achievementByCode(code: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.code === code);
}

export function evaluateAchievements(stats: GameStats, alreadyEarned: ReadonlySet<string>): AchievementDefinition[] {
  return ACHIEVEMENTS.filter((a) => !alreadyEarned.has(a.code) && a.earned(stats));
}
