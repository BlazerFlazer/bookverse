import { BufferAttribute, BufferGeometry, ExtrudeGeometry, Shape } from 'three';

export const BOOK_W = 1;
export const BOOK_H = 1.36;
export const BOARD = 0.016;
const PAGE_MARGIN = 0.014;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Доска обложки со скруглёнными внешними углами и фаской. Ось X идёт от корешка. */
export function coverBoardGeometry(): ExtrudeGeometry {
  const r = 0.018;
  const w = BOOK_W;
  const h = BOOK_H / 2;
  const shape = new Shape();
  shape.moveTo(0, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(0, h);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: BOARD * 0.76,
    bevelEnabled: true,
    bevelThickness: BOARD * 0.12,
    bevelSize: 0.004,
    bevelOffset: -0.004,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geometry.translate(0, 0, BOARD * 0.12);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i += 1) {
    uv.setXY(i, position.getX(i) / w, (position.getY(i) + h) / BOOK_H);
  }
  return geometry;
}

const SECTIONS = 18;

export interface StackPose {
  /** Толщина стопки. */
  height: number;
  /** На сколько стопка заходит за шарнир к центру корешка. */
  inner: number;
  /** 0 — ровный блок закрытой книги, 1 — изогнутые страницы раскрытой. */
  arch: number;
  /** Смещение обреза сверху при раскрытии. */
  slant: number;
}

/**
 * Стопка страниц: верхняя бумага (группа 0) и срезы (группа 1).
 * Сетка неравномерна, потому что основной изгиб приходится на участок у корешка.
 */
export function createStackGeometry(flipUv: boolean): BufferGeometry {
  const columns = SECTIONS + 1;
  const vertices = columns * 2 + columns * 2 + columns * 2 + 4;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(vertices * 2), 2));

  const top: number[] = [];
  for (let i = 0; i < SECTIONS; i += 1) {
    const a = i * 2;
    top.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const edges: number[] = [];
  const head = columns * 2;
  const tail = columns * 4;
  for (let i = 0; i < SECTIONS; i += 1) {
    const a = head + i * 2;
    edges.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    const b = tail + i * 2;
    edges.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  const fore = columns * 6;
  edges.push(fore, fore + 2, fore + 1, fore + 1, fore + 2, fore + 3);
  geometry.setIndex([...top, ...edges]);
  geometry.addGroup(0, top.length, 0);
  geometry.addGroup(top.length, edges.length, 1);
  geometry.userData.flipUv = flipUv;
  return geometry;
}

export function updateStackGeometry(geometry: BufferGeometry, pose: StackPose): void {
  const { height, inner, arch, slant } = pose;
  const flip = geometry.userData.flipUv as boolean;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  const uv = geometry.getAttribute('uv') as BufferAttribute;
  const halfH = BOOK_H / 2 - PAGE_MARGIN;
  const outer = BOOK_W - PAGE_MARGIN;
  const columns = SECTIONS + 1;
  const head = columns * 2;
  const tail = columns * 4;
  const fore = columns * 6;

  const profile = (t: number) => {
    const rise = 1 - Math.exp(-t * 15);
    const crown = 1 + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.5)) - 0.06 * t * t;
    return height * lerp(1, rise * crown, arch);
  };

  for (let i = 0; i <= SECTIONS; i += 1) {
    const t = (i / SECTIONS) ** 1.6;
    const baseX = lerp(-inner, outer, t);
    const topX = baseX - slant * height * t;
    const z = profile(t);
    const slope = (profile(t + 0.01) - z) / (0.01 * (outer + inner));
    const nl = Math.hypot(slope, 1);
    const u = flip ? 1 - t : t;

    position.setXYZ(i * 2, topX, halfH, z);
    position.setXYZ(i * 2 + 1, topX, -halfH, z);
    normal.setXYZ(i * 2, -slope / nl, 0, 1 / nl);
    normal.setXYZ(i * 2 + 1, -slope / nl, 0, 1 / nl);
    uv.setXY(i * 2, u, flip ? 0 : 1);
    uv.setXY(i * 2 + 1, u, flip ? 1 : 0);

    const a = head + i * 2;
    position.setXYZ(a, topX, halfH, z);
    position.setXYZ(a + 1, baseX, halfH, 0);
    normal.setXYZ(a, 0, 1, 0);
    normal.setXYZ(a + 1, 0, 1, 0);
    uv.setXY(a, t * 0.2, z * 3);
    uv.setXY(a + 1, t * 0.2, 0);

    const b = tail + i * 2;
    position.setXYZ(b, topX, -halfH, z);
    position.setXYZ(b + 1, baseX, -halfH, 0);
    normal.setXYZ(b, 0, -1, 0);
    normal.setXYZ(b + 1, 0, -1, 0);
    uv.setXY(b, t * 0.2, z * 3);
    uv.setXY(b + 1, t * 0.2, 0);
  }

  const endTop = outer - slant * height;
  const endZ = profile(1);
  position.setXYZ(fore, endTop, halfH, endZ);
  position.setXYZ(fore + 1, outer, halfH, 0);
  position.setXYZ(fore + 2, endTop, -halfH, endZ);
  position.setXYZ(fore + 3, outer, -halfH, 0);
  const nl = Math.hypot(endZ, slant * height) || 1;
  for (let i = 0; i < 4; i += 1) normal.setXYZ(fore + i, endZ / nl, 0, (slant * height) / nl);
  uv.setXY(fore, 0, endZ * 3);
  uv.setXY(fore + 1, 0, 0);
  uv.setXY(fore + 2, 0.4, endZ * 3);
  uv.setXY(fore + 3, 0.4, 0);

  position.needsUpdate = true;
  normal.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeBoundingSphere();
}

