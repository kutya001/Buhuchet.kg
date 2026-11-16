/**
 * Чтение ZIP для XLSX, DOCX и PPTX в окне просмотра (доработки 16.11.2026, блок 5, пункт 3):
 * предел распаковки. Проверяется и заявленный в архиве размер, и фактический при распаковке —
 * архив, который врёт о размере, останавливается на пределе, а не забивает память («zip-бомба»).
 * Распаковка — DecompressionStream браузера (и Node.js в тестах), без сторонних библиотек.
 */
import { ViewError } from './xml';

export interface ZipLimits {
  /** Записей в архиве. */
  maxEntries: number;
  /** Распакованный размер одной записи, байт. */
  maxEntryBytes: number;
  /** Распаковано всего за один просмотр, байт. */
  maxTotalBytes: number;
  /** Во сколько раз запись больше сжатой (для записей больше 1 МиБ). */
  maxRatio: number;
}

const MiB = 1024 * 1024;

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxEntryBytes: 64 * MiB,
  maxTotalBytes: 160 * MiB,
  maxRatio: 500,
};

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  csize: number;
  usize: number;
  offset: number;
}

export interface Zip {
  /** Имена записей как в архиве. */
  readonly names: readonly string[];
  has(name: string): boolean;
  /** Распакованные байты записи (`null` — записи нет). */
  read(name: string): Promise<Uint8Array | null>;
  /** Текст записи XML (UTF-8 или UTF-16 по BOM); `null` — записи нет. */
  text(name: string): Promise<string | null>;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** Это ZIP (локальный заголовок `PK\x03\x04`)? */
export const isZip = (b: Uint8Array) =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Ключ записи: без ведущей «/» и без учёта регистра (имена частей OPC регистр не различают). */
const keyOf = (name: string) => name.replace(/^\/+/, '').toLowerCase();

/** Текст части OOXML: BOM UTF-16 или UTF-8. */
export function decodeXmlBytes(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

/** Распаковка deflate с остановкой на пределе: больше `max` байт — `zip_bomb`. */
export async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer
    .write(data)
    .then(() => writer.close())
    .catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw new ViewError('zip_bomb');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ViewError) throw e;
    throw new ViewError('zip_bad');
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** Каталог архива; сами записи распаковываются по запросу и под пределами `limits`. */
export function openZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): Zip {
  // Конец каталога: подпись 0x06054b50 в последних 64 КиБ + 22 байта.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ViewError('zip_bad');
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  // ZIP64 (файлы больше 4 ГиБ или 65 535 записей) окну просмотра не нужен.
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ViewError('zip_bad');
  if (count > limits.maxEntries) throw new ViewError('zip_entries');
  if (cdOffset + cdSize > bytes.length) throw new ViewError('zip_bad');
  const entries = new Map<string, ZipEntry>();
  const names: string[] = [];
  const utf8 = new TextDecoder('utf-8');
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ViewError('zip_bad');
    const nameLen = u16(bytes, p + 28);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const e: ZipEntry = {
      name,
      flags: u16(bytes, p + 8),
      method: u16(bytes, p + 10),
      csize: u32(bytes, p + 20),
      usize: u32(bytes, p + 24),
      offset: u32(bytes, p + 42),
    };
    names.push(name);
    entries.set(keyOf(name), e);
    p += 46 + nameLen + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
  let spent = 0;

  async function read(name: string): Promise<Uint8Array | null> {
    const e = entries.get(keyOf(name));
    if (!e) return null;
    if (e.flags & 1) throw new ViewError('file_encrypted');
    if (e.usize > limits.maxEntryBytes || spent + e.usize > limits.maxTotalBytes)
      throw new ViewError('zip_too_big');
    if (e.usize > MiB && e.usize / Math.max(1, e.csize) > limits.maxRatio)
      throw new ViewError('zip_bomb');
    const lh = e.offset;
    if (lh + 30 > bytes.length || u32(bytes, lh) !== 0x04034b50) throw new ViewError('zip_bad');
    const start = lh + 30 + u16(bytes, lh + 26) + u16(bytes, lh + 28);
    const end = start + e.csize;
    if (end > bytes.length) throw new ViewError('zip_bad');
    const raw = bytes.subarray(start, end);
    let out: Uint8Array;
    if (e.method === 0) out = raw;
    else if (e.method === 8) out = await inflateRaw(raw, Math.min(e.usize, limits.maxEntryBytes));
    else throw new ViewError('zip_method');
    // Фактический размер проверен пределом распаковки; заявленный меньше фактического — тоже бомба.
    if (out.byteLength > limits.maxEntryBytes) throw new ViewError('zip_bomb');
    if (out.byteLength / Math.max(1, e.csize) > limits.maxRatio && out.byteLength > MiB)
      throw new ViewError('zip_bomb');
    spent += out.byteLength;
    if (spent > limits.maxTotalBytes) throw new ViewError('zip_too_big');
    return out;
  }

  return {
    names,
    has: (name) => entries.has(keyOf(name)),
    read,
    async text(name) {
      const b = await read(name);
      return b ? decodeXmlBytes(b) : null;
    },
  };
}

/** Путь цели связи (rels) относительно части: `xl/workbook.xml` + `worksheets/sheet1.xml`. */
export function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** Путь файла связей части: `xl/workbook.xml` → `xl/_rels/workbook.xml.rels`. */
export function relsPathOf(part: string): string {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}
