import { describe, expect, it } from 'vitest';
import { fileContentProblem, FILE_SNIFF_BYTES } from './content';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

const PDF = bytes('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF');
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 20, 0, 6, 0], '[Content_Types].xml');
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const EXE = bytes('MZ', [0x90, 0, 3, 0], 'This program cannot be run in DOS mode');

describe('тип файла по содержимому', () => {
  it('читает не больше 4 КБ начала файла', () => {
    expect(FILE_SNIFF_BYTES).toBe(4096);
  });

  it('известный тип с подходящим содержимым принимается', () => {
    expect(fileContentProblem('Выписка_октябрь.pdf', PDF)).toBeNull();
    expect(fileContentProblem('скан.PNG', PNG)).toBeNull();
    expect(fileContentProblem('фото.jpeg', JPEG)).toBeNull();
    expect(fileContentProblem('фото.jpg', JPEG)).toBeNull();
    expect(fileContentProblem('Табель.xlsx', ZIP)).toBeNull();
    expect(fileContentProblem('Договор.docx', ZIP)).toBeNull();
    expect(fileContentProblem('Отчёт.xls', OLE)).toBeNull();
    expect(fileContentProblem('Акт.doc', OLE)).toBeNull();
    expect(fileContentProblem('a.gif', bytes('GIF89a', [1, 0]))).toBeNull();
    expect(fileContentProblem('a.webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBeNull();
    expect(fileContentProblem('a.bmp', bytes('BM', [0, 0]))).toBeNull();
    expect(fileContentProblem('a.tiff', bytes([0x49, 0x49, 0x2a, 0]))).toBeNull();
    expect(fileContentProblem('a.tif', bytes([0x4d, 0x4d, 0, 0x2a]))).toBeNull();
    expect(fileContentProblem('IMG_0001.HEIC', bytes([0, 0, 0, 24], 'ftypheic'))).toBeNull();
    expect(fileContentProblem('a.rar', bytes('Rar!', [0x1a, 0x07, 0]))).toBeNull();
    expect(fileContentProblem('a.7z', bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBeNull();
    expect(fileContentProblem('a.rtf', bytes('{\\rtf1\\ansi'))).toBeNull();
    expect(fileContentProblem('a.zip', bytes([0x50, 0x4b, 0x05, 0x06]))).toBeNull();
  });

  it('PDF может начинаться не с первого байта, как его открывают просмотрщики', () => {
    expect(fileContentProblem('a.pdf', bytes([0xef, 0xbb, 0xbf], '\n%PDF-1.4'))).toBeNull();
  });

  it('содержимое не того типа, что в имени, — «не совпадает с типом»', () => {
    expect(fileContentProblem('Акт.pdf', PNG)).toBe('file_content_mismatch');
    expect(fileContentProblem('фото.jpg', PDF)).toBe('file_content_mismatch');
    expect(fileContentProblem('Табель.xlsx', OLE)).toBe('file_content_mismatch');
    expect(fileContentProblem('Акт.pdf', new Uint8Array())).toBe('file_content_mismatch');
    expect(fileContentProblem('Акт.pdf', utf8('просто текст'))).toBe('file_content_mismatch');
  });

  it('программа не проходит под любым расширением и без него', () => {
    expect(fileContentProblem('Акт.pdf', EXE)).toBe('file_type_forbidden');
    expect(fileContentProblem('табель.xlsx', EXE)).toBe('file_type_forbidden');
    expect(fileContentProblem('данные.dbf', EXE)).toBe('file_type_forbidden');
    expect(fileContentProblem('readme', EXE)).toBe('file_type_forbidden');
    expect(fileContentProblem('a.txt', bytes([0x7f], 'ELF', [2, 1, 1]))).toBe(
      'file_type_forbidden',
    );
    expect(fileContentProblem('a.dat', bytes([0xcf, 0xfa, 0xed, 0xfe]))).toBe(
      'file_type_forbidden',
    );
    expect(fileContentProblem('a.dat', bytes([0xca, 0xfe, 0xba, 0xbe]))).toBe(
      'file_type_forbidden',
    );
    expect(fileContentProblem('Ярлык.pdf', bytes([0x4c, 0, 0, 0, 1, 0x14, 2, 0]))).toBe(
      'file_type_forbidden',
    );
    expect(fileContentProblem('справка.dat', bytes('ITSF', [3, 0]))).toBe('file_type_forbidden');
    expect(fileContentProblem('запуск.txt', utf8('#!/bin/sh\nrm -rf ~'))).toBe(
      'file_type_forbidden',
    );
  });

  it('запрещённое расширение не проходит, даже если содержимое безобидное', () => {
    expect(fileContentProblem('Акт.pdf.exe', PDF)).toBe('file_type_forbidden');
    expect(fileContentProblem('страница.html', utf8('hello'))).toBe('file_type_forbidden');
    expect(fileContentProblem('logo.svg', PNG)).toBe('file_type_forbidden');
  });

  it('веб-страница и SVG под текстовым или неизвестным расширением не проходят', () => {
    expect(fileContentProblem('a.txt', utf8('<!DOCTYPE html><html><body>'))).toBe(
      'file_type_forbidden',
    );
    expect(fileContentProblem('a.csv', utf8('  <script>alert(1)</script>'))).toBe(
      'file_type_forbidden',
    );
    expect(fileContentProblem('a.xml', utf8('<?xml version="1.0"?><svg xmlns="x">'))).toBe(
      'file_type_forbidden',
    );
    expect(
      fileContentProblem(
        'a.xml',
        utf8('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">'),
      ),
    ).toBe('file_type_forbidden');
    expect(fileContentProblem('выгрузка.1c', utf8('<HTML><HEAD>'))).toBe('file_type_forbidden');
    expect(fileContentProblem('без_расширения', utf8('<iframe src=x>'))).toBe(
      'file_type_forbidden',
    );
    // UTF-16 (так сохраняет Excel «Текст Юникод»): нулевые байты не прячут признаки
    const u16 = bytes(
      [0xff, 0xfe],
      [...'<script>'].flatMap((c) => [c.charCodeAt(0), 0]),
    );
    expect(fileContentProblem('a.txt', u16)).toBe('file_type_forbidden');
  });

  it('признаки страницы внутри двоичного файла (PDF, картинка) не мешают', () => {
    expect(fileContentProblem('a.pdf', bytes('%PDF-1.7 /JS <script>'))).toBeNull();
    expect(
      fileContentProblem('a.png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '<svg')),
    ).toBeNull();
  });

  it('текст: без нулевых байтов или UTF-16 с отметкой порядка байтов; пустой — можно', () => {
    expect(fileContentProblem('Табель.csv', utf8('ФИО;Дни\nИванов;22'))).toBeNull();
    expect(fileContentProblem('a.txt', new Uint8Array())).toBeNull();
    expect(
      fileContentProblem('a.xml', utf8('<?xml version="1.0" encoding="UTF-8"?><Документ/>')),
    ).toBeNull();
    expect(fileContentProblem('a.txt', bytes([0xfe, 0xff, 0, 0x41]))).toBeNull();
    expect(fileContentProblem('a.csv', PNG)).toBe('file_content_mismatch');
    expect(fileContentProblem('a.txt', bytes('abc', [0], 'def'))).toBe('file_content_mismatch');
  });

  it('неизвестный тип без признаков программы и страницы принимается как есть', () => {
    expect(fileContentProblem('база.dbf', bytes([0x03, 0x7e, 0x0b, 0x0e, 0, 0]))).toBeNull();
    expect(fileContentProblem('1Cv8.1CD', bytes('1CDBMSV8', [0, 0]))).toBeNull();
    expect(fileContentProblem('README', utf8('просто заметка'))).toBeNull();
  });
});
