export const READER_THEME_IDS = [
  'parchment',
  'academia',
  'midnight',
  'royal',
  'minimal',
  'sunset',
  'forest',
  'storybook',
] as const;

export type ReaderThemeId = (typeof READER_THEME_IDS)[number];

export const READER_FONT_IDS = ['literata', 'oldstandard', 'cormorant', 'manrope', 'nunito'] as const;
export type ReaderFontId = (typeof READER_FONT_IDS)[number];

export const PAGE_TURN_MODES = ['full', 'soft', 'off'] as const;
export type PageTurnMode = (typeof PAGE_TURN_MODES)[number];

export interface ReaderSettings {
  themeId: ReaderThemeId;
  fontId: ReaderFontId | 'auto';
  fontScale: number;
  lineHeight: number;
  align: 'left' | 'justify';
  margin: number;
  pageWidth: number;
  brightness: number;
  pageTurn: PageTurnMode;
  reducedMotion: boolean;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  themeId: 'parchment',
  fontId: 'auto',
  fontScale: 1,
  lineHeight: 1.62,
  align: 'justify',
  margin: 1,
  pageWidth: 1,
  brightness: 1,
  pageTurn: 'full',
  reducedMotion: false,
};
