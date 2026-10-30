import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/service.json';
import {
  archivePeriods,
  cancelPlannedPause,
  initialPeriods,
  inService,
  notRequiredOnArchive,
  pause,
  periodsText,
  plannedPause,
  plannedResume,
  reportAfterServiceChange,
  restoredOnFill,
  resume,
  rollbackPause,
  servedWithin,
  serviceMenu,
  serviceState,
  skippedMonths,
  toRegularPeriods,
  unarchivePeriods,
  type ServicePeriod,
  type ServiceReport,
  type ServiceSubject,
} from './service';

interface Case {
  today: string;
  subject: ServiceSubject;
  inService: boolean;
  text: string;
  planned: { from: string; resume: string | null } | null;
  ops: {
    pause?: { from: string; resume: string | null; periods: ServicePeriod[] };
    resume?: { from: string; periods: ServicePeriod[] };
    cancel?: ServicePeriod[] | null;
    skipped?: string[];
    rollback?: ServicePeriod[];
    archive?: ServicePeriod[];
    toRegular?: { from: string; periods: ServicePeriod[] };
    unarchive: ServicePeriod[];
  };
}

const cases = fixture.cases as Case[];
const P = (from: string, to: string | null = null): ServicePeriod => ({ from, to });
const S = (periods: ServicePeriod[], extra: Partial<ServiceSubject> = {}): ServiceSubject => ({
  archived: false,
  oneOff: false,
  periods,
  ...extra,
});

describe('обслуживание: эталон прототипа', () => {
  it('наборов достаточно: демо, цепочки действий, три даты', () => {
    expect(cases.length).toBeGreaterThan(150);
    expect(cases.filter((c) => c.planned).length).toBeGreaterThan(10);
    expect(cases.filter((c) => !c.inService && !c.subject.archived).length).toBeGreaterThan(10);
  });

  it.each(cases.map((c, i) => [i, c] as const))('набор %i', (_, c) => {
    const month = c.today.slice(0, 7);
    const { subject: s, ops } = c;
    expect(inService(s.periods, month)).toBe(c.inService);
    expect(periodsText(s.periods)).toBe(c.text);
    expect(plannedPause(s, month)).toEqual(c.planned);
    expect(unarchivePeriods(s.periods, s.oneOff, month)).toEqual(ops.unarchive);
    if (s.archived || s.oneOff) return;

    const menu = serviceMenu(s, month);
    const paused = pause(s.periods, ops.pause!.from, ops.pause!.resume, month);
    if (menu.pause) expect(paused).toEqual({ ok: true, periods: ops.pause!.periods });
    else expect(paused.ok).toBe(false);

    const resumed = resume(s.periods, ops.resume!.from, month);
    if (menu.resume || menu.changeResume) {
      expect(resumed).toEqual({ ok: true, periods: ops.resume!.periods });
    } else expect(resumed).toEqual({ ok: false, code: 'service_not_paused' });

    const cancelled = cancelPlannedPause(s, month);
    expect(menu.cancelPause).toBe(ops.cancel !== null);
    if (ops.cancel) expect(cancelled).toEqual({ ok: true, periods: ops.cancel });
    else expect(cancelled).toEqual({ ok: false, code: 'service_no_planned_pause' });

    const rolled = rollbackPause(s.periods, month);
    if (menu.rollback) {
      expect(rolled).toEqual({ ok: true, periods: ops.rollback });
      // ОТКЛОНЕНИЕ: docs/deviations.md#В-10 — при запланированном возобновлении прототип предлагает
      // только идущий месяц; по ТЗ — все пропущенные с начала приостановки.
      if (plannedResume(s, month) === null)
        expect(skippedMonths(s.periods, month)).toEqual(ops.skipped);
    } else if (!c.inService) expect(menu.cancelPause).toBe(true);
    else expect(rolled).toEqual({ ok: false, code: 'service_not_paused' });

    // У прототипа запланированное возобновление остаётся периодом с концом раньше начала.
    const last = s.periods[s.periods.length - 1];
    if (!(last && last.from > month)) expect(archivePeriods(s.periods, month)).toEqual(ops.archive);

    expect(toRegularPeriods(s.periods, ops.toRegular!.from, month)).toEqual({
      ok: true,
      periods: ops.toRegular!.periods,
    });
  });

  it.each(fixture.reports.map((r, i) => [i, r] as const))('отчёты, набор %i', (_, set) => {
    const c = { archived: set.archived, periods: set.periods as ServicePeriod[] };
    for (const r of set.reports) {
      const report = { ...r, last: r.month, byService: true } as ServiceReport;
      const next = reportAfterServiceChange(report, c, set.today);
      expect(
        next === 'not_required' ? 'not_required' : next === 'to_submit' ? 'open' : r.status,
      ).toBe(r.applied);
      expect(notRequiredOnArchive(report, c.periods, set.today) ? 'not_required' : r.status).toBe(
        r.onArchive,
      );
    }
  });
});

