/**
 * Файл XML в окне просмотра (доработки 16.11.2026, блок 5, пункт 2): дерево с отступами для
 * сворачивания веток и поиска. Внешние сущности и DOCTYPE не раскрываются (см. `scanXml`).
 */
import { decodeText } from './text';
import { scanXml } from './xml';

/**
 * Элементов и атрибутов XML в окне вместе — не больше (атрибут окно рисует так же, как элемент);
 * дальше — «Скачайте, чтобы увидеть всё».
 */
export const XML_MAX_NODES = 20_000;
/** Знаков в именах, значениях и тексте XML в окне — не больше (как у текстового файла). */
export const XML_MAX_CHARS = 2_000_000;

export interface XmlViewNode {
  /** Имя элемента. */
  n: string;
  /** Атрибуты по порядку. */
  a: [string, string][];
  /** Дети: элементы и куски текста (без пустых). */
  c: (XmlViewNode | string)[];
}

export interface XmlView {
  kind: 'xml';
  /** `<?xml …?>` как в файле. */
  decl: string | null;
  /** В файле было объявление DOCTYPE — оно пропущено, внешнее не загружалось. */
  doctype: boolean;
  root: XmlViewNode | null;
  /** Показаны не все элементы. */
  cut: boolean;
}

export function xmlView(bytes: Uint8Array): XmlView {
  const { text } = decodeText(bytes);
  const top: XmlViewNode = { n: '#', a: [], c: [] };
  const stack: XmlViewNode[] = [top];
  let nodes = 0;
  let chars = 0;
  let cut = false;
  let doctype = false;
  let decl: string | null = null;
  scanXml(text, {
    open(name, attrs) {
      const a = Object.entries(attrs);
      nodes += 1 + a.length;
      for (const [k, v] of a) chars += k.length + v.length;
      chars += name.length;
      if (nodes > XML_MAX_NODES || chars > XML_MAX_CHARS) {
        cut = true;
        return false;
      }
      const el: XmlViewNode = { n: name, a, c: [] };
      stack[stack.length - 1]!.c.push(el);
      stack.push(el);
    },
    close() {
      if (stack.length > 1) stack.pop();
    },
    text(t) {
      const s = t.trim();
      if (!s || stack.length <= 1) return;
      chars += s.length;
      if (chars > XML_MAX_CHARS) {
        cut = true;
        return false;
      }
      stack[stack.length - 1]!.c.push(s);
    },
    doctype() {
      doctype = true;
    },
    pi(target, body) {
      if (target === 'xml' && decl === null) decl = `<?xml ${body}?>`;
    },
  });
  const root = top.c.find((k): k is XmlViewNode => typeof k !== 'string') ?? null;
  return { kind: 'xml', decl, doctype, root, cut };
}
