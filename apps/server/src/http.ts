/** Ошибка с понятным пользователю сообщением. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (message = 'Не найдено') => new HttpError(404, message);
export const unauthorized = (message = 'Нужно войти в аккаунт') => new HttpError(401, message);
