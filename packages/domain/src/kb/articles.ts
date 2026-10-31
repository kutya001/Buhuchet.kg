import { NEWS_IMAGE_PATH } from '../news/markdown';
import type { Feature, PermissionId } from '../roles/permissions';
import type { KbArticleDef, KbScreenUi } from './catalog';
import type { KbAccess, KbProgramStep } from './program';
import { KB_READY_MODULES } from './ready';

/*
 * Статьи «Базы знаний» (ТЗ «Вкладка «Статьи»», прототип modules/kb.js: kbArts, kbArtOf, stripTags,
 * kbScreenHtml). Текст статьи в refDB — HTML из небольшого набора тегов; на экран он уходит не HTML, а
 * блоками (`KbBlock`): неизвестные теги отбрасываются, остаётся только текст — так содержимое из
 * Админки не сможет вставить на страницу разметку или сценарий.
 */

/** Кусок текста; `bold` — жирный (`<b>`). */
export interface KbInline {
  text: string;
  bold?: true;
}

/**
 * Пункт списка. Вложенные списки — плоско, по порядку статьи, с глубиной: так у ответа API нет
 * рекурсивной схемы; экран собирает вложенность обратно (пункты глубже предыдущего — его подсписок).
 */
export interface KbListItem {
  /** 0 — верхний список. */
  depth: number;
  /** Нумерованный список (`ol`). */
  ordered: boolean;
  inline: KbInline[];
}

export interface KbList {
  type: 'list';
  items: KbListItem[];
}

export type KbBlock =
  | { type: 'h4' | 'h5' | 'p' | 'quote'; inline: KbInline[] }
  | KbList
  /** Описание экрана модуля (`<kb-screen data-mod="…">`) — разворачивает `kbScreenBlocks`. */
  | { type: 'screen'; module: string }
  /**
   * Картинка, загруженная в Админке (задача 2.39, прототип kbArtEditDlg «Добавить картинку»): только
   * из хранилища — `/api/news/images/<id>`, как у новостей; другие адреса пропускаются.
   */
  | { type: 'image'; src: string; alt: string };

/** Адрес картинки статьи: загруженная в Админке (`/api/news/images/<id>`). */
const IMAGE_SRC = new RegExp(`^${NEWS_IMAGE_PATH}[0-9a-f-]{36}$`);

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

type Token =
  | { open: string; mod?: string; src?: string; alt?: string }
  | { close: string }
  | { text: string };

/** Значение атрибута тега в кавычках (`name="…"`), с разбором сущностей. */
const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return m ? decode(m[1]!) : undefined;
};

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const re = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)|(<)/g;
  for (const m of html.matchAll(re)) {
    if (m[4] !== undefined || m[5] !== undefined) {
      out.push({ text: decode(m[4] ?? m[5]!) });
      continue;
    }
    const tag = m[2]!.toLowerCase();
    if (m[1]) out.push({ close: tag });
    else if (tag === 'img') {
      out.push({ open: tag, src: attr(m[3] ?? '', 'src') ?? '', alt: attr(m[3] ?? '', 'alt') ?? '' });
    } else {
      const mod = /data-mod\s*=\s*"([^"]*)"/.exec(m[3] ?? '')?.[1];
      out.push(mod === undefined ? { open: tag } : { open: tag, mod });
    }
  }
  return out;
}

const TEXT_BLOCKS: Readonly<Record<string, 'h4' | 'h5' | 'p' | 'quote'>> = {
  h4: 'h4',
  h5: 'h5',
  p: 'p',
  blockquote: 'quote',
};

/** Склеить соседние куски одного вида и убрать пустые. */
function tidy(inline: KbInline[]): KbInline[] {
  const out: KbInline[] = [];
  for (const part of inline) {
    if (!part.text) continue;
    const last = out[out.length - 1];
    if (last && !!last.bold === !!part.bold) last.text += part.text;
    else out.push({ ...part });
  }
  if (out.length) {
    out[0]!.text = out[0]!.text.trimStart();
    out[out.length - 1]!.text = out[out.length - 1]!.text.trimEnd();
  }
  return out.filter((p) => p.text);
}

