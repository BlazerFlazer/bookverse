import { randomInt } from 'node:crypto';

/** Псевдонимы вместо имён: на большой экран не попадают настоящие имена детей и случайные слова. */
const FEMININE = [
  ['Мудрая', 'Смелая', 'Тихая', 'Весёлая', 'Звёздная', 'Читающая', 'Лесная', 'Быстрая', 'Добрая', 'Золотая'],
  ['Сова', 'Лиса', 'Белка', 'Закладка', 'Страница', 'Рыбка', 'Цапля', 'Рысь'],
] as const;

const MASCULINE = [
  ['Мудрый', 'Смелый', 'Тихий', 'Весёлый', 'Звёздный', 'Читающий', 'Лесной', 'Быстрый', 'Добрый', 'Золотой'],
  ['Филин', 'Лис', 'Барсук', 'Переплёт', 'Томик', 'Журавль', 'Ёж', 'Заяц'],
] as const;

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)]!;

export function randomNickname(): string {
  const [adjectives, nouns] = randomInt(2) === 0 ? FEMININE : MASCULINE;
  return `${pick(adjectives)} ${pick(nouns)}`;
}
