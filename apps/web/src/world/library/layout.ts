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

/** Пролёт, где вместо стеллажей стоят большое окно справа и камин слева: они смотрят друг на друга. */
export const FEATURE_BAY = 4;

/** Ниша с окном: сюда подходит камера, и капли здесь видны в настоящем размере. */
export const ALCOVE = { x: HALL.wall + 0.03, z: bayCenterZ(FEATURE_BAY), width: 2.86, height: 4.18, sill: 0.52 };

export const FIREPLACE = { x: -(HALL.wall - 0.02), z: bayCenterZ(FEATURE_BAY) };

/** Окна галереи в порядке важности: слабым устройствам достаются только ближайшие. */
export const WINDOW_BAYS = [3, 5, 1, 7, 9];

export const SIDE_WINDOW = { x: HALL.upperWall + 0.02, width: 2.5, height: 3.86, sill: HALL.deckY + 0.56 };

export const FAR_WINDOW = { width: 7, height: 13, sill: 0.5 };

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
  // Свет из окон здесь не запекается: он меняется вместе со временем суток и считается в шейдере.
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

/** Вплотную к большому окну: кадр для капель на стекле. */
export const WINDOW_POSE = {
  pos: [0.5, 1.72, ALCOVE.z + 0.7] as [number, number, number],
  look: [ALCOVE.x, 2.6, ALCOVE.z - 0.1] as [number, number, number],
};

/** Камин напротив окна: лучше всего смотрится вечером и ночью. */
export const FIRE_POSE = {
  pos: [0.7, 1.5, FIREPLACE.z + 1.4] as [number, number, number],
  look: [FIREPLACE.x, 1.1, FIREPLACE.z - 0.1] as [number, number, number],
};

/** Что видно за читалкой: стол, лампы и окно с дождём. */
export const READING_POSE = {
  pos: [-1.4, 1.64, ALCOVE.z + 5.6] as [number, number, number],
  look: [ALCOVE.x, 2.3, ALCOVE.z] as [number, number, number],
};
