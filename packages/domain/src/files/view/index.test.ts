import { describe, expect, it } from 'vitest';
import { cfbBytes, docxBytes, pptxBytes, xlsWorkbookStream, xlsxBytes } from './fixtures';
import { fileExt, fileViewKind, isPdf, parseFileView, viewPictureType } from './index';

const enc = new TextEncoder();

describe('какой показ у файла и разбор по содержимому', () => {
  it('показ по расширению', () => {
    expect(fileExt('Отчёт.XLSX')).toBe('xlsx');
    expect(fileExt('без')).toBe('');
    expect(
      [
        'a.jpg',
        'a.HEIC',
        'a.pdf',
        'a.xls',
        'a.xlsm',
        'a.csv',
        'a.docx',
        'a.pptx',
        'a.txt',
        'a.log',
        'a.xml',
        'a.doc',
        'a.ppt',
        'a.zip',
        'a',
      ].map(fileViewKind),
    ).toEqual([
      'image',
      'image',
      'pdf',
      'sheet',
      'sheet',
      'csv',
      'docx',
      'pptx',
      'text',
      'text',
      'xml',
      'download',
      'download',
      'none',
      'none',
    ]);
  });

  it('тип картинки и PDF — по первым байтам', () => {
    expect(viewPictureType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'image/jpeg',
    );
    expect(viewPictureType(enc.encode('GIF89a......'))).toBe('image/gif');
    expect(viewPictureType(enc.encode('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(viewPictureType(enc.encode('\0\0\0\x18ftypheic....'))).toBe('image/heic');
    expect(viewPictureType(enc.encode('\0\0\0\x18ftypisom....'))).toBeNull();
    expect(viewPictureType(enc.encode('<svg onload=alert(1)>'))).toBeNull();
    expect(isPdf(enc.encode('\n%PDF-1.7'))).toBe(true);
    expect(isPdf(enc.encode('<html>'))).toBe(false);
  });

  it('разбор по содержимому: XLS под именем .xlsx, подделки — «Предпросмотр недоступен»', async () => {
    const xls = cfbBytes([
      {
        name: 'Workbook',
        data: xlsWorkbookStream([{ name: 'Л', cells: [{ r: 0, c: 0, k: 'rk', v: 7 }] }]),
      },
    ]);
    expect((await parseFileView('Старый.xlsx', xls)).kind).toBe('sheet');
    expect((await parseFileView('a.xls', await xlsxBytes([{ name: 'Л', rows: [[1]] }]))).kind).toBe(
      'sheet',
    );
    expect(await parseFileView('a.xlsx', enc.encode('<html>'))).toEqual({ kind: 'none' });
    expect(await parseFileView('a.docx', enc.encode('нет'))).toEqual({ kind: 'none' });
    expect(await parseFileView('a.pptx', enc.encode('нет'))).toEqual({ kind: 'none' });
    expect((await parseFileView('a.docx', await docxBytes(''))).kind).toBe('doc');
    expect((await parseFileView('a.pptx', await pptxBytes(['']))).kind).toBe('slides');
    expect(await parseFileView('a.doc', xls)).toEqual({ kind: 'none' });
    expect(await parseFileView('a.zip', xls)).toEqual({ kind: 'none' });
  });

  it('CSV и TXT в Windows-1251 читаются по-русски, XML с внешней сущностью открывается без загрузки', async () => {
    const cp = new Uint8Array([
      0xc8, 0xcd, 0xcd, 0x3b, 0xd1, 0xf3, 0xec, 0xec, 0xe0, 0x0a, 0x31, 0x3b, 0x32,
    ]); // «ИНН;Сумма\n1;2»
    const csv = await parseFileView('Выписка.csv', cp);
    expect(csv.kind === 'sheet' && csv.sheets[0]!.name).toBe('Выписка');
    expect(csv.kind === 'sheet' && csv.sheets[0]!.rows[0]).toEqual([{ v: 'ИНН' }, { v: 'Сумма' }]);
    const txt = await parseFileView(
      'Журнал.txt',
      new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),
    );
    expect(txt).toEqual({
      kind: 'text',
      lines: ['Привет'],
      encoding: 'windows-1251',
      totalLines: 1,
    });
    const xml = await parseFileView(
      'Отчёт.xml',
      enc.encode('<!DOCTYPE r [<!ENTITY x SYSTEM "http://evil.example/">]><r>&x;</r>'),
    );
    expect(xml).toEqual({
      kind: 'xml',
      decl: null,
      doctype: true,
      root: { n: 'r', a: [], c: ['&x;'] },
      cut: false,
    });
  });
});
