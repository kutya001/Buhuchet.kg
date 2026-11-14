import { describe, expect, it } from 'vitest';
import { isWeekSummaryDay, WEEK_DAY_DEFAULT, weekDayOf } from './notices';

describe('недельная сводка: день недели (блок «Telegram-уведомления»)', () => {
  it('по умолчанию — понедельник, как было', () => {
    expect(WEEK_DAY_DEFAULT).toBe(1);
    expect(weekDayOf(null)).toBe(1);
    expect(weekDayOf(undefined)).toBe(1);
    expect(weekDayOf(0)).toBe(1);
    expect(weekDayOf(8)).toBe(1);
    expect(weekDayOf(2.5)).toBe(1);
    expect(weekDayOf(7)).toBe(7);
  });

  it('сводка уходит только в выбранный день', () => {
    // 2026-11-16 — понедельник, 2026-11-20 — пятница, 2026-11-22 — воскресенье
    expect(isWeekSummaryDay('2026-11-16', 1)).toBe(true);
    expect(isWeekSummaryDay('2026-11-17', 1)).toBe(false);
    expect(isWeekSummaryDay('2026-11-20', 5)).toBe(true);
    expect(isWeekSummaryDay('2026-11-16', 5)).toBe(false);
    expect(isWeekSummaryDay('2026-11-22', 7)).toBe(true);
    expect(isWeekSummaryDay('2026-11-21', 7)).toBe(false);
  });

  it('неверный день в базе — сводка по понедельникам', () => {
    expect(isWeekSummaryDay('2026-11-16', 0)).toBe(true);
    expect(isWeekSummaryDay('2026-11-17', 9)).toBe(false);
  });
});
