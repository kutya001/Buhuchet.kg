import { describe, expect, it } from 'vitest';
import { calendarGrid, CALENDAR_GRID_DAYS } from './calendar';

describe('calendarGrid (прототип renderCalendar)', () => {
  it('октябрь 2026: с понедельника 28.09 — 42 дня, до 08.11', () => {
    const days = calendarGrid('2026-10');
    expect(days).toHaveLength(CALENDAR_GRID_DAYS);
    expect(days[0]).toBe('2026-09-28');
    expect(days[3]).toBe('2026-10-01');
    expect(days.at(-1)).toBe('2026-11-08');
  });

  it('месяц с понедельника начинается с первого числа; переход через год', () => {
    expect(calendarGrid('2026-06')[0]).toBe('2026-06-01');
    const dec = calendarGrid('2026-12');
    expect(dec[0]).toBe('2026-11-30');
    expect(dec.at(-1)).toBe('2027-01-10');
  });

  it('февраль високосного года — 29 дней внутри сетки', () => {
    const days = calendarGrid('2028-02');
    expect(days).toContain('2028-02-29');
    expect(days[0]).toBe('2028-01-31');
  });
});
