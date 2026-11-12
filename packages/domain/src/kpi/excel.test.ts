import { describe, expect, it } from 'vitest';
import type { YearMonth } from '../common/months';
import oracle from './__fixtures__/kx-month-heads.json';
import {
  excelColumn,
  IMPORT_ERROR_VALUE_MAX_LENGTH,
  IMPORT_ERRORS_KEPT,
  importFileMonths,
  importHead,
  importInn,
  importMonthHead,
  importTemplate,
  importTooMany,
  importWrites,
  KPI_IMPORT_MAX_CELLS,
  KPI_IMPORT_MAX_LINES,
  KPI_IMPORT_MAX_MONTHS,
  parseImportHead,
  parseImportMonth,
  planImport,
  type ImportCellValue,
  type ImportIndicator,
  type ImportLookup,
} from './excel';
import type { KpiBook, KpiContractor, KpiTarget } from './fill';
import type { KpiValueOf } from './views';

const indicator = (id: string, name: string, extra: Partial<ImportIndicator> = {}) =>
  ({
    id,
    name,
    type: 'som',
    required: true,
    dueDay: 10,
    start: '2026-01',
    archived: false,
    scope: 'all',
    autoNew: true,
    order: Number(id.slice(1)),
    ...extra,
  }) satisfies ImportIndicator;

const contractor = (id: string, extra: Partial<KpiContractor> = {}): KpiContractor => ({
  id,
  oneOff: false,
  archived: false,
  periods: [{ from: '2025-06', to: null }],
  ...extra,
});

const revenue = indicator('k1', 'Выручка');
const staff = indicator('k2', 'Количество сотрудников', { type: 'int', required: false });
const old = indicator('k3', 'Площадь', { archived: true });
const onr = contractor('c1');
const single = contractor('c2');
const foreign = contractor('c3');

const targets: Record<string, KpiTarget> = {
  'k1|c2': { on: false, from: null, offSince: '2026-08' },
};
// Сотые: 100 000 сом в 08.2026 у c1 (месяц проверен), 5 чел. в 09.2026.
const values: Record<string, number> = {
  'c1|k1|2026-08': 10_000_000,
  'c1|k2|2026-09': 500,
};
const valueOf: KpiValueOf = (c, i, m) => values[`${c}|${i}|${m}`] ?? null;
const book: KpiBook = {
  indicators: [revenue, staff, old],
  target: (i, c) => targets[`${i}|${c}`],
  hasValue: (c, i, m) => valueOf(c, i, m) !== null,
};
const checked = (c: string, m: YearMonth) => c === 'c1' && m === '2026-08';

const lookup: ImportLookup = {
  book,
  indicators: [revenue, staff, old],
  contractorByInn: (inn) =>
    ({
      '03744097401851': { contractor: onr, editable: true },
      '21503199000123': { contractor: single, editable: true },
      '03744097401852': { contractor: foreign, editable: false },
    })[inn],
  valueOf,
  checked,
  currentMonth: '2026-10',
};

