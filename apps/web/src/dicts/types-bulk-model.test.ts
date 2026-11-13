import { describe, expect, it } from 'vitest';
import {
  bulkNames,
  disconnectPlan,
  EMPTY_BULK_DRAFT,
  setupBody,
  setupCounts,
} from './types-bulk-model';

const row = (code: string, over: Partial<ReturnType<typeof base>> = {}) => ({
  ...base(code),
  ...over,
});
const base = (code: string) => ({
  code,
  shortName: code.toUpperCase(),
  enabled: true,
  assigned: 0,
  act: 'both' as 'both' | 'pay' | 'sub',
});

// Прототип v84 (modules/dicts.js: typesBulkOn, typesBulkDlg).
describe('Массовые изменения видов отчётов: окно и запрос', () => {
  it('подзаголовок — первые шесть кратких названий и «и ещё N»', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((c) => row(c));
    expect(bulkNames(rows)).toEqual({ names: 'A, B, C, D, E, F', more: 2 });
    expect(bulkNames(rows.slice(0, 2))).toEqual({ names: 'A, B', more: 0 });
  });

  it('«Отключить»: подключённые делятся на назначенные контрагентам и остальные', () => {
    const rows = [
      row('nds', { assigned: 3 }),
      row('soc'),
      row('pat', { enabled: false, assigned: 0 }),
    ];
    const plan = disconnectPlan(rows);
    expect(plan.on.map((r) => r.code)).toEqual(['nds', 'soc']);
    expect(plan.busy.map((r) => r.code)).toEqual(['nds']);
    expect(plan.ok.map((r) => r.code)).toEqual(['soc']);
  });

  it('числа окна: неподключённые и «только оплата»', () => {
    expect(
      setupCounts([row('nds'), row('pat', { act: 'pay' }), row('soc', { enabled: false })]),
    ).toEqual({ off: 1, pay: 1 });
  });

  it('«Ничего не выбрано»: всё «Не менять» и подключать нечего или галочка снята', () => {
    const on = [row('nds'), row('soc')];
    const mixed = [row('nds'), row('soc', { enabled: false })];
    expect(setupBody(on, EMPTY_BULK_DRAFT)).toBeNull();
    expect(setupBody(mixed, { ...EMPTY_BULK_DRAFT, connect: false })).toBeNull();
    // Есть неподключённые и галочка стоит — подключение само по себе изменение.
    expect(setupBody(mixed, EMPTY_BULK_DRAFT)).toEqual({
      action: 'setup',
      codes: ['nds', 'soc'],
      connect: true,
    });
  });

  it('запрос: «Не менять» не отправляется, дни — без повторов от большего к меньшему', () => {
    expect(
      setupBody([row('nds'), row('soc')], {
        file: '1',
        receipt: '0',
        days: [3, 10, 3],
        connect: true,
      }),
    ).toEqual({
      action: 'setup',
      codes: ['nds', 'soc'],
      needFile: true,
      needReceipt: false,
      remindDays: [10, 3],
      connect: false,
    });
    // Пустой набор дней — только в день срока: это тоже изменение.
    expect(setupBody([row('nds')], { ...EMPTY_BULK_DRAFT, days: [] })).toEqual({
      action: 'setup',
      codes: ['nds'],
      remindDays: [],
      connect: false,
    });
  });
});
