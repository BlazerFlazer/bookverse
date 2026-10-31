import { Color } from 'three';

/** Размеры зала в метрах. Вся геометрия и позиции камеры строятся от этих чисел. */
export const HALL = {
  aisle: 3.3,
  wall: 5.6,
  upperWall: 4.8,
  bay: 3.6,
  bays: 11,
  startZ: 6.2,
  rowHeight: 0.66,
  rows: 7,
  firstRow: 0.26,
  deckY: 5.0,
  springY: 9.6,
  vaultRadius: 4.8,
} as const;

export const hallEndZ = HALL.startZ - HALL.bay * HALL.bays;
export const bayLineZ = (k: number) => HALL.startZ - k * HALL.bay;
export const bayCenterZ = (k: number) => bayLineZ(k) - HALL.bay / 2;
export const rowY = (r: number) => HALL.firstRow + r * HALL.rowHeight;

export const PENDANTS: [number, number, number][] = [
  [0, 7.4, 2.2],
  [0, 7.4, -5.2],
  [0, 7.4, -12.6],
  [0, 7.4, -20],
  [0, 7.4, -27.4],
];

export const TABLE = { centerZ: -3.4, length: 8.4, halfWidth: 0.82, height: 0.78 };

export const TABLE_LAMPS: [number, number, number][] = [
  [-0.38, TABLE.height + 0.36, TABLE.centerZ + 2.9],
  [0.38, TABLE.height + 0.36, TABLE.centerZ],
  [-0.38, TABLE.height + 0.36, TABLE.centerZ - 2.9],
];

const scratch = new Color();

/**
 * Запечённый свет: вместо десятков источников каждая деталь получает цвет,
 * посчитанный один раз. Живыми остаются только несколько ламп рядом с камерой.
 */
export function bakedLight(x: number, y: number, z: number, target = new Color()): Color {
  target.setRGB(0.42, 0.31, 0.22);
  // Тёплое окно в конце нефа.
  const toWindow = Math.max(0, 1 - (z - hallEndZ) / 26);
  const windowGain = toWindow * toWindow * (0.55 + (0.45 * y) / 10);
  target.r += windowGain * 0.95;
  target.g += windowGain * 0.62;
  target.b += windowGain * 0.3;
  for (const [lx, ly, lz] of PENDANTS) {
    const d2 = (x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2;
    const gain = 9 / (d2 + 5);
    target.r += gain * 0.82;
    target.g += gain * 0.56;
    target.b += gain * 0.3;
  }
  // Низ стеллажей уходит в тень, это даёт объём без теневых карт.
  const floorShade = 0.62 + 0.38 * Math.min(1, y / 2.4);
  target.multiplyScalar(floorShade);
  return target;
}

export const bakedColor = (base: string, x: number, y: number, z: number, target: Color): Color => {
  bakedLight(x, y, z, scratch);
  target.set(base);
  target.r *= scratch.r;
  target.g *= scratch.g;
  target.b *= scratch.b;
  return target;
};

export interface ShelfSlot {
  side: -1 | 1;
  bay: number;
  row: number;
  /** Смещение вдоль стены от центра пролёта. */
  along: number;
}

/**
 * Места настоящих книг: у задних стен первых пролётов, на уровне глаз.
 * Декоративные книги этих мест не занимают.
 */
export const REAL_BOOK_SLOTS: ShelfSlot[] = [
  { side: -1, bay: 0, row: 2, along: -0.55 },
  { side: 1, bay: 0, row: 2, along: -0.55 },
  { side: -1, bay: 0, row: 2, along: 0.55 },
  { side: 1, bay: 0, row: 2, along: 0.55 },
  { side: -1, bay: 1, row: 2, along: -0.55 },
  { side: 1, bay: 1, row: 2, along: -0.55 },
  { side: -1, bay: 1, row: 2, along: 0.55 },
  { side: 1, bay: 1, row: 2, along: 0.55 },
  { side: -1, bay: 2, row: 2, along: 0 },
  { side: 1, bay: 2, row: 2, along: 0 },
];

export function slotPosition(slot: ShelfSlot): [number, number, number] {
  return [slot.side * (HALL.wall - 0.18), rowY(slot.row) + 0.17, bayCenterZ(slot.bay) + slot.along];
}

/** Положение камеры напротив пролёта. */
export function focusPose(side: -1 | 1, bay: number) {
  const z = bayCenterZ(bay);
  return {
    pos: [side * 2.5, 1.72, z] as [number, number, number],
    look: [side * HALL.wall, 1.72, z] as [number, number, number],
  };
}

export const HOME_POSE = {
  pos: [0, 1.78, 8.2] as [number, number, number],
  look: [0, 2.7, -14] as [number, number, number],
};
