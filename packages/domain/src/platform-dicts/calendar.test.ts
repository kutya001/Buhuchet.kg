import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/calendar.json';
import {
  calendarAddKind,
  calendarAddProblems,
  calendarAdminYears,
  calendarCopyPlan,
  calendarEntryProblem,
  calendarKindOf,
  calendarYear,
  holidayName,
  isCalendarDay,
  isWorkingDay,
  nextWorkingDay,
  productionCalendar,
  type CalendarEntry,
} from './calendar';

// Эталон — прототип (scripts/oracle-calendar.mjs): каждый день с 15.12.2025 по 15.01.2027 и праздники с
// рабочими субботами refDB.json; записи календаря — так, как их раскладывает наполнение базы.
const days = fixture.days as [string, boolean, string, string][];
const entries: CalendarEntry[] = [
  ...Object.entries(fixture.holidays as Record<string, string>).map(([day, name]) => ({
    day,
    kind: calendarKindOf(name, false),
    name,
  })),
  ...fixture.workingSaturdays.map((day) => ({ day, kind: calendarKindOf('', true), name: '' })),
];
const calendar = productionCalendar(entries);

describe('производственный календарь — как в прототипе', () => {
  it('рабочий день, срок после сдвига и название праздника совпадают с прототипом на каждом дне', () => {
    expect(days.length).toBeGreaterThan(390);
    for (const [date, working, shifted, name] of days) {
      expect([date, isWorkingDay(calendar, date), nextWorkingDay(calendar, date)]).toEqual([
        date,
        working,
        shifted,
      ]);
      expect(holidayName(calendar, date)).toBe(name);
    }
  });

  it('срок на нерабочем дне сдвигается до рабочего по календарю, а не «суббота → понедельник»', () => {
    // 07.03.2026 суббота → 08.03 праздник → 09.03 перенос → 10.03.
    expect(nextWorkingDay(calendar, '2026-03-07')).toBe('2026-03-10');
    // 20.03 Орозо айт (пятница), 21.03 Нооруз, 22.03 воскресенье → 23.03.
    expect(nextWorkingDay(calendar, '2026-03-20')).toBe('2026-03-23');
    // Рабочая суббота — рабочий день, срок на неё не сдвигается.
    expect(isWorkingDay(calendar, '2026-03-14')).toBe(true);
    expect(nextWorkingDay(calendar, '2026-03-14')).toBe('2026-03-14');
    expect(nextWorkingDay(calendar, '2026-03-21')).toBe('2026-03-23');
  });

  it('праздник «каждый год» есть в любом году, праздник года — только в своём', () => {
    expect(holidayName(calendar, '2031-08-31')).toBe('День независимости');
    expect(holidayName(calendar, '2026-05-27')).toBe('Курман айт');
    expect(holidayName(calendar, '2027-05-27')).toBe('');
  });
});

