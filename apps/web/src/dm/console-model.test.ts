import type { DmTemplateColumnInput, DmTemplateParamInput } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { schemaIndex } from './console-assist';
import {
  consoleColumnType,
  consoleHasMoney,
  consoleParamsToSend,
  consolePlanLines,
  consoleResult,
  consoleTemplatePrefill,
  methodSqlOf,
  methodToConsole,
  type MethodSource,
  consoleCpColumns,
} from './console-model';

// Чистые правила вкладки «Консоль» (доработки 27.11.2026: консоль запросов, блоки 1, 4, 5; прототип
// v166 `dmcRun`, `dmcResDraw`, `dmcToTpl`, `dmcFromMethod`).

describe('consoleParamsToSend', () => {
  it('только параметры текста; пустое поле — пусто (null)', () => {
    expect(consoleParamsToSend('SELECT :a, :b', { a: '1', b: '  ', c: 'x' })).toEqual({
      a: '1',
      b: null,
    });
  });
});

describe('consoleColumnType', () => {
  it('деньги по имени и числу; да/нет, число, дата, момент, иначе текст', () => {
    expect(consoleColumnType('amount', [100, '250', null])).toBe('money');
    expect(consoleColumnType('amount', ['abc'])).toBe('text');
    expect(consoleColumnType('ok', [true, false])).toBe('bool');
    expect(consoleColumnType('n', [1, 2.5])).toBe('num');
    expect(consoleColumnType('d', ['2026-11-27'])).toBe('date');
    expect(consoleColumnType('at', ['2026-11-27T10:00:00+06:00'])).toBe('datetime');
    expect(consoleColumnType('x', [null, ''])).toBe('text');
  });
});

describe('consoleResult', () => {
  const answer = {
    columns: ['name', 'amount', 'name'],
    rows: [
      ['A', 12550, 'B'],
      ['C', 100, 'D'],
    ],
    more: false,
    max: 1000,
    ms: 12,
    params: [],
  };

  it('денежный столбец — «… · сом» с итогом; одинаковые имена — свой код', () => {
    const r = consoleResult(answer, (n) => `${n} · сом`);
    expect(r.columns).toEqual([
      { code: 'name', name: 'name', type: 'text', total: false },
      { code: 'amount', name: 'amount · сом', type: 'money', total: true },
      { code: 'name_3', name: 'name', type: 'text', total: false },
    ]);
    expect(r.rows[0]!.v).toEqual(['A', 12550, 'B']);
    expect(r.ms).toBe(12);
    expect(consoleHasMoney(r)).toBe(true);
    expect(consoleHasMoney(consoleResult({ ...answer, columns: ['a', 'b', 'c'] }, String))).toBe(
      false,
    );
  });
});

describe('consoleTemplatePrefill', () => {
  it('без запуска — столбцы из списка SELECT, параметры по имени', () => {
    const r = consoleTemplatePrefill(
      'SELECT c.name, r.amount, contractor_id, r.due_date, r.paid_on, r.created_at FROM reports r WHERE r.month = :month AND r.d >= :date_from',
      null,
      null,
    );
    expect(r.params.map((p) => [p.code, p.type, p.required])).toEqual([
      ['month', 'month', true],
      ['date_from', 'date', true],
    ]);
    expect(r.columns.map((c) => [c.code, c.type])).toEqual([
      ['name', 'text'],
      ['amount', 'money'],
      ['contractor_id', 'cp'],
      ['due_date', 'date'],
      ['paid_on', 'date'],
      ['created_at', 'datetime'],
    ]);
  });

  it('после запуска — столбцы запуска; у шаблона — его параметры и столбцы по коду; неподходящие коды отброшены', () => {
    const last = consoleResult(
      { columns: ['amount', 'Bad Name'], rows: [], more: false, max: 1000, ms: 1, params: [] },
      String,
    );
    const had: { params: DmTemplateParamInput[]; columns: DmTemplateColumnInput[] } = {
      params: [{ code: 'year', name: 'Год', type: 'year', required: false, default: 'year' }],
      columns: [{ code: 'amount', name: 'Сумма', type: 'money', total: true }],
    };
    const r = consoleTemplatePrefill('SELECT amount FROM x WHERE y = :year', last, had);
    expect(r.params).toEqual(had.params);
    expect(r.columns).toEqual(had.columns);
    expect(r.query).toBe('SELECT amount FROM x WHERE y = :year');
  });
});

