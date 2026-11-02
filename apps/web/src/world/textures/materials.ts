import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { createCanvas, mulberry, normalsFromHeight } from './noise.ts';

function colorTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 6;
  texture.minFilter = LinearMipmapLinearFilter;
  return texture;
}

function dataTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = colorTexture(canvas);
  texture.colorSpace = NoColorSpace;
  return texture;
}

/** Срез страниц: тысячи тонких линий. По высоте текстура повторяется. */
export function pageEdgeTexture(): CanvasTexture {
  const { canvas, ctx } = createCanvas(32, 512);
  const rand = mulberry(7);
  ctx.fillStyle = '#e9d9b8';
  ctx.fillRect(0, 0, 32, 512);
  for (let y = 0; y < 512; y += 1) {
    const v = rand();
    ctx.fillStyle = `rgba(${v > 0.5 ? '120,90,55' : '255,246,226'},${0.12 + rand() * 0.34})`;
    ctx.fillRect(0, y, 32, 1);
    if (rand() > 0.82) {
      ctx.fillStyle = 'rgba(70,48,28,0.35)';
      ctx.fillRect(0, y, 32, 1);
    }
  }
  return colorTexture(canvas);
}

/** Страница с настоящими строками. Текст на летящих листах читается как текст, а не как полоски. */
export function pagePaperTexture(size: number): CanvasTexture {
  const width = size;
  const height = Math.round(size * 1.36);
  const { canvas, ctx } = createCanvas(width, height);
  const rand = mulberry(21);
  ctx.fillStyle = '#f3e8cf';
  ctx.fillRect(0, 0, width, height);

  const blot = ctx.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, width * 0.85);
  blot.addColorStop(0, 'rgba(255,250,235,0.5)');
  blot.addColorStop(1, 'rgba(176,136,84,0.32)');
  ctx.fillStyle = blot;
  ctx.fillRect(0, 0, width, height);

  const left = width * 0.14;
  const right = width * 0.86;
  const fontSize = Math.max(8, width * 0.032);
  ctx.fillStyle = 'rgba(58,38,24,0.82)';
  ctx.font = `600 ${fontSize * 2}px "Cormorant Garamond", serif`;
  ctx.textAlign = 'center';
  ctx.fillText('❦', width / 2, height * 0.13);
  ctx.textAlign = 'left';
  ctx.font = `${fontSize}px "Cormorant Garamond", serif`;
  const sample =
    'Каждая книга новая вселенная пока её читают она живёт и за окнами всегда тот самый час слова перетекают со строки на строку собираются в истории дороги уходят за холм и кто то очень терпеливый перелистывает страницу';
  const words = sample.split(' ');
  let y = height * 0.18;
  let index = Math.floor(rand() * words.length);
  while (y < height * 0.9) {
    let x = left;
    while (x < right) {
      const word = words[index % words.length]!;
      const measure = ctx.measureText(word).width;
      if (x + measure > right) break;
      ctx.fillText(word, x, y);
      x += measure + fontSize * 0.34;
      index += 1;
    }
    y += fontSize * 1.42;
  }
  return colorTexture(canvas);
}

/** Тёмный орех: длинные волокна вдоль оси X. */
export function woodTextures(size: number, seed = 3): { map: CanvasTexture; normalMap: CanvasTexture } {
  const { canvas, ctx } = createCanvas(size, size);
  const rand = mulberry(seed);
  ctx.fillStyle = '#3b2418';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 1.6; i += 1) {
    const y = rand() * size;
    const dark = rand() > 0.5;
    ctx.strokeStyle = dark ? `rgba(22,12,7,${0.08 + rand() * 0.22})` : `rgba(122,80,48,${0.05 + rand() * 0.16})`;
    ctx.lineWidth = 0.5 + rand() * 2.2;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    const wobble = rand() * 16 - 8;
    ctx.bezierCurveTo(size * 0.33, y + wobble, size * 0.66, y - wobble, size + 10, y + rand() * 6 - 3);
    ctx.stroke();
  }
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const heights = new Float32Array(size * size);
  for (let i = 0; i < heights.length; i += 1) heights[i] = pixels[i * 4]! / 255;
  const normal = createCanvas(size, size);
  normal.ctx.putImageData(normalsFromHeight(heights, size, size, 1.6), 0, 0);
  return { map: colorTexture(canvas), normalMap: dataTexture(normal.canvas) };
}

/** Паркет ёлочкой не нужен: длинные доски лучше работают на перспективу зала. */
export function floorTexture(size: number): CanvasTexture {
  const { canvas, ctx } = createCanvas(size, size);
  const rand = mulberry(9);
  const rows = 8;
  const rowHeight = size / rows;
  for (let row = 0; row < rows; row += 1) {
    let x = -rand() * size * 0.3;
    while (x < size) {
      const length = size * (0.3 + rand() * 0.4);
      const tone = 28 + rand() * 20;
      ctx.fillStyle = `rgb(${tone + 22},${tone},${tone - 12})`;
      ctx.fillRect(x, row * rowHeight, length - 1.5, rowHeight - 1.5);
      for (let i = 0; i < 12; i += 1) {
        ctx.strokeStyle = `rgba(15,8,4,${0.08 + rand() * 0.14})`;
        ctx.lineWidth = 0.6;
        const y = row * rowHeight + rand() * rowHeight;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + length, y + rand() * 3 - 1.5);
        ctx.stroke();
      }
      x += length;
    }
  }
  return colorTexture(canvas);
}

