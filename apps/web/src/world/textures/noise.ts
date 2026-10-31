/** Небольшой детерминированный генератор: рисунок материалов одинаков при каждом запуске. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, ctx };
}

/** Клеточный шум для бесшовной кожаной фактуры. Возвращает высоты 0..1. */
export function leatherHeight(size: number, cells: number, seed: number): Float32Array {
  const rand = mulberry(seed);
  const grid = Math.ceil(Math.sqrt(cells));
  const points = new Float32Array(grid * grid * 2);
  for (let i = 0; i < grid * grid; i += 1) {
    points[i * 2] = rand();
    points[i * 2 + 1] = rand();
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fx = (x / size) * grid;
      const fy = (y / size) * grid;
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      let first = 9;
      let second = 9;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const gx = (cx + ox + grid) % grid;
          const gy = (cy + oy + grid) % grid;
          const i = (gy * grid + gx) * 2;
          const dx = cx + ox + points[i]! - fx;
          const dy = cy + oy + points[i + 1]! - fy;
          const d = dx * dx + dy * dy;
          if (d < first) {
            second = first;
            first = d;
          } else if (d < second) second = d;
        }
      }
      // Морщины кожи проходят по границам клеток.
      const edge = Math.sqrt(second) - Math.sqrt(first);
      out[y * size + x] = Math.min(1, edge * 2.6);
    }
  }
  return out;
}

/** Нормали из карты высот оператором Собеля. */
export function normalsFromHeight(height: Float32Array, width: number, rows: number, strength: number): ImageData {
  const image = new ImageData(width, rows);
  const at = (x: number, y: number) => height[((y + rows) % rows) * width + ((x + width) % width)]!;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 4;
      image.data[i] = ((-dx / length) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      image.data[i + 2] = (1 / length) * 0.5 * 255 + 127.5;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
