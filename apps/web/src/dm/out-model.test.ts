import { formatSom, type DmOutColumn } from '@buhuchet/domain';
import type { DmParam, DmRunResult, DmTemplateCard } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import {
  catalogGroups,
  outAutoRun,
  outColumns,
  outColumnWidth,
  outExCell,
  outPageOf,
  outParamProblems,
  outParamsOf,
  outParamsToSend,
  outResult,
  outResultKey,
  outRunFailure,
  outServerProblem,
  outTemplateGroups,
  outTotalText,
  outValuesOf,
  outYearOptions,
  outYears,
} from './out-model';

// «Витрина данных» → «Вывод» и «Шаблоны» (прототип v155 `dmOptHtml`, `dmPar`, `dmParRead`, `dmCol`,
// `dmEx`, `renderDmTpl`).

const texts = { yes: 'Да', no: 'Нет' };

const param = (over: Partial<DmParam> & Pick<DmParam, 'code'>): DmParam => ({
  name: over.code,
  type: 'date',
  required: false,
  default: null,
  value: null,
  ...over,
});

const card = (over: Partial<DmTemplateCard> & Pick<DmTemplateCard, 'code'>): DmTemplateCard => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: over.code,
  description: null,
  audience: 'org',
  module: 'reports',
  needPermission: null,
  state: 'published',
  params: [],
  columns: [],
  ...over,
});

const columns: DmOutColumn[] = [
  { code: 'cp', name: 'Контрагент', type: 'text', total: false },
  { code: 'sum', name: 'Сумма', type: 'money', total: true },
  { code: 'n', name: 'Отчётов', type: 'num', total: true },
  { code: 'paid', name: 'Оплачено', type: 'bool', total: false },
];

const answer = (rows: unknown[][]): DmRunResult => ({
  columns,
  rows,
  more: false,
  max: 50_000,
  ms: 12,
  orgName: null,
});

describe('выбор шаблона по группам (прототип dmOptHtml)', () => {
  const list = [
    card({ code: 'a', audience: 'admin', module: null }),
    card({ code: 'b', module: 'reports' }),
    card({ code: 'c', module: 'cps' }),
    card({ code: 'd', module: 'reports' }),
    card({ code: 'e', module: null }),
  ];

  it('группа — по первому шаблону, в порядке списка; у Админки — «Для организаций · …»', () => {
    const groups = outTemplateGroups(list, true);
    expect(groups.map((g) => g.key)).toEqual(['admin', 'org:reports', 'org:cps', 'org:other']);
    expect(groups[1]!.items.map((x) => x.code)).toEqual(['b', 'd']);
    expect(groups[0]!.label).toEqual({ admin: true });
    expect(groups[1]!.label).toEqual({ module: 'reports', prefix: true });
    expect(groups[3]!.label).toEqual({ module: null, prefix: true });
  });

  it('у организации — без приставки', () => {
    expect(outTemplateGroups(list, false)[1]!.label).toEqual({ module: 'reports', prefix: false });
  });

  it('каталог организации — по модулям в порядке модулей, без шаблонов Админки', () => {
    const groups = catalogGroups(list);
    expect(groups.map((g) => g.module)).toEqual(['cps', 'reports']);
    expect(groups[1]!.items.map((x) => x.code)).toEqual(['b', 'd']);
  });
});

