import { describe, expect, it } from 'vitest';
import schemaDoc from '../../../../spec/prototype/db/schema.json';
import {
  DM_BUILD_MAX,
  type DmBuildSchema,
  type DmBuildState,
  type DmBuildTable,
  dmBuildAlias,
  dmBuildAlive,
  dmBuildEdges,
  dmBuildFill,
  dmBuildPathText,
  dmBuildPaths,
  dmBuildPlan,
  dmBuildPreFields,
  dmBuildSql,
  dmBuildStart,
  dmConsoleAutoCp,
} from './builder';
import { UI_TEXTS } from '../l10n/texts';
import { DM_CONSOLE_PRESETS } from './presets';

/** Маленькая карта базы: поле — «имя:тип>таблица.поле». */
function map(spec: Record<string, string[]>): DmBuildSchema {
  return new Map(
    Object.entries(spec).map(([name, cols]) => {
      const fields = cols.map((c) => {
        const [head, ref] = c.split('>');
        const [n, type] = head!.split(':');
        const [table, field] = (ref ?? '').split('.');
        return {
          name: n!,
          type: type ?? 'text',
          ref: ref ? { table: table!, field: field! } : null,
        };
      });
      return [name, { name, fields } satisfies DmBuildTable];
    }),
  );
}

const S = map({
  contractors: [
    'id:uuid',
    'org_id:uuid>organizations.id',
    'name',
    'inn',
    'deleted_at:timestamptz',
    'created_by:uuid>users.id',
  ],
  reports: [
    'id:uuid',
    'contractor_id:uuid>contractors.id',
    'title',
    'due_date:date',
    'amount:bigint',
    'superseded:boolean',
    'created_by:uuid>users.id',
  ],
  report_payments: ['id:uuid', 'report_id:uuid>reports.id', 'amount:bigint', 'paid_on:date'],
  money_operations: [
    'id:uuid',
    'contractor_id:uuid>contractors.id',
    'amount:bigint',
    'op_date:date',
    'cancelled_at:timestamptz',
  ],
  transfers: [
    'id:uuid',
    'from_id:uuid>contractors.id',
    'to_id:uuid>contractors.id',
    'amount:bigint',
  ],
  users: ['id:uuid', 'login'],
  organizations: ['id:uuid', 'name'],
  lonely: ['id:uuid', 'code'],
});

const st = (names: string[], o: Partial<DmBuildState> = {}): DmBuildState => ({
  names,
  choice: {},
  kind: 'left',
  sep: false,
  fields: {},
  ...o,
});

