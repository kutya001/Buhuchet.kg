import type { DmSchemaMap } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import {
  assistAt,
  consoleParamNames,
  consoleParamType,
  fieldIsMoney,
  hoverAt,
  knownFields,
  schemaIndex,
  schemaMarks,
  sqlRefs,
  type AssistTexts,
} from './console-assist';

// Подсказки консоли по карте базы (доработки 27.11.2026: консоль запросов, блок 3; прототип v166
// `dmcRefs`, `dmcSuggest`, `dmcCard`, `dmcIssues`).

const field = (
  name: string,
  type = 'text',
  over: Partial<DmSchemaMap['tables'][0]['fields'][0]> = {},
) => ({
  name,
  type,
  title: null,
  description: null,
  ref: null,
  ...over,
});

const MAP: DmSchemaMap = {
  described: 'v1',
  tables: [
    {
      name: 'contractors',
      group: 'Контрагенты',
      title: 'Контрагенты',
      description: null,
      orgVisible: true,
      fields: [
        field('id', 'uuid'),
        field('name', 'text', { title: 'Название' }),
        field('inn'),
        field('employee_id', 'uuid', { ref: { table: 'employees', field: 'id' } }),
      ],
    },
    {
      name: 'employees',
      group: 'Сотрудники',
      title: 'Сотрудники',
      description: null,
      orgVisible: true,
      fields: [field('id', 'uuid'), field('full_name')],
    },
    {
      name: 'reports',
      group: 'Контрагенты',
      title: 'Отчёты',
      description: null,
      orgVisible: true,
      fields: [
        field('id', 'uuid'),
        field('contractor_id', 'uuid', { ref: { table: 'contractors', field: 'id' } }),
        field('amount', 'bigint'),
        field('fine', 'bigint', { description: 'Пеня в тыйынах' }),
        field('due_date', 'date'),
      ],
    },
    {
      name: 'sessions_log',
      group: null,
      title: null,
      description: null,
      orgVisible: false,
      fields: [field('id', 'bigint')],
    },
  ],
};
const index = schemaIndex(MAP);

const texts: AssistTexts = {
  noDesc: 'нет описания',
  money: 'Деньги',
  closed: 'закрыто',
  keyword: 'Слово SQL',
  join: 'Связь',
  alias: (t) => `Псевдоним: ${t}`,
  fn: (n) => `fn:${n}`,
};

describe('schemaIndex', () => {
  it('таблицы по имени, обратные ссылки и группы по порядку появления', () => {
    expect([...index.tables.keys()]).toEqual([
      'contractors',
      'employees',
      'reports',
      'sessions_log',
    ]);
    expect(index.incoming.get('contractors')).toEqual([
      { field: 'contractor_id', table: 'reports', to: 'id' },
    ]);
    expect(index.groups).toEqual(['Контрагенты', 'Сотрудники', '']);
    expect(knownFields(index).get('reports')?.get('amount')).toBe('bigint');
  });

  it('деньги — целое поле с денежным именем или «тыйын» в описании', () => {
    const reports = index.tables.get('reports')!;
    expect(fieldIsMoney(reports.fields.find((f) => f.name === 'amount')!)).toBe(true);
    expect(fieldIsMoney(reports.fields.find((f) => f.name === 'fine')!)).toBe(true);
    expect(fieldIsMoney(reports.fields.find((f) => f.name === 'due_date')!)).toBe(false);
    expect(fieldIsMoney(field('amount', 'text'))).toBe(false);
  });
});

describe('sqlRefs', () => {
  it('таблицы FROM, JOIN и через запятую с псевдонимами; public. — та же таблица; WITH — свои имена', () => {
    const r = sqlRefs(
      'WITH x AS (SELECT 1) SELECT * FROM public.contractors c JOIN reports AS r ON true, employees, x',
    );
    expect(r.refs.map((x) => [x.kw, x.table, x.alias])).toEqual([
      ['from', 'contractors', 'c'],
      ['join', 'reports', 'r'],
      ['comma', 'employees', 'employees'],
      ['comma', 'x', 'x'],
    ]);
    expect(r.aliases.get('c')).toBe('contractors');
    expect(r.cte.has('x')).toBe(true);
  });

  it('подзапрос и функция на месте таблицы — не таблица', () => {
    expect(sqlRefs('SELECT * FROM (SELECT 1) s').refs).toEqual([]);
    expect(sqlRefs('SELECT * FROM generate_series(1, 3) g').refs).toEqual([]);
  });
});