const SPINE_SEGMENTS = 12;

/** Гибкая полоса корешка. Изгибается вместе с раскрытием книги. */
export function createSpineGeometry(): BufferGeometry {
  const columns = SPINE_SEGMENTS + 1;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(columns * 2 * 3), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(columns * 2 * 3), 3));
  const uv = new BufferAttribute(new Float32Array(columns * 2 * 2), 2);
  const index: number[] = [];
  for (let i = 0; i <= SPINE_SEGMENTS; i += 1) {
    uv.setXY(i * 2, i / SPINE_SEGMENTS, 1);
    uv.setXY(i * 2 + 1, i / SPINE_SEGMENTS, 0);
    if (i < SPINE_SEGMENTS) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  geometry.setAttribute('uv', uv);
  geometry.setIndex(index);
  return geometry;
}

export function updateSpineGeometry(
  geometry: BufferGeometry,
  start: { x: number; z: number },
  end: { x: number; z: number },
  bulge: number,
): void {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  const halfH = BOOK_H / 2;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz) || 1;
  // Наружная нормаль смотрит от страниц.
  const nx = -dz / length;
  const nz = dx / length;
  for (let i = 0; i <= SPINE_SEGMENTS; i += 1) {
    const s = i / SPINE_SEGMENTS;
    const offset = bulge * Math.sin(Math.PI * s);
    const x = lerp(start.x, end.x, s) + nx * offset;
    const z = lerp(start.z, end.z, s) + nz * offset;
    // Наклон дуги в этой точке даёт скруглённый блик.
    const lean = bulge * Math.cos(Math.PI * s) * Math.PI / length;
    const mx = nx - (dx / length) * lean;
    const mz = nz - (dz / length) * lean;
    const ml = Math.hypot(mx, mz);
    position.setXYZ(i * 2, x, halfH, z);
    position.setXYZ(i * 2 + 1, x, -halfH, z);
    normal.setXYZ(i * 2, mx / ml, 0, mz / ml);
    normal.setXYZ(i * 2 + 1, mx / ml, 0, mz / ml);
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
}
