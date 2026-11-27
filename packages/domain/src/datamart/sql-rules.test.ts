import { describe, expect, it } from 'vitest';
import { DM_TEMPLATE_FUNCTIONS, dmSqlDeniedWord, dmSqlRules } from './sql-rules';

/*
 * Деревья — в том виде, в каком их отдаёт разборщик PostgreSQL (libpg_query 17, `parsePgSql`), только
 * нужные узлы. Тот же набор на настоящем разборщике — packages/adapters/src/sql-parser.test.ts.
 */
const fn = (name: string[], location = 7, args: unknown[] = []) => ({
  FuncCall: { funcname: name.map((sval) => ({ String: { sval } })), args, location },
});
const rel = (relname: string, schemaname?: string, location = 14) => ({
  RangeVar: { relname, ...(schemaname ? { schemaname } : {}), inh: true, location },
});
const select = (body: Record<string, unknown>) => ({ SelectStmt: body });
const tree = (...stmts: unknown[]) => ({
  version: 170007,
  stmts: stmts.map((stmt, i) => ({ stmt, stmt_location: i * 10 })),
});
const target = (val: unknown) => ({ ResTarget: { val, location: 7 } });

describe('один оператор, только SELECT', () => {
  it('два оператора, пусто, не SELECT', () => {
    const one = select({ targetList: [target({ A_Const: { ival: { ival: 1 } } })] });
    expect(dmSqlRules(tree(one, one), 'console')).toEqual({
      code: 'two_statements',
      position: 10,
    });
    expect(dmSqlRules(tree(), 'console')).toEqual({ code: 'not_select', position: 0 });
    expect(dmSqlRules({}, 'console')).toEqual({ code: 'not_select', position: 0 });
    expect(dmSqlRules(tree({ UpdateStmt: {} }), 'template')).toEqual({
      code: 'not_select',
      position: 0,
    });
    expect(dmSqlRules(tree(one), 'console')).toBeNull();
    expect(dmSqlRules(tree(one), 'template')).toBeNull();
  });

  it('запись внутри WITH и SELECT … INTO — отказ', () => {
    const cte = select({
      withClause: {
        ctes: [{ CommonTableExpr: { ctename: 'x', ctequery: { DeleteStmt: {} }, location: 5 } }],
      },
      targetList: [target({ A_Const: { ival: { ival: 1 } } })],
    });
    expect(dmSqlRules(tree(cte), 'console')).toEqual({ code: 'write', position: 0 });
    const into = select({ intoClause: { rel: rel('t') }, targetList: [] });
    expect(dmSqlRules(tree(into), 'console')).toEqual({ code: 'write', position: 0 });
  });

  it('FOR UPDATE и FOR SHARE — отказ', () => {
    const locked = select({
      targetList: [],
      fromClause: [rel('contractors')],
      lockingClause: [{ LockingClause: { strength: 'LCS_FORUPDATE' } }],
    });
    expect(dmSqlRules(tree(locked), 'console')).toEqual({ code: 'lock', position: 0 });
  });
});

describe('консоль: любые функции, кроме запрещённых', () => {
  const call = (name: string[], mode: 'console' | 'template' = 'console') =>
    dmSqlRules(tree(select({ targetList: [target(fn(name))] })), mode);

  it('ожидание, блокировки, запрос из строки, файлы, настройки, сигналы', () => {
    for (const name of [
      'pg_sleep',
      'pg_advisory_lock',
      'pg_try_advisory_xact_lock',
      'query_to_xml',
      'ts_stat',
      'pg_logical_emit_message',
      'pg_read_file',
      'pg_ls_dir',
      'dblink_exec',
      'lo_import',
      'set_config',
      'pg_cancel_backend',
      'pg_terminate_backend',
      'nextval',
    ]) {
      expect(call([name])).toEqual({ code: 'function', name, position: 7 });
    }
  });

  it('со схемой: pg_catalog.pg_sleep — отказ, функции app и dm — отказ', () => {
    expect(call(['pg_catalog', 'pg_sleep'])).toEqual({
      code: 'function',
      name: 'pg_catalog.pg_sleep',
      position: 7,
    });
    expect(call(['dm', 'run_admin'])).toMatchObject({ code: 'function', name: 'dm.run_admin' });
    expect(call(['app', 'current_org_id'])).toMatchObject({ code: 'function' });
  });

  it('обычные и системные функции и таблицы можно', () => {
    expect(call(['current_setting'])).toBeNull();
    expect(call(['pg_size_pretty'])).toBeNull();
    expect(call(['pg_catalog', 'extract'])).toBeNull();
    const sys = select({ targetList: [], fromClause: [rel('pg_stat_activity')] });
    expect(dmSqlRules(tree(sys), 'console')).toBeNull();
  });

  it('функция в подзапросе и во FROM видна', () => {
    const deep = select({
      targetList: [
        target({
          SubLink: {
            subselect: select({
              targetList: [],
              fromClause: [
                { RangeFunction: { functions: [{ List: { items: [fn(['pg_sleep'], 40)] } }] } },
              ],
            }),
          },
        }),
      ],
    });
    expect(dmSqlRules(tree(deep), 'console')).toEqual({
      code: 'function',
      name: 'pg_sleep',
      position: 40,
    });
  });
});

