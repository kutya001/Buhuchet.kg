import { describe, expect, it } from 'vitest';
import { STATUS_TEXTS } from '../l10n/status-texts';
import { formatText, UI_TEXTS } from '../l10n/texts';
import fixture from './__fixtures__/status-scales.json';
import {
  durationParts,
  durationText,
  isNoScale,
  isScaleStatus,
  rollbackRefusal,
  scaleBack,
  scaleNext,
  scalePosition,
  scaleStatuses,
  scaleSteps,
  scaleTextKey,
  STATUS_SCALE_DEFS,
  STATUS_SCALES,
  STATUS_TONES,
  statusDurations,
  statusLook,
  statusTextKey,
  statusTotals,
  type StatusScaleKey,
} from './status';

// Прототип хранит статусы названиями, продукт — кодами: перевод — по названиям словаря `status.*`.
function codeOf(scale: StatusScaleKey, name: string): string {
  const code = scaleStatuses(scale).find((s) => UI_TEXTS[statusTextKey(scale, s)]?.ru === name);
  if (!code) throw new Error(`${scale}: нет статуса «${name}»`);
  return code;
}
const nameOf = (scale: StatusScaleKey, code: string) => UI_TEXTS[statusTextKey(scale, code)].ru;

describe('шкалы статусов — как в прототипе (status-scale.js)', () => {
  it('у каждого статуса шкалы есть название в словаре и только один код на название', () => {
    for (const scale of STATUS_SCALES) {
      const names = scaleStatuses(scale).map((s) => nameOf(scale, s));
      expect(new Set(names).size).toBe(names.length);
      expect(UI_TEXTS[scaleTextKey(scale)]).toBeDefined();
      for (const s of scaleStatuses(scale)) {
        expect(STATUS_TONES).toContain(statusLook(scale, s).tone);
      }
    }
    // Ключи `status.<шкала>.<код>` — только для статусов шкал (лишних нет).
    const keys = Object.keys(STATUS_TEXTS).filter((k) =>
      STATUS_SCALES.some((s) => k.startsWith(`status.${s}.`)),
    );
    expect(keys.length).toBe(STATUS_SCALES.reduce((n, s) => n + scaleStatuses(s).length, 0));
  });

  it('шаг, шаги и боковой статус (scPos) — у всех статусов справочника', () => {
    for (const [scale, name, confirm, want] of fixture.position as [
      StatusScaleKey,
      string,
      boolean,
      { index: number; steps: string[]; side: string | null } | null,
    ][]) {
      const got = scalePosition(scale, codeOf(scale, name), { confirm });
      const expected = want && {
        index: want.index,
        steps: want.steps.map((s) => codeOf(scale, s)),
        side: want.side,
      };
      expect([scale, name, confirm, got && { ...got, side: got.side?.tone ?? null }]).toEqual([
        scale,
        name,
        confirm,
        expected,
      ]);
    }
    expect(fixture.position.length).toBeGreaterThan(30);
  });

  it('следующие шаги (scNext)', () => {
    for (const [scale, name, confirm, want] of fixture.next as [
      StatusScaleKey,
      string,
      boolean,
      string[],
    ][]) {
      expect([scale, name, confirm, scaleNext(scale, codeOf(scale, name), { confirm })]).toEqual([
        scale,
        name,
        confirm,
        want.map((s) => codeOf(scale, s)),
      ]);
    }
  });

  it('откат на один шаг (scBack): отчёт с подтверждённой сдачей и без, оплата — по остатку после отмены', () => {
    for (const [scale, name, options, want] of fixture.back as [
      StatusScaleKey,
      string,
      { confirmed?: boolean; paidRest?: number | null },
      string | null,
    ][]) {
      expect([scale, name, options, scaleBack(scale, codeOf(scale, name), options)]).toEqual([
        scale,
        name,
        options,
        want === null ? null : codeOf(scale, want),
      ]);
    }
  });

  it('длительность словами (durTxt): меньше часа, часы, дни с формой числа', () => {
    for (const [ms, want] of fixture.durations as [number, string][]) {
      const { key, n } = durationText(ms);
      expect([ms, formatText(UI_TEXTS[key].ru, { n })]).toEqual([ms, want]);
    }
  });
});

