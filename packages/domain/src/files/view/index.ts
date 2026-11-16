/**
 * Окно просмотра файлов (доработки 16.11.2026, блок 5): какой показ у файла и разбор его байтов в
 * простую модель для окна. Разбор идёт в отдельном потоке браузера (Worker) без доступа к странице,
 * сети и cookie; из файла ничего не выполняется и ничего внешнего не загружается.
 */
import { parseDocx, type DocView } from './docx';
import { viewImageType } from './ooxml';
import { parsePptx, type SlidesView } from './pptx';
import { capBookText, csvSheet, SHEET_MAX_ROWS, type BookView } from './sheet';
import { decodeText, parseCsv, textView, type TextView } from './text';
import { isCfb, parseXls } from './xls';
import { parseXlsx } from './xlsx';
import { ViewError } from './xml';
import { xmlView, type XmlView } from './xmlview';
import { isZip, openZip } from './zip';

export type FileViewKind =
  'image' | 'pdf' | 'sheet' | 'csv' | 'docx' | 'pptx' | 'text' | 'xml' | 'download' | 'none';

const EXT_KIND: Record<string, FileViewKind> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  heic: 'image',
  heif: 'image',
  pdf: 'pdf',
  xlsx: 'sheet',
  xlsm: 'sheet',
  xls: 'sheet',
  csv: 'csv',
  docx: 'docx',
  docm: 'docx',
  pptx: 'pptx',
  pptm: 'pptx',
  txt: 'text',
  log: 'text',
  xml: 'xml',
  doc: 'download',
  ppt: 'download',
};

export const fileExt = (name: string) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};

/** Как показать файл по имени (до загрузки байтов). */
export const fileViewKind = (name: string): FileViewKind => EXT_KIND[fileExt(name)] ?? 'none';

/** Картинка, которую окно рисует само: тип по первым байтам (HEIC — браузер решает, сможет ли). */
export type ViewPictureType =
  'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/heic';

export function viewPictureType(b: Uint8Array): ViewPictureType | null {
  const t = viewImageType(b);
  if (t) return t;
  // HEIC/HEIF: «ftyp» и марка heic/heix/mif1/msf1.
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  return null;
}

/** PDF: «%PDF-» в первом килобайте. */
export function isPdf(b: Uint8Array): boolean {
  const head = String.fromCharCode(...b.subarray(0, Math.min(1024, b.length)));
  return head.includes('%PDF-');
}

export type FileViewModel = BookView | DocView | SlidesView | TextView | XmlView | { kind: 'none' };

/**
 * Разбор файла для окна. Тип проверяется по содержимому, а не только по расширению: XLSX, который
 * на деле старый XLS, откроется как XLS; не то, что обещает расширение, — «Предпросмотр недоступен».
 * Ошибка разбора или превышенный предел — `ViewError`.
 */
export async function parseFileView(name: string, bytes: Uint8Array): Promise<FileViewModel> {
  const kind = fileViewKind(name);
  switch (kind) {
    case 'sheet':
      if (isZip(bytes)) return capBookText(await parseXlsx(openZip(bytes)));
      if (isCfb(bytes)) return capBookText(parseXls(bytes));
      return { kind: 'none' };
    case 'csv': {
      const { text } = decodeText(bytes);
      const { rows, total } = parseCsv(text, SHEET_MAX_ROWS);
      const base = name.replace(/\.[^.]*$/, '') || name;
      return capBookText({ kind: 'sheet', sheets: [csvSheet(base, rows, total)] });
    }
    case 'docx':
      return isZip(bytes) ? parseDocx(openZip(bytes)) : { kind: 'none' };
    case 'pptx':
      return isZip(bytes) ? parsePptx(openZip(bytes)) : { kind: 'none' };
    case 'text':
      return textView(bytes);
    case 'xml':
      return xmlView(bytes);
    default:
      return { kind: 'none' };
  }
}

export { ViewError };
export type { ViewErrorCode } from './xml';
export type { BookView, SheetCell, SheetView } from './sheet';
export { SHEET_MAX_ROWS, colLetters } from './sheet';
export type { DocBlock, DocCell, DocPara, DocRun, DocTable, DocView } from './docx';
export type { SlideItem, SlideModel, SlidePara, SlideRun, SlidesView } from './pptx';
export type { TextView, TextEncodingName } from './text';
export { TEXT_MAX_LINES } from './text';
export type { XmlView, XmlViewNode } from './xmlview';
export { XML_MAX_NODES } from './xmlview';
export type { ViewImage, ViewImageType } from './ooxml';
