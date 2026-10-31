/** Участки карты приключения. Границы заданы в процентах прочитанной книги. */
export const BIOMES = [
  { until: 16, color: '#7f9a4e', name: 'Деревня' },
  { until: 41, color: '#3f6b43', name: 'Лесная тропа' },
  { until: 50, color: '#5d8150', name: 'Мост через реку' },
  { until: 76, color: '#8b8272', name: 'Горная дорога' },
  { until: 92, color: '#7d7f6a', name: 'Замок' },
  { until: 101, color: '#c9a860', name: 'Волшебные врата' },
];

export const biomeAt = (percent: number) => BIOMES.find((b) => percent <= b.until)?.name ?? BIOMES.at(-1)!.name;
