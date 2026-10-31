import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import type { CoverStyle } from '@bookverse/shared';
import { MOTIFS } from '@bookverse/shared';
import { createCanvas, hexToRgb, leatherHeight, normalsFromHeight } from './noise.ts';

export const COVER_ASPECT = 1.36;

function drawMotif(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, size: number): void {
  const motif = MOTIFS[name] ?? MOTIFS.book!;
  const scale = size / 100;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const path of motif.stroke) ctx.stroke(new Path2D(path));
  ctx.restore();
}

export interface CoverSpec {
  key: string;
  title: string;
  author: string;
  style: CoverStyle;
  /** На фирменной книге вместо заголовка — крупный логотип. */
  brand?: boolean;
}

export interface CoverTextures {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  ormMap: CanvasTexture;
  emissiveMap: CanvasTexture;
  spine: CanvasTexture;
  dispose: () => void;
}

/** Переносы по словам с подбором размера: длинные названия не вылезают за рамку. */
function fitTitle(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number, start: number, family: string): { lines: string[]; size: number } {
  for (let size = start; size > start * 0.4; size -= start * 0.04) {
    ctx.font = `600 ${size}px ${family}`;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = attempt;
    }
    lines.push(line);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length <= maxLines && widest <= maxWidth) return { lines, size };
  }
  return { lines: [text], size: start * 0.4 };
}

function spacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  const previous = ctx.letterSpacing;
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(text, x + spacing / 2, y);
  ctx.letterSpacing = previous;
}

/** Завиток в углу рамки. Рисуется в системе координат угла и отражается на все четыре. */
function cornerFlourish(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, s * 1.1);
  ctx.bezierCurveTo(s * 0.04, s * 0.5, s * 0.5, s * 0.04, s * 1.1, 0);
  ctx.moveTo(s * 0.12, s * 0.12);
  ctx.bezierCurveTo(s * 0.55, s * 0.12, s * 0.72, s * 0.3, s * 0.55, s * 0.5);
  ctx.bezierCurveTo(s * 0.44, s * 0.62, s * 0.26, s * 0.54, s * 0.3, s * 0.4);
  ctx.moveTo(s * 0.12, s * 0.12);
  ctx.bezierCurveTo(s * 0.12, s * 0.55, s * 0.3, s * 0.72, s * 0.5, s * 0.55);
  ctx.moveTo(s * 0.72, s * 0.08);
  ctx.bezierCurveTo(s * 0.86, s * 0.1, s * 0.92, s * 0.2, s * 0.84, s * 0.28);
  ctx.moveTo(s * 0.08, s * 0.72);
  ctx.bezierCurveTo(s * 0.1, s * 0.86, s * 0.2, s * 0.92, s * 0.28, s * 0.84);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s * 0.12, s * 0.12, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Весь золотой рисунок обложки. Функция вызывается на маске: из неё получаются цвет фольги,
 * тиснение в карте нормалей, металличность и свечение. Поэтому золото всегда совпадает с рельефом.
 */
