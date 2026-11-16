/**
 * Текстовые файлы и CSV в окне просмотра (доработки 16.11.2026, блок 5, пункт 2): кодировка UTF-8
 * или Windows-1251 определяется сама — по BOM, иначе строгий UTF-8, а при ошибке — Windows-1251
 * (так сохраняют 1С и «Блокнот» старых Windows).
 */

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1251';

export function decodeText(b: Uint8Array): { text: string; encoding: TextEncodingName } {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8' };
  if (b[0] === 0xff && b[1] === 0xfe)
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  if (b[0] === 0xfe && b[1] === 0xff)
    return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(b), encoding: 'windows-1251' };
  }
}

/** Строк текстового файла в окне — не больше; остальное — «Скачайте, чтобы увидеть всё». */
export const TEXT_MAX_LINES = 10_000;
/** Знаков текстового файла в окне — не больше. */
export const TEXT_MAX_CHARS = 2_000_000;

export interface TextView {
  kind: 'text';
  lines: string[];
  encoding: TextEncodingName;
  /** Всего строк в файле. */
  totalLines: number;
}

export function textView(b: Uint8Array): TextView {
  const { text, encoding } = decodeText(b);
  const cut = text.length > TEXT_MAX_CHARS ? text.slice(0, TEXT_MAX_CHARS) : text;
  const all = cut.split(/\r\n|\r|\n/);
  const totalLines = text.length > TEXT_MAX_CHARS ? text.split(/\r\n|\r|\n/).length : all.length;
  return { kind: 'text', lines: all.slice(0, TEXT_MAX_LINES), encoding, totalLines };
}

/** Разделитель CSV: тот из `;` `,` табуляции `|`, который чаще и ровнее встречается в первых строках вне кавычек. */
export function csvDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024);
  const cands = [';', ',', '\t', '|'];
  let best = ',';
  let bestScore = 0;
  for (const d of cands) {
    const counts: number[] = [];
    let inQ = false;
    let c = 0;
    for (let i = 0; i < sample.length && counts.length < 20; i++) {
      const ch = sample[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === d) c++;
      else if (!inQ && ch === '\n') {
        counts.push(c);
        c = 0;
      }
    }
    if (c) counts.push(c);
    const lines = counts.filter((x) => x > 0).length;
    const score = lines ? lines * 1000 + Math.min(...counts.filter((x) => x > 0)) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Разбор CSV по RFC 4180 (кавычки, удвоенные кавычки, переносы внутри кавычек). `maxRows` — сколько
 * строк вернуть; `total` — сколько строк в файле всего.
 */
export function parseCsv(
  text: string,
  maxRows: number,
  delim = csvDelimiter(text),
): { rows: string[][]; total: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  let total = 0;
  const n = text.length;
  const push = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    push();
    total++;
    if (rows.length < maxRows) rows.push(row);
    row = [];
  };
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < n; i++) {
    const ch = text[i]!;
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQ = true;
    else if (ch === delim) push();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
  }
  if (field !== '' || row.length) endRow();
  return { rows, total };
}
