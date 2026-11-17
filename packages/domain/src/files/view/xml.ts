/**
 * Безопасный разбор XML для окна просмотра файлов (доработки 16.11.2026, блок 5, пункт 3).
 * Свой разборщик без DOMParser: объявление DOCTYPE со всем внутренним набором пропускается,
 * из сущностей понимаются только пять стандартных и числовые — внешняя сущность (XXE) и «миллиард
 * смехов» невозможны: им просто нечем раскрыться, `&name;` остаётся текстом как есть.
 */

/** Ошибка разбора: битый файл или превышен предел — окно покажет «Не удалось открыть файл». */
export class ViewError extends Error {
  constructor(readonly code: ViewErrorCode) {
    super(code);
    this.name = 'ViewError';
  }
}

export type ViewErrorCode =
  | 'xml_bad'
  | 'xml_too_deep'
  | 'xml_too_big'
  | 'zip_bad'
  | 'zip_entries'
  | 'zip_too_big'
  | 'zip_bomb'
  | 'file_encrypted'
  | 'zip_method'
  | 'xls_bad'
  | 'file_bad';

export type XmlAttrs = Record<string, string>;

/** Обработчик событий разбора; `false` из обработчика останавливает разбор (лист дочитан до предела). */
export interface XmlHandler {
  open?(name: string, attrs: XmlAttrs, selfClosing: boolean): void | false;
  close?(name: string): void | false;
  text?(text: string): void | false;
  /** Было объявление `<!DOCTYPE …>` (оно пропущено вместе с внутренними сущностями). */
  doctype?(): void;
  pi?(target: string, body: string): void;
  comment?(body: string): void;
}

export interface XmlScanLimits {
  /** Глубина вложенности элементов. */
  maxDepth: number;
}

export const XML_MAX_DEPTH = 256;

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function codePoint(ref: string): string | null {
  const cp =
    ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
    return null;
  return String.fromCodePoint(cp);
}

/** Раскрывает только `&lt; &gt; &amp; &quot; &apos;` и `&#N;`/`&#xN;`; любая другая сущность остаётся текстом. */
export function decodeXmlEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(
    /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z_][\w.-]{0,63});/g,
    (m, ref: string) => {
      if (ref[0] === '#') return codePoint(ref) ?? m;
      return PREDEFINED[ref] ?? m;
    },
  );
}

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** Конец объявления `<!…>` с учётом внутреннего набора `[…]` и строк в кавычках. */
function declEnd(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const q = src.indexOf(ch, i + 1);
      if (q < 0) return -1;
      i = q;
    } else if (ch === '<' && src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e < 0) return -1;
      i = e + 2;
    } else if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === '>' && depth <= 0) return i;
  }
  return -1;
}

/**
 * Потоковый разбор: события по порядку документа. Не проверяет, что закрывающий тег совпадает с
 * открытым (файлы Office бывают «грязными»), но глубина ограничена.
 */
export function scanXml(
  src: string,
  h: XmlHandler,
  limits: XmlScanLimits = { maxDepth: XML_MAX_DEPTH },
): void {
  const n = src.length;
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  let depth = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (h.text && h.text(decodeXmlEntities(src.slice(i))) === false) return;
      return;
    }
    if (lt > i && h.text && h.text(decodeXmlEntities(src.slice(i, lt))) === false) return;
    const c1 = src.charCodeAt(lt + 1);
    if (c1 === 0x21 /* ! */) {
      if (src.startsWith('<!--', lt)) {
        const e = src.indexOf('-->', lt + 4);
        if (e < 0) throw new ViewError('xml_bad');
        h.comment?.(src.slice(lt + 4, e));
        i = e + 3;
      } else if (src.startsWith('<![CDATA[', lt)) {
        const e = src.indexOf(']]>', lt + 9);
        if (e < 0) throw new ViewError('xml_bad');
        if (h.text && h.text(src.slice(lt + 9, e)) === false) return;
        i = e + 3;
      } else {
        // DOCTYPE и прочие объявления: пропускаются целиком, сущности из них не раскрываются.
        const e = declEnd(src, lt + 2);
        if (e < 0) throw new ViewError('xml_bad');
        if (/^<!DOCTYPE/i.test(src.slice(lt, lt + 9))) h.doctype?.();
        i = e + 1;
      }
      continue;
    }
    if (c1 === 0x3f /* ? */) {
      const e = src.indexOf('?>', lt + 2);
      if (e < 0) throw new ViewError('xml_bad');
      const body = src.slice(lt + 2, e);
      const sp = body.search(/\s/);
      h.pi?.(sp < 0 ? body : body.slice(0, sp), sp < 0 ? '' : body.slice(sp + 1).trim());
      i = e + 2;
      continue;
    }
    if (c1 === 0x2f /* / */) {
      const e = src.indexOf('>', lt + 2);
      if (e < 0) throw new ViewError('xml_bad');
      // Непарный закрывающий тег глубину ниже нуля не уводит: иначе предел глубины обходится.
      depth = Math.max(0, depth - 1);
      if (h.close && h.close(src.slice(lt + 2, e).trim()) === false) return;
      i = e + 1;
      continue;
    }
    // Открывающий тег: имя и атрибуты, значение в кавычках может содержать «>».
    let j = lt + 1;
    while (j < n && !isSpace(src.charCodeAt(j)) && src[j] !== '>' && src[j] !== '/') j++;
    const name = src.slice(lt + 1, j);
    if (!name) throw new ViewError('xml_bad');
    const attrs: XmlAttrs = {};
    let self = false;
    for (;;) {
      while (j < n && isSpace(src.charCodeAt(j))) j++;
      if (j >= n) throw new ViewError('xml_bad');
      if (src[j] === '>') {
        j++;
        break;
      }
      if (src[j] === '/' && src[j + 1] === '>') {
        self = true;
        j += 2;
        break;
      }
      const a0 = j;
      while (
        j < n &&
        src[j] !== '=' &&
        !isSpace(src.charCodeAt(j)) &&
        src[j] !== '>' &&
        src[j] !== '/'
      )
        j++;
      const an = src.slice(a0, j);
      while (j < n && isSpace(src.charCodeAt(j))) j++;
      if (src[j] !== '=') {
        // Атрибут без значения (не XML, но не падаем): пропускаем.
        if (!an) j++;
        continue;
      }
      j++;
      while (j < n && isSpace(src.charCodeAt(j))) j++;
      const q = src[j];
      if (q !== '"' && q !== "'") throw new ViewError('xml_bad');
      const qe = src.indexOf(q, j + 1);
      if (qe < 0) throw new ViewError('xml_bad');
      attrs[an] = decodeXmlEntities(src.slice(j + 1, qe));
      j = qe + 1;
    }
    if (!self) {
      depth++;
      if (depth > limits.maxDepth) throw new ViewError('xml_too_deep');
    }
    if (h.open && h.open(name, attrs, self) === false) return;
    if (self && h.close && h.close(name) === false) return;
    i = j;
  }
}

