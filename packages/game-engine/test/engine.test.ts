import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, evaluateAchievements, levelFromXp, MASTERED_BOX, rankForLevel, RANKS, scheduleReview, type GameStats } from '../src/index.ts';

const stats = (patch: Partial<GameStats> = {}): GameStats => ({
  booksOpened: 0,
  chaptersCompleted: 0,
  maxBookPercent: 0,
  booksCompleted: 0,
  uniqueWords: 0,
  masteredWords: 0,
  quizzesPassed: 0,
  reviewSessions: 0,
  foundByCode: 0,
  ...patch,
});

describe('уровни', () => {
  it('начинает с первого уровня и считает остаток опыта', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForLevel: 100 });
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(250)).toEqual({ level: 3, xpIntoLevel: 10, xpForLevel: 180 });
  });

  it('содержит все шесть рангов по порядку', () => {
    expect(RANKS.map((r) => r.title)).toEqual(['Новичок', 'Искатель историй', 'Книжный исследователь', 'Хранитель знаний', 'Мастер литературы', 'Легенда BOOKVERSE']);
    expect(rankForLevel(1)).toBe('Новичок');
    expect(rankForLevel(10)).toBe('Хранитель знаний');
    expect(rankForLevel(99)).toBe('Легенда BOOKVERSE');
  });
});

describe('достижения', () => {
  it('выдаёт достижение при выполнении условия', () => {
    const earned = evaluateAchievements(stats({ booksOpened: 1 }), new Set());
    expect(earned.map((a) => a.title)).toEqual(['Первое путешествие']);
  });

  it('не выдаёт уже полученное', () => {
    expect(evaluateAchievements(stats({ booksOpened: 3 }), new Set(['first-journey']))).toEqual([]);
  });

  it('содержит достижения из технического задания', () => {
    const titles = ACHIEVEMENTS.map((a) => a.title);
    for (const title of ['Первое путешествие', 'Начинающий читатель', 'На полпути', 'Покоритель историй', 'Книжный следопыт', 'Литературный детектив', 'Собиратель слов', 'Повелитель слов', 'Мастер памяти', 'Коллекционер историй', 'Первое открытие', 'Мастер лексики']) {
      expect(titles).toContain(title);
    }
  });
});

describe('интервальное повторение', () => {
  const now = new Date('2026-10-30T10:00:00Z');
  const days = (date: Date) => (date.getTime() - now.getTime()) / 86_400_000;

  it('отодвигает знакомое слово всё дальше', () => {
    const first = scheduleReview({ box: 0, lapses: 0 }, 'know', now);
    const second = scheduleReview({ box: first.box, lapses: 0 }, 'know', now);
    expect(days(second.nextReviewAt)).toBeGreaterThan(days(first.nextReviewAt));
  });

  it('возвращает забытое слово в начало', () => {
    const result = scheduleReview({ box: 4, lapses: 1 }, 'forgot', now);
    expect(result.box).toBe(0);
    expect(result.lapses).toBe(2);
    expect(days(result.nextReviewAt)).toBeLessThan(0.1);
  });

  it('«почти помню» не повышает коробку', () => {
    const result = scheduleReview({ box: 2, lapses: 0 }, 'almost', now);
    expect(result.box).toBe(2);
    expect(days(result.nextReviewAt)).toBe(1.5);
  });

  it('считает слово выученным с пятой коробки', () => {
    expect(scheduleReview({ box: MASTERED_BOX - 2, lapses: 0 }, 'know', now).mastery).toBe('learning');
    expect(scheduleReview({ box: MASTERED_BOX - 1, lapses: 0 }, 'know', now).mastery).toBe('mastered');
  });
});