const SPINE_TONES = ['#5d2a2c', '#3a2a22', '#2f3f39', '#6a4a2a', '#2b2f45', '#4f2030', '#70552f', '#3a3324', '#23362f', '#5a3a2a'];

/** Ряд корешков одной картинкой: для дальних пролётов и верхнего яруса, где нет смысла в геометрии. */
export function shelfRowTexture(width: number, height: number, seed: number): CanvasTexture {
  const { canvas, ctx } = createCanvas(width, height);
  const rand = mulberry(seed);
  ctx.fillStyle = '#0d0806';
  ctx.fillRect(0, 0, width, height);
  let x = 0;
  while (x < width) {
    const bookWidth = height * (0.05 + rand() * 0.09);
    const top = height * (0.04 + rand() * 0.24);
    const base = SPINE_TONES[Math.floor(rand() * SPINE_TONES.length)]!;
    const shade = ctx.createLinearGradient(x, 0, x + bookWidth, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.5)');
    shade.addColorStop(0.45, 'rgba(255,230,190,0.1)');
    shade.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = base;
    ctx.fillRect(x, top, bookWidth, height - top);
    ctx.fillStyle = shade;
    ctx.fillRect(x, top, bookWidth, height - top);
    ctx.fillStyle = 'rgba(214,170,100,0.75)';
    const bands = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < bands; i += 1) {
      const y = top + (height - top) * (0.12 + i * 0.18 + rand() * 0.04);
      ctx.fillRect(x + 1, y, bookWidth - 2, Math.max(1, height * 0.012));
    }
    if (rand() > 0.5) ctx.fillRect(x + bookWidth * 0.32, top + (height - top) * 0.46, bookWidth * 0.36, (height - top) * 0.24);
    x += bookWidth + 0.5;
    if (rand() > 0.96) x += height * 0.1;
  }
  const texture = colorTexture(canvas);
  texture.wrapT = RepeatWrapping;
  return texture;
}

/**
 * Вид за окнами в виде масок, а не картинки: цвет даёт шейдер, поэтому одна текстура служит
 * всем частям суток. Красный — облака и лужи, зелёный — дальний силуэт, синий — ближние деревья.
 */
export function exteriorTexture(size: number): CanvasTexture {
  const rand = mulberry(41);
  const layer = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const { ctx } = createCanvas(size, size);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff';
    draw(ctx);
    return ctx.getImageData(0, 0, size, size).data;
  };

  const clouds = layer((ctx) => {
    ctx.filter = `blur(${Math.round(size / 48)}px)`;
    for (let i = 0; i < 90; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      const width = size * (0.08 + rand() * 0.24);
      const height = width * (0.2 + rand() * 0.2);
      ctx.globalAlpha = 0.12 + rand() * 0.34;
      for (const wrap of [-size, 0, size]) {
        ctx.beginPath();
        ctx.ellipse(x + wrap, y, width, height, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
  });

  const horizon = size * 0.8;
  const far = layer((ctx) => {
    ctx.beginPath();
    ctx.moveTo(0, size);
    let x = 0;
    while (x <= size) {
      const wave = Math.sin((x / size) * Math.PI * 6) * size * 0.012 + Math.sin((x / size) * Math.PI * 14) * size * 0.006;
      ctx.lineTo(x, horizon - size * 0.05 + wave - rand() * size * 0.008);
      x += size / 90;
    }
    ctx.lineTo(size, size);
    ctx.closePath();
    ctx.fill();
    // Шпили старого города в дымке дождя.
    for (const spot of [0.14, 0.3, 0.37, 0.58, 0.76, 0.92]) {
      const cx = spot * size;
      const width = size * (0.012 + rand() * 0.016);
      const top = horizon - size * (0.14 + rand() * 0.14);
      ctx.fillRect(cx - width / 2, top + width * 2.4, width, horizon - top);
      ctx.beginPath();
      ctx.moveTo(cx - width * 0.7, top + width * 2.5);
      ctx.lineTo(cx, top);
      ctx.lineTo(cx + width * 0.7, top + width * 2.5);
      ctx.fill();
    }
  });

  const near = layer((ctx) => {
    for (let i = 0; i < 26; i += 1) {
      const x = rand() * size;
      const crown = size * (0.05 + rand() * 0.07);
      const y = horizon - crown * 0.5 + rand() * size * 0.04;
      for (const wrap of [-size, 0, size]) {
        for (let k = 0; k < 7; k += 1) {
          ctx.beginPath();
          ctx.arc(x + wrap + (rand() - 0.5) * crown * 1.5, y + (rand() - 0.5) * crown, crown * (0.35 + rand() * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillRect(x + wrap - size * 0.003, y, size * 0.006, size - y);
      }
    }
  });

  const { canvas, ctx } = createCanvas(size, size);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = clouds[i]!;
    image.data[i + 1] = far[i]!;
    image.data[i + 2] = near[i]!;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = dataTexture(canvas);
  texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = 1;
  return texture;
}

/** Мягкое пятно для ореолов ламп. */
export function glowTexture(): CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
