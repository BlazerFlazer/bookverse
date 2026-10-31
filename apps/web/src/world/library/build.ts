import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry } from '../textures/noise.ts';
import { bayLineZ, HALL, hallEndZ, REAL_BOOK_SLOTS, rowY, slotPosition, TABLE } from './layout.ts';

export interface BoxInstance {
  position: [number, number, number];
  size: [number, number, number];
  tone: string;
  /** Поворот вокруг Y для наклонённых книг. */
  lean?: number;
}

export interface RowInstance {
  position: [number, number, number];
  rotationY: number;
  length: number;
  height: number;
}

const WOOD = ['#5b3a25', '#4f3220', '#63402a'];
const SPINES = ['#7c2f33', '#5d2a2c', '#3a4f47', '#2f3f39', '#7a5a2d', '#2b3652', '#5a2336', '#8a6a35', '#3d3a2c', '#28453b', '#6b3b28', '#46324f'];

/** Участок полки: откуда, в какую сторону и куда смотрят корешки. */
interface ShelfRun {
  from: [number, number];
  to: [number, number];
  normal: [number, number];
  y: number;
}

function shelfRuns(side: number, bay: number, row: number): ShelfRun[] {
  const y = rowY(row);
  // Линия участка проходит по плоскости корешков, чуть глубже края полки.
  const near = bayLineZ(bay) - 0.43;
  const far = bayLineZ(bay + 1) + 0.43;
  const inner = side * (HALL.aisle + 0.06);
  const outer = side * (HALL.wall - 0.24);
  return [
    // Задняя стена ниши
    { from: [outer, near], to: [outer, far], normal: [-side, 0], y },
    // Боковые грани соседних стеллажей
    { from: [inner, near], to: [outer, near], normal: [0, -1], y },
    { from: [inner, far], to: [outer, far], normal: [0, 1], y },
  ];
}

/** Декоративные книги ближних пролётов. Они заполняют ряды плотно, как настоящие полки. */
export function buildBooks(limit: number): BoxInstance[] {
  const rand = mulberry(2024);
  const books: BoxInstance[] = [];
  const reserved = REAL_BOOK_SLOTS.map((slot) => ({ pos: slotPosition(slot), radius: 0.22 }));

  const fill = (run: ShelfRun) => {
    const dx = run.to[0] - run.from[0];
    const dz = run.to[1] - run.from[1];
    const length = Math.hypot(dx, dz);
    const ux = dx / length;
    const uz = dz / length;
    let t = 0.02;
    while (t < length - 0.03) {
      const thickness = 0.022 + rand() * 0.04;
      const height = 0.3 + rand() * 0.2;
      const depth = 0.2 + rand() * 0.06;
      const middle = t + thickness / 2;
      const inset = depth / 2 + rand() * 0.02;
      const x = run.from[0] + ux * middle - run.normal[0] * inset;
      const z = run.from[1] + uz * middle - run.normal[1] * inset;
      const y = run.y + height / 2;
      const blocked = reserved.some((r) => Math.hypot(r.pos[0] - x, r.pos[1] - y, r.pos[2] - z) < r.radius);
      if (!blocked) {
        books.push({
          position: [x, y, z],
          size: run.normal[0] !== 0 ? [depth, height, thickness] : [thickness, height, depth],
          tone: SPINES[Math.floor(rand() * SPINES.length)]!,
          lean: rand() > 0.97 ? (rand() - 0.5) * 0.18 : undefined,
        });
      }
      t += thickness + 0.002;
      if (rand() > 0.985) t += 0.04 + rand() * 0.12;
    }
  };

  // От камеры в глубину: при низком качестве обрезаются самые дальние книги.
  outer: for (let bay = 0; bay < HALL.bays; bay += 1) {
    for (let row = 0; row < HALL.rows; row += 1) {
      for (const side of [-1, 1]) {
        for (const run of shelfRuns(side, bay, row)) {
          fill(run);
          if (books.length >= limit) break outer;
        }
      }
    }
  }
  return books;
}

