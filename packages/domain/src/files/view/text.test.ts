import { describe, expect, it } from 'vitest';
import {
  csvDelimiter,
  decodeText,
  parseCsv,
  TEXT_MAX_CHARS,
  TEXT_MAX_LINES,
  textView,
} from './text';

const enc = new TextEncoder();
/** «Привет, мир» в Windows-1251. */
const CP1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x2c, 0x20, 0xec, 0xe8, 0xf0]);

describe('текст и CSV окна просмотра', () => {
  it('кодировка определяется сама: UTF-8, Windows-1251, BOM', () => {
    expect(decodeText(enc.encode('Привет'))).toEqual({ text: 'Привет', encoding: 'utf-8' });
    expect(decodeText(CP1251)).toEqual({ text: 'Привет, мир', encoding: 'windows-1251' });
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('Ж')]))).toEqual({
      text: 'Ж',
      encoding: 'utf-8',
    });
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x16, 0x04]))).toEqual({
      text: 'Ж',
      encoding: 'utf-16le',
    });
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x04, 0x16]))).toEqual({
      text: 'Ж',
      encoding: 'utf-16be',
    });
  });

  it('строки текста и предел строк', () => {
    const v = textView(enc.encode('a\r\nb\rc\nd'));
    expect(v).toEqual({
      kind: 'text',
      lines: ['a', 'b', 'c', 'd'],
      encoding: 'utf-8',
      totalLines: 4,
    });
    const many = textView(enc.encode('x\n'.repeat(TEXT_MAX_LINES + 50)));
    expect(many.lines).toHaveLength(TEXT_MAX_LINES);
    expect(many.totalLines).toBe(TEXT_MAX_LINES + 51);
    const long = textView(enc.encode(`${'я'.repeat(TEXT_MAX_CHARS)}\nхвост\nещё`));
    expect(long.lines[0]).toHaveLength(TEXT_MAX_CHARS);
    expect(long.totalLines).toBe(3);
  });

  it('CSV: разделитель сам, кавычки, переносы внутри кавычек, предел строк', () => {
    expect(csvDelimiter('a;b;c\n1;2;3\n')).toBe(';');
    expect(csvDelimiter('a,b\n1,2')).toBe(',');
    expect(csvDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(csvDelimiter('"a;b",c\n"1;2",3\n')).toBe(',');
    expect(csvDelimiter('один столбец')).toBe(',');
    const { rows, total } = parseCsv(
      '﻿Имя;Сумма\r\n"ОсОО ""Ромашка""";"1 250,50"\n"много\nстрок";2\n',
      10,
    );
    expect(rows).toEqual([
      ['Имя', 'Сумма'],
      ['ОсОО "Ромашка"', '1 250,50'],
      ['много\nстрок', '2'],
    ]);
    expect(total).toBe(3);
    const cut = parseCsv('1\n2\n3\n4', 2, ';');
    expect(cut).toEqual({ rows: [['1'], ['2']], total: 4 });
  });
});
