#!/usr/bin/env node
// Превращает исходник Викитеки или Project Gutenberg в простой формат BOOKVERSE (content/README.md).
// Использование: node content/tools/wiki2text.mjs <wiki|gutenberg> <вход> <выход> [--verse] [--cut "Заголовок"]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [mode, input, output, ...flags] = process.argv.slice(2);
if (!mode || !input || !output) {
  console.error('Использование: wiki2text.mjs <wiki|gutenberg> <вход> <выход> [--verse] [--cut "Заголовок"]');
  process.exit(1);
}
const verse = flags.includes('--verse');
const cutIndex = flags.indexOf('--cut');
const cutHeading = cutIndex >= 0 ? flags[cutIndex + 1] : null;

const raw = readFileSync(input, 'utf8').replace(/\r\n/g, '\n');

/** Снимает внешний шаблон {{Отексте ...}} с учётом вложенных скобок. */
function stripHeaderTemplate(text) {
  const start = text.indexOf('{{Отексте');
  if (start < 0) return text;
  let depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    if (text.startsWith('{{', i)) { depth += 1; i += 1; continue; }
    if (text.startsWith('}}', i)) {
      depth -= 1; i += 1;
      if (depth === 0) return text.slice(i + 1);
    }
  }
  return text;
}

function cleanInline(line) {
  return line
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{(?:razr|разрядка|Разрядка|r|sub|sup)\|([^{}|]*)[^{}]*\}\}/g, '$1')
    .replace(/\{\{indent\|\d+\|([^{}]*)\}\}/g, '$1')
    .replace(/__[A-Z]+__/g, '')
    .replace(/\{\{выступ\|[^{}]*\}\}/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\S+\s+([^\]]*)\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8201;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/́/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function fromWiki(text) {
  let body = stripHeaderTemplate(text);
  body = body.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  const cutAt = cutHeading ? body.search(new RegExp(`^={2,4}\\s*${cutHeading}`, 'm')) : -1;
  if (cutAt >= 0) body = body.slice(0, cutAt);
  const notesAt = body.search(/^={2,4}\s*Примечания/m);
  if (notesAt >= 0) body = body.slice(0, notesAt);

  const out = [];
  for (const rawLine of body.split('\n')) {
    const heading = rawLine.match(/^={2,4}\s*(.*?)\s*={2,4}\s*$/);
    if (heading) {
      const title = cleanInline(heading[1].replace(/<br\s*\/?>/g, ' ')).replace(/\s+/g, ' ');
      out.push('', `# ${title}`, '');
      continue;
    }
    if (/^(\{\{F1\||\|[^|]*\}\}$|\{\||\|\}|\|-|<\/?div|<\/?poem|<\/?center|\[\[Категория)/.test(rawLine.trim())) {
      if (/poem/.test(rawLine)) out.push('');
      continue;
    }
    const line = cleanInline(rawLine);
    if (/^(\*\s*\*\s*\*|\* \* \*)$/.test(line)) { out.push('', '~', ''); continue; }
    if (!line) { out.push(''); continue; }
    out.push(verse ? `> ${line}` : line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function fromGutenberg(text) {
  const start = text.search(/\*\*\* START OF .*\*\*\*/);
  const end = text.search(/\*\*\* END OF .*\*\*\*/);
  let body = text.slice(text.indexOf('\n', start) + 1, end);
  // Пропускаем титульный лист и оглавление: текст начинается со второго «CHAPTER I.»
  const firstChapter = [...body.matchAll(/^\s*CHAPTER I\.\s*$/gm)].at(-1);
  if (firstChapter) body = body.slice(firstChapter.index);

  const paragraphs = body.split(/\n\s*\n/);
  const out = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    const para = paragraphs[i].trim();
    if (!para) continue;
    const head = para.match(/^CHAPTER ([IVXLC]+)\.\s*\n?\s*(.*)$/s);
    if (head) {
      let title = head[2].replace(/\s+/g, ' ').trim();
      if (!title) { title = (paragraphs[i + 1] ?? '').trim().replace(/\s+/g, ' '); i += 1; }
      out.push(`# Chapter ${head[1]}. ${title}`, '');
      continue;
    }
    if (/^\*(\s+\*)+$/.test(para)) { out.push('~', ''); continue; }
    if (/^THE END$/.test(para)) continue;
    const lines = para.split('\n');
    const indented = lines.length > 1 && lines.every((l) => /^\s{2,}/.test(l));
    if (indented) {
      for (const l of lines) out.push(`> ${l.trim()}`);
      out.push('');
    } else {
      out.push(para.replace(/\s*\n\s*/g, ' ').replace(/_/g, '').replace(/\[Illustration[^\]]*\]/g, '').trim(), '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const result = mode === 'gutenberg' ? fromGutenberg(raw) : fromWiki(raw);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, result, 'utf8');
console.log(`${output}: ${result.length} символов, глав: ${(result.match(/^# /gm) ?? []).length}`);
