import { describe, expect, it } from 'vitest';
import { declension, editDistance, formatBookId, isBookId, normalizeBookId, normalizeForLookup, registerSchema } from '../src/index.ts';

describe('Book ID', () => {
  it('форматирует номер в шесть цифр', () => {
    expect(formatBookId(137)).toBe('BV-000137');
    expect(isBookId('BV-000137')).toBe(true);
    expect(isBookId('BV-137')).toBe(false);
  });

  it('понимает разные варианты написания', () => {
    for (const input of ['BV-000137', 'bv-137', 'bv 137', 'BV000137', ' вв-137 ']) {
      expect(normalizeBookId(input)).toBe('BV-000137');
    }
  });

  it('отвергает всё остальное', () => {
    for (const input of ['BV-0', 'Каштанка', 'BV-1234567', '137']) expect(normalizeBookId(input)).toBeNull();
  });
});

describe('нормализация текста', () => {
  it('убирает регистр, ударение и ё', () => {
    expect(normalizeForLookup('Зелёный')).toBe('зеленый');
    expect(normalizeForLookup('за́мок')).toBe('замок');
  });

  it('считает опечатки, включая перестановку букв', () => {
    expect(editDistance('каштанка', 'каштонка')).toBe(1);
    expect(editDistance('каштанка', 'кашатнка')).toBe(1);
    expect(editDistance('кот', 'собака', 2)).toBeGreaterThan(2);
  });

  it('склоняет числительные', () => {
    const forms: [string, string, string] = ['слово', 'слова', 'слов'];
    expect(declension(1, forms)).toBe('слово');
    expect(declension(3, forms)).toBe('слова');
    expect(declension(11, forms)).toBe('слов');
    expect(declension(21, forms)).toBe('слово');
  });
});

describe('схема регистрации', () => {
  const valid = { displayName: 'Мира', email: 'Mira@Example.com', password: 'длинный-пароль', confirmPassword: 'длинный-пароль' };

  it('приводит почту к нижнему регистру', () => {
    expect(registerSchema.parse(valid).email).toBe('mira@example.com');
  });

  it('ловит несовпадение паролей', () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: 'другой-пароль' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });
});
