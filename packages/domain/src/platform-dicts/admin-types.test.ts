import { describe, expect, it } from 'vitest';
import { payScheduleText } from '../dicts/report-types';
import { ADMIN_DICT_META, nextDictCode } from './admin';
import {
  gnsCheckState,
  inactiveLinks,
  NEW_REPORT_TYPE,
  parsePaySchedule,
  REPORT_TYPE_FIELDS,
  REPORT_TYPE_RULE_FIELDS,
  reportTypeProblems,
} from './admin-types';

describe('Админка → «Виды отчётов»: окно вида отчёта', () => {
  it('новый вид — с постоянным ключом, как основание; поля окна — в порядке прототипа', () => {
    expect(nextDictCode('types', ['nds', 'type-a1'], () => 'k3x9')).toBe('type-k3x9');
    expect(ADMIN_DICT_META.types.fields).toBe(REPORT_TYPE_FIELDS);
    expect(ADMIN_DICT_META.types.links).toEqual(['regimes', 'notForRegimes', 'bases']);
    expect(ADMIN_DICT_META.types.required).toEqual(['shortName', 'authorityCode', 'act']);
    expect(REPORT_TYPE_FIELDS.slice(0, 4)).toEqual([
      'name',
      'shortName',
      'formCode',
      'authorityCode',
    ]);
    // Правило срока сдачи — без срока оплаты: его правка сроки отчётов не пересчитывает (прототип ruleCh).
    expect(REPORT_TYPE_RULE_FIELDS).not.toContain('payDay');
  });

  it('значения нового вида — как в прототипе: месячный, 20-е число следующего месяца, по желанию', () => {
    expect(NEW_REPORT_TYPE).toMatchObject({
      period: 'M',
      dueDay: 20,
      dueAfter: 1,
      dueMonth: 4,
      kind: 'cross',
      payer: 'all',
      pickGroup: 'optional',
      shiftToWorkday: true,
    });
  });

  it('«График оплаты»: ДД.ММ через точку с запятой или запятую; ошибка формата — null', () => {
    expect(parsePaySchedule('')).toEqual([]);
    expect(parsePaySchedule(' 20.03; 20.06 ,20.09;20.12 ')).toEqual([
      [3, 20],
      [6, 20],
      [9, 20],
      [12, 20],
    ]);
    expect(parsePaySchedule('1.1')).toEqual([[1, 1]]);
    expect(parsePaySchedule('20/03')).toBeNull();
    expect(parsePaySchedule('32.01')).toBeNull();
    expect(parsePaySchedule('20.13')).toBeNull();
    expect(parsePaySchedule('0.05')).toBeNull();
    expect(parsePaySchedule(Array.from({ length: 13 }, () => '01.01').join('; '))).toBeNull();
    // Строка из графика читается обратно тем же графиком (прототип instTxt ↔ instIn).
    const schedule: [number, number][] = [
      [3, 20],
      [12, 5],
    ];
    expect(parsePaySchedule(payScheduleText(schedule))).toEqual(schedule);
  });

  it('проверки окна: режимный — с режимом, вид с уплатой — с платежом с названием', () => {
    const ok = { kind: 'cross', regimes: [], act: 'sub', payments: [] } as const;
    expect(reportTypeProblems(ok)).toEqual([]);
    expect(reportTypeProblems({ ...ok, kind: 'regime' })).toEqual([
      { field: 'regimes', problem: 'regimes_required' },
    ]);
    expect(reportTypeProblems({ ...ok, kind: 'regime', regimes: ['РЕЖ-01'] })).toEqual([]);
    expect(reportTypeProblems({ ...ok, act: 'pay' })).toEqual([
      { field: 'payments', problem: 'payments_required' },
    ]);
    expect(reportTypeProblems({ ...ok, act: 'both', payments: [{ name: ' ' }] })).toEqual([
      { field: 'payments', problem: 'payments_required' },
    ]);
    expect(reportTypeProblems({ ...ok, act: 'both', payments: [{ name: 'НДС' }] })).toEqual([]);
  });

  it('выбранные значения — действующие; уже выбранное остаётся, неизвестное — нельзя', () => {
    const list = [
      { code: 'a', active: true },
      { code: 'b', active: false },
    ];
    expect(inactiveLinks(['a'], list, [])).toEqual([]);
    expect(inactiveLinks(['a', 'b'], list, [])).toEqual(['b']);
    expect(inactiveLinks(['b'], list, ['b'])).toEqual([]);
    expect(inactiveLinks(['x'], list, ['x'])).toEqual(['x']);
  });
});

describe('«Сверено с ГНС» (задача 2.37, часть 3)', () => {
  it('не сверено, старше 180 дней — жёлтым, иначе обычным', () => {
    expect(gnsCheckState(null, '2026-10-30')).toBe('none');
    expect(gnsCheckState('2026-05-03', '2026-10-30')).toBe('fresh');
    expect(gnsCheckState('2026-05-02', '2026-10-30')).toBe('old');
  });
});