describe('шаблон «Ввода из Excel»', () => {
  it('заголовок столбца и его разбор: месяц из «ММ.ГГГГ», единица в скобках не мешает', () => {
    expect(importHead('Выручка', '2026-09')).toBe('Выручка · 09.2026');
    expect(parseImportHead('Выручка · 09.2026 (сом, сумма в сом)')).toEqual({
      name: 'Выручка',
      month: '2026-09',
    });
    expect(parseImportHead(' Выручка · 09.2026 ')).toEqual({ name: 'Выручка', month: '2026-09' });
    expect(parseImportHead('Выручка · 13.2026')).toBeNull();
    expect(parseImportHead('Выручка 09.2026')).toBeNull();
    // Длинный текст — не заголовок шаблона: выражение его не разбирает (повторы «· ММ.ГГГГ(» были бы
    // для него квадратичными).
    expect(parseImportHead('a · 01.2026('.repeat(30))).toBeNull();
    expect(parseImportHead(`${'a'.repeat(280)} · 09.2026`)).not.toBeNull();
    expect(excelColumn(0)).toBe('A');
    // Пределы шаблона: месяцы, контрагенты, ячейки показателей (строки × месяцы, docs/deviations.md п. В-8).
    expect(importTooMany(24, 1000, 20_000)).toBeNull();
    expect(importTooMany(25, 1, 1)).toBe('months');
    expect(importTooMany(24, 1001, 1)).toBe('contractors');
    expect(importTooMany(1, 1000, 20_001)).toBe('lines');
    expect(importTooMany(24, 1000, 20_000)).toBeNull();
    // 480 000 ячеек при 24 месяцах — те же 20 000 строк; предел ячеек остаётся правилом на случай иного
    // числа месяцев.
    expect(KPI_IMPORT_MAX_LINES * KPI_IMPORT_MAX_MONTHS).toBe(KPI_IMPORT_MAX_CELLS);
    expect(excelColumn(27)).toBe('AB');
  });

  it('(v80) месяц столбца: «янв 2026», «январь 2026», «01.2026», «2026-01», дата Excel — как kxMon', () => {
    expect(importMonthHead('2026-01')).toBe('янв 2026');
    expect(importMonthHead('2026-05')).toBe('май 2026');
    for (const [head, month] of oracle.cases as [string | number | null, string | null][]) {
      expect([head, parseImportMonth(head)]).toEqual([head, month]);
    }
    expect(parseImportMonth(`${'я'.repeat(60)} 2026`)).toBeNull();
  });

  it('(v80) строка — контрагент и показатель; невключённые и будущие — серые; проверенные — помечены', () => {
    const t = importTemplate(
      book,
      [onr, single, contractor('c9', { oneOff: true })],
      new Set(['k1', 'k3']),
      ['2026-08', '2026-09'],
      valueOf,
      checked,
      { current: '2026-10' },
    );
    // Архивный показатель в шаблон не идёт, разовый контрагент — тоже; у c2 «Выручка» выключена с 08.2026.
    expect(t.rows.map((r) => [r.contractor.id, r.indicatorId])).toEqual([['c1', 'k1']]);
    expect(t.contractors).toBe(1);
    expect(t.rows[0]!.cells).toEqual([
      { kind: 'checked', value: 10_000_000 },
      { kind: 'input', value: null },
    ]);
    const both = importTemplate(
      book,
      [onr, single],
      new Set(['k1', 'k2']),
      ['2026-09', '2026-10', '2026-11'],
      valueOf,
      checked,
      { current: '2026-10' },
    );
    expect(both.rows.map((r) => [r.contractor.id, r.indicatorId])).toEqual([
      ['c1', 'k1'],
      ['c1', 'k2'],
      ['c2', 'k2'],
    ]);
    expect(both.contractors).toBe(2);
    // Будущий месяц — серый, как невключённый.
    expect(both.rows[1]!.cells).toEqual([
      { kind: 'input', value: 500 },
      { kind: 'input', value: null },
      { kind: 'off' },
    ]);
  });

  it('(v80) выгрузка «Ввода по месяцам»: и строки с внесёнными значениями, когда показатель уже не ведётся', () => {
    const was: KpiValueOf = (c, i, m) =>
      c === 'c2' && i === 'k1' && m === '2026-08' ? 700 : valueOf(c, i, m);
    const args = [book, [single], new Set(['k1']), ['2026-08', '2026-09'], was, checked] as const;
    expect(importTemplate(...args, { current: '2026-10' }).rows).toEqual([]);
    const out = importTemplate(...args, { current: '2026-10', withValues: true });
    expect(out.rows).toEqual([
      { contractor: single, indicatorId: 'k1', cells: [{ kind: 'off' }, { kind: 'off' }] },
    ]);
  });
});