describe('сборщик запроса (консоль Витрины, этап 2, П9; прототип v167 vitrina-builder.js)', () => {
  it('связи: свои внешние ключи, потом ключи соседей; без org_id и …_by', () => {
    const e = dmBuildEdges(S, 'contractors');
    expect(e.map((x) => `${x.a}.${x.ac}=${x.b}.${x.bc}:${x.many ? 'n' : '1'}`)).toEqual([
      'contractors.id=reports.contractor_id:1',
      'contractors.id=money_operations.contractor_id:1',
      'contractors.id=transfers.from_id:1',
      'contractors.id=transfers.to_id:1',
    ]);
    expect(dmBuildEdges(S, 'reports')[0]).toEqual({
      a: 'reports',
      b: 'contractors',
      ac: 'contractor_id',
      bc: 'id',
      many: true,
    });
    expect(dmBuildEdges(S, 'users')).toEqual([]);
    expect(dmBuildEdges(S, 'нет такой')).toEqual([]);
  });

  it('пути: кратчайшие, все варианты одной длины, не длиннее трёх шагов', () => {
    const one = dmBuildPaths(S, 'reports', new Set(['contractors']));
    expect(one.map(dmBuildPathText)).toEqual(['reports.contractor_id = contractors.id']);
    const two = dmBuildPaths(S, 'transfers', new Set(['contractors']));
    expect(two.map(dmBuildPathText)).toEqual([
      'transfers.from_id = contractors.id',
      'transfers.to_id = contractors.id',
    ]);
    const via = dmBuildPaths(S, 'report_payments', new Set(['contractors']));
    expect(via.map(dmBuildPathText)).toEqual([
      'report_payments.report_id = reports.id → reports.contractor_id = contractors.id',
    ]);
    expect(dmBuildPaths(S, 'lonely', new Set(['contractors']))).toEqual([]);
  });

  it('псевдонимы: первые буквы слов, занятый — с цифрой, слово SQL — нет', () => {
    const used = new Set<string>();
    expect(dmBuildAlias('reports', used)).toBe('r');
    expect(dmBuildAlias('report_types', used)).toBe('rt');
    expect(dmBuildAlias('roles', used)).toBe('r2');
    expect(dmBuildAlias('audit_samples', used)).toBe('as1');
    expect(dmBuildAlias('_', new Set())).toBe('t');
  });

  it('поля по умолчанию — названия и даты; живые записи — условия по таблице', () => {
    expect(dmBuildPreFields(S.get('contractors')!)).toEqual(['name', 'inn']);
    expect(dmBuildPreFields(S.get('reports')!)).toEqual(['title', 'due_date']);
    expect(dmBuildPreFields(S.get('users')!)).toEqual(['login']);
    expect(
      dmBuildPreFields({ name: 'x', fields: [{ name: 'id', type: 'uuid', ref: null }] }),
    ).toEqual([]);
    expect(dmBuildAlive(S.get('reports')!, 'r')).toEqual(['NOT r.superseded']);
    expect(dmBuildAlive(S.get('money_operations')!, 'mo')).toEqual(['mo.cancelled_at IS NULL']);
    expect(dmBuildAlive(S.get('contractors')!, 'c')).toEqual(['c.deleted_at IS NULL']);
  });

  it('промежуточная таблица добавляется сама, без полей', () => {
    const s0 = st(['contractors', 'report_payments']);
    const plan = dmBuildPlan(S, s0);
    expect(plan.joins.map((j) => [j.t, j.alias, j.parentAlias, j.via])).toEqual([
      ['contractors', 'c', null, false],
      ['reports', 'r', 'c', true],
      ['report_payments', 'rp', 'r', false],
    ]);
    const s1 = dmBuildFill(s0, plan);
    expect(s1.fields).toEqual({
      contractors: ['name', 'inn'],
      reports: [],
      report_payments: ['paid_on'],
    });
    expect(dmBuildFill(s1, plan)).toBe(s1);
    expect(dmBuildSql(S, s1, plan)).toBe(
      [
        'SELECT',
        '  c.name,',
        '  c.inn,',
        '  rp.paid_on',
        'FROM contractors c',
        'LEFT JOIN reports r ON r.contractor_id = c.id AND NOT r.superseded',
        'LEFT JOIN report_payments rp ON rp.report_id = r.id',
        'WHERE c.deleted_at IS NULL',
        'ORDER BY 1',
      ].join('\n'),
    );
  });

  it('выбор пути и «Только строки с парой»', () => {
    const base = st(['contractors', 'transfers'], {
      kind: 'inner',
      fields: { contractors: ['name'], transfers: ['amount'] },
    });
    const p0 = dmBuildPlan(S, base);
    expect(p0.steps).toEqual([expect.objectContaining({ t: 'transfers', none: false, pick: 0 })]);
    expect(dmBuildSql(S, base)).toContain('JOIN transfers t ON t.from_id = c.id');
    expect(dmBuildSql(S, base)).not.toContain('LEFT JOIN');
    const p1 = { ...base, choice: { transfers: 1 } };
    expect(dmBuildSql(S, p1)).toContain('JOIN transfers t ON t.to_id = c.id');
    // Номер за пределами списка — ближайший из возможных.
    expect(dmBuildPlan(S, { ...base, choice: { transfers: 9 } }).steps[0]).toMatchObject({
      pick: 1,
    });
  });

  it('таблица без связи — «связи не нашлось», в запрос не идёт; неизвестная — пропускается', () => {
    const plan = dmBuildPlan(S, st(['contractors', 'lonely', 'нет']));
    expect(plan.steps).toEqual([{ t: 'lonely', none: true }]);
    expect(plan.joins.map((j) => j.t)).toEqual(['contractors']);
    expect(dmBuildSql(S, st(['нет']))).toBe('');
    expect(dmBuildSql(S, st(['users']))).toBe('SELECT\n  u.*\nFROM users u\nORDER BY 1');
  });

  it('две таблицы «много на одного» — задвоение; «Считать итоги отдельно» — подзапросы WITH', () => {
    const s0 = st(['contractors', 'reports', 'money_operations'], {
      fields: {
        contractors: ['name'],
        reports: ['amount', 'title'],
        money_operations: ['amount'],
      },
    });
    const plan = dmBuildPlan(S, s0);
    expect(plan.dbl).toBe(true);
    expect(plan.sepOk).toBe(true);
    // Одинаковые имена полей разных таблиц получают имя таблицы.
    expect(dmBuildSql(S, s0)).toContain(
      'r.amount AS reports_amount,\n  r.title,\n  mo.amount AS money_operations_amount',
    );
    expect(dmBuildSql(S, { ...s0, sep: true })).toBe(
      [
        'WITH r_sum AS (',
        '  SELECT r.contractor_id, count(*) AS reports_n, sum(r.amount) AS reports_amount',
        '  FROM reports r',
        '  WHERE NOT r.superseded',
        '  GROUP BY r.contractor_id',
        '), mo_sum AS (',
        '  SELECT mo.contractor_id, count(*) AS money_operations_n, sum(mo.amount) AS money_operations_amount',
        '  FROM money_operations mo',
        '  WHERE mo.cancelled_at IS NULL',
        '  GROUP BY mo.contractor_id',
        ')',
        'SELECT',
        '  c.name,',
        '  coalesce(r_sum.reports_n, 0) AS reports_n,',
        '  coalesce(r_sum.reports_amount, 0) AS reports_amount,',
        '  coalesce(mo_sum.money_operations_n, 0) AS money_operations_n,',
        '  coalesce(mo_sum.money_operations_amount, 0) AS money_operations_amount',
        'FROM contractors c',
        'LEFT JOIN r_sum ON r_sum.contractor_id = c.id',
        'LEFT JOIN mo_sum ON mo_sum.contractor_id = c.id',
        'WHERE c.deleted_at IS NULL',
        'ORDER BY 1',
      ].join('\n'),
    );
    // Одна такая таблица — задвоения нет, «отдельно» ничего не меняет.
    const one = st(['contractors', 'reports'], { sep: true, fields: { reports: ['amount'] } });
    expect(dmBuildPlan(S, one).dbl).toBe(false);
    expect(dmBuildSql(S, one)).not.toContain('WITH');
  });

  it('начало окна: без повторов и public., только из карты, не больше пяти', () => {
    expect(dmBuildStart(S, ['public.Reports', 'reports', 'нет', 'contractors'])).toEqual({
      state: st(['reports', 'contractors']),
      cut: false,
    });
    const many = dmBuildStart(S, [...S.keys()]);
    expect(many.state.names).toHaveLength(DM_BUILD_MAX);
    expect(many.cut).toBe(true);
  });
});