describe('календарь года', () => {
  it('2026: праздники «каждый год» на 2026 год, праздники и переносы 2026 года, рабочая суббота', () => {
    const days = calendarYear(entries, 2026);
    expect(days.map((d) => d.date)).toEqual([
      '2026-01-01',
      '2026-01-07',
      '2026-02-23',
      '2026-03-08',
      '2026-03-09',
      '2026-03-14',
      '2026-03-20',
      '2026-03-21',
      '2026-04-07',
      '2026-05-01',
      '2026-05-05',
      '2026-05-09',
      '2026-05-27',
      '2026-08-31',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(days.find((d) => d.date === '2026-03-09')).toEqual({
      date: '2026-03-09',
      kind: 'transfer',
      name: 'Перенос: 8 марта',
      everyYear: false,
    });
    expect(days.find((d) => d.date === '2026-03-14')).toMatchObject({ kind: 'workday' });
    expect(days.find((d) => d.date === '2026-01-01')).toMatchObject({
      kind: 'holiday',
      everyYear: true,
    });
  });

  it('29 февраля «каждый год» в невисокосном году не появляется', () => {
    const leap: CalendarEntry[] = [{ day: '02-29', kind: 'holiday', name: 'Пример' }];
    expect(calendarYear(leap, 2027)).toEqual([]);
    expect(calendarYear(leap, 2028)).toHaveLength(1);
  });
});

describe('запись календаря', () => {
  it('ключ — MM-DD или дата YYYY-MM-DD', () => {
    expect(isCalendarDay('03-21')).toBe(true);
    expect(isCalendarDay('02-29')).toBe(true);
    expect(isCalendarDay('2026-03-20')).toBe(true);
    expect(isCalendarDay('13-01')).toBe(false);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('20260320')).toBe(false);
  });

  it('вид дня: рабочая суббота, перенос по названию, остальное — праздник', () => {
    expect(calendarKindOf('', true)).toBe('workday');
    expect(calendarKindOf('Перенос: 8 марта', false)).toBe('transfer');
    expect(calendarKindOf('Нооруз', false)).toBe('holiday');
  });

  it('проверка записи: каждый год — только праздник, рабочая суббота — суббота, у праздника есть название', () => {
    expect(entries.map(calendarEntryProblem).filter(Boolean)).toEqual([]);
    expect(calendarEntryProblem({ day: '2026-02-30', kind: 'holiday', name: 'X' })).toMatch(
      /не дата/,
    );
    expect(calendarEntryProblem({ day: '03-09', kind: 'transfer', name: 'Перенос' })).toMatch(
      /только праздник/,
    );
    expect(calendarEntryProblem({ day: '2026-03-13', kind: 'workday', name: '' })).toMatch(
      /не суббота/,
    );
    expect(calendarEntryProblem({ day: '2026-03-20', kind: 'holiday', name: ' ' })).toMatch(
      /нет названия/,
    );
    expect(
      calendarEntryProblem({ day: '2026-03-20', kind: 'other' as 'holiday', name: 'X' }),
    ).toMatch(/неизвестный вид/);
  });
});

describe('Админка → «Календарь»', () => {
  const base: CalendarEntry[] = [
    { day: '01-01', kind: 'holiday', name: 'Новый год' },
    { day: '02-29', kind: 'holiday', name: 'Високосный' },
    { day: '2026-03-20', kind: 'holiday', name: 'Орозо айт' },
    { day: '2026-03-14', kind: 'workday', name: '' },
    { day: '2026-03-09', kind: 'transfer', name: 'Перенос: 8 марта' },
    { day: '2027-03-09', kind: 'holiday', name: 'Уже внесено' },
    { day: '2028-02-29', kind: 'transfer', name: 'Перенос' },
  ];
  const today = '2026-10-27';

  it('годы вкладки — текущий по Бишкеку и следующий', () => {
    expect(calendarAdminYears(today)).toEqual([2026, 2027]);
  });

  it('вид нового дня: перенос — по названию «Перенос…», рабочая суббота — по типу', () => {
    expect(calendarAddKind('off', 'Орозо айт')).toBe('holiday');
    expect(calendarAddKind('off', ' Перенос: 8 марта')).toBe('transfer');
    expect(calendarAddKind('workday', 'что угодно')).toBe('workday');
  });

  it('«Нерабочий день»: дата, год вкладки, суббота, повтор даты, название праздника', () => {
    const problems = (date: string, type: 'off' | 'workday', name = 'Праздник') =>
      calendarAddProblems({ date, type, name }, base, today).map((p) => p.code);
    expect(problems('', 'off')).toEqual(['date_required']);
    expect(problems('2026-02-30', 'off')).toEqual(['date_required']);
    expect(problems('2025-12-31', 'off')).toEqual(['date_year']);
    expect(problems('2028-01-03', 'off')).toEqual(['date_year']);
    expect(problems('2027-03-15', 'workday')).toEqual(['not_saturday']);
    expect(problems('2027-03-13', 'workday', '')).toEqual([]);
    expect(problems('2027-01-01', 'off')).toEqual(['date_taken']);
    expect(problems('2026-03-20', 'off')).toEqual(['date_taken']);
    expect(problems('2027-01-04', 'off', ' ')).toEqual(['name_required']);
    expect(problems('', 'off', '')).toEqual(['date_required', 'name_required']);
  });

  it('копирование: только даты «только в этом году», на ту же дату следующего года, занятые — нет', () => {
    // Рабочая суббота 14.03.2026 не копируется: 14.03.2027 — воскресенье.
    expect(calendarCopyPlan(base, 2026)).toEqual([
      { from: '2026-03-20', to: '2027-03-20', kind: 'holiday', name: 'Орозо айт' },
    ]);
    // 29 февраля в невисокосный год не копируется.
    expect(calendarCopyPlan(base, 2028)).toEqual([]);
  });
});