describe('assistAt', () => {
  const at = (sql: string, opts?: { force?: boolean; org?: boolean }) =>
    assistAt(sql.replaceAll('|', ''), sql.indexOf('|'), index, texts, opts);

  it('после «псевдоним.» — поля таблицы, и по-русски', () => {
    const r = at('SELECT c.| FROM contractors c');
    expect(r?.items.map((x) => x.label)).toEqual(['id', 'name', 'inn', 'employee_id']);
    expect(r?.items.find((x) => x.label === 'name')?.detail).toBe('text · Название');
    expect(r?.items.find((x) => x.label === 'id')?.plain).toBe(true);
    expect(at('SELECT c.назв| FROM contractors c')?.items.map((x) => x.label)).toEqual(['name']);
    expect(at('SELECT z.| FROM contractors c')).toBeNull();
  });

  it('после FROM — таблицы: имя с начала выше, поиск по-русски; у шаблона организаций — пометка закрытой', () => {
    expect(at('SELECT * FROM rep|')?.items.map((x) => x.label)).toEqual(['reports']);
    expect(at('SELECT * FROM отч|')?.items.map((x) => x.label)).toEqual(['reports']);
    const all = at('SELECT * FROM |', { org: true })!;
    expect(all.items.find((x) => x.label === 'sessions_log')?.detail).toBe(' · закрыто');
  });

  it('после ON — условия по связям таблиц', () => {
    const r = at('SELECT * FROM reports r JOIN contractors c ON |');
    expect(r?.items.map((x) => x.label)).toEqual(['r.contractor_id = c.id']);
  });

  it('от двух букв — функции, слова SQL и псевдонимы; меньше — только по Ctrl+Пробел', () => {
    const r = at('SELECT su| FROM reports r');
    expect(r?.items[0]).toMatchObject({
      label: 'sum',
      apply: 'sum(r.amount)',
      detail: 'fn:sum · sum(r.amount)',
    });
    expect(at('SELECT s| FROM reports r')).toBeNull();
    expect(at('SELECT s| FROM reports r', { force: true })?.items.length).toBeGreaterThan(0);
    expect(at('SELECT * FROM reports rep WHERE re|')?.items.some((x) => x.type === 'alias')).toBe(
      true,
    );
  });

  it('внутри строки и комментария, на месте псевдонима — без подсказок', () => {
    expect(at("SELECT 'su|'")).toBeNull();
    expect(at('SELECT 1 -- su|')).toBeNull();
    expect(at('SELECT * FROM reports re|')).toBeNull();
  });
});

describe('hoverAt', () => {
  it('таблица и поле по псевдониму; неизвестное — ничего', () => {
    const sql = 'SELECT c.name FROM contractors c';
    expect(hoverAt(sql, sql.indexOf('contractors') + 2, index)).toMatchObject({
      kind: 'table',
      table: { name: 'contractors' },
    });
    expect(hoverAt(sql, sql.indexOf('name') + 1, index)).toMatchObject({
      kind: 'field',
      field: { name: 'name' },
    });
    expect(hoverAt(sql, 2, index)).toBeNull();
  });
});

describe('schemaMarks', () => {
  it('нет таблицы, нет поля; закрытая — только у шаблона «Для организаций»; WITH и функции — не ошибка', () => {
    const sql = 'SELECT c.nope, x.a FROM contractors c, nosuch, sessions_log WITH_X';
    const marks = schemaMarks(sql, index);
    expect(marks.map((m) => [m.code, m.table, m.field ?? null])).toEqual([
      ['no_field', 'contractors', 'nope'],
      ['no_table', 'nosuch', null],
    ]);
    expect(schemaMarks('SELECT * FROM sessions_log', index, { org: true })[0]?.code).toBe(
      'org_closed',
    );
    expect(schemaMarks('WITH t AS (SELECT 1) SELECT t.a FROM t', index)).toEqual([]);
    expect(schemaMarks('SELECT app.current_org_id(), r.id FROM reports r', index)).toEqual([]);
  });
});

describe('consoleParamNames и consoleParamType', () => {
  it('параметры по порядку, без повторов и приведения типа', () => {
    expect(consoleParamNames("SELECT :month, :date_from::date, :month, ':no'")).toEqual([
      'month',
      'date_from',
    ]);
  });
  it('поле по имени: месяц, дата, текст', () => {
    expect(consoleParamType('report_month')).toBe('month');
    expect(consoleParamType('due_date')).toBe('date');
    expect(consoleParamType('p_from')).toBe('date');
    expect(consoleParamType('inn')).toBe('text');
  });
});
