/*
 * Markdown подробного описания новости (ТЗ «База знаний (содержимое)» → «Новости»; прототип
 * modules/kb-news.js: mdHtml, mdInline, mdText; admin/news.js: mdTrim). Поддерживается: заголовки двух
 * уровней, жирный и курсив, код, маркированные и нумерованные списки, ссылки (в том числе на модуль
 * `#mod:id`, его вкладку `#mod:id.вкладка` и статью `#art:id`), картинки, цитата-примечание, разделитель,
 * простая таблица. На экран текст уходит не HTML, а блоками и кусками (`NewsMdBlock`, `NewsSpan`) —
 * HTML и скрипты из текста не выполняются: экран показывает их как обычный текст.
 */

/** Ссылка в тексте: внешняя (http, https), на модуль меню (и вкладку) или на статью Базы знаний. */
export type NewsLink =
  | { kind: 'url'; href: string }
  | { kind: 'mod'; module: string; tab: string | null }
  | { kind: 'art'; id: string };

/** Кусок текста с оформлением; у картинки — адрес и подпись. */
export type NewsSpan =
  | {
      text: string;
      bold?: true;
      italic?: true;
      code?: true;
      link?: NewsLink;
    }
  | { image: string; alt: string };

/** Пункт списка плоско, с глубиной (как `KbListItem`): экран собирает вложенность обратно. */
export interface NewsListItem {
  depth: number;
  ordered: boolean;
  spans: NewsSpan[];
}

export type NewsMdBlock =
  | { type: 'h4' | 'h5' | 'p' | 'quote'; spans: NewsSpan[] }
  | { type: 'hr' }
  | { type: 'list'; items: NewsListItem[] }
  | { type: 'table'; head: NewsSpan[][]; rows: NewsSpan[][][] };

/**
 * Адрес картинки в новости: внешняя по https или загруженная в Админке (`/api/news/images/<id>`).
 * Картинки `data:` (прототип хранил их в тексте) в продукте не принимаются: файлы живут в хранилище.
 */
export const NEWS_IMAGE_PATH = '/api/news/images/';
const IMAGE_SRC = /^(?:https:\/\/[^\s"'<>]+|\/api\/news\/images\/[0-9a-f-]{36})$/;
const LINK_REF = /^#(mod|art):([\w-]+)(?:\.([\w-]+))?$/;

type Marks = { bold?: true; italic?: true; link?: NewsLink };

function linkOf(href: string): NewsLink | null {
  const m = LINK_REF.exec(href);
  if (m) {
    if (m[1] === 'art') return m[3] ? null : { kind: 'art', id: m[2]! };
    return { kind: 'mod', module: m[2]!, tab: m[3] ?? null };
  }
  return /^https?:\/\/[^\s"'<>]+$/.test(href) ? { kind: 'url', href } : null;
}

/** Стоит ли перед курсивом подходящий знак (прототип: начало, пробел, «(» или «««). */
const ITALIC_BEFORE = /[\s(«]/;

/**
 * Строка → куски с оформлением (прототип mdInline): `код`, картинка, ссылка, **жирный**, *курсив* или
 * _курсив_. Внутри ссылки и жирного оформление разбирается дальше; неподходящая ссылка остаётся
 * текстом ссылки, неподходящая картинка — подписью.
 */
export function newsMdSpans(source: string, marks: Marks = {}): NewsSpan[] {
  const out: NewsSpan[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ text, ...marks });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ text: m[1]!, code: true, ...marks });
      i += m[0].length;
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      if (IMAGE_SRC.test(m[2]!)) out.push({ image: m[2]!, alt: m[1]! });
      else if (m[1]) out.push({ text: m[1], ...marks });
      i += m[0].length;
      continue;
    }
    if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      const link = linkOf(m[2]!);
      out.push(...newsMdSpans(m[1]!, link ? { ...marks, link } : marks));
      i += m[0].length;
      continue;
    }
    if ((m = /^\*\*([^*]+)\*\*/.exec(rest))) {
      flush();
      out.push(...newsMdSpans(m[1]!, { ...marks, bold: true }));
      i += m[0].length;
      continue;
    }
    if (
      (i === 0 || ITALIC_BEFORE.test(source[i - 1]!)) &&
      (m = /^[*_]([^*_\s][^*_]*?)[*_](?=[\s.,;:!?)»]|$)/.exec(rest))
    ) {
      flush();
      out.push(...newsMdSpans(m[1]!, { ...marks, italic: true }));
      i += m[0].length;
      continue;
    }
    text += source[i];
    i++;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,2})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,})\s*$/;