describe('загрузка заполненного шаблона', () => {
  const head = [
    'ИНН',
    'Контрагент',
    'Выручка · 08.2026 (сом, сумма в сом)',
    'Выручка · 09.2026 (сом, сумма в сом)',
    'Количество сотрудников · 09.2026 (чел., целое число)',
  ];
  const plan = (rows: ImportCellValue[][]) => planImport([head, ...rows], lookup);

  it('новые, изменённые, без изменений; пустая ячейка ничего не стирает; ИНН без ведущего нуля', () => {
    const p = plan([
      [3744097401851, 'ОсОО «Укс»', 120_000, '150 000,50', 5],
      ['21503199000123', 'ИП Асанов', null, null, '  '],
    ]);
    expect(p.errors).toEqual([]);
    expect(p.added.map((x) => [x.ref, x.value])).toEqual([['D2', 15_000_050]]);
    expect(p.changed).toEqual([
      expect.objectContaining({ ref: 'C2', old: 10_000_000, value: 12_000_000, checked: true }),
    ]);
    expect(p.same).toBe(1);
    expect(p.months).toEqual(['2026-08', '2026-09']);
    // Без согласия проверенные не пишутся.
    expect(importWrites(p, false).map((x) => x.ref)).toEqual(['D2']);
    expect(importWrites(p, true).map((x) => x.ref)).toEqual(['D2', 'C2']);
  });

  it('(п. 45) «abc» — «не число» с номером строки; строка с ошибкой не пишется, остальные — да', () => {
    const p = plan([
      ['03744097401851', 'ОсОО «Укс»', null, 'abc', 7],
      ['21503199000123', 'ИП Асанов', null, null, 3],
    ]);
    expect(p.errors).toEqual([
      {
        row: 2,
        col: 3,
        ref: 'D2',
        contractorId: 'c1',
        value: 'abc',
        problem: 'not_number',
      },
    ]);
    expect(p.skipped).toBe(1);
    expect(p.added.map((x) => [x.contractorId, x.indicatorId, x.value])).toEqual([
      ['c2', 'k2', 300],
    ]);
  });

  it('ошибки: неизвестный и чужой контрагент, показатель не ведётся, в архиве, неизвестный, будущий месяц', () => {
    const p = planImport(
      [
        [...head, 'Площадь · 09.2026', 'Прибыль · 09.2026', 'Выручка · 11.2026'],
        ['99999999999999', '', 1],
        ['03744097401852', 'Чужой', 1],
        ['21503199000123', 'ИП Асанов', null, 5],
        ['03744097401851', 'ОсОО «Укс»', null, null, null, 4, null, 9],
      ],
      lookup,
    );
    expect(p.errors.map((e) => [e.ref, e.problem, e.contractorId])).toEqual([
      ['G1', 'unknown_indicator', null],
      ['A2', 'unknown_contractor', null],
      ['A3', 'no_access', null],
      ['D4', 'indicator_off', 'c2'],
      ['F5', 'indicator_archived', 'c1'],
      ['H5', 'month_in_future', 'c1'],
    ]);
    expect(p.added).toEqual([]);
  });

  it('нет столбца «ИНН» — файл не принимается целиком; повтор ячейки — берётся первая', () => {
    expect(
      planImport(
        [
          ['Контрагент', 'Выручка · 09.2026'],
          ['x', 1],
        ],
        lookup,
      ).errors,
    ).toEqual([{ row: 1, col: 0, ref: 'A1', contractorId: null, value: '', problem: 'no_inn' }]);
    const twice = planImport(
      [
        ['ИНН', 'Выручка · 09.2026', 'выручка · 09.2026'],
        ['03744097401851', 1, 2],
      ],
      lookup,
    );
    expect(twice.added.map((x) => x.value)).toEqual([100]);
  });

  it('длинное значение в ошибке обрезается: в предпросмотр и файл ошибок не идёт весь текст ячейки', () => {
    const long = 'x'.repeat(1_000);
    const p = plan([
      ['03744097401851', 'ОсОО «Укс»', null, long],
      [long, ''],
    ]);
    expect(p.errors.map((e) => [e.ref, e.problem, e.value.length])).toEqual([
      ['D2', 'not_number', IMPORT_ERROR_VALUE_MAX_LENGTH + 1],
      ['A3', 'unknown_contractor', IMPORT_ERROR_VALUE_MAX_LENGTH + 1],
    ]);
    expect(p.errors[0]!.value.endsWith('x…')).toBe(true);
  });

  it('ошибок больше, чем хранится: в плане — первые, счёт — все, строки с ошибками не пишутся', () => {
    const p = plan([
      ...Array.from({ length: IMPORT_ERRORS_KEPT + 5 }, () => ['03744097401851', '', 'abc']),
      ['21503199000123', 'ИП Асанов', null, null, 3],
    ]);
    expect(p.errors).toHaveLength(IMPORT_ERRORS_KEPT);
    expect(p.errorCount).toBe(IMPORT_ERRORS_KEPT + 5);
    expect(p.errors[0]).toMatchObject({ ref: 'C2', problem: 'not_number' });
    expect(p.added.map((x) => x.contractorId)).toEqual(['c2']);
  });

  it('ИНН из ячейки: пробелы убираются, 13 цифр — с нулём впереди', () => {
    expect(importInn(' 0374 4097 401851 ')).toBe('03744097401851');
    expect(importInn(3744097401851)).toBe('03744097401851');
    expect(importInn(null)).toBe('');
  });
});