describe('параметры (прототип dmPar, dmParRead)', () => {
  const params = [
    param({ code: 'date_from', value: '2026-11-01' }),
    param({ code: 'date_to', required: true, value: '2026-11-21' }),
    param({ code: 'status', type: 'list:status' }),
  ];

  it('запомненное значение, иначе значение по умолчанию; пустое запомненное — по умолчанию', () => {
    expect(outParamsOf(params, null)).toEqual({
      date_from: '2026-11-01',
      date_to: '2026-11-21',
      status: '',
    });
    expect(outParamsOf(params, { date_from: '2026-10-01', date_to: '', status: 'todo' })).toEqual(
      { date_from: '2026-10-01', date_to: '2026-11-21', status: 'todo' },
    );
    // Не строка в памяти браузера — не значение.
    expect(outParamsOf(params, { date_from: 5 })).toMatchObject({ date_from: '2026-11-01' });
  });

  it('обязательный пустой — «Укажите значение», не тот тип — «Неверное значение»', () => {
    expect(outParamProblems(params, { date_from: '', date_to: ' ', status: '' })).toEqual({
      date_to: 'required',
    });
    expect(outParamProblems(params, { date_from: '01.11.2026', date_to: '2026-11-21' })).toEqual({
      date_from: 'type',
    });
    expect(outParamProblems(params, { date_from: '', date_to: '2026-11-21', status: 'todo' })).toEqual(
      {},
    );
  });

  it('«По дату» раньше «С даты» и «Месяц раньше начального» — у второго поля', () => {
    expect(
      outParamProblems(params, { date_from: '2026-11-21', date_to: '2026-11-01', status: '' }),
    ).toEqual({ date_to: 'date_order' });
    const months = [
      param({ code: 'month_from', type: 'month' }),
      param({ code: 'month_to', type: 'month' }),
    ];
    expect(outParamProblems(months, { month_from: '2026-11', month_to: '2026-10' })).toEqual({
      month_to: 'month_order',
    });
    expect(outParamProblems(months, { month_from: '2026-10', month_to: '2026-10' })).toEqual({});
  });

  it('пустое поле уходит пустым (прототип `v || null`), лишних кодов нет', () => {
    expect(outParamsToSend(params, { date_from: ' ', date_to: '2026-11-21', x: '1' })).toEqual({
      date_from: null,
      date_to: '2026-11-21',
      status: null,
    });
  });

  it('отказ сервера по параметру — ошибка поля', () => {
    expect(outServerProblem('date_to', 'range')).toBe('date_order');
    expect(outServerProblem('month_to', 'range')).toBe('month_order');
    expect(outServerProblem('year', 'type')).toBe('type');
    expect(outServerProblem('year', 'required')).toBe('required');
  });

  it('год — текущий и четыре прошлых; запомненный другой — первым', () => {
    expect(outYears('2026-11-21')).toEqual(['2026', '2025', '2024', '2023', '2022']);
    expect(outYearOptions('2026-11-21', '2024')).toEqual(outYears('2026-11-21'));
    expect(outYearOptions('2026-11-21', '2019')[0]).toBe('2019');
    expect(outYearOptions('2026-11-21', '')).toHaveLength(5);
  });
});

describe('запуск при открытии и отказы «Показать»', () => {
  const tpl = card({ code: 'x', params: [param({ code: 'month', type: 'month', required: true })] });

  it('сразу — опубликованный с верными параметрами; Админка по шаблону организации — только по «Показать»', () => {
    expect(outAutoRun(tpl, { month: '2026-11' }, false)).toBe(true);
    expect(outAutoRun(tpl, { month: '' }, false)).toBe(false);
    expect(outAutoRun({ ...tpl, state: 'broken' }, { month: '2026-11' }, false)).toBe(false);
    expect(outAutoRun(tpl, { month: '2026-11' }, true)).toBe(false);
    expect(outAutoRun({ ...tpl, audience: 'admin' }, { month: '2026-11' }, true)).toBe(true);
  });

  it('неверный параметр — у поля, сломанный — с текстом базы для Админки, остальное — текстом', () => {
    expect(outRunFailure('dm_bad_param', { param: 'date_to', why: 'range' })).toEqual({
      kind: 'param',
      param: 'date_to',
      problem: 'date_order',
    });
    expect(outRunFailure('dm_bad_param', { param: 'x' })).toEqual({ kind: 'other' });
    expect(outRunFailure('dm_template_broken', { error: 'relation "x" does not exist' })).toEqual({
      kind: 'broken',
      error: 'relation "x" does not exist',
    });
    expect(outRunFailure('dm_template_broken', undefined)).toEqual({ kind: 'broken', error: null });
    expect(outRunFailure('dm_timeout', null)).toEqual({ kind: 'other' });
  });
});

