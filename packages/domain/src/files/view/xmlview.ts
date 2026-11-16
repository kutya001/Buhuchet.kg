/**
 * Файл XML в окне просмотра (доработки 16.11.2026, блок 5, пункт 2): дерево с отступами для
 * сворачивания веток и поиска. Внешние сущности и DOCTYPE не раскрываются (см. `scanXml`).
 */
import { decodeText } from './text';
import { scanXml } from './xml';

/** Элементов XML в окне — не больше; дальше — «Скачайте, чтобы увидеть всё». */
export const XML_MAX_NODES = 20_000;

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
  let cut = false;
  let doctype = false;
  let decl: string | null = null;
  scanXml(text, {
    open(name, attrs) {
      if (++nodes > XML_MAX_NODES) {
        cut = true;
        return false;
      }
      const el: XmlViewNode = { n: name, a: Object.entries(attrs), c: [] };
      stack[stack.length - 1]!.c.push(el);
      stack.push(el);
    },
    close() {
      if (stack.length > 1) stack.pop();
    },
    text(t) {
      const s = t.trim();
      if (s && stack.length > 1) stack[stack.length - 1]!.c.push(s);
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
