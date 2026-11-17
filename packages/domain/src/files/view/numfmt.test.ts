import { describe, expect, it } from 'vitest';
import {
  BUILTIN_NUMFMT,
  excelDateParts,
  formatCellNumber,
  formatCellText,
  formatGeneral,
  isDateFormat,
} from './numfmt';

const NB = '\u00a0';

describe('числа листа «как в файле»', () => {
  it('«Общий» формат: запятая, до 10 значащих цифр, большие — с порядком', () => {
    expect(formatGeneral(0)).toBe('0');
    expect(formatGeneral(1250.5)).toBe('1250,5');
    expect(formatGeneral(0.1 + 0.2)).toBe('0,3');
    expect(formatGeneral(-42)).toBe('-42');
    expect(formatGeneral(123456789012)).toBe('1,23457E+11');
    expect(formatGeneral(0.00000000012)).toBe('1,2E-10');
    expect(formatGeneral(Number.NaN)).toBe('#ЧИСЛО!');
    expect(formatCellNumber(3.5, 'General')).toBe('3,5');
    expect(formatCellNumber(3.5, '')).toBe('3,5');
  });

  it('встроенные и свои форматы чисел: тысячи неразрывным пробелом, запятая, проценты, валюта', () => {
    expect(formatCellNumber(1250.5, BUILTIN_NUMFMT[4]!)).toBe(`1${NB}250,50`);
    expect(formatCellNumber(1234567, BUILTIN_NUMFMT[3]!)).toBe(`1${NB}234${NB}567`);
    expect(formatCellNumber(7, '000')).toBe('007');
    expect(formatCellNumber(0.256, '0.0%')).toBe('25,6%');
    expect(formatCellNumber(0.5, BUILTIN_NUMFMT[9]!)).toBe('50%');
    expect(formatCellNumber(-1250.5, '#,##0.00')).toBe(`-1${NB}250,50`);
    expect(formatCellNumber(-1250.5, '#,##0.00;(#,##0.00)')).toBe(`(1${NB}250,50)`);
    expect(formatCellNumber(-5, '#,##0;[Red]-#,##0')).toBe('-5');
    expect(formatCellNumber(0, '#,##0;-#,##0;"—"')).toBe('—');
    expect(formatCellNumber(1500, '#,##0.00\\ "сом"')).toBe(`1${NB}500,00 сом`);
    expect(formatCellNumber(1500, '#,##0.00 [$сом-440]')).toBe(`1${NB}500,00 сом`);
    expect(formatCellNumber(1500, '#,##0.00_ ;\\-#,##0.00\\ ')).toBe(`1${NB}500,00 `);
    expect(formatCellNumber(2.5, '#.##')).toBe('2,5');
    expect(formatCellNumber(0.5, '#.00')).toBe(',50');
    expect(formatCellNumber(1234567, '#,##0,')).toBe(`1${NB}235`);
    expect(formatCellNumber(12345, '0.00E+00')).toBe('1,23E+04');
    expect(formatCellNumber(0.00012, '0.0E+0')).toBe('1,2E-4');
    expect(formatCellNumber(12345, '##0.0E+0')).toBe('12,3E+3');
    expect(formatCellNumber(5, '"нет"')).toBe('нет');
    expect(formatCellNumber(5, ';;;')).toBe('');
    expect(formatCellNumber(150, '[>=100]"много";[<0]"минус";0')).toBe('много');
    expect(formatCellNumber(-3, '[>=100]"много";[<0]"минус";0')).toBe('минус');
    expect(formatCellNumber(7, '[>=100]"много";[<0]"минус";0')).toBe('7');
    expect(formatCellNumber(5, '[=5]"пять";0')).toBe('пять');
    expect(formatCellNumber(5, '[<>5]"не пять";[<=1]"мало";0')).toBe('5');
    expect(formatCellNumber(0, '[<=1]"мало";0')).toBe('мало');
    expect(formatCellNumber(42, '@')).toBe('42');
    expect(formatCellNumber(1.5, '# ?/?')).toBe('1,5');
    expect(formatCellNumber(3, '0.')).toBe('3,');
  });

  it('даты и время: система 1900 (с ложным 29.02.1900) и 1904, русские названия', () => {
    expect(isDateFormat(BUILTIN_NUMFMT[14]!)).toBe(true);
    expect(isDateFormat('#,##0.00')).toBe(false);
    expect(isDateFormat('General')).toBe(false);
    expect(isDateFormat('[h]:mm')).toBe(true);
    expect(formatCellNumber(46342, BUILTIN_NUMFMT[14]!)).toBe('16.11.2026');
    expect(formatCellNumber(46342.75, BUILTIN_NUMFMT[22]!)).toBe('16.11.2026 18:00');
    expect(formatCellNumber(46342, 'd mmmm yyyy')).toBe('16 ноябрь 2026');
    expect(formatCellNumber(46342, 'dddd, dd mmm yy')).toBe('понедельник, 16 ноя 26');
    expect(formatCellNumber(46342, 'ddd mmmmm')).toBe('Пн н');
    expect(formatCellNumber(46342, 'm/d/yyyy')).toBe('11/16/2026');
    expect(formatCellNumber(0.5, 'h:mm AM/PM')).toBe('12:00 PM');
    expect(formatCellNumber(0.25, 'hh:mm:ss a/p')).toBe('06:00:00 A');
    expect(formatCellNumber(1.5, '[h]:mm:ss')).toBe('36:00:00');
    expect(formatCellNumber(0.0005, 'mm:ss.0')).toBe('00:43,2');
    expect(formatCellNumber(0.5, '[mm]')).toBe('720');
    expect(formatCellNumber(0.5, 'h:m:s')).toBe('12:0:0');
    expect(formatCellNumber(60, 'dd.mm.yyyy')).toBe('29.02.1900');
    expect(formatCellNumber(59, 'dd.mm.yyyy')).toBe('28.02.1900');
    expect(formatCellNumber(61, 'dd.mm.yyyy')).toBe('01.03.1900');
    expect(formatCellNumber(0, 'dd.mm.yyyy', true)).toBe('01.01.1904');
    expect(formatCellNumber(-1, 'dd.mm.yyyy')).toBe('#####');
    expect(excelDateParts(1.5)).toMatchObject({ y: 1900, mo: 1, d: 1, h: 12, mi: 0, s: 0 });
    expect(excelDateParts(0.9999999999)).toMatchObject({ y: 1900, mo: 1, d: 1, h: 0 });
    expect(excelDateParts(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('текстовый раздел формата', () => {
    expect(formatCellText('ОсОО', '@')).toBe('ОсОО');
    expect(formatCellText('ОсОО', '0;-0;0;"Имя: "@')).toBe('Имя: ОсОО');
    expect(formatCellText('ОсОО', '#,##0')).toBe('ОсОО');
    expect(formatCellText('x', '0;0')).toBe('x');
  });
});
