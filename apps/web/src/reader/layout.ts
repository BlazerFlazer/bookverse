export interface Spread {
  twoPages: boolean;
  pageWidth: number;
  pageHeight: number;
  /** Весь разворот на экране. */
  width: number;
  height: number;
  left: number;
  top: number;
}

const TOP_BAR = 56;
const JOURNEY = 104;

/** Размеры разворота. Этой же функцией пользуется 3D-книга: она садится ровно на страницы. */
export function computeSpread(viewportWidth: number, viewportHeight: number, widthScale: number): Spread {
  const twoPages = viewportWidth >= 960 && viewportWidth / viewportHeight > 1.12;
  const availableHeight = Math.max(320, viewportHeight - TOP_BAR - JOURNEY - 14);
  const availableWidth = viewportWidth - (twoPages ? 110 : 24);
  const perPage = twoPages ? availableWidth / 2 : availableWidth;
  const pageWidth = Math.floor(Math.min(perPage, availableHeight * 0.76 * widthScale));
  const pageHeight = Math.floor(Math.min(availableHeight, pageWidth / 0.68));
  const width = pageWidth * (twoPages ? 2 : 1);
  return {
    twoPages,
    pageWidth,
    pageHeight,
    width,
    height: pageHeight,
    left: Math.round((viewportWidth - width) / 2),
    top: TOP_BAR + Math.round((availableHeight - pageHeight) / 2),
  };
}
