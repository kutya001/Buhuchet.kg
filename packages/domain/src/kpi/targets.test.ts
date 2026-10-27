import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/kpi.json';
import {
  indicatorOn,
  indicatorStart,
  type KpiContractor,
  type KpiIndicator,
  type KpiTarget,
} from './fill';
import { applyWho, reenableMonth, toggleTarget, whoAutoNew } from './targets';

// Эталон — прототип (scripts/oracle-kpi.mjs): kSetOn и kWhoApply на показателях demoDB.json. Строка
// эталона: контрагент | вёлся до (пусто — показатель новый) | ведётся после | «с <месяц>» |
// «Не ведётся с <месяц>» | свой «с <месяц>» | поставлен ли он сейчас.
// Решение заказчика 27.10.2026 (docs/deviations.md п. В-3): включённому снова прототип ставит «с <месяц>» текущего месяца
// заполнения (прошлый календарный), продукт по ТЗ — текущий месяц: там, где прототип ставит месяц
// сейчас, ожидается `reenableMonth`.
const demo = fixture.datasets[0]!;
const today = fixture.who.today;
const contractors = (demo.contractors as KpiContractor[]).filter((c) => !c.oneOff);

function targetsOf(indicatorId: string) {
  return new Map(
    demo.targets
      .filter((t) => t.indicatorId === indicatorId)
      .map((t) => [t.contractorId, { on: t.on, from: t.from, offSince: t.offSince } as KpiTarget]),
  );
}

function expectRows(
  indicator: KpiIndicator,
  targets: Map<string, KpiTarget>,
  before: (id: string) => boolean | null,
  rows: string[],
) {
  const got = contractors.map((c) => {
    const t = targets.get(c.id);
    const on = indicatorOn(indicator, t);
    const b = before(c.id);
    return [
      c.id,
      b === null ? '' : b ? 1 : 0,
      on ? 1 : 0,
      indicatorStart(indicator, t, c),
      !on && t?.offSince ? t.offSince : '',
      t?.from ?? '',
    ].join('|');
  });
  const expected = rows.map((r) => {
    const [id, b, on, start, off, from, set] = r.split('|');
    // Месяц, поставленный сейчас, — по ТЗ текущий, а не прошлый.
    const now = set === '1' ? reenableMonth(today) : null;
    return [id, b, on, now && start === from ? now : start, off, now ?? from].join('|');
  });
  expect(got).toEqual(expected);
}

describe('«Кому вести» — как в прототипе', () => {
  const toggles = fixture.who.cases.filter((c) => c.kind === 'toggle');
  it.each(toggles)('$ind у контрагента $cp: «Вести» = $on', (w) => {
    const indicator = demo.indicators.find((i) => i.id === w.ind) as KpiIndicator;
    const targets = targetsOf(w.ind);
    const before = (id: string) => indicatorOn(indicator, targets.get(id));
    const was = new Map(contractors.map((c) => [c.id, before(c.id)]));
    const next = toggleTarget(indicator, targets.get(w.cp!), w.on!, today);
    expect(next !== null).toBe(w.expected.changed);
    if (next) targets.set(w.cp!, next);
    expectRows(indicator, targets, (id) => was.get(id)!, w.expected.rows);
  });

  const saves = fixture.who.cases.filter((c) => c.kind === 'who');
  it.each(saves)('окно показателя $ind: $scope, отмечены [$sel]', (w) => {
    const previous =
      (demo.indicators.find((i) => i.id === w.ind) as KpiIndicator | undefined) ?? null;
    const scope = w.scope === 'sel' ? 'selected' : 'all';
    const targets = previous ? targetsOf(w.ind) : new Map<string, KpiTarget>();
    const changes = applyWho(
      previous,
      scope,
      new Set(w.sel),
      contractors,
      (id) => targets.get(id),
      today,
    );
    const was = new Map(changes.map((c) => [c.contractorId, c.before]));
    for (const c of changes) {
      if (c.target) targets.set(c.contractorId, c.target);
      else targets.delete(c.contractorId);
    }
    const autoNew = whoAutoNew(scope, w.autoNew!);
    expect(autoNew).toBe(w.expected.autoNew);
    const indicator = {
      ...(previous ?? (fixture.who.newIndicator as KpiIndicator)),
      scope,
      autoNew,
    } as KpiIndicator;
    expectRows(indicator, targets, (id) => was.get(id)!, w.expected.rows);
    for (const c of changes)
      expect(c.after).toBe(indicatorOn(indicator, targets.get(c.contractorId)));
  });
});

describe('«Кому вести» — правила ТЗ', () => {
  const all = { scope: 'all' as const, autoNew: true };
  const sel = { scope: 'selected' as const, autoNew: false };

  it('включённый снова требуется с текущего месяца; выключение оставляет свой «с <месяц>»', () => {
    expect(
      toggleTarget(all, { on: false, from: '2025-01', offSince: '2026-03' }, true, '2026-10-18'),
    ).toEqual({
      on: true,
      from: '2026-10',
      offSince: null,
    });
    expect(
      toggleTarget(all, { on: true, from: '2025-01', offSince: null }, false, '2026-10-18'),
    ).toEqual({
      on: false,
      from: '2025-01',
      offSince: '2026-10',
    });
    expect(toggleTarget(all, undefined, true, '2026-10-18')).toBeNull();
    expect(toggleTarget(sel, undefined, false, '2026-10-18')).toBeNull();
  });

  it('при «Всем контрагентам» новые включаются всегда', () => {
    expect(whoAutoNew('all', false)).toBe(true);
    expect(whoAutoNew('selected', false)).toBe(false);
    expect(whoAutoNew('selected', true)).toBe(true);
  });

  it('«Всем» без выключенных и своих месяцев — записей нет', () => {
    const changes = applyWho(
      null,
      'all',
      new Set(),
      [{ id: '1' }, { id: '2' }],
      () => undefined,
      '2026-10-18',
    );
    expect(changes).toEqual([
      { contractorId: '1', before: null, after: true, target: null },
      { contractorId: '2', before: null, after: true, target: null },
    ]);
  });

  it('«Выбранным» — запись у каждого: отмеченный ведётся, остальные нет', () => {
    const changes = applyWho(
      null,
      'selected',
      new Set(['2']),
      [{ id: '1' }, { id: '2' }],
      () => undefined,
      '2026-10-18',
    );
    expect(changes.map((c) => [c.contractorId, c.target])).toEqual([
      ['1', { on: false, from: null, offSince: null }],
      ['2', { on: true, from: null, offSince: null }],
    ]);
  });

  it('контрагенты вне области сотрудника не меняются — и при переходе «Выбранным» → «Всем»', () => {
    const previous = { scope: 'selected' as const, autoNew: false };
    const off = { on: false, from: null, offSince: '2026-05' };
    const changes = applyWho(
      previous,
      'all',
      new Set(),
      [{ id: 'own' }, { id: 'other' }],
      () => off,
      '2026-10-18',
      new Set(['other']),
    );
    expect(changes.map((c) => [c.contractorId, c.before, c.after, c.target])).toEqual([
      ['own', false, true, { on: true, from: '2026-10', offSince: null }],
      ['other', false, false, { on: false, from: null, offSince: '2026-05' }],
    ]);
  });
});