function drawOrnament(ctx: CanvasRenderingContext2D, w: number, h: number, spec: CoverSpec): void {
  const u = w / 1000;
  const inset = 62 * u;
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';

  ctx.lineWidth = 10 * u;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.lineWidth = 3.6 * u;
  ctx.strokeRect(inset + 15 * u, inset + 15 * u, w - (inset + 15 * u) * 2, h - (inset + 15 * u) * 2);

  ctx.lineWidth = 5 * u;
  const corners: [number, number, number, number][] = [
    [inset + 26 * u, inset + 26 * u, 1, 1],
    [w - inset - 26 * u, inset + 26 * u, -1, 1],
    [inset + 26 * u, h - inset - 26 * u, 1, -1],
    [w - inset - 26 * u, h - inset - 26 * u, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    cornerFlourish(ctx, 150 * u);
    ctx.restore();
  }

  const cx = w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (spec.brand) {
    const cy = h * 0.43;
    ctx.lineWidth = 5 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, 214 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, 196 * u, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 48; i += 1) {
      const a = (i / 48) * Math.PI * 2;
      const r0 = 222 * u;
      const r1 = i % 2 === 0 ? 262 * u : 240 * u;
      ctx.lineWidth = i % 2 === 0 ? 4.4 * u : 2.4 * u;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.lineWidth = 9 * u;
    drawMotif(ctx, 'book', cx, cy, 290 * u);

    ctx.font = `600 ${122 * u}px "Cormorant Garamond", serif`;
    spacedText(ctx, 'BOOKVERSE', cx, h * 0.725, 12 * u);
    ctx.lineWidth = 2.4 * u;
    ctx.beginPath();
    ctx.moveTo(cx - 190 * u, h * 0.785);
    ctx.lineTo(cx - 30 * u, h * 0.785);
    ctx.moveTo(cx + 30 * u, h * 0.785);
    ctx.lineTo(cx + 190 * u, h * 0.785);
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, h * 0.785);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-8 * u, -8 * u, 16 * u, 16 * u);
    ctx.restore();
    ctx.font = `500 ${38 * u}px "Cormorant Garamond", serif`;
    spacedText(ctx, 'ЖИВАЯ БИБЛИОТЕКА', cx, h * 0.83, 9 * u);
    return;
  }

  ctx.lineWidth = 5.5 * u;
  drawMotif(ctx, spec.style.motif, cx, h * 0.33, 250 * u);

  const family = '"Cormorant Garamond", serif';
  const title = fitTitle(ctx, spec.title, w * 0.68, 4, 112 * u, family);
  ctx.font = `600 ${title.size}px ${family}`;
  const lineHeight = title.size * 1.04;
  const top = h * 0.62 - ((title.lines.length - 1) * lineHeight) / 2;
  title.lines.forEach((line, i) => ctx.fillText(line, cx, top + i * lineHeight));

  ctx.lineWidth = 2.2 * u;
  const dividerY = top + title.lines.length * lineHeight - lineHeight * 0.32;
  ctx.beginPath();
  ctx.moveTo(cx - 90 * u, dividerY);
  ctx.lineTo(cx + 90 * u, dividerY);
  ctx.stroke();

  ctx.font = `500 ${42 * u}px "Cormorant Garamond", serif`;
  ctx.fillText(spec.author, cx, dividerY + 54 * u);
}

function configure(texture: CanvasTexture, color: boolean): CanvasTexture {
  texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  return texture;
}

/** Кожа один раз считается в тайл и затем кладётся на все обложки. */
let leatherTile: Float32Array | null = null;
const LEATHER_TILE = 256;

function leather(): Float32Array {
  leatherTile ??= leatherHeight(LEATHER_TILE, 2600, 11);
  return leatherTile;
}

export function makeCoverTextures(spec: CoverSpec, width: number): CoverTextures {
  const height = Math.round(width * COVER_ASPECT);
  const tile = leather();
  const [deepR, deepG, deepB] = hexToRgb(spec.style.leatherDeep);
  const [lightR, lightG, lightB] = hexToRgb(spec.style.leather);
  const [foilR, foilG, foilB] = hexToRgb(spec.style.foil);

  const mask = createCanvas(width, height);
  drawOrnament(mask.ctx, width, height, spec);
  const maskPixels = mask.ctx.getImageData(0, 0, width, height).data;

  const blurred = createCanvas(width, height);
  blurred.ctx.filter = `blur(${Math.max(1, width / 700)}px)`;
  blurred.ctx.drawImage(mask.canvas, 0, 0);
  const blurPixels = blurred.ctx.getImageData(0, 0, width, height).data;

  const albedo = createCanvas(width, height);
  const orm = createCanvas(width, height);
  const emissive = createCanvas(width, height);
  const albedoImage = albedo.ctx.createImageData(width, height);
  const ormImage = orm.ctx.createImageData(width, height);
  const emissiveImage = emissive.ctx.createImageData(width, height);
  const heights = new Float32Array(width * height);

  const scale = LEATHER_TILE / (width * 0.42);
  for (let y = 0; y < height; y += 1) {
    const ny = y / height - 0.5;
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const p = i * 4;
      const nx = x / width - 0.5;
      const tx = Math.floor(x * scale) % LEATHER_TILE;
      const ty = Math.floor(y * scale) % LEATHER_TILE;
      const grain = tile[ty * LEATHER_TILE + tx]!;
      const ink = maskPixels[p + 3]! / 255;
      const soft = blurPixels[p + 3]! / 255;

      // Кожа темнеет к краям и поблёскивает на выпуклостях зерна.
      const vignette = Math.max(0, 1 - (nx * nx + ny * ny) * 1.5);
      const tone = (0.42 + 0.58 * grain) * (0.55 + 0.45 * vignette);
      const baseR = deepR + (lightR - deepR) * tone;
      const baseG = deepG + (lightG - deepG) * tone;
      const baseB = deepB + (lightB - deepB) * tone;
      // Тиснение вдавливает кожу вокруг золота.
      const press = 1 - soft * 0.4 * (1 - ink);

      albedoImage.data[p] = baseR * press * (1 - ink) + foilR * ink;
      albedoImage.data[p + 1] = baseG * press * (1 - ink) + foilG * ink;
      albedoImage.data[p + 2] = baseB * press * (1 - ink) + foilB * ink;
      albedoImage.data[p + 3] = 255;

      ormImage.data[p] = 255;
      ormImage.data[p + 1] = (0.6 - grain * 0.14) * (1 - ink) * 255 + 0.3 * ink * 255;
      ormImage.data[p + 2] = ink * 255;
      ormImage.data[p + 3] = 255;

      emissiveImage.data[p] = foilR * ink;
      emissiveImage.data[p + 1] = foilG * ink;
      emissiveImage.data[p + 2] = foilB * ink;
      emissiveImage.data[p + 3] = 255;

      // На фольге зерна нет: иначе золото рассыпается на шумные блики.
      heights[i] = grain * 0.2 * (1 - soft) - soft * 0.42;
    }
  }
  albedo.ctx.putImageData(albedoImage, 0, 0);
  orm.ctx.putImageData(ormImage, 0, 0);
  emissive.ctx.putImageData(emissiveImage, 0, 0);

  const normal = createCanvas(width, height);
  normal.ctx.putImageData(normalsFromHeight(heights, width, height, width / 512), 0, 0);

  const spineCanvas = makeSpineCanvas(spec, width);

  const textures = [
    configure(new CanvasTexture(albedo.canvas), true),
    configure(new CanvasTexture(normal.canvas), false),
    configure(new CanvasTexture(orm.canvas), false),
    configure(new CanvasTexture(emissive.canvas), true),
    configure(new CanvasTexture(spineCanvas), true),
  ] as const;

  return {
    map: textures[0],
    normalMap: textures[1],
    ormMap: textures[2],
    emissiveMap: textures[3],
    spine: textures[4],
    dispose: () => textures.forEach((t) => t.dispose()),
  };
}

