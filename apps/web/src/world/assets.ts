import type { CanvasTexture } from 'three';
import type { BookSummaryDto, CoverStyle } from '@bookverse/shared';
import { useWorld } from '../stores/world.ts';
import { makeCoverTextures, renderCoverPreview, type CoverSpec, type CoverTextures } from './textures/cover.ts';
import { floorTexture, glowTexture, pageEdgeTexture, pagePaperTexture, shelfRowTexture, woodTextures } from './textures/materials.ts';

export const BRAND_COVER: CoverSpec = {
  key: 'brand',
  title: 'BOOKVERSE',
  author: '',
  brand: true,
  style: { leather: '#5a2418', leatherDeep: '#1e0c08', foil: '#efc27a', motif: 'book' },
};

interface Assets {
  brand: CoverTextures;
  paper: CanvasTexture;
  edge: CanvasTexture;
  glow: CanvasTexture;
  wood: { map: CanvasTexture; normalMap: CanvasTexture };
  floor: CanvasTexture;
  shelfRow: CanvasTexture;
}

export let assets: Assets;

/** Пауза, чтобы экран загрузки успел обновиться. В фоновой вкладке кадров нет, поэтому есть запасной таймер. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 120);
  });

let preparing: Promise<void> | null = null;

/** Реальная загрузка: прогресс отражает готовность шрифтов и генерацию материалов. */
export function prepareAssets(): Promise<void> {
  preparing ??= run();
  return preparing;
}

async function run(): Promise<void> {
  const { quality, setLoad } = useWorld.getState();
  const size = quality.textureSize;

  setLoad(4, 'Открываем двери библиотеки');
  await Promise.all([
    document.fonts.load('600 64px "Cormorant Garamond"', 'BOOKVERSE Каждая'),
    document.fonts.load('500 64px "Cormorant Garamond"', 'BOOKVERSE Каждая'),
    document.fonts.load('400 16px "Literata Variable"', 'Каждая'),
  ]);

  setLoad(20, 'Смазываем петли и переплёт');
  await nextFrame();
  const brand = makeCoverTextures(BRAND_COVER, size);

  setLoad(52, 'Перебираем страницы');
  await nextFrame();
  const paper = pagePaperTexture(Math.min(1024, size));
  const edge = pageEdgeTexture();
  const glow = glowTexture();

  setLoad(70, 'Натираем дерево воском');
  await nextFrame();
  const wood = woodTextures(Math.min(1024, size));
  const floor = floorTexture(Math.min(1024, size));

  setLoad(86, 'Расставляем книги по полкам');
  await nextFrame();
  const shelfRow = shelfRowTexture(1536, 192, 31);

  assets = { brand, paper, edge, glow, wood, floor, shelfRow };
  // Остальной путь до 100% проходит прогрев шейдеров в сцене.
  setLoad(92, 'Настраиваем свет');
  await nextFrame();
}

const coverCache = new Map<string, CoverTextures>();

export function coverSpecOf(book: Pick<BookSummaryDto, 'publicId' | 'title' | 'author' | 'cover'>): CoverSpec {
  return { key: book.publicId, title: book.title, author: book.author, style: book.cover };
}

export function coverTexturesFor(book: Pick<BookSummaryDto, 'publicId' | 'title' | 'author' | 'cover'>): CoverTextures {
  let textures = coverCache.get(book.publicId);
  if (!textures) {
    // На экране книга не шире 450 точек: большего размера глаз не заметит, а времени он стоит.
    textures = makeCoverTextures(coverSpecOf(book), Math.min(768, useWorld.getState().quality.textureSize));
    coverCache.set(book.publicId, textures);
  }
  return textures;
}

const previewCache = new Map<string, string>();

export function coverPreview(book: { publicId: string; title: string; author: string; cover: CoverStyle }, width = 220): string {
  const key = `${book.publicId}:${width}`;
  let url = previewCache.get(key);
  if (!url) {
    url = renderCoverPreview(coverSpecOf(book), width);
    previewCache.set(key, url);
  }
  return url;
}
