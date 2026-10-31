import { createHash } from 'node:crypto';
import { rewardKey, XP_RULES } from '@bookverse/game-engine';
import type { QuizDto, QuizResultDto, QuizTask } from '@bookverse/shared';
import { prisma } from '../db.ts';
import { notFound } from '../http.ts';
import { award, publishGame, settle } from '../game/service.ts';

export type StoredTask =
  | { type: 'single'; prompt: string; options: string[]; answer: number; explanation: string }
  | { type: 'order'; prompt: string; items: string[]; explanation: string }
  | { type: 'match'; prompt: string; pairs: [string, string][]; explanation: string };

/** Детерминированное перемешивание: клиент и сервер видят один и тот же порядок. */
function shuffledIndexes(length: number, seed: string): number[] {
  const bytes = createHash('sha256').update(seed).digest();
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = bytes[i % bytes.length]! % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  // Случайно совпавший правильный порядок сделал бы задание бессмысленным.
  if (order.every((value, index) => value === index) && length > 1) order.reverse();
  return order;
}

function publicTask(task: StoredTask, seed: string): QuizTask {
  switch (task.type) {
    case 'single':
      return { type: 'single', prompt: task.prompt, options: task.options, explanation: '' };
    case 'order':
      return {
        type: 'order',
        prompt: task.prompt,
        items: shuffledIndexes(task.items.length, seed).map((i) => task.items[i]!),
        explanation: '',
      };
    case 'match':
      return {
        type: 'match',
        prompt: task.prompt,
        left: task.pairs.map(([left]) => left),
        right: shuffledIndexes(task.pairs.length, seed).map((i) => task.pairs[i]![1]),
        explanation: '',
      };
  }
}

export async function listQuizzes(bookId: string, userId: string | null): Promise<QuizDto[]> {
  const quizzes = await prisma.quiz.findMany({ where: { bookId }, orderBy: { chapterOrder: 'asc' } });
  const attempts = userId
    ? await prisma.quizAttempt.groupBy({ by: ['quizId'], where: { userId }, _max: { score: true } })
    : [];
  return quizzes.map((quiz) => ({
    id: quiz.id,
    chapterOrder: quiz.chapterOrder,
    title: quiz.title,
    tasks: (quiz.tasks as unknown as StoredTask[]).map((task, index) => publicTask(task, `${quiz.id}:${index}`)),
    bestScore: attempts.find((a) => a.quizId === quiz.id)?._max.score ?? null,
  }));
}

function grade(task: StoredTask, answer: number | number[] | undefined, seed: string) {
  switch (task.type) {
    case 'single':
      return { correct: answer === task.answer, correctAnswer: task.options[task.answer] ?? '' };
    case 'order': {
      const shown = shuffledIndexes(task.items.length, seed);
      const chosen = Array.isArray(answer) ? answer.map((i) => shown[i]) : [];
      const correct = chosen.length === task.items.length && chosen.every((value, index) => value === index);
      return { correct, correctAnswer: task.items.join(' → ') };
    }
    case 'match': {
      const shown = shuffledIndexes(task.pairs.length, seed);
      const chosen = Array.isArray(answer) ? answer.map((i) => shown[i]) : [];
      const correct = chosen.length === task.pairs.length && chosen.every((value, index) => value === index);
      return { correct, correctAnswer: task.pairs.map(([a, b]) => `${a} — ${b}`).join('; ') };
    }
  }
}

export async function submitQuiz(userId: string, quizId: string, answers: (number | number[])[]): Promise<QuizResultDto> {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz) throw notFound('Задание не найдено');
  const tasks = quiz.tasks as unknown as StoredTask[];
  const results = tasks.map((task, index) => ({
    ...grade(task, answers[index], `${quiz.id}:${index}`),
    explanation: task.explanation,
  }));
  const score = results.filter((r) => r.correct).length;
  const passed = score >= Math.ceil(tasks.length * 0.66);

  const game = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await tx.quizAttempt.create({ data: { userId, quizId, score, total: tasks.length } });
    // Награда только за успешное прохождение и только один раз; разбор ошибок доступен всегда.
    const gained = passed ? await award(tx, userId, rewardKey.quizPassed(quizId), XP_RULES.quizPassed, `Задание: ${quiz.title}`) : 0;
    return settle(tx, userId, user.xp, gained);
  });
  publishGame(userId, game);
  return { score, total: tasks.length, results, game };
}