/** Корешок: кожа, бинты, название вдоль. Высота совпадает с высотой обложки. */
export function makeSpineCanvas(spec: CoverSpec, coverWidth: number): HTMLCanvasElement {
  const height = Math.round(coverWidth * COVER_ASPECT * 0.5);
  const width = Math.round(height * 0.17);
  const { canvas, ctx } = createCanvas(width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, spec.style.leatherDeep);
  gradient.addColorStop(0.5, spec.style.leather);
  gradient.addColorStop(1, spec.style.leatherDeep);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = spec.style.foil;
  ctx.strokeStyle = spec.style.foil;
  const bands = [0.08, 0.12, 0.84, 0.88];
  for (const b of bands) ctx.fillRect(0, height * b, width, Math.max(1.5, height * 0.006));

  ctx.save();
  ctx.translate(width / 2, height * 0.48);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = spec.brand ? 'BOOKVERSE' : spec.title;
  const { lines, size } = fitTitle(ctx, text, height * 0.66, 1, width * 0.46, '"Cormorant Garamond", serif');
  ctx.font = `600 ${size}px "Cormorant Garamond", serif`;
  ctx.fillText(lines[0] ?? text, 0, 0);
  ctx.restore();

  ctx.lineWidth = Math.max(1, width * 0.06);
  drawMotif(ctx, spec.brand ? 'book' : spec.style.motif, width / 2, height * 0.93, width * 0.62);
  return canvas;
}

/** Обложка для каталога: тот же рисунок и та же кожа, но плоская и маленькая. */
export function renderCoverPreview(spec: CoverSpec, width: number): string {
  const height = Math.round(width * COVER_ASPECT);
  const { canvas, ctx } = createCanvas(width, height);
  const gradient = ctx.createRadialGradient(width * 0.5, height * 0.42, 0, width * 0.5, height * 0.5, height * 0.72);
  gradient.addColorStop(0, spec.style.leather);
  gradient.addColorStop(1, spec.style.leatherDeep);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const mask = createCanvas(width, height);
  drawOrnament(mask.ctx, width, height, spec);
  mask.ctx.globalCompositeOperation = 'source-in';
  const foil = mask.ctx.createLinearGradient(0, 0, width, height);
  foil.addColorStop(0, spec.style.foil);
  foil.addColorStop(0.5, '#fff0c8');
  foil.addColorStop(1, spec.style.foil);
  mask.ctx.fillStyle = foil;
  mask.ctx.fillRect(0, 0, width, height);
  ctx.drawImage(mask.canvas, 0, 0);

  const shade = ctx.createLinearGradient(0, 0, width * 0.14, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.45)');
  shade.addColorStop(0.6, 'rgba(255,255,255,0.06)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width * 0.14, height);
  return canvas.toDataURL('image/webp', 0.9);
}

export function repeatTexture(texture: CanvasTexture, x: number, y: number): CanvasTexture {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(x, y);
  return texture;
}
