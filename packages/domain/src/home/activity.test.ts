import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_DEFAULT,
  ACTIVITY_MAX_BACK,
  activityBarHeight,
  activityBucketLabeled,
  activityBuckets,
  activityByDay,
  activityKindChosen,
  activityLast,
  activityLastDay,
  activityRange,
  activityRow,
  activityRows,
  activityShift,
  activityTotals,
  type ActivityDay,
  type ActivityEmployee,
} from './activity';

// Сегодня — четверг 12.11.2026 (как в демо-данных прототипа v84).
const TODAY = '2026-11-12';

const day = (d: string, n: number, i = 0, o = 0, last = '10:00'): ActivityDay => ({
  day: d,
  n,
  in: i,
  out: o,
  first: i ? '09:00' : null,
  last,
});

describe('Период «Активности» (прототип modules/activity.js, actRange)', () => {
  it('по умолчанию — текущий месяц', () => {
    expect(ACTIVITY_DEFAULT).toEqual({ k: 'm', off: 0 });
    expect(activityRange(ACTIVITY_DEFAULT, TODAY)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('день: сегодня и сдвиг назад', () => {
    expect(activityRange({ k: 'd', off: 0 }, TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(activityRange({ k: 'd', off: -12 }, TODAY)).toEqual({
      from: '2026-10-31',
      to: '2026-10-31',
    });
  });

  it('неделя — с понедельника по воскресенье, прошлая — на семь дней раньше', () => {
    expect(activityRange({ k: 'w', off: 0 }, TODAY)).toEqual({
      from: '2026-11-09',
      to: '2026-11-15',
    });
    expect(activityRange({ k: 'w', off: -1 }, TODAY)).toEqual({
      from: '2026-11-02',
      to: '2026-11-08',
    });
    // В воскресенье неделя ещё текущая, в понедельник — уже новая.
    expect(activityRange({ k: 'w', off: 0 }, '2026-11-15').from).toBe('2026-11-09');
    expect(activityRange({ k: 'w', off: 0 }, '2026-11-16').from).toBe('2026-11-16');
  });

  it('месяц: через границу года и февраль', () => {
    expect(activityRange({ k: 'm', off: -11 }, TODAY)).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(activityRange({ k: 'm', off: -9 }, TODAY)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('год — целиком', () => {
    expect(activityRange({ k: 'y', off: 0 }, TODAY)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(activityRange({ k: 'y', off: -1 }, TODAY)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('последний наступивший день: в текущем периоде — сегодня, в прошлом — конец периода', () => {
    expect(activityLastDay({ from: '2026-11-01', to: '2026-11-30' }, TODAY)).toBe(TODAY);
    expect(activityLastDay({ from: '2026-10-01', to: '2026-10-31' }, TODAY)).toBe('2026-10-31');
  });
});

describe('Листание периода (прототип actBind)', () => {
  it('«Раньше» уводит назад, «Позже» — не дальше текущего, «К текущему» — сдвиг 0', () => {
    expect(activityShift({ k: 'w', off: 0 }, -1)).toEqual({ k: 'w', off: -1 });
    expect(activityShift({ k: 'w', off: -1 }, 1)).toEqual({ k: 'w', off: 0 });
    expect(activityShift({ k: 'w', off: 0 }, 1)).toEqual({ k: 'w', off: 0 });
    expect(activityShift({ k: 'y', off: -3 }, 0)).toEqual({ k: 'y', off: 0 });
  });

  it('назад — не дальше предела', () => {
    expect(activityShift({ k: 'd', off: -ACTIVITY_MAX_BACK }, -1).off).toBe(-ACTIVITY_MAX_BACK);
  });

  it('другой вид периода начинается с текущего', () => {
    expect(activityKindChosen('y')).toEqual({ k: 'y', off: 0 });
  });
});

describe('Строки списка «Активности» (прототип actEmp, renderHomeAct)', () => {
  const aigerim: ActivityEmployee = {
    id: 'e1',
    name: 'Айгерим С.',
    role: 'Бухгалтер',
    active: true,
  };
  const blocked: ActivityEmployee = {
    id: 'e2',
    name: 'Бакыт Т.',
    role: 'Бухгалтер',
    active: false,
  };
  const gone: ActivityEmployee = { id: 'e3', name: 'Чолпон А.', role: 'Бухгалтер', active: false };
  const idle: ActivityEmployee = { id: 'e4', name: 'Данияр К.', role: 'Бухгалтер', active: true };
  const days = new Map([
    ['e1', [day('2026-11-10', 14, 1, 1, '17:40'), day('2026-11-12', 6, 2, 0, '11:05')]],
    ['e2', [day('2026-11-03', 2, 1, 0, '09:30')]],
  ]);
  const counters = new Map([
    ['e1', { sub: 5, late: 1, due: 9, over: 2, cps: 12, tasks: 3 }],
    ['e3', { sub: 0, late: 0, due: 0, over: 0, cps: 0, tasks: 0 }],
  ]);

  it('сводка сотрудника: суммы по дням, дни с активностью, последняя активность', () => {
    expect(activityRow(aigerim, days.get('e1')!, counters.get('e1'))).toEqual({
      id: 'e1',
      name: 'Айгерим С.',
      role: 'Бухгалтер',
      active: true,
      last: '2026-11-12 11:05',
      in: 3,
      out: 1,
      days: 2,
      n: 20,
      sub: 5,
      late: 1,
      due: 9,
      over: 2,
      cps: 12,
      tasks: 3,
    });
  });

  it('без активности — «не было» и нули', () => {
    const r = activityRow(idle, []);
    expect(r.last).toBeNull();
    expect([r.in, r.out, r.days, r.n, r.sub, r.cps]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('последняя активность — по самому позднему дню, в каком бы порядке дни ни пришли', () => {
    expect(
      activityLast([day('2026-11-12', 1, 0, 0, '08:15'), day('2026-11-10', 1, 0, 0, '19:00')]),
    ).toBe('2026-11-12 08:15');
    expect(activityLast([])).toBeNull();
  });

  it('действующие — все; заблокированный — только с активностью или сданными отчётами', () => {
    const rows = activityRows([aigerim, blocked, gone, idle], days, counters);
    expect(rows.map((r) => r.id)).toEqual(['e1', 'e2', 'e4']);
    const withSub = activityRows(
      [gone],
      new Map(),
      new Map([['e3', { sub: 1, late: 0, due: 0, over: 0, cps: 0, tasks: 0 }]]),
    );
    expect(withSub.map((r) => r.id)).toEqual(['e3']);
  });

  it('плашки: работали из стольких, входы и выходы, действия, сдано и позже срока, задачи', () => {
    const rows = activityRows([aigerim, blocked, gone, idle], days, counters);
    expect(activityTotals(rows)).toEqual({
      staff: 3,
      active: 2,
      in: 4,
      out: 1,
      n: 22,
      sub: 5,
      late: 1,
      tasks: 3,
    });
  });

  it('действия по дням — сумма по сотрудникам списка', () => {
    const byDay = activityByDay(
      new Map([
        ['e1', [day('2026-11-10', 14), day('2026-11-12', 6)]],
        ['e2', [day('2026-11-10', 2)]],
        ['e9', [day('2026-11-10', 100)]],
      ]),
      ['e1', 'e2'],
    );
    expect([...byDay]).toEqual([
      ['2026-11-10', 16],
      ['2026-11-12', 6],
    ]);
  });
});

describe('Столбики «Действия по дням» (прототип actBuckets, actChart)', () => {
  const byDay = new Map([
    ['2026-11-09', 10],
    ['2026-11-12', 7],
    ['2026-11-13', 99],
    ['2026-03-05', 4],
    ['2026-03-20', 6],
  ]);

  it('за день графика нет', () => {
    expect(activityBuckets({ k: 'd', off: 0 }, { from: TODAY, to: TODAY }, TODAY, byDay)).toEqual(
      [],
    );
  });

  it('неделя — семь дней, дни после сегодняшнего — ноль', () => {
    const p = { k: 'w', off: 0 } as const;
    const b = activityBuckets(p, activityRange(p, TODAY), TODAY, byDay);
    expect(b.map((x) => x.key)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(b.map((x) => x.value)).toEqual([10, 0, 0, 7, 0, 0, 0]);
  });

  it('месяц — все дни месяца', () => {
    const p = { k: 'm', off: 0 } as const;
    const b = activityBuckets(p, activityRange(p, TODAY), TODAY, byDay);
    expect(b).toHaveLength(30);
    expect(b[8]).toEqual({ key: '2026-11-09', value: 10 });
  });

  it('год — двенадцать месяцев с суммой действий', () => {
    const p = { k: 'y', off: 0 } as const;
    const b = activityBuckets(p, activityRange(p, TODAY), TODAY, byDay);
    expect(b).toHaveLength(12);
    expect(b[2]).toEqual({ key: '2026-03', value: 10 });
    expect(b[10]).toEqual({ key: '2026-11', value: 17 });
    expect(b[11]).toEqual({ key: '2026-12', value: 0 });
  });

  it('подписи дней: в коротком периоде — у каждого, в месяце — у каждого пятого и последнего', () => {
    expect([0, 1, 6].map((i) => activityBucketLabeled(i, 7))).toEqual([true, true, true]);
    expect([0, 1, 4, 5, 10, 28, 29].map((i) => activityBucketLabeled(i, 30))).toEqual([
      true,
      false,
      false,
      true,
      true,
      false,
      true,
    ]);
  });

  it('высота столбика: ноль — нет, ненулевой — не ниже 2 %, наибольший — 100 %', () => {
    expect(activityBarHeight(0, 50)).toBe(0);
    expect(activityBarHeight(50, 50)).toBe(100);
    expect(activityBarHeight(1, 1000)).toBe(2);
    expect(activityBarHeight(25, 50)).toBe(50);
  });
});
