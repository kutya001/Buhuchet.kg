/**
 * Тип файла по содержимому (доработки 14.11.2026, блок 2: «тип файла проверяется по содержимому, а не по
 * расширению»). Публичная загрузка — со страницы контрагента и из Telegram — проверяет первые байты файла:
 * программа, сценарий или веб-страница не проходит под любым расширением, а у известного типа («.pdf»,
 * «.jpg», «.xlsx»…) содержимое должно ему соответствовать. Файл неизвестного типа («.dbf», «.1cd»)
 * принимается, если в нём нет признаков программы или веб-страницы.
 */
import { fileExtension, FILE_BLOCKED_EXTENSIONS } from './files';

/** Сколько первых байт файла читает проверка (читается из хранилища одним запросом). */
export const FILE_SNIFF_BYTES = 4096;

/** Что показало содержимое: запрещённый тип, не тот тип, что в имени, или всё в порядке (null). */
export type FileContentProblem = 'file_type_forbidden' | 'file_content_mismatch';

type Family =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'tiff'
  | 'heic'
  | 'zip'
  | 'ole'
  | 'rar'
  | '7z'
  | 'rtf'
  | 'text';

/** Известные типы: расширение → чем файл обязан начинаться. Офисные «x»-форматы и OpenDocument — ZIP. */
const EXT_FAMILY: Readonly<Record<string, Family>> = {
  pdf: 'pdf',
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
  tif: 'tiff',
  tiff: 'tiff',
  heic: 'heic',
  heif: 'heic',
  docx: 'zip',
  xlsx: 'zip',
  pptx: 'zip',
  odt: 'zip',
  ods: 'zip',
  odp: 'zip',
  zip: 'zip',
  doc: 'ole',
  xls: 'ole',
  ppt: 'ole',
  rar: 'rar',
  '7z': '7z',
  rtf: 'rtf',
  txt: 'text',
  csv: 'text',
  xml: 'text',
};

const startsWith = (head: Uint8Array, sig: readonly number[], at = 0): boolean =>
  head.length >= at + sig.length && sig.every((b, i) => head[at + i] === b);

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Начало программы: Windows (MZ), Linux (ELF), macOS (Mach-O и «толстый» файл, он же класс Java), ярлык Windows, справка CHM, сценарий с «#!». */
const PROGRAM_SIGNATURES: readonly (readonly number[])[] = [
  ascii('MZ'),
  [0x7f, ...ascii('ELF')],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
  [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00],
  ascii('ITSF'),
  ascii('#!'),
];

/** Признаки веб-страницы и картинки SVG: браузер выполнит такой файл как страницу. */
const WEB_MARKERS = [
  '<!doctype html',
  '<html',
  '<head',
  '<body',
  '<script',
  '<iframe',
  '<svg',
  '<object',
  '<embed',
  '<?xml-stylesheet',
  'http://www.w3.org/1999/xhtml',
  'javascript:',
];

/** Первые байты как текст для поиска признаков: строчными, без нулевых байтов (UTF-16 тоже читается). */
function headText(head: Uint8Array): string {
  let s = '';
  for (const b of head.subarray(0, 1024)) if (b !== 0) s += String.fromCharCode(b);
  return s.toLowerCase();
}

function looksLikeWeb(head: Uint8Array): boolean {
  const text = headText(head);
  return WEB_MARKERS.some((m) => text.includes(m));
}

/** Текстовый файл: без нулевых байтов (кроме UTF-16 с отметкой порядка байтов, так сохраняет Excel). */
function isText(head: Uint8Array): boolean {
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff])) return true;
  return !head.includes(0);
}

function matches(family: Family, head: Uint8Array): boolean {
  switch (family) {
    case 'pdf':
      return headText(head).includes('%pdf-');
    case 'png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'gif':
      return startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'));
    case 'webp':
      return startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8);
    case 'bmp':
      return startsWith(head, ascii('BM'));
    case 'tiff':
      return (
        startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
      );
    case 'heic':
      return startsWith(head, ascii('ftyp'), 4);
    case 'zip':
      return (
        startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])
      );
    case 'ole':
      return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'rar':
      return startsWith(head, ascii('Rar!\x1a\x07'));
    case '7z':
      return startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    case 'rtf':
      return startsWith(head, ascii('{\\rtf'));
    case 'text':
      return isText(head);
  }
}

/**
 * Что не так с содержимым файла `name`, если он начинается байтами `head` (первые `FILE_SNIFF_BYTES`):
 * запрещённое расширение или программа и веб-страница внутри — `file_type_forbidden`; содержимое не того
 * типа, что в имени («Акт.pdf», а внутри картинка или архив), — `file_content_mismatch`. Двоичные форматы
 * (PDF, картинки, архивы, офисные) веб-страницей не считаются: их признаки ищутся только в тексте и в
 * файлах неизвестного типа.
 */
export function fileContentProblem(name: string, head: Uint8Array): FileContentProblem | null {
  const ext = fileExtension(name) ?? '';
  if (FILE_BLOCKED_EXTENSIONS.has(ext)) return 'file_type_forbidden';
  if (PROGRAM_SIGNATURES.some((sig) => startsWith(head, sig))) return 'file_type_forbidden';
  const family = EXT_FAMILY[ext];
  if (family && family !== 'text') return matches(family, head) ? null : 'file_content_mismatch';
  if (looksLikeWeb(head)) return 'file_type_forbidden';
  if (family === 'text' && !matches('text', head)) return 'file_content_mismatch';
  return null;
}