/** Элемент дерева: имя с префиксом, атрибуты и дети (элементы и строки). */
export interface XEl {
  name: string;
  attrs: XmlAttrs;
  kids: (XEl | string)[];
}

export interface XmlTree {
  root: XEl | null;
  doctype: boolean;
  /** Объявление `<?xml …?>` как есть, для окна XML. */
  decl: string | null;
}

/** Дерево целиком; `maxNodes` — предел числа элементов (больше — `xml_too_big`). */
export function parseXmlTree(src: string, maxNodes = 2_000_000): XmlTree {
  const top: XEl = { name: '#doc', attrs: {}, kids: [] };
  const stack: XEl[] = [top];
  let nodes = 0;
  let doctype = false;
  let decl: string | null = null;
  scanXml(src, {
    open(name, attrs) {
      if (++nodes > maxNodes) throw new ViewError('xml_too_big');
      const el: XEl = { name, attrs, kids: [] };
      stack[stack.length - 1]!.kids.push(el);
      stack.push(el);
    },
    close() {
      if (stack.length > 1) stack.pop();
    },
    text(t) {
      if (stack.length > 1) stack[stack.length - 1]!.kids.push(t);
    },
    doctype() {
      doctype = true;
    },
    pi(target, body) {
      if (target === 'xml' && decl === null) decl = body;
    },
  });
  const root = top.kids.find((k): k is XEl => typeof k !== 'string') ?? null;
  return { root, doctype, decl };
}

/** Имя без префикса пространства имён: `w:p` → `p`. */
export const localName = (name: string) => {
  const c = name.indexOf(':');
  return c < 0 ? name : name.slice(c + 1);
};

/** Значение атрибута по имени без префикса (`val` найдёт `w:val`). */
export function attrOf(el: XEl | undefined, local: string): string | undefined {
  if (!el) return undefined;
  if (local in el.attrs) return el.attrs[local];
  for (const k in el.attrs) if (localName(k) === local) return el.attrs[k];
  return undefined;
}

/** Атрибут с префиксом пространства имён (`r:id`), а не свой атрибут элемента (`id`). */
export function prefixedAttr(el: XEl | undefined, local: string): string | undefined {
  if (!el) return undefined;
  for (const k in el.attrs) if (k.includes(':') && localName(k) === local) return el.attrs[k];
  return undefined;
}

export const childEls = (el: XEl | undefined, local?: string): XEl[] =>
  el
    ? el.kids.filter(
        (k): k is XEl =>
          typeof k !== 'string' && (local === undefined || localName(k.name) === local),
      )
    : [];

export const childEl = (el: XEl | undefined, local: string): XEl | undefined =>
  el?.kids.find((k): k is XEl => typeof k !== 'string' && localName(k.name) === local);

/** Первый потомок на любой глубине с таким именем. */
export function findEl(el: XEl | undefined, local: string): XEl | undefined {
  if (!el) return undefined;
  for (const k of el.kids) {
    if (typeof k === 'string') continue;
    if (localName(k.name) === local) return k;
    const f = findEl(k, local);
    if (f) return f;
  }
  return undefined;
}

/** Все потомки с таким именем (без захода внутрь найденных). */
export function findAll(el: XEl | undefined, local: string, out: XEl[] = []): XEl[] {
  if (!el) return out;
  for (const k of el.kids) {
    if (typeof k === 'string') continue;
    if (localName(k.name) === local) out.push(k);
    else findAll(k, local, out);
  }
  return out;
}

/** Весь текст внутри элемента. */
export function textOf(el: XEl | undefined): string {
  if (!el) return '';
  let s = '';
  for (const k of el.kids) s += typeof k === 'string' ? k : textOf(k);
  return s;
}