export interface WoodParts {
  boards: BoxInstance[];
  rows: RowInstance[];
}

export function buildStructure(realBays: number): WoodParts {
  const rand = mulberry(77);
  const boards: BoxInstance[] = [];
  const rows: RowInstance[] = [];
  const tone = () => WOOD[Math.floor(rand() * WOOD.length)]!;
  const push = (position: [number, number, number], size: [number, number, number]) => boards.push({ position, size, tone: tone() });

  for (const side of [-1, 1]) {
    const midStack = side * (HALL.aisle + HALL.wall) / 2;
    const stackLength = HALL.wall - HALL.aisle;
    for (let k = 0; k <= HALL.bays; k += 1) {
      const z = bayLineZ(k);
      // Перпендикулярный стеллаж: корпус и цоколь.
      push([midStack, 2.4, z], [stackLength + 0.02, 4.9, 0.52]);
      push([midStack, 0.09, z], [stackLength + 0.1, 0.18, 0.62]);
      push([midStack, 4.92, z], [stackLength + 0.1, 0.16, 0.64]);
      // Торец у прохода
      push([side * (HALL.aisle - 0.02), 2.4, z], [0.08, 4.9, 0.58]);

      if (k === HALL.bays) continue;
      const center = z - HALL.bay / 2;
      const span = HALL.bay - 0.52;
      push([side * (HALL.wall + 0.04), 2.4, center], [0.1, 5, span]);
      for (let r = 0; r <= HALL.rows; r += 1) {
        const y = rowY(r) - 0.03;
        push([side * (HALL.wall - 0.14), y, center], [0.3, 0.05, span]);
        push([midStack, y, z - 0.33], [stackLength, 0.05, 0.3]);
        push([midStack, y, z + 0.33 - HALL.bay + 0.0], [stackLength, 0.05, 0.3]);
      }

      if (k >= realBays) {
        // Дальше камера не подходит: ряд книг рисуется одной картинкой.
        for (let r = 0; r < HALL.rows; r += 1) {
          const y = rowY(r) + 0.3;
          rows.push({ position: [side * (HALL.wall - 0.02), y, center], rotationY: -side * Math.PI / 2, length: span, height: 0.6 });
          rows.push({ position: [midStack, y, z - 0.27], rotationY: Math.PI, length: stackLength, height: 0.6 });
          rows.push({ position: [midStack, y, z - HALL.bay + 0.27], rotationY: 0, length: stackLength, height: 0.6 });
        }
      }

      // Верхний ярус вдоль галереи
      for (let r = 0; r < 6; r += 1) {
        const y = HALL.deckY + 0.72 + r * 0.68;
        rows.push({ position: [side * HALL.upperWall, y, center], rotationY: -side * Math.PI / 2, length: HALL.bay - 0.2, height: 0.62 });
        push([side * (HALL.upperWall - 0.11), y - 0.33, center], [0.24, 0.05, HALL.bay - 0.2]);
      }
      push([side * (HALL.upperWall + 0.06), 7.3, center], [0.1, 4.6, HALL.bay]);
    }

    // Настил галереи и перила
    const length = HALL.bay * HALL.bays + 0.6;
    const middleZ = HALL.startZ - (HALL.bay * HALL.bays) / 2;
    push([side * ((HALL.aisle + HALL.upperWall) / 2 - 0.02), HALL.deckY + 0.05, middleZ], [HALL.upperWall - HALL.aisle + 0.5, 0.12, length]);
    push([side * (HALL.aisle - 0.1), HALL.deckY + 0.02, middleZ], [0.22, 0.26, length]);
    push([side * (HALL.aisle - 0.08), HALL.deckY + 1.05, middleZ], [0.1, 0.07, length]);
    push([side * (HALL.aisle - 0.08), HALL.deckY + 0.22, middleZ], [0.08, 0.05, length]);
    // Карниз под сводом
    push([side * HALL.upperWall, HALL.springY + 0.06, middleZ], [0.5, 0.2, length]);
  }
  return { boards, rows };
}