describe('автостолбец contractor_id при «Сохранить в шаблон» (этап 2, П7; прототип dmcAutoCp)', () => {
  it('таблица контрагентов — c.id первым столбцом, модуль «Контрагенты»', () => {
    expect(dmConsoleAutoCp('SELECT c.name FROM contractors c', S)).toEqual({
      sql: 'SELECT c.id AS contractor_id, c.name FROM contractors c',
      added: 'c.id AS contractor_id',
      module: 'cps',
      fee: false,
    });
  });
  it('таблица с contractor_id — её поле; DISTINCT остаётся первым; модуль по первой таблице', () => {
    expect(dmConsoleAutoCp('select distinct r.title from reports as r', S)).toEqual({
      sql: 'select distinct r.contractor_id AS contractor_id, r.title from reports as r',
      added: 'r.contractor_id AS contractor_id',
      module: 'reports',
      fee: false,
    });
  });
  it('столбец уже есть, таблиц карты нет, контрагента нет', () => {
    expect(dmConsoleAutoCp('SELECT r.contractor_id, r.title FROM reports r', S)).toMatchObject({
      added: null,
      module: 'reports',
    });
    expect(dmConsoleAutoCp('SELECT 1', S)).toBeNull();
    expect(dmConsoleAutoCp('SELECT u.login FROM users u', S)).toMatchObject({
      added: null,
      module: 'cps',
    });
  });
  it('WITH и подзапросы: столбец — в основной SELECT, имена WITH — не таблицы', () => {
    const sql =
      'WITH x AS (SELECT r.contractor_id, r.amount FROM reports r) SELECT x.amount, c.name FROM x JOIN contractors c ON c.id = x.contractor_id';
    const r = dmConsoleAutoCp(sql, S)!;
    expect(r.added).toBe('c.id AS contractor_id');
    expect(r.sql).toContain(') SELECT c.id AS contractor_id, x.amount');
    expect(r.module).toBe('cps');
    // Запятая в списке полей — не имя WITH: «reports AS n» не прячет таблицу reports.
    expect(dmConsoleAutoCp('SELECT r.title, 1 AS reports FROM reports r', S)?.module).toBe(
      'reports',
    );
  });
  it('плата за обслуживание — нужно право «Видеть плату за обслуживание»', () => {
    const fee = map({
      contractors: ['id:uuid', 'name'],
      fee_payments: ['id:uuid', 'contractor_id:uuid>contractors.id', 'amount:bigint'],
    });
    expect(dmConsoleAutoCp('SELECT fp.amount FROM fee_payments fp', fee)).toMatchObject({
      added: 'fp.contractor_id AS contractor_id',
      module: 'cps',
      fee: true,
    });
  });
});