describe('consolePlanLines', () => {
  it('узлы плана деревом; непонятное пропускается', () => {
    const plan = [
      {
        Plan: {
          'Node Type': 'Hash Join',
          'Plan Rows': 10,
          'Total Cost': 5.5,
          Plans: [
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'reports',
              'Plan Rows': 100,
              'Total Cost': 2,
            },
            { nonsense: true },
          ],
        },
      },
    ];
    expect(consolePlanLines(plan)).toEqual([
      { depth: 0, type: 'Hash Join', relation: null, rows: 10, cost: 5.5 },
      { depth: 1, type: 'Seq Scan', relation: 'reports', rows: 100, cost: 2 },
    ]);
    expect(consolePlanLines(null)).toEqual([]);
    expect(consolePlanLines('x')).toEqual([]);
  });
});

describe('methodToConsole', () => {
  const card = (over: Partial<MethodSource> = {}): MethodSource => ({
    method: 'GET',
    path: '/api/x',
    summary: 'Список',
    queries: [
      {
        kind: 'sql',
        text: 'SELECT c.name FROM contractors c WHERE c.org_id = app.current_org_id() AND c.id = $1',
      },
    ],
    ...over,
  });
  const index = schemaIndex({
    described: null,
    tables: [
      {
        name: 'contractors',
        group: null,
        title: null,
        description: null,
        orgVisible: true,
        fields: [
          {
            name: 'name',
            type: 'text',
            title: null,
            description: null,
            ref: null,
            orgVisible: true,
          },
          { name: 'id', type: 'uuid', title: null, description: null, ref: null, orgVisible: true },
        ],
      },
    ],
  });

  it('GET с точным SQL → вкладка консоли: SELECT без проверки «моя организация», параметры пусто, откуда', () => {
    const r = methodToConsole(card(), index, true)!;
    expect(r.sql).not.toMatch(/current_org_id/);
    expect(r.name).toBe('Список');
    expect(r.toTemplate).toBe(true);
    expect(Object.values(r.params ?? {}).every((v) => v === '')).toBe(true);
    expect(r.notes?.from).toBe('GET /api/x');
  });

  it('не GET или запрос написан кодом — нет', () => {
    expect(methodSqlOf(card({ method: 'POST' }))).toBeNull();
    expect(methodToConsole(card({ method: 'POST' }), index, false)).toBeNull();
    expect(
      methodToConsole(card({ queries: [{ kind: 'code', text: 'db.select()' }] }), null, false),
    ).toBeNull();
  });
});

describe('consoleCpColumns (этап 2, П7: автостолбец «Контрагент»)', () => {
  const col = (code: string): DmTemplateColumnInput => ({
    code,
    name: code,
    type: 'text',
    total: false,
  });
  const cp = { code: 'contractor_id', name: 'Контрагент', type: 'cp', total: false };

  it('последний запуск шёл до дописывания — contractor_id добавляется первым', () => {
    expect(consoleCpColumns([col('name'), col('inn')], new Set(), true, 'Контрагент')).toEqual([
      cp,
      col('name'),
      col('inn'),
    ]);
  });

  it('уже есть в запуске — получает вид «Контрагент» и встаёт первым; у шаблона свой — не трогается', () => {
    expect(
      consoleCpColumns([col('name'), col('contractor_id')], new Set(), true, 'Контрагент'),
    ).toEqual([cp, col('name')]);
    expect(
      consoleCpColumns([col('name'), col('contractor_id')], new Set(['contractor_id']), false, 'К'),
    ).toEqual([col('name'), col('contractor_id')]);
  });

  it('не дописан — порядок прежний', () => {
    expect(consoleCpColumns([col('name')], new Set(), false, 'Контрагент')).toEqual([col('name')]);
  });
});
