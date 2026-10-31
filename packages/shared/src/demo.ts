import { z } from 'zod';
import type { CoverStyle } from './dto.ts';

export const DEMO_CODE_PATTERN = /^[A-Z2-9]{5}$/;

export const presenterLoginSchema = z.object({ key: z.string().min(1, 'Введите ключ').max(128) });

export const demoStartSchema = z.object({ practice: z.boolean().default(false) });

export const demoOpenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vote'), publicIds: z.array(z.string().max(16)).min(2).max(6) }),
  z.object({ kind: z.literal('quiz'), questionId: z.string().max(64) }),
]);

export const demoVoteSchema = z.object({
  activityId: z.string().min(1).max(40),
  choice: z.number().int().min(0).max(5),
});

export const demoPracticeSchema = z.object({ count: z.number().int().min(1).max(60) });

export type DemoSource = 'web' | 'telegram' | 'practice';

export interface DemoOptionDto {
  label: string;
  note: string | null;
  /** Есть у голосования за книгу: победителя можно сразу открыть. */
  publicId: string | null;
  cover: CoverStyle | null;
}

export interface DemoActivityDto {
  id: string;
  kind: 'vote' | 'quiz';
  prompt: string;
  options: DemoOptionDto[];
  status: 'open' | 'closed';
  counts: number[];
  total: number;
  /** Появляются только после закрытия вопроса. */
  correct: number | null;
  explanation: string | null;
  winner: number | null;
}

export interface DemoStateDto {
  code: string;
  status: 'lobby' | 'finale' | 'ended';
  practice: boolean;
  participants: number;
  bySource: Record<DemoSource, number>;
  activity: DemoActivityDto | null;
  /** Сколько голосований и вопросов уже прошло за показ. */
  finished: number;
}

export interface DemoJoinDto {
  state: DemoStateDto;
  nickname: string;
  /** Выбор участника в текущем голосовании. */
  choice: number | null;
}

export interface DemoQuestionDto {
  id: string;
  bookTitle: string;
  prompt: string;
  options: string[];
}

export interface DemoControlDto {
  state: DemoStateDto | null;
  links: { web: string; telegram: string | null } | null;
  questions: DemoQuestionDto[];
}