const profile = (points: [number, number][]) => points.map(([x, y]) => new Vector2(x, y));

/** Колонна на единичную высоту: база, стройный ствол, капитель. */
export function columnGeometry(): BufferGeometry {
  return new LatheGeometry(
    profile([
      [0, 0], [0.19, 0], [0.19, 0.03], [0.165, 0.045], [0.15, 0.07], [0.125, 0.09], [0.115, 0.5],
      [0.1, 0.915], [0.115, 0.925], [0.105, 0.935], [0.13, 0.955], [0.18, 0.985], [0.19, 1], [0, 1],
    ]),
    14,
  );
}

export function balusterGeometry(): BufferGeometry {
  return new LatheGeometry(
    profile([
      [0, 0], [0.035, 0], [0.035, 0.08], [0.018, 0.14], [0.045, 0.32], [0.03, 0.52], [0.016, 0.58], [0.02, 0.86], [0.035, 0.9], [0.035, 1], [0, 1],
    ]),
    7,
  );
}

function placed(geometry: BufferGeometry, x: number, y: number, z: number, rotationX = 0, rotationZ = 0): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const matrix = new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rotationX).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotationZ)),
    new Vector3(1, 1, 1),
  );
  g.applyMatrix4(matrix);
  g.deleteAttribute('uv2');
  return g;
}

/** Лестница на колёсах: перила и ступени в одной геометрии. */
export function ladderGeometry(height: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rail = new BoxGeometry(0.05, height, 0.08);
  parts.push(placed(rail.clone(), -0.21, height / 2, 0));
  parts.push(placed(rail.clone(), 0.21, height / 2, 0));
  const step = new BoxGeometry(0.42, 0.03, 0.06);
  for (let y = 0.3; y < height - 0.1; y += 0.32) parts.push(placed(step.clone(), 0, y, 0));
  return mergeGeometries(parts)!;
}

export function tableGeometry(): BufferGeometry {
  const { length, halfWidth, height, centerZ } = TABLE;
  const parts: BufferGeometry[] = [];
  parts.push(placed(new BoxGeometry(halfWidth * 2, 0.07, length), 0, height, centerZ));
  parts.push(placed(new BoxGeometry(halfWidth * 2 - 0.2, 0.1, length - 0.3), 0, height - 0.08, centerZ));
  for (const z of [-length / 2 + 0.35, 0, length / 2 - 0.35]) {
    for (const x of [-halfWidth + 0.16, halfWidth - 0.16]) {
      parts.push(placed(new CylinderGeometry(0.05, 0.035, height - 0.1, 8), x, (height - 0.1) / 2, centerZ + z));
    }
  }
  return mergeGeometries(parts.map((p) => {
    p.deleteAttribute('uv');
    return p;
  }))!;
}

/** Латунная часть настольной лампы. Плафон отдельный: он светится. */
export function lampBaseGeometry(): BufferGeometry {
  const parts = [
    placed(new CylinderGeometry(0.1, 0.12, 0.03, 12), 0, 0.015, 0),
    placed(new CylinderGeometry(0.012, 0.012, 0.32, 6), 0, 0.17, 0),
  ];
  return mergeGeometries(parts.map((p) => {
    p.deleteAttribute('uv');
    return p;
  }))!;
}

export function lampShadeGeometry(): BufferGeometry {
  // Цилиндрический плафон банковской лампы, вытянутый вдоль стола.
  return new CylinderGeometry(0.075, 0.075, 0.38, 14).rotateX(Math.PI / 2);
}

export function archGeometry(radius: number): BufferGeometry {
  return new TorusGeometry(radius, 0.1, 6, 24, Math.PI);
}

export const globeGeometry = () => new SphereGeometry(0.34, 16, 12);

export const hallLength = HALL.startZ + 4 - hallEndZ;
