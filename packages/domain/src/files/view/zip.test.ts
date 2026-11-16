import { describe, expect, it, vi } from 'vitest';
import { deflateRaw, zipBytes } from './fixtures';
import {
  decodeXmlBytes,
  inflateRaw,
  isZip,
  openZip,
  relsPathOf,
  resolvePart,
  ZIP_LIMITS,
} from './zip';
import { ViewError } from './xml';

const enc = new TextEncoder();
const MiB = 1024 * 1024;

describe('ZIP окна просмотра: предел распаковки', () => {
  it('читает сжатые и несжатые записи, имена без учёта регистра и ведущей «/»', async () => {
    const z = openZip(
      await zipBytes([
        { name: 'xl/Workbook.xml', data: '<w/>' },
        { name: 'a.bin', data: new Uint8Array([1, 2, 3]), store: true },
      ]),
    );
    expect(z.names).toEqual(['xl/Workbook.xml', 'a.bin']);
    expect(z.has('/XL/workbook.xml')).toBe(true);
    expect(await z.text('xl/workbook.xml')).toBe('<w/>');
    expect(await z.read('a.bin')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await z.read('нет')).toBeNull();
    expect(await z.text('нет')).toBeNull();
  });

  it('zip-бомба: часть больше предела с честным размером — отказ без распаковки', async () => {
    // Предел части уменьшен (в работе — 64 МиБ), чтобы тест не сжимал десятки мегабайт.
    const zeros = new Uint8Array(2 * MiB);
    const z = openZip(await zipBytes([{ name: 'xl/worksheets/sheet1.xml', data: zeros }]), {
      ...ZIP_LIMITS,
      maxEntryBytes: MiB,
    });
    await expect(z.read('xl/worksheets/sheet1.xml')).rejects.toThrowError(
      new ViewError('zip_too_big'),
    );
  });

  it('zip-бомба, которая врёт о размере: распаковка останавливается на заявленном размере', async () => {
    const zeros = new Uint8Array(8 * MiB);
    const z = openZip(await zipBytes([{ name: 'big.xml', data: zeros, declaredSize: 1000 }]));
    await expect(z.read('big.xml')).rejects.toThrowError(new ViewError('zip_bomb'));
  });

  it('распаковка подаёт сжатые данные шагами и на пределе прекращает подачу (браузер раздувает записанное целиком)', async () => {
    // Распаковщик как в браузере: каждый записанный кусок сразу раздувается целиком (здесь — в 64 КиБ)
    // и ложится в очередь, не дожидаясь чтения. Считаем, сколько сжатых байт ему подано.
    let fed = 0;
    class BrowserLike extends TransformStream<Uint8Array, Uint8Array> {
      constructor() {
        super({
          transform(chunk, ctl) {
            fed += chunk.byteLength;
            for (let i = 0; i < 4; i++) ctl.enqueue(new Uint8Array(16 * 1024));
          },
        });
      }
    }
    vi.stubGlobal('DecompressionStream', BrowserLike);
    const packed = new Uint8Array(64 * 1024);
    try {
      await expect(inflateRaw(packed, 100 * 1024, 64)).rejects.toThrowError(
        new ViewError('zip_bomb'),
      );
    } finally {
      vi.unstubAllGlobals();
    }
    // Предел — на втором куске; подано не больше нескольких шагов, а не все 64 КиБ.
    expect(fed).toBeLessThanOrEqual(4 * 64);
    // Настоящая распаковка шагами: обычная запись — целиком.
    const text = new TextEncoder().encode('строка '.repeat(5000));
    expect(await inflateRaw(await deflateRaw(text), text.length, 64)).toEqual(text);
  });

  it('слишком сжатая запись (больше 500 раз) — отказ', async () => {
    const zeros = new Uint8Array(4 * MiB);
    const z = openZip(await zipBytes([{ name: 'z.xml', data: zeros }]));
    await expect(z.read('z.xml')).rejects.toThrowError(new ViewError('zip_bomb'));
  });

  it('общий предел распаковки за один просмотр', async () => {
    const data = enc.encode('x'.repeat(2000));
    const z = openZip(
      await zipBytes([
        { name: 'a', data, store: true },
        { name: 'b', data, store: true },
      ]),
      { ...ZIP_LIMITS, maxTotalBytes: 3000 },
    );
    await z.read('a');
    await expect(z.read('b')).rejects.toThrowError(new ViewError('zip_too_big'));
  });

  it('слишком много записей, шифрование, неизвестное сжатие, битый архив', async () => {
    const many = await zipBytes(
      Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: 'x' })),
    );
    expect(() => openZip(many, { ...ZIP_LIMITS, maxEntries: 4 })).toThrowError(
      new ViewError('zip_entries'),
    );
    const z = openZip(await zipBytes([{ name: 'e', data: 'x', encrypted: true }]));
    await expect(z.read('e')).rejects.toThrowError(new ViewError('file_encrypted'));
    const m = await zipBytes([{ name: 'm', data: 'xyz', store: true }]);
    m[8] = 12; // метод bzip2 в локальном заголовке не используется, правим каталог
    const cdAt = m.length - 22 - (46 + 1);
    m[cdAt + 10] = 12;
    await expect(openZip(m).read('m')).rejects.toThrowError(new ViewError('zip_method'));
    expect(() => openZip(new Uint8Array(100))).toThrowError(new ViewError('zip_bad'));
    const cut = (await zipBytes([{ name: 'a', data: 'hello world' }])).slice();
    cut[30 + 1] = 0xff; // испорченные сжатые данные
    await expect(openZip(cut).read('a')).rejects.toThrow(ViewError);
    expect(isZip(enc.encode('PK\x03\x04'))).toBe(true);
    expect(isZip(enc.encode('PK'))).toBe(false);
  });

  it('распаковка с пределом и пути частей', async () => {
    await expect(inflateRaw(new Uint8Array([0xff, 0xff]), 10)).rejects.toThrow(ViewError);
    expect(resolvePart('xl/workbook.xml', 'worksheets/sheet1.xml')).toBe(
      'xl/worksheets/sheet1.xml',
    );
    expect(resolvePart('ppt/slides/slide1.xml', '../media/i.png')).toBe('ppt/media/i.png');
    expect(resolvePart('ppt/slides/slide1.xml', './x/../y.xml')).toBe('ppt/slides/y.xml');
    expect(resolvePart('a/b.xml', '/xl/s.xml')).toBe('xl/s.xml');
    expect(relsPathOf('xl/workbook.xml')).toBe('xl/_rels/workbook.xml.rels');
    expect(relsPathOf('')).toBe('_rels/.rels');
    expect(decodeXmlBytes(new Uint8Array([0xff, 0xfe, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e, 0]))).toBe(
      '<a/>',
    );
    expect(decodeXmlBytes(new Uint8Array([0xfe, 0xff, 0, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e]))).toBe(
      '<a/>',
    );
  });
});