/**
 * Статья по блокам: заголовки `h4`/`h5`, абзацы, цитаты, списки `ul`/`ol` (со вложенными списками),
 * жирный `b`/`strong`, описание экрана `kb-screen` и картинки `img` из хранилища. Прочие теги не
 * попадают в ответ — только их текст.
 */
export function kbArticleBlocks(html: string): KbBlock[] {
  const blocks: KbBlock[] = [];
  /** Открытые списки: нумерованный ли каждый. */
  const lists: boolean[] = [];
  let list: KbList | null = null;
  let inline: KbInline[] | null = null;
  let textBlock: 'h4' | 'h5' | 'p' | 'quote' | null = null;
  let bold = 0;

  const flushText = () => {
    if (inline && textBlock) {
      const parts = tidy(inline);
      if (parts.length) blocks.push({ type: textBlock, inline: parts });
    }
    inline = null;
    textBlock = null;
  };
  const flushItem = () => {
    if (list && lists.length && inline && !textBlock) {
      const parts = tidy(inline);
      if (parts.length) {
        list.items.push({
          depth: lists.length - 1,
          ordered: lists[lists.length - 1]!,
          inline: parts,
        });
      }
    }
    if (!textBlock) inline = null;
  };

  for (const token of tokenize(html)) {
    if ('text' in token) {
      if (!inline) {
        if (!token.text.trim()) continue;
        // Текст вне блока — отдельный абзац.
        if (!lists.length) textBlock = 'p';
        inline = [];
      }
      inline.push(bold > 0 ? { text: token.text, bold: true } : { text: token.text });
      continue;
    }
    if ('open' in token) {
      const tag = token.open;
      if (tag === 'b' || tag === 'strong') bold++;
      else if (tag === 'ul' || tag === 'ol') {
        flushText();
        flushItem();
        if (!lists.length) {
          list = { type: 'list', items: [] };
          blocks.push(list);
        }
        lists.push(tag === 'ol');
      } else if (tag === 'li') {
        flushItem();
        inline = [];
      } else if (Object.hasOwn(TEXT_BLOCKS, tag) && !lists.length) {
        flushText();
        textBlock = TEXT_BLOCKS[tag]!;
        inline = [];
      } else if (tag === 'kb-screen' && !lists.length) {
        flushText();
        if (token.mod) blocks.push({ type: 'screen', module: token.mod });
      } else if (tag === 'img' && !lists.length) {
        // Картинка — отдельным блоком; текст абзаца после неё — новым абзацем.
        const block: 'h4' | 'h5' | 'p' | 'quote' | null = textBlock;
        flushText();
        if (token.src && IMAGE_SRC.test(token.src)) {
          blocks.push({ type: 'image', src: token.src, alt: token.alt ?? '' });
        }
        if (block) {
          textBlock = block;
          inline = [];
        }
      } else if (tag === 'br' && inline) {
        inline.push({ text: ' ' });
      }
      continue;
    }
    const tag = token.close;
    if (tag === 'b' || tag === 'strong') bold = Math.max(0, bold - 1);
    else if (tag === 'li') flushItem();
    else if ((tag === 'ul' || tag === 'ol') && lists.length) {
      flushItem();
      lists.pop();
    } else if (Object.hasOwn(TEXT_BLOCKS, tag) && !lists.length) flushText();
  }
  flushItem();
  flushText();
  return blocks;
}

