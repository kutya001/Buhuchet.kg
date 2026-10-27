import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysInMonth,
  isYearMonth,
  lastDayOf,
  monthDay,
  monthLabel,
  monthLabelGen,
  monthOf,
  monthRange,
  monthText,
} from './months';

describe('месяцы показателей', () => {
  it('YYYY-MM — месяц, остальное — нет', () => {
    expect(isYearMonth('2026-09')).toBe(true);
    expect(isYearMonth('2026-13')).toBe(false);
    expect(isYearMonth('2026-00')).toBe(false);
    expect(isYearMonth('2026-9')).toBe(false);
    expect(isYearMonth('2026-09-01')).toBe(false);
  });

  it('месяц даты, сдвиг через границу года, «09.2026», число месяца', () => {
    expect(monthOf('2026-10-18')).toBe('2026-10');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-10', -35)).toBe('2023-11');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
    expect(monthText('2026-09')).toBe('09.2026');
    expect(monthDay('2026-11', 5)).toBe('2026-11-05');
  });

  it('диапазон включительно; начало позже конца — пусто', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-02', '2026-02')).toEqual(['2026-02']);
    expect(monthRange('2026-03', '2026-02')).toEqual([]);
  });

  it('не месяц — ошибка, а не тихий неверный ответ', () => {
    expect(() => addMonths('2026-9', 1)).toThrow(RangeError);
    expect(() => monthRange('2026-01', 'x')).toThrow(RangeError);
    expect(() => monthText('')).toThrow(RangeError);
    expect(() => monthDay('2026-13', 1)).toThrow(RangeError);
  });

  it('дни месяца и названия', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(lastDayOf('2026-10')).toBe('2026-10-31');
    expect(lastDayOf('2026-11')).toBe('2026-11-30');
    expect(monthLabel('2026-10')).toBe('октябрь 2026');
    expect(monthLabelGen('2026-09')).toBe('сентября 2026');
  });
});
