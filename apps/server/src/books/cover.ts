import { Resvg } from '@resvg/resvg-js';
import { MOTIFS, type CoverStyle } from '@bookverse/shared';

const WIDTH = 480;
const HEIGHT = 653;

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Грубый перенос по числу символов: у обложки всего несколько коротких строк. */
function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && `${line} ${word}`.length > perLine) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.slice(0, 4);
}

function coverSvg(title: string, author: string, style: CoverStyle): string {
  const motif = MOTIFS[style.motif] ?? MOTIFS.book!;
  const lines = wrap(title, 17);
  const size = lines.length > 2 ? 40 : 46;
  const top = 400 - ((lines.length - 1) * size * 1.1) / 2;
  const titleText = lines
    .map((line, i) => `<text x="240" y="${top + i * size * 1.1}" font-size="${size}" text-anchor="middle" font-weight="700">${escapeXml(line)}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs><radialGradient id="leather" cx="50%" cy="42%" r="74%"><stop offset="0" stop-color="${style.leather}"/><stop offset="1" stop-color="${style.leatherDeep}"/></radialGradient></defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#leather)"/>
    <g fill="none" stroke="${style.foil}">
      <rect x="30" y="30" width="420" height="593" stroke-width="4"/>
      <rect x="38" y="38" width="404" height="577" stroke-width="1.4"/>
      <g transform="translate(160 90) scale(1.6)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
        ${motif.stroke.map((d) => `<path d="${d}"/>`).join('')}
      </g>
    </g>
    <g fill="${style.foil}" font-family="Georgia, 'Times New Roman', 'Liberation Serif', serif">
      ${titleText}
      <text x="240" y="${top + lines.length * size * 1.1 + 18}" font-size="22" text-anchor="middle">${escapeXml(author)}</text>
    </g>
  </svg>`;
}

const cache = new Map<string, Buffer>();

/** Обложка для Telegram: бот отправляет готовую картинку, холста на сервере нет. */
export function coverPng(publicId: string, title: string, author: string, style: CoverStyle): Buffer {
  let png = cache.get(publicId);
  if (!png) {
    const resvg = new Resvg(coverSvg(title, author, style), {
      font: { loadSystemFonts: true, defaultFontFamily: 'Georgia' },
      fitTo: { mode: 'width', value: WIDTH },
    });
    png = Buffer.from(resvg.render().asPng());
    cache.set(publicId, png);
  }
  return png;
}