describe('шаблоны и токены: только функции из списка', () => {
  const call = (name: string[]) =>
    dmSqlRules(tree(select({ targetList: [target(fn(name))] })), 'template');

  it('функции готовых шаблонов — в списке', () => {
    // Все функции 18 готовых шаблонов продукта (DM_BUILTIN_SQL, разобраны 27.11.2026).
    for (const name of ['count', 'date_trunc', 'generate_series', 'make_date', 'max', 'extract']) {
      expect(DM_TEMPLATE_FUNCTIONS).toContain(name);
    }
    for (const name of ['round', 'sum', 'to_char', 'translate']) {
      expect(call([name])).toBeNull();
    }
    expect(call(['pg_catalog', 'extract'])).toBeNull();
  });

  it('не из списка — отказ; схема не pg_catalog — отказ', () => {
    expect(call(['current_setting'])).toEqual({
      code: 'function',
      name: 'current_setting',
      position: 7,
    });
    expect(call(['pg_sleep'])).toMatchObject({ code: 'function', name: 'pg_sleep' });
    expect(call(['public', 'count'])).toMatchObject({ code: 'function', name: 'public.count' });
  });

  it('системные таблицы — отказ', () => {
    const from = (r: unknown) =>
      dmSqlRules(tree(select({ targetList: [], fromClause: [r] })), 'template');
    expect(from(rel('pg_roles'))).toEqual({ code: 'system_table', name: 'pg_roles', position: 14 });
    expect(from(rel('tables', 'information_schema'))).toMatchObject({
      code: 'system_table',
      name: 'information_schema.tables',
    });
    expect(from(rel('pg_class', 'pg_catalog'))).toMatchObject({ code: 'system_table' });
    expect(from(rel('contractors'))).toBeNull();
    expect(from(rel('contractors', 'public'))).toBeNull();
  });
});

describe('запасная проверка без разборщика (worker)', () => {
  it('ожидание, блокировки, запрос из строки и функции схем app и dm — отказ; обычный запрос — нет', () => {
    expect(dmSqlDeniedWord('select pg_sleep(1)')).toMatchObject({
      code: 'function',
      name: 'pg_sleep',
    });
    expect(dmSqlDeniedWord('select PG_CATALOG . Pg_Sleep (1)')).toMatchObject({
      code: 'function',
      name: 'pg_catalog.pg_sleep',
    });
    expect(dmSqlDeniedWord('select "pg_sleep"(1)')).toMatchObject({ code: 'function' });
    expect(dmSqlDeniedWord('select pg_advisory_xact_lock(1)')).toMatchObject({ code: 'function' });
    expect(dmSqlDeniedWord("select query_to_xml('select 1', true, true, '')")).toMatchObject({
      code: 'function',
    });
    expect(dmSqlDeniedWord('select app.current_org_id()')).toMatchObject({
      code: 'function',
      name: 'app.current_org_id',
    });
    expect(dmSqlDeniedWord('select * from contractors for update')).toMatchObject({ code: 'lock' });
    expect(dmSqlDeniedWord('select * from contractors for no key update')).toMatchObject({
      code: 'lock',
    });
    expect(
      dmSqlDeniedWord(
        "select count(*), coalesce(sum(x), 0) from t where d >= date_trunc('month', now())",
      ),
    ).toBeNull();
    // Строже разборщика: имя в строке тоже отказ — без разборщика не отличить.
    expect(dmSqlDeniedWord("select 'pg_sleep(1)'")).toMatchObject({ code: 'function' });
  });
});