describe('таблица результата (прототип dmCol, dmEx)', () => {
  const result = outResult(
    answer([
      ['Альфа', 125050, 3, true],
      ['Бета', '100', 1, false],
      ['Гамма', null, 2, null],
    ]),
  );

  it('строки по порядку ответа, деньги — тыйыны', () => {
    expect(result.rows.map((r) => r.i)).toEqual([0, 1, 2]);
    expect(result.rows[1]!.v).toEqual(['Бета', 100, 1, false]);
    expect(result.ms).toBe(12);
  });

  it('ширина столбцов: первый текстовый 230, текст 170, деньги 140, остальное 120', () => {
    expect(outColumnWidth(columns[0]!, 0)).toBe(230);
    expect(outColumnWidth(columns[0]!, 2)).toBe(170);
    expect(outColumnWidth(columns[1]!, 1)).toBe(140);
    expect(outColumnWidth(columns[2]!, 2)).toBe(120);
  });

  it('столбцы: числа справа с итогом, ячейка знает своё место и строку', () => {
    const cols = outColumns(columns, texts);
    expect(cols.map((c) => c.key)).toEqual(['cp', 'sum', 'n', 'paid']);
    expect(cols[1]!.numeric).toBe(true);
    expect(cols[3]!.numeric).toBe(false);
    expect(cols[1]!.text!(result.rows[0]!)).toBe(formatSom(125050));
    expect(cols[3]!.text!(result.rows[1]!)).toBe('Нет');
    expect(cols[2]!.td!(result.rows[2]!)).toEqual({ 'data-dx': '2', 'data-dr': '2' });
    expect(typeof cols[1]!.total).toBe('function');
    expect(cols[0]!.total).toBeUndefined();
    expect(outTotalText(columns[1]!, 125050)).toBe(formatSom(125050));
    expect(outTotalText(columns[2]!, 6)).toBe('6');
  });

  it('сортировка и фильтр — по всему результату', () => {
    const page = outPageOf(result.rows, columns, { sort: 'sum.desc', size: 'all' }, texts);
    expect(page.items.map((r) => r.i)).toEqual([0, 1, 2]);
    const asc = outPageOf(result.rows, columns, { sort: 'cp.desc', size: '25' }, texts);
    expect(asc.items.map((r) => r.v[0])).toEqual(['Гамма', 'Бета', 'Альфа']);
    expect(asc.total).toBe(3);
    // Неверный запрос — первая страница без условий.
    const bad = outPageOf(result.rows, columns, { sort: '!' }, texts);
    expect(bad.items.map((r) => r.i)).toEqual([0, 1, 2]);
    expect(outValuesOf(result.rows, columns, 'paid', texts).items.length).toBeGreaterThan(0);
  });

  it('ячейка «как в Excel»: текст для Ctrl+C, число — для итогов внизу, правки нет', () => {
    const shown = columns.map((col, index) => ({ col, index }));
    expect(outExCell(shown, result.rows[0], 1, texts, 'нет')).toEqual({
      t: '1250,50',
      n: 125050,
      ed: false,
      why: 'нет',
    });
    expect(outExCell(shown, result.rows[0], 0, texts, 'нет')).toMatchObject({ t: 'Альфа', n: null });
    expect(outExCell(shown, undefined, 0, texts, 'нет')).toEqual({
      t: '',
      n: null,
      ed: false,
      why: 'нет',
    });
  });

  it('номер ответа: тот же ответ — тот же номер, новый — новый', () => {
    const a = answer([]);
    const b = answer([]);
    expect(outResultKey(a)).toBe(outResultKey(a));
    expect(outResultKey(b)).not.toBe(outResultKey(a));
  });
});