describe('шкала — мелочи', () => {
  it('задача с подтверждением: шкала из 4 шагов, если включено или статус только из неё', () => {
    expect(scaleSteps('task', 'todo')).toEqual(['todo', 'in_progress', 'done']);
    expect(scaleSteps('task', 'todo', { confirm: true })).toHaveLength(4);
    expect(scaleSteps('task', 'on_confirm')).toHaveLength(4);
    expect(scaleSteps('task', null)).toHaveLength(3);
    expect(scaleSteps('report', 'todo', { confirm: true })).toEqual(STATUS_SCALE_DEFS.report.steps);
    expect(scaleNext('task', 'in_progress', { confirm: true })).toEqual(['on_confirm']);
  });

  it('«Не требуется» — шкала не ведётся; неизвестный статус — серый кружок и вне шкалы', () => {
    expect(isNoScale('report', 'not_required')).toBe(true);
    expect(isNoScale('payment', 'not_required')).toBe(true);
    expect(isNoScale('report', 'todo')).toBe(false);
    expect(isNoScale('service', 'archived')).toBe(false);
    expect(isScaleStatus('report', 'paid')).toBe(false);
    expect(isScaleStatus('report', 'toString')).toBe(false);
    expect(statusLook('report', 'paid')).toEqual({ tone: 'gray', icon: 'circle' });
    expect(scalePosition('report', 'paid')).toBeNull();
    expect(scalePosition('task', 'cancelled', { confirm: true })).toEqual({
      index: 3,
      steps: STATUS_SCALE_DEFS.task.stepsConfirm,
      side: { at: -1, tone: 'faint' },
    });
  });
});

describe('rollbackRefusal — откат только с правом, на шаг назад и с причиной', () => {
  const ok = { canRollback: true, back: 'in_progress', to: 'in_progress', reason: 'по ошибке' };

  it('всё есть — можно', () => {
    expect(rollbackRefusal(ok)).toBeNull();
  });

  it('нет права «Откат статусов» — нельзя, даже с причиной', () => {
    expect(rollbackRefusal({ ...ok, canRollback: false })).toBe('no_right');
  });

  it('не на предыдущий шаг или откатывать некуда — нельзя', () => {
    expect(rollbackRefusal({ ...ok, to: 'todo' })).toBe('not_back_step');
    expect(rollbackRefusal({ ...ok, back: null })).toBe('not_back_step');
  });

  it('причина пустая или из пробелов — нельзя', () => {
    expect(rollbackRefusal({ ...ok, reason: '' })).toBe('reason_required');
    expect(rollbackRefusal({ ...ok, reason: ' \n ' })).toBe('reason_required');
  });
});

describe('время в статусе', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 20, h));
  const history = [
    { at: at(0), to: 'todo' },
    { at: at(5), to: 'in_progress' },
    { at: at(8), to: 'todo' },
    { at: at(9), to: 'in_progress' },
  ];

  it('до следующей смены, у последней — до «сейчас»; время назад — 0', () => {
    expect(statusDurations(history, at(12))).toEqual([5, 3, 1, 3].map((h) => h * 3_600_000));
    expect(statusDurations(history, at(7)).at(-1)).toBe(0);
    expect(statusDurations([], at(1))).toEqual([]);
  });

  it('итог по статусам — по порядку появления', () => {
    expect(statusTotals(history, at(12))).toEqual([
      { status: 'todo', ms: 6 * 3_600_000 },
      { status: 'in_progress', ms: 6 * 3_600_000 },
    ]);
  });

  it('части длительности', () => {
    expect(durationParts(-1)).toEqual({ unit: 'lt_hour' });
    expect(durationParts(2 * 3_600_000)).toEqual({ unit: 'hours', n: 2 });
    expect(durationParts(50 * 3_600_000)).toEqual({ unit: 'days', n: 2 });
  });
});
