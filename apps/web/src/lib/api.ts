export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте, что он запущен.', 0);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string; fields?: Record<string, string> } | null;
    throw new ApiError(payload?.message ?? 'Что-то пошло не так', response.status, payload?.fields);
  }
  return (await response.json()) as T;
}
