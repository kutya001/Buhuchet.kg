import { describe, expect, it } from 'vitest';
import {
  addDays,
  bishkekDate,
  bishkekTime,
  diffDays,
  formatDateRu,
  formatMomentRu,
  isIsoDate,
  weekdayMondayFirst,
} from './dates';

describe('bishkekDate', () => {
  it('после 18:00 UTC в Бишкеке уже завтра', () => {
    expect(bishkekDate(new Date('2026-10-18T17:59:00Z'))).toBe('2026-10-18');
    expect(bishkekDate(new Date('2026-10-18T18:00:00Z'))).toBe('2026-10-19');
    expect(bishkekTime(new Date('2026-10-18T18:05:00Z'))).toBe('00:05');
  });
});

describe('арифметика дат', () => {
  it('addDays переходит через месяц и год', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('diffDays', () => {
    expect(diffDays('2026-10-25', '2026-10-18')).toBe(7);
    expect(diffDays('2026-10-18', '2026-10-25')).toBe(-7);
  });

  it('formatDateRu', () => {
    expect(formatDateRu('2026-03-15')).toBe('15.03.2026');
  });

  it('formatMomentRu — дата и время по Бишкеку', () => {
    expect(formatMomentRu(new Date('2026-03-15T04:05:00Z'))).toBe('15.03.2026 10:05');
    expect(formatMomentRu(new Date('2026-12-31T18:30:00Z'))).toBe('01.01.2027 00:30');
  });

  it('weekdayMondayFirst', () => {
    expect(weekdayMondayFirst('2026-10-19')).toBe(0);
    expect(weekdayMondayFirst('2026-10-25')).toBe(6);
  });

  it('isIsoDate отсеивает несуществующие даты', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('15.03.2026')).toBe(false);
    expect(() => addDays('2026-13-01', 1)).toThrow(RangeError);
  });
});
