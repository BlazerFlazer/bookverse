export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = QualityLevel | 'auto';

export interface QualityProfile {
  level: QualityLevel;
  /** Предел плотности пикселей холста. */
  maxDpr: number;
  textureSize: number;
  paperCount: number;
  flyingBooks: number;
  dustCount: number;
  shelfBooks: number;
  dynamicLights: number;
  bloom: boolean;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: { level: 'low', maxDpr: 0.85, textureSize: 512, paperCount: 70, flyingBooks: 6, dustCount: 120, shelfBooks: 1800, dynamicLights: 1, bloom: false },
  medium: { level: 'medium', maxDpr: 1, textureSize: 1024, paperCount: 150, flyingBooks: 12, dustCount: 300, shelfBooks: 4200, dynamicLights: 2, bloom: false },
  high: { level: 'high', maxDpr: 1.5, textureSize: 1536, paperCount: 260, flyingBooks: 18, dustCount: 600, shelfBooks: 7500, dynamicLights: 3, bloom: true },
  ultra: { level: 'ultra', maxDpr: 2, textureSize: 2048, paperCount: 420, flyingBooks: 26, dustCount: 1000, shelfBooks: 12000, dynamicLights: 4, bloom: true },
};

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

function gpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    return '';
  }
}

/** Встроенная графика получает «средний» профиль, программный рендер и телефоны — «низкий». */
export function detectQuality(): QualityLevel {
  const gpu = gpuName().toLowerCase();
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  if (coarse || memory <= 2) return 'low';
  if (/rtx|radeon rx|radeon pro|geforce gtx [12]|apple m[2-9]/.test(gpu)) return 'high';
  return 'medium';
}

export function resolveQuality(setting: QualitySetting): QualityProfile {
  return QUALITY_PROFILES[setting === 'auto' ? detectQuality() : setting];
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