/** Карта базы из описания схемы (`spec/prototype/db/schema.json`): «Есть в базе», внешние ключи. */
const real: DmBuildSchema = new Map(
  (
    schemaDoc as unknown as {
      tables: {
        name: string;
        status: string;
        columns: { name: string; type: string; fk?: string; status?: string }[];
      }[];
    }
  ).tables
    .filter((t) => t.status === 'actual')
    .map((t) => [
      t.name,
      {
        name: t.name,
        fields: t.columns
          .filter((c) => c.status !== 'planned')
          .map((c) => {
            const [table, field] = (c.fk ?? '').split('.');
            return {
              name: c.name,
              type: c.type,
              ref: c.fk ? { table: table!, field: field! } : null,
            };
          }),
      },
    ]),
);

describe('сборщик на карте базы продукта', () => {
  it('отчёты и контрагенты — одна связь по contractor_id', () => {
    const s0 = st(['contractors', 'reports']);
    const plan = dmBuildPlan(real, s0);
    expect(plan.steps).toEqual([expect.objectContaining({ t: 'reports', none: false, pick: 0 })]);
    const sql = dmBuildSql(real, dmBuildFill(s0, plan), plan);
    expect(sql).toMatch(/^SELECT\n/);
    expect(sql).toContain('FROM contractors c\nLEFT JOIN reports r ON r.contractor_id = c.id');
  });
  it('каждая заготовка «Заготовок» — запрос к таблицам этой карты', () => {
    for (const p of DM_CONSOLE_PRESETS) expect(dmConsoleAutoCp(p.sql, real), p.id).not.toBeNull();
  });
  it('у каждой заготовки — название и пояснение в словаре (ключи собирает экран из `id`)', () => {
    const keys: Record<string, unknown> = UI_TEXTS;
    for (const p of DM_CONSOLE_PRESETS) {
      expect(keys[`dm.con.pre.${p.id}`], p.id).toBeDefined();
      expect(keys[`dm.con.pre.${p.id}.d`], p.id).toBeDefined();
    }
  });
});
