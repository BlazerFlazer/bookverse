/** Постоянный публичный номер книги. Это не секрет и не средство авторизации. */
export const BOOK_ID_PATTERN = /^BV-\d{6}$/;

export function formatBookId(sequence: number): string {
  return `BV-${String(sequence).padStart(6, '0')}`;
}

export function isBookId(value: string): boolean {
  return BOOK_ID_PATTERN.test(value);
}

/** Понимает варианты вроде «bv 137», «BV-137», «bv000137» и кириллическое «вв-000137». */
export function normalizeBookId(input: string): string | null {
  const match = input.trim().match(/^(?:bv|вв|бв)[\s\-_]*(\d{1,6})$/i);
  if (!match?.[1]) return null;
  const sequence = Number(match[1]);
  return sequence > 0 ? formatBookId(sequence) : null;
}