describe('обслуживание: правила', () => {
  const M = '2026-10';

  it('статус: архив, разовый, обслуживается, приостановлен', () => {
    expect(serviceState(S([P('2026-01')], { archived: true }), M)).toBe('archived');
    expect(serviceState(S([], { oneOff: true }), M)).toBe('active');
    expect(serviceState(S([P('2026-01')]), M)).toBe('active');
    expect(serviceState(S([P('2026-01', '2026-09')]), M)).toBe('paused');
    expect(serviceState(S([P('2026-01', '2026-10')]), M)).toBe('active');
    expect(serviceState(S([]), M)).toBe('paused');
  });

  it('новый контрагент: постоянный — с месяца начала, разовый — без периодов', () => {
    expect(initialPeriods(false, '2026-10-22')).toEqual([P('2026-10')]);
    expect(initialPeriods(true, '2026-10-22')).toEqual([]);
  });

  it('«Приостановить»: проверки окна (прототип pauseDlg)', () => {
    const ps = [P('2026-01')];
    expect(pause(ps, '2026-09', null, M)).toEqual({ ok: false, code: 'service_month_in_past' });
    expect(pause(ps, '2026-11', '2026-11', M)).toEqual({
      ok: false,
      code: 'service_resume_before_pause',
    });
    expect(pause(ps, '2026-11', '2027-05', M)).toEqual({
      ok: true,
      periods: [P('2026-01', '2026-10'), P('2027-05')],
    });
    // С первого месяца обслуживания — периода не остаётся.
    expect(pause([P('2026-10')], '2026-10', null, M)).toEqual({ ok: true, periods: [] });
    expect(pause([P('2026-01', '2026-11')], '2026-12', null, M)).toEqual({
      ok: false,
      code: 'service_already_paused',
    });
    expect(pause([], '2026-11', null, M)).toEqual({ ok: false, code: 'service_already_paused' });
  });

  it('«Возобновить»: переносит запланированное, продолжает прежний период', () => {
    expect(resume([P('2026-01', '2026-07')], '2026-09', M)).toEqual({
      ok: false,
      code: 'service_month_in_past',
    });
    expect(resume([P('2026-01', '2026-07')], '2027-05', M)).toEqual({
      ok: true,
      periods: [P('2026-01', '2026-07'), P('2027-05')],
    });
    expect(resume([P('2026-01', '2026-07'), P('2027-05')], '2026-11', M)).toEqual({
      ok: true,
      periods: [P('2026-01', '2026-07'), P('2026-11')],
    });
    // Запланированная приостановка с декабря и возобновление — в ноябре: перерыва нет.
    expect(resume([P('2026-01', '2026-11'), P('2027-05')], '2026-11', M)).toEqual({
      ok: true,
      periods: [P('2026-01')],
    });
    expect(resume([P('2026-01', '2026-11')], '2027-01', M)).toEqual({
      ok: false,
      code: 'service_not_paused',
    });
    expect(resume([], '2026-10', M)).toEqual({ ok: true, periods: [P('2026-10')] });
  });

  it('запланированная приостановка и возобновление (прототип planPause, svcPlanNote)', () => {
    const c = S([P('2026-01', '2026-11'), P('2027-05')]);
    expect(plannedPause(c, M)).toEqual({ from: '2026-12', resume: '2027-05' });
    expect(plannedResume(c, M)).toBeNull();
    expect(plannedPause({ ...c, archived: true }, M)).toBeNull();
    const paused = S([P('2026-01', '2026-07'), P('2027-05')]);
    expect(plannedPause(paused, M)).toBeNull();
    expect(plannedResume(paused, M)).toBe('2027-05');
    expect(plannedResume(S([P('2026-01', '2026-07')]), M)).toBeNull();
  });

  it('меню: пункты как в прототипе cpActions', () => {
    expect(serviceMenu(S([P('2026-01')]), M)).toMatchObject({
      pause: true,
      resume: false,
      rollback: false,
    });
    expect(serviceMenu(S([P('2026-01', '2026-11'), P('2027-05')]), M)).toMatchObject({
      cancelPause: true,
      changeResume: '2027-05',
      pause: false,
      resume: false,
      rollback: false,
    });
    expect(serviceMenu(S([P('2026-01', '2026-07')]), M)).toMatchObject({
      resume: true,
      rollback: true,
    });
    expect(serviceMenu(S([], { oneOff: true }), M)).toMatchObject({
      toRegular: true,
      archive: true,
      pause: false,
    });
    expect(serviceMenu(S([P('2026-01', '2026-09')], { archived: true }), M)).toEqual({
      toRegular: false,
      cancelPause: false,
      changeResume: null,
      pause: false,
      resume: false,
      rollback: false,
      archive: false,
      unarchive: true,
    });
  });

  it('откат приостановки: пропущенные месяцы с её начала', () => {
    expect(skippedMonths([P('2026-01', '2026-07')], M)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(skippedMonths([P('2026-01', '2026-07'), P('2027-05')], M)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(skippedMonths([], M)).toEqual(['2026-10']);
    expect(skippedMonths([P('2026-01')], M)).toEqual([]);
    expect(rollbackPause([P('2026-01', '2026-07'), P('2027-05')], M)).toEqual({
      ok: true,
      periods: [P('2026-01')],
    });
    expect(rollbackPause([], M)).toEqual({ ok: true, periods: [P('2026-10')] });
    expect(rollbackPause([P('2027-05')], M)).toEqual({ ok: true, periods: [P('2026-10')] });
  });

  it('«В архив»: конец — идущий месяц, запланированное возобновление отменяется', () => {
    expect(archivePeriods([P('2026-01')], M)).toEqual([P('2026-01', '2026-10')]);
    expect(archivePeriods([P('2026-01', '2026-12')], M)).toEqual([P('2026-01', '2026-10')]);
    expect(archivePeriods([P('2026-01', '2026-07')], M)).toEqual([P('2026-01', '2026-07')]);
    expect(archivePeriods([P('2026-01', '2026-07'), P('2027-05')], M)).toEqual([
      P('2026-01', '2026-07'),
    ]);
    expect(archivePeriods([P('2027-05')], M)).toEqual([]);
    expect(archivePeriods([], M)).toEqual([]);
  });

  it('возврат из архива и перевод в постоянное', () => {
    expect(unarchivePeriods([P('2026-01', '2026-07')], false, M)).toEqual([
      P('2026-01', '2026-07'),
      P('2026-10'),
    ]);
    expect(unarchivePeriods([P('2026-01', '2026-10')], false, M)).toEqual([P('2026-01')]);
    expect(unarchivePeriods([], true, M)).toEqual([]);
    expect(toRegularPeriods([], '2026-09', M)).toEqual({
      ok: false,
      code: 'service_month_in_past',
    });
    expect(toRegularPeriods([], '2026-11', M)).toEqual({ ok: true, periods: [P('2026-11')] });
    expect(toRegularPeriods([P('2026-04')], '2026-10', M)).toEqual({
      ok: true,
      periods: [P('2026-04', '2026-09'), P('2026-10')],
    });
    expect(toRegularPeriods([P('2026-11')], '2026-10', M)).toEqual({
      ok: true,
      periods: [P('2026-10')],
    });
  });

  it('отчёты: «Не требуется», поставленное вручную, не возвращается', () => {
    const r: ServiceReport = {
      month: '2026-10',
      last: '2026-10',
      due: '2026-11-20',
      status: 'not_required',
      submitted: false,
      assigned: true,
      byService: true,
    };
    const c = { archived: false, periods: [P('2026-01')] };
    expect(reportAfterServiceChange(r, c, '2026-10-30')).toBe('to_submit');
    expect(reportAfterServiceChange({ ...r, byService: false }, c, '2026-10-30')).toBeNull();
    expect(reportAfterServiceChange(r, { ...c, archived: true }, '2026-10-30')).toBeNull();
    expect(reportAfterServiceChange({ ...r, due: '2026-10-29' }, c, '2026-10-30')).toBeNull();
    expect(
      reportAfterServiceChange(
        { ...r, status: 'open' },
        { archived: false, periods: [P('2026-01', '2026-09')] },
        '2026-10-30',
      ),
    ).toBe('not_required');
  });

  it('квартал и год: период обслуживается, если обслуживается хотя бы один его месяц (п. В-11)', () => {
    expect(servedWithin([P('2026-03')], '2026-01', '2026-12')).toBe(true);
    expect(servedWithin([P('2026-01', '2026-02')], '2026-04', '2026-06')).toBe(false);
    expect(servedWithin([P('2026-01', '2026-10')], '2026-10', '2026-12')).toBe(true);
    const year: ServiceReport = {
      month: '2026-01',
      last: '2026-12',
      due: '2027-03-31',
      status: 'open',
      submitted: false,
      assigned: true,
      byService: false,
    };
    // Обслуживается с марта и приостановлен с ноября: годовой за 2026 остаётся к сдаче.
    const c = { archived: false, periods: [P('2026-03', '2026-10')] };
    expect(reportAfterServiceChange(year, c, '2026-10-30')).toBeNull();
    expect(notRequiredOnArchive(year, c.periods, '2026-10-30')).toBe(false);
    // Квартал целиком в паузе — «Не требуется».
    const q4 = { ...year, month: '2026-10', last: '2026-12', due: '2027-01-20' };
    expect(
      reportAfterServiceChange(
        q4,
        { archived: false, periods: [P('2026-01', '2026-09')] },
        '2026-10-30',
      ),
    ).toBe('not_required');
    expect(restoredOnFill({ ...q4, status: 'not_required', byService: true }, ['2026-11'])).toBe(
      true,
    );
  });

  it('досоздать за пропущенный месяц: «Не требуется» от приостановки снова «К сдаче»', () => {
    const r = {
      month: '2026-08',
      last: '2026-08',
      status: 'not_required' as const,
      submitted: false,
      assigned: true,
      byService: true,
    };
    expect(restoredOnFill(r, ['2026-08', '2026-09'])).toBe(true);
    expect(restoredOnFill(r, ['2026-09'])).toBe(false);
    expect(restoredOnFill({ ...r, byService: false }, ['2026-08'])).toBe(false);
    expect(restoredOnFill({ ...r, assigned: false }, ['2026-08'])).toBe(false);
    expect(restoredOnFill({ ...r, submitted: true }, ['2026-08'])).toBe(false);
  });
});
