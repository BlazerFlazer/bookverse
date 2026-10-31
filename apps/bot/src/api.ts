import type { BookDetailDto, BookSummaryDto, DemoActivityDto, ProfileDto, QuizTask, VocabularyItemDto, VocabularySummaryDto } from '@bookverse/shared';

export class NotLinkedError extends Error {}
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ContinueBook {
  publicId: string;
  title: string;
  author: string;
  percent: number;
  chapterOrder: number;
  chapterTitle: string | null;
  chapterCount: number;
  url: string;
}

export interface BotBook extends BookDetailDto {
  readUrl: string;
  listenUrl: string;
}

export interface QuizQuestion {
  id: string;
  title: string;
  bookTitle: string;
  taskIndex: number;
  task: Extract<QuizTask, { type: 'single' }>;
}

/** Бот не ходит в базу: всё проходит через API сервера с отдельным секретом. */
export class BookverseApi {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  private async request<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
    const response = await fetch(`${this.baseUrl}/internal/bot${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'x-bot-secret': this.secret,
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (payload?.message === 'telegram-not-linked') throw new NotLinkedError();
      throw new ApiFailure(payload?.message ?? 'Сервер не ответил', response.status);
    }
    return (await response.json()) as T;
  }

  link(token: string, telegramId: string, username: string | null) {
    return this.request<{ displayName: string }>('/link', { method: 'POST', body: { token, telegramId, username } });
  }

  searchBooks(query: string) {
    return this.request<{ books: BookSummaryDto[] }>(`/books?q=${encodeURIComponent(query)}`);
  }

  book(publicId: string, telegramId: string) {
    return this.request<BotBook>(`/books/${publicId}?telegramId=${telegramId}`);
  }

  async cover(publicId: string): Promise<Buffer | null> {
    const response = await fetch(`${this.baseUrl}/api/books/${publicId}/cover.png`).catch(() => null);
    return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
  }

  addToShelf(telegramId: string, publicId: string) {
    return this.request<{ created: boolean }>(`/users/${telegramId}/shelf/${publicId}`, { method: 'POST', body: {} });
  }

  profile(telegramId: string) {
    return this.request<{ profile: ProfileDto; vocabulary: VocabularySummaryDto; reminders: boolean }>(`/users/${telegramId}/profile`);
  }

  continueReading(telegramId: string) {
    return this.request<{ book: ContinueBook | null }>(`/users/${telegramId}/continue`);
  }

  library(telegramId: string) {
    return this.request<{ books: { title: string; publicId: string; percent: number; status: string; url: string }[] }>(`/users/${telegramId}/library`);
  }

  nextReview(telegramId: string) {
    return this.request<{ word: VocabularyItemDto | null; due: number }>(`/users/${telegramId}/review`);
  }

  submitReview(telegramId: string, id: string, rating: string) {
    return this.request<{ item: VocabularyItemDto }>(`/users/${telegramId}/review/${id}`, { method: 'POST', body: { rating } });
  }

  quiz(telegramId: string) {
    return this.request<{ quiz: QuizQuestion | null }>(`/users/${telegramId}/quiz`);
  }

  answerQuiz(telegramId: string, quizId: string, taskIndex: number, answer: number) {
    return this.request<{ correct: boolean; explanation: string; correctAnswer: string }>(`/users/${telegramId}/quiz/${quizId}`, {
      method: 'POST',
      body: { taskIndex, answer },
    });
  }

  recommend(telegramId: string) {
    return this.request<{ books: (BookSummaryDto & { readUrl: string })[] }>(`/users/${telegramId}/recommend`);
  }

  setReminders(telegramId: string, enabled: boolean) {
    return this.request<{ enabled: boolean }>(`/users/${telegramId}/reminders`, { method: 'POST', body: { enabled } });
  }

  joinDemo(code: string, telegramId: string) {
    return this.request<{ nickname: string; code: string }>('/demo/join', { method: 'POST', body: { code, telegramId } });
  }

  voteDemo(telegramId: string, activityId: string, choice: number) {
    return this.request<{ ok: boolean }>('/demo/vote', { method: 'POST', body: { telegramId, activityId, choice } });
  }

  demoPending() {
    return this.request<{ messages: { telegramId: string; activity: DemoActivityDto }[] }>('/demo/pending');
  }

  reminders() {
    return this.request<{ reminders: { telegramId: string; title: string; percent: number; url: string }[] }>('/reminders');
  }
}
