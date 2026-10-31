import { randomInt } from 'node:crypto';
import type { DemoActivity, DemoSession } from '@prisma/client';
import type { CoverStyle, DemoActivityDto, DemoJoinDto, DemoOptionDto, DemoQuestionDto, DemoSource, DemoStateDto } from '@bookverse/shared';
import { hashToken, newToken } from '../auth/session.ts';
import { isUniqueViolation, prisma } from '../db.ts';
import { HttpError, notFound } from '../http.ts';
import type { StoredTask } from '../quizzes/service.ts';
import { broadcast } from '../realtime.ts';
import { randomNickname } from './nicknames.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const demoRoom = (code: string) => `demo:${code}`;

function newCode(): string {
  return Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

export function activeSession(): Promise<DemoSession | null> {
  return prisma.demoSession.findFirst({ where: { status: { not: 'ended' } }, orderBy: { createdAt: 'desc' } });
}

async function requireActive(): Promise<DemoSession> {
  const session = await activeSession();
  if (!session) throw new HttpError(409, 'Показ не начат');
  return session;
}

function winnerOf(counts: number[]): number | null {
  const top = Math.max(0, ...counts);
  return top > 0 ? counts.indexOf(top) : null;
}

async function liveCounts(activity: DemoActivity): Promise<number[]> {
  const options = activity.options as unknown as DemoOptionDto[];
  if (activity.resultCounts) return activity.resultCounts as number[];
  const grouped = await prisma.demoVote.groupBy({ by: ['choice'], where: { activityId: activity.id }, _count: true });
  return options.map((_, index) => grouped.find((g) => g.choice === index)?._count ?? 0);
}

export async function activityDto(activity: DemoActivity): Promise<DemoActivityDto> {
  const counts = await liveCounts(activity);
  const closed = activity.status === 'closed';
  return {
    id: activity.id,
    kind: activity.kind as DemoActivityDto['kind'],
    prompt: activity.prompt,
    options: activity.options as unknown as DemoOptionDto[],
    status: activity.status as DemoActivityDto['status'],
    counts,
    total: counts.reduce((sum, n) => sum + n, 0),
    // Пока вопрос открыт, верный ответ не покидает сервер.
    correct: closed ? activity.correct : null,
    explanation: closed ? activity.explanation : null,
    winner: closed && activity.kind === 'vote' ? winnerOf(counts) : null,
  };
}

export async function stateOf(session: DemoSession): Promise<DemoStateDto> {
  const [grouped, latest, finished] = await Promise.all([
    prisma.demoParticipant.groupBy({ by: ['source'], where: { sessionId: session.id }, _count: true }),
    prisma.demoActivity.findFirst({ where: { sessionId: session.id }, orderBy: { openedAt: 'desc' } }),
    prisma.demoActivity.count({ where: { sessionId: session.id, status: 'closed' } }),
  ]);
  const bySource: Record<DemoSource, number> = { web: 0, telegram: 0, practice: 0 };
  for (const row of grouped) bySource[row.source as DemoSource] = row._count;
  return {
    code: session.code,
    status: session.status as DemoStateDto['status'],
    practice: session.practice,
    participants: bySource.web + bySource.telegram + bySource.practice,
    bySource,
    activity: latest ? await activityDto(latest) : null,
    finished,
  };
}

/** Голоса приходят пачками: экран обновляется не чаще нескольких раз в секунду. */
const pendingPush = new Map<string, ReturnType<typeof setTimeout>>();
const PUSH_DELAY_MS = 120;

function pushState(sessionId: string): void {
  if (pendingPush.has(sessionId)) return;
  const timer = setTimeout(() => {
    pendingPush.delete(sessionId);
    void (async () => {
      const session = await prisma.demoSession.findUnique({ where: { id: sessionId } });
      if (session) broadcast(demoRoom(session.code), 'demo:state', await stateOf(session));
    })().catch((error: unknown) => console.error(error));
  }, PUSH_DELAY_MS);
  pendingPush.set(sessionId, timer);
}

const practiceTimers = new Map<string, Set<ReturnType<typeof setTimeout>>>();

function clearPractice(sessionId: string): void {
  for (const timer of practiceTimers.get(sessionId) ?? []) clearTimeout(timer);
  practiceTimers.delete(sessionId);
}

/** Удаляем всё, что относится к людям: остаются только итоговые числа. */
async function purgeParticipants(sessionId: string): Promise<void> {
  await prisma.demoParticipant.deleteMany({ where: { sessionId } });
}

export async function startSession(practice: boolean): Promise<DemoSession> {
  const previous = await activeSession();
  if (previous) await endSession(previous);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.demoSession.create({ data: { code: newCode(), practice } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new HttpError(500, 'Не удалось создать код показа');
}

export async function endSession(session: DemoSession): Promise<void> {
  clearPractice(session.id);
  await closeOpenActivity(session.id);
  await prisma.demoSession.update({ where: { id: session.id }, data: { status: 'ended', endedAt: new Date() } });
  await purgeParticipants(session.id);
  pushState(session.id);
}

/** Сброс перед новым показом: код остаётся прежним, поэтому QR на экране не надо менять. */
export async function resetSession(): Promise<DemoSession> {
  const session = await requireActive();
  clearPractice(session.id);
  await prisma.demoActivity.deleteMany({ where: { sessionId: session.id } });
  await purgeParticipants(session.id);
  const fresh = await prisma.demoSession.update({ where: { id: session.id }, data: { status: 'lobby' } });
  pushState(session.id);
  return fresh;
}

export async function setFinale(): Promise<void> {
  const session = await requireActive();
  await closeOpenActivity(session.id);
  await prisma.demoSession.update({ where: { id: session.id }, data: { status: 'finale' } });
  pushState(session.id);
}

export async function resumeLobby(): Promise<void> {
  const session = await requireActive();
  await prisma.demoSession.update({ where: { id: session.id }, data: { status: 'lobby' } });
  pushState(session.id);
}

async function closeOpenActivity(sessionId: string): Promise<void> {
  const open = await prisma.demoActivity.findFirst({ where: { sessionId, status: 'open' } });
  if (!open) return;
  const counts = await liveCounts(open);
  await prisma.demoActivity.update({
    where: { id: open.id },
    data: { status: 'closed', closedAt: new Date(), resultCounts: counts },
  });
}

export async function closeActivity(): Promise<void> {
  const session = await requireActive();
  clearPractice(session.id);
  await closeOpenActivity(session.id);
  pushState(session.id);
}

/** Вопросы только из проверенных заданий к книгам: сгенерированных вопросов на экране нет. */
export async function questionBank(): Promise<(DemoQuestionDto & { answer: number; explanation: string })[]> {
  const quizzes = await prisma.quiz.findMany({
    where: { chapterOrder: 1, book: { featured: true, language: 'ru' } },
    include: { book: { select: { title: true, sequence: true } } },
    orderBy: { book: { sequence: 'asc' } },
  });
  return quizzes.flatMap((quiz) => {
    const tasks = quiz.tasks as unknown as StoredTask[];
    const index = tasks.findIndex((task) => task.type === 'single');
    const task = tasks[index];
    if (task?.type !== 'single') return [];
    return [{ id: `${quiz.id}:${index}`, bookTitle: quiz.book.title, prompt: task.prompt, options: task.options, answer: task.answer, explanation: task.explanation }];
  });
}

export type OpenRequest = { kind: 'vote'; publicIds: string[] } | { kind: 'quiz'; questionId: string };

async function activityData(input: OpenRequest) {
  if (input.kind === 'vote') {
    const books = await prisma.book.findMany({ where: { publicId: { in: input.publicIds } } });
    const options: DemoOptionDto[] = input.publicIds.flatMap((publicId) => {
      const book = books.find((b) => b.publicId === publicId);
      if (!book) return [];
      return [{ label: book.title, note: book.author, publicId, cover: book.coverStyle as unknown as CoverStyle }];
    });
    if (options.length < 2) throw new HttpError(400, 'Для голосования нужны хотя бы две книги');
    return { kind: 'vote', prompt: 'Какую книгу откроем вместе?', options: options as object[], correct: null, explanation: null };
  }
  const question = (await questionBank()).find((q) => q.id === input.questionId);
  if (!question) throw notFound('Такого вопроса нет');
  const options: DemoOptionDto[] = question.options.map((label) => ({ label, note: null, publicId: null, cover: null }));
  return { kind: 'quiz', prompt: question.prompt, options: options as object[], correct: question.answer, explanation: question.explanation };
}

export async function openActivity(input: OpenRequest): Promise<void> {
  const session = await requireActive();
  clearPractice(session.id);
  await closeOpenActivity(session.id);
  const data = await activityData(input);
  const activity = await prisma.demoActivity.create({ data: { ...data, sessionId: session.id } });
  await prisma.demoSession.update({ where: { id: session.id }, data: { status: 'lobby' } });
  if (session.practice) schedulePracticeVotes(session.id, activity);
  pushState(session.id);
}

/** Имитация только в репетиции: на настоящем показе такого пути нет. */
function schedulePracticeVotes(sessionId: string, activity: DemoActivity): void {
  const options = (activity.options as unknown as DemoOptionDto[]).length;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  practiceTimers.set(sessionId, timers);
  void prisma.demoParticipant.findMany({ where: { sessionId, source: 'practice' } }).then((participants) => {
    for (const participant of participants) {
      const leaning = activity.correct ?? 0;
      const choice = randomInt(100) < 55 ? leaning : randomInt(options);
      const timer = setTimeout(() => {
        void castVote(participant.id, activity.id, choice).catch(() => undefined);
      }, 700 + randomInt(6000));
      timers.add(timer);
    }
  });
}

export async function addPracticeParticipants(count: number): Promise<void> {
  const session = await requireActive();
  if (!session.practice) throw new HttpError(403, 'Имитация участников доступна только в режиме репетиции');
  await prisma.demoParticipant.createMany({
    data: Array.from({ length: count }, () => ({ sessionId: session.id, nickname: randomNickname(), source: 'practice' })),
  });
  pushState(session.id);
}

async function castVote(participantId: string, activityId: string, choice: number): Promise<void> {
  const activity = await prisma.demoActivity.findUnique({ where: { id: activityId } });
  if (!activity) throw notFound('Вопрос не найден');
  if (activity.status !== 'open') throw new HttpError(409, 'Голосование уже закрыто');
  if (choice >= (activity.options as unknown as unknown[]).length) throw new HttpError(400, 'Такого варианта нет');
  try {
    await prisma.demoVote.create({ data: { activityId, participantId, choice } });
  } catch (error) {
    // Двойное нажатие на телефоне не должно выглядеть как ошибка: первый голос уже учтён.
    if (!isUniqueViolation(error)) throw error;
  }
  pushState(activity.sessionId);
}

const TOKEN_BYTES = 24;

export async function participantFromToken(token: string | undefined) {
  if (!token) return null;
  return prisma.demoParticipant.findUnique({ where: { tokenHash: hashToken(token) }, include: { session: true } });
}

async function joinDto(session: DemoSession, participantId: string, nickname: string): Promise<DemoJoinDto> {
  const state = await stateOf(session);
  const vote = state.activity
    ? await prisma.demoVote.findUnique({ where: { activityId_participantId: { activityId: state.activity.id, participantId } } })
    : null;
  return { state, nickname, choice: vote?.choice ?? null };
}

async function openSessionByCode(code: string): Promise<DemoSession> {
  const session = await prisma.demoSession.findUnique({ where: { code: code.toUpperCase() } });
  if (!session || session.status === 'ended') throw notFound('Показ с таким кодом не найден или уже закончился');
  return session;
}

/** Без имён и почты: участнику выдаётся псевдоним, а повторный вход узнаётся по cookie. */
export async function joinFromBrowser(code: string, token: string | undefined): Promise<{ result: DemoJoinDto; token: string | null }> {
  const session = await openSessionByCode(code);
  const existing = await participantFromToken(token);
  if (existing && existing.sessionId === session.id) {
    return { result: await joinDto(session, existing.id, existing.nickname), token: null };
  }
  const fresh = newToken(TOKEN_BYTES);
  const participant = await prisma.demoParticipant.create({
    data: { sessionId: session.id, tokenHash: hashToken(fresh), nickname: randomNickname(), source: 'web' },
  });
  pushState(session.id);
  return { result: await joinDto(session, participant.id, participant.nickname), token: fresh };
}

export async function voteFromBrowser(token: string | undefined, activityId: string, choice: number): Promise<DemoJoinDto> {
  const participant = await participantFromToken(token);
  if (!participant) throw new HttpError(401, 'Сначала присоединитесь к показу');
  const activity = await prisma.demoActivity.findUnique({ where: { id: activityId } });
  if (activity?.sessionId !== participant.sessionId) throw notFound('Вопрос не найден');
  await castVote(participant.id, activityId, choice);
  return joinDto(participant.session, participant.id, participant.nickname);
}

export async function joinFromTelegram(code: string, telegramId: string): Promise<{ nickname: string; code: string }> {
  const session = await openSessionByCode(code);
  const participant = await prisma.demoParticipant.upsert({
    where: { sessionId_telegramId: { sessionId: session.id, telegramId } },
    update: {},
    create: { sessionId: session.id, telegramId, nickname: randomNickname(), source: 'telegram' },
  });
  pushState(session.id);
  return { nickname: participant.nickname, code: session.code };
}

export async function voteFromTelegram(telegramId: string, activityId: string, choice: number): Promise<void> {
  const activity = await prisma.demoActivity.findUnique({ where: { id: activityId } });
  if (!activity) throw notFound('Вопрос не найден');
  const participant = await prisma.demoParticipant.findUnique({
    where: { sessionId_telegramId: { sessionId: activity.sessionId, telegramId } },
  });
  if (!participant) throw new HttpError(403, 'Сначала присоединитесь к показу');
  await castVote(participant.id, activityId, choice);
}

/** Что бот должен разослать: новый вопрос или итог. Каждое сообщение уходит один раз. */
export async function pendingTelegramMessages(): Promise<{ telegramId: string; activity: DemoActivityDto }[]> {
  const session = await activeSession();
  if (!session) return [];
  const latest = await prisma.demoActivity.findFirst({ where: { sessionId: session.id }, orderBy: { openedAt: 'desc' } });
  if (!latest) return [];
  const key = `${latest.id}:${latest.status}`;
  const participants = await prisma.demoParticipant.findMany({
    where: { sessionId: session.id, source: 'telegram', telegramId: { not: null }, OR: [{ notified: null }, { notified: { not: key } }] },
  });
  if (participants.length === 0) return [];
  await prisma.demoParticipant.updateMany({ where: { id: { in: participants.map((p) => p.id) } }, data: { notified: key } });
  const activity = await activityDto(latest);
  return participants.map((p) => ({ telegramId: p.telegramId!, activity }));
}