const QUOTE = /^>\s?/;
const LIST_ITEM = /^\s*([-*]|\d+[.)])\s+/;
const ORDERED = /^\s*\d+[.)]/;
const TABLE_ROW = /^\s*\|/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}/;
const PARAGRAPH_END = /^(#{1,2}\s|>|\s*([-*]|\d+[.)])\s+|\s*\||\s*-{3,}\s*$)/;

const indentOf = (line: string) => /^\s*/.exec(line)![0].length;
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/**
 * Текст markdown → блоки (прототип mdHtml): пустые строки разделяют абзацы, строки абзаца склеиваются
 * пробелом; список идёт, пока строки — пункты, вложенность — по отступу, смена нумерованного на
 * маркированный на том же отступе начинает новый список.
 */
export function newsMdBlocks(source: string): NewsMdBlock[] {
  const lines = String(source ?? '')
    .replace(/\r/g, '')
    .split('\n');
  const blocks: NewsMdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      i++;
      continue;
    }
    if ((m = HEADING.exec(line))) {
      blocks.push({ type: m[1]!.length === 1 ? 'h4' : 'h5', spans: newsMdSpans(m[2]!) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) quote.push(lines[i++]!.replace(QUOTE, ''));
      blocks.push({ type: 'quote', spans: newsMdSpans(quote.join(' ')) });
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
      const head = cellsOf(line);
      i += 2;
      const rows: NewsSpan[][][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        const cells = cellsOf(lines[i++]!);
        rows.push(head.map((_, j) => newsMdSpans(cells[j] ?? '')));
      }
      blocks.push({ type: 'table', head: head.map((c) => newsMdSpans(c)), rows });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const items: NewsListItem[] = [];
      const read = (indent: number, depth: number) => {
        const ordered = ORDERED.test(lines[i]!);
        while (i < lines.length && LIST_ITEM.test(lines[i]!)) {
          const d = indentOf(lines[i]!);
          if (d < indent || (d === indent && ORDERED.test(lines[i]!) !== ordered)) return;
          if (d > indent) {
            read(d, depth + 1);
            continue;
          }
          const text = lines[i]!.replace(LIST_ITEM, '').trim();
          if (text) items.push({ depth, ordered, spans: newsMdSpans(text) });
          i++;
        }
      };
      read(indentOf(line), 0);
      if (items.length) blocks.push({ type: 'list', items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !PARAGRAPH_END.test(lines[i]!))
      paragraph.push(lines[i++]!.trim());
    if (!paragraph.length) paragraph.push(lines[i++]!.trim());
    blocks.push({ type: 'p', spans: newsMdSpans(paragraph.join(' ')) });
  }
  return blocks;
}

/** Текст без разметки — для поиска и краткого описания (прототип mdText). */
export function newsMdText(source: string): string {
  return String(source ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Пустые разделы шаблона (заголовок без пунктов) при сохранении убираются: у пользователя они не
 * показываются (прототип mdTrim).
 */
export function newsMdTrim(source: string): string {
  return source
    .replace(/\r/g, '')
    .split(/\n(?=##\s)/)
    .filter(
      (section) =>
        !/^##\s/.test(section) ||
        section
          .split('\n')
          .slice(1)
          .some((l) => !/^\s*([-*]|\d+[.)])?\s*$/.test(l)),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Адреса загруженных в Админке картинок в тексте — чтобы сервер знал, какие файлы новости нужны. */
export function newsMdImageIds(source: string): string[] {
  return [...String(source ?? '').matchAll(/\/api\/news\/images\/([0-9a-f-]{36})/g)].map(
    (m) => m[1]!,
  );
}
