/**
 * Таблица наград. У каждой награды есть ключ, уникальный для пользователя: второе начисление
 * с тем же ключом невозможно на уровне базы. Поэтому повторные клики, обновление страницы
 * и цикл «сохранил слово, удалил, сохранил» не приносят новых очков.
 */
export const XP_RULES = {
  bookOpened: 10,
  chapterCompleted: 30,
  bookCompleted: 100,
  wordSaved: 5,
  wordMastered: 15,
  /** Сессия повторения: один раз за календарный день. */
  reviewSession: 10,
  quizPassed: 40,
} as const;

export const rewardKey = {
  bookOpened: (bookId: string) => `book-open:${bookId}`,
  chapterCompleted: (bookId: string, order: number) => `chapter:${bookId}:${order}`,
  bookCompleted: (bookId: string) => `book-done:${bookId}`,
  wordSaved: (language: string, lemma: string) => `word:${language}:${lemma}`,
  wordMastered: (language: string, lemma: string) => `mastered:${language}:${lemma}`,
  reviewSession: (day: string) => `review-day:${day}`,
  quizPassed: (quizId: string) => `quiz:${quizId}`,
  achievement: (code: string) => `achievement:${code}`,
};
