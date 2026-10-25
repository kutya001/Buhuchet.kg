import { describe, expect, it } from 'vitest';
import { formatSom, formatSomWithUnit, parseSom, somToTyiyn, sumTyiyn } from './money';

const NBSP = ' ';

describe('formatSom — как fmtM прототипа', () => {
  it('группирует тысячи неразрывным пробелом и ставит запятую', () => {
    expect(formatSom(125050)).toBe(`1${NBSP}250,50`);
    expect(formatSom(123456789)).toBe(`1${NBSP}234${NBSP}567,89`);
    expect(formatSom(5)).toBe('0,05');
    expect(formatSom(0)).toBe('0,00');
  });

  it('минус — типографский знак «−»', () => {
    expect(formatSom(-30000)).toBe('−300,00');
  });

  it('auto убирает «,00» у целых сомов', () => {
    expect(formatSom(125000, 'auto')).toBe(`1${NBSP}250`);
    expect(formatSom(125050, 'auto')).toBe(`1${NBSP}250,50`);
    expect(formatSomWithUnit(100000)).toBe(`1${NBSP}000${NBSP}сом`);
  });

  it('не принимает дробные тыйыны', () => {
    expect(() => formatSom(1.5)).toThrow(RangeError);
  });
});

describe('parseSom', () => {
  it.each([
    ['1 250,50', 125050],
    [`1${NBSP}250,5`, 125050],
    ['1250.5', 125050],
    ['1250', 125000],
    ['−300', -30000],
    ['-0,01', -1],
  ])('%s → %d тыйын', (input, expected) => {
    expect(parseSom(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,234', '1.2.3', '12,'])('«%s» — не сумма', (input) => {
    expect(parseSom(input)).toBeNull();
  });

  it('слишком большая сумма — не сумма', () => {
    expect(parseSom('99999999999999999999')).toBeNull();
  });
});

describe('somToTyiyn и sumTyiyn', () => {
  it('округляет до тыйына', () => {
    expect(somToTyiyn(1250.5)).toBe(125050);
    expect(somToTyiyn(0.1 + 0.2)).toBe(30);
  });

  it('отказывает не числам', () => {
    expect(() => somToTyiyn(Number.NaN)).toThrow(RangeError);
  });

  it('складывает без ошибок плавающей точки', () => {
    expect(sumTyiyn([10, 20, 30])).toBe(60);
    expect(() => sumTyiyn([1, 0.5])).toThrow(RangeError);
  });
});