/** Текст статьи без тегов, пробелы схлопнуты (прототип stripTags): по нему ищет поиск. */
export function kbArticleText(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Нижний регистр и «ё» = «е»: поиск не зависит от написания. */
const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Подходит ли статья под поиск: название или текст содержат строку (прототип renderKB, «arts»). */
export function kbArticleMatches(article: { title: string; text: string }, q: string): boolean {
  const needle = fold(q.trim());
  return !needle || fold(`${article.title} ${article.text}`).includes(needle);
}

/**
 * Отрывок под названием статьи (прототип renderKB, snip): без поиска — первые 150 знаков; с поиском —
 * 60 знаков до найденного, само найденное (`mark`) и 90 после.
 */
export function kbArticleSnippet(
  text: string,
  q: string,
): { before: string; mark: string; after: string } {
  const needle = fold(q.trim());
  if (!needle) {
    return { before: text.slice(0, 150) + (text.length > 150 ? '…' : ''), mark: '', after: '' };
  }
  const k = fold(text).indexOf(needle);
  if (k < 0) return { before: text.slice(0, 150), mark: '', after: '' };
  const start = Math.max(0, k - 60);
  return {
    before: (start ? '…' : '') + text.slice(start, k),
    mark: text.slice(k, k + needle.length),
    after: `${text.slice(k + needle.length, k + needle.length + 90)}…`,
  };
}

/**
 * Видна ли статья (прототип kbArts): включена, для режима пользователя (организации или Админки),
 * модуль статьи — в меню пользователя и уже сделан, есть право и функция статьи. ТЗ: «Статьи о
 * модулях, недоступных пользователю по правам, не показываются».
 */
export function kbArticleVisible(article: KbArticleDef, access: KbAccess): boolean {
  if (article.active === false) return false;
  const aud = article.aud ?? 'all';
  if (aud !== 'all' && (aud === 'adm') !== access.admin) return false;
  if (article.mod && (!access.modules.has(article.mod) || !KB_READY_MODULES.has(article.mod))) {
    return false;
  }
  if (article.perm && !access.can(article.perm as PermissionId)) return false;
  return !article.feat || access.feature(article.feat as Feature);
}

/** Статья шага (прототип kbArtOf): своя статья шага, иначе статья его модуля; только видимые. */
export function kbStepArticle(
  step: KbProgramStep,
  articles: readonly KbArticleDef[],
): KbArticleDef | null {
  return (
    (step.def.art ? articles.find((a) => a.id === step.def.art) : undefined) ??
    (step.module ? articles.find((a) => a.mod === step.module) : undefined) ??
    null
  );
}

/** Строка описания экрана: что за элемент и за что отвечает. */
export interface KbScreenItem {
  /** `el` — элемент со своим названием, `plate` — плашка «…», `button` — кнопка «…». */
  kind: 'el' | 'plate' | 'button';
  name: string;
  text: string;
}

export interface KbScreenBlocks {
  /** Вкладка модуля → что на ней; названия и порядок вкладок даёт экран (по правам пользователя). */
  tabs: Record<string, string>;
  items: KbScreenItem[];
  forms: {
    title: string;
    text: string;
    fields: { name: string; required: boolean; text: string }[];
  }[];
}

/**
 * Описание экрана модуля для статьи (прототип kbScreenHtml): тексты вкладок, кнопки и элементы экрана,
 * формы и их поля — из справочника `kbUi`, того же, что у «Показать как».
 */
export function kbScreenBlocks(ui: KbScreenUi, module: string): KbScreenBlocks {
  const tabs: Record<string, string> = {};
  for (const [key, text] of Object.entries(ui.tabs ?? {})) {
    const [mod, tab] = key.split('.');
    if (mod === module && tab) tabs[tab] = text;
  }
  const items = (ui.screens?.[module] ?? []).map((key): KbScreenItem => {
    const el = ui.els?.find((e) => e.id === key);
    if (el) return { kind: 'el', name: el.t, text: el.x ?? '' };
    const plate = ui.plates?.[key];
    if (plate !== undefined) return { kind: 'plate', name: key, text: plate };
    return { kind: 'button', name: key, text: ui.buttons?.[key] ?? ui.addItems?.[key] ?? '' };
  });
  const forms = (ui.artForms ?? [])
    .filter((f) => f.mod === module)
    .map((f) => ({
      title: f.t,
      text: f.x ?? '',
      fields: f.fields.map((key) => {
        const d = ui.fields?.[key] ?? {};
        return { name: d.n ?? key, required: d.req === true || d.req === 1, text: d.x ?? '' };
      }),
    }));
  return { tabs, items, forms };
}