describe('(v80) загрузка шаблона «строка — контрагент и показатель»', () => {
  const head = ['ИНН', 'Контрагент', 'Показатель', 'авг 2026', 'сен 2026', 'Итог'];

  it('показатель — по названию в строке, месяц — по заголовку; «Итог» пропускается', () => {
    const p = planImport(
      [
        head,
        [3744097401851, 'ОсОО «Укс»', 'Выручка', 120_000, '150 000,50', '270 000,50'],
        ['03744097401851', 'ОсОО «Укс»', ' количество сотрудников ', null, 5],
        ['21503199000123', 'ИП Асанов', 'Количество сотрудников', null, 3],
      ],
      lookup,
    );
    expect(p.errors).toEqual([]);
    expect(p.changed.map((x) => [x.ref, x.old, x.value, x.checked])).toEqual([
      ['D2', 10_000_000, 12_000_000, true],
    ]);
    expect(p.added.map((x) => [x.ref, x.contractorId, x.indicatorId, x.month, x.value])).toEqual([
      ['E2', 'c1', 'k1', '2026-09', 15_000_050],
      ['E4', 'c2', 'k2', '2026-09', 300],
    ]);
    expect(p.same).toBe(1);
    expect(p.months).toEqual(['2026-08', '2026-09']);
    expect(importFileMonths(head)).toEqual(['2026-08', '2026-09']);
  });

  it('ошибки: заголовок — не месяц, неизвестный показатель в строке (вся строка), в архиве, не ведётся', () => {
    const p = planImport(
      [
        [...head.slice(0, 5), 'Примечание', 'ноя 2026'],
        ['03744097401851', 'ОсОО «Укс»', 'Прибыль', 1, 2],
        ['03744097401851', 'ОсОО «Укс»', 'Площадь', null, 4],
        ['21503199000123', 'ИП Асанов', 'Выручка', 5, 6],
        ['21503199000123', 'ИП Асанов', 'Количество сотрудников', 'abc', 2, null, 9],
        ['99999999999999', '', 'Выручка', 1],
      ],
      lookup,
    );
    expect(p.errors.map((e) => [e.ref, e.problem, e.contractorId, e.value])).toEqual([
      ['F1', 'not_month', null, 'Примечание'],
      ['C2', 'unknown_indicator', 'c1', 'Прибыль'],
      ['E3', 'indicator_archived', 'c1', '4'],
      ['D4', 'indicator_off', 'c2', '5'],
      ['E4', 'indicator_off', 'c2', '6'],
      ['D5', 'not_number', 'c2', 'abc'],
      ['G5', 'month_in_future', 'c2', '9'],
      ['A6', 'unknown_contractor', null, '99999999999999'],
    ]);
    // Строки с ошибками не пишутся: «2» за сентябрь у c2 пропущено.
    expect(p.added).toEqual([]);
    expect(p.skipped).toBe(1);
  });

  it('месяцы файла: прежний шаблон — из «Показатель · ММ.ГГГГ», новый — из заголовков месяцев', () => {
    expect(
      importFileMonths(['ИНН', 'Выручка · 09.2026 (сом)', 'Площадь · 01.2026', 'Итог']),
    ).toEqual(['2026-01', '2026-09']);
    expect(importFileMonths(['ИНН', 'Показатель', 46023, '01.2026', 'фев 2026'])).toEqual([
      '2026-01',
      '2026-02',
    ]);
    expect(importFileMonths([])).toEqual([]);
  });
});
