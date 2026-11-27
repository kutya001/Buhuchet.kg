import { dmSqlRules, type DmSqlMode } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { parsePgSql } from './sql-parser';

/** Правила по дереву настоящего разборщика PostgreSQL (доработки 27.11.2026: консоль запросов, П2). */
async function rules(text: string, mode: DmSqlMode) {
  const parsed = await parsePgSql(text);
  if (!parsed.ok) return { code: 'syntax' as const, message: parsed.message };
  return dmSqlRules(parsed.tree, mode);
}

describe('разборщик PostgreSQL', () => {
  it('дерево запроса и ошибка с позицией', async () => {
    const ok = await parsePgSql('select 1');
    expect(ok.ok).toBe(true);
    const bad = await parsePgSql('select from where');
    expect(bad).toMatchObject({ ok: false, message: expect.stringContaining('syntax error') });
    expect(bad.ok === false && bad.position).toBeGreaterThan(0);
  });
});

describe('консоль: отказ на запрещённое (блок 2, пункты 5 и 11)', () => {
  it.each([
    ['ожидание', 'select pg_sleep(1)', 'pg_sleep'],
    ['ожидание со схемой и кавычками', 'select "pg_catalog"."pg_sleep"(1)', 'pg_catalog.pg_sleep'],
    ['ожидание в подзапросе', "select (select 1 from pg_sleep_for('1s'))", 'pg_sleep_for'],
    ['блокировка', 'select pg_advisory_lock(1)', 'pg_advisory_lock'],
    ['блокировка транзакции', 'select pg_try_advisory_xact_lock(42)', 'pg_try_advisory_xact_lock'],
    ['запрос из строки', "select query_to_xml('select 1', true, true, '')", 'query_to_xml'],
    ['запрос из строки (ts_stat)', "select * from ts_stat('select 1')", 'ts_stat'],
    [
      'запись в журнал',
      "select pg_logical_emit_message(true, 'x', 'y')",
      'pg_logical_emit_message',
    ],
    ['файл сервера', "select pg_read_file('/etc/passwd')", 'pg_read_file'],
    ['каталог сервера', "select * from pg_ls_dir('.')", 'pg_ls_dir'],
    ['другая база', "select * from dblink('host=x', 'select 1') as t(a int)", 'dblink'],
    ['смена настроек', "select set_config('role', 'postgres', false)", 'set_config'],
    ['сигнал', 'select pg_cancel_backend(1)', 'pg_cancel_backend'],
    ['сигнал', 'select pg_terminate_backend(pid) from pg_stat_activity', 'pg_terminate_backend'],
    ['функция исполнителя', "select dm.run_admin('select 1', '[]', 1)", 'dm.run_admin'],
  ])('%s: %s', async (_, text, name) => {
    expect(await rules(text, 'console')).toMatchObject({ code: 'function', name });
  });

  it('запись, блокировка строк, смена роли, второй оператор', async () => {
    expect(await rules('insert into news(id) values (1)', 'console')).toMatchObject({
      code: 'not_select',
    });
    expect(await rules('update users set login = 1', 'console')).toMatchObject({
      code: 'not_select',
    });
    expect(await rules('delete from contractors', 'console')).toMatchObject({ code: 'not_select' });
    expect(
      await rules('with d as (delete from contractors returning id) select * from d', 'console'),
    ).toMatchObject({ code: 'write' });
    expect(await rules('select * into t2 from contractors', 'console')).toMatchObject({
      code: 'write',
    });
    expect(await rules('select * from contractors for update', 'console')).toMatchObject({
      code: 'lock',
    });
    expect(await rules('select 1 from contractors for share skip locked', 'console')).toMatchObject(
      {
        code: 'lock',
      },
    );
    expect(await rules('set role postgres', 'console')).toMatchObject({ code: 'not_select' });
    expect(await rules('reset role', 'console')).toMatchObject({ code: 'not_select' });
    expect(await rules('select 1; select 2', 'console')).toMatchObject({ code: 'two_statements' });
    expect(await rules('select 1; drop table users', 'console')).toMatchObject({
      code: 'two_statements',
    });
  });

  it('обычные запросы и системные таблицы консоли можно', async () => {
    for (const text of [
      'select count(*) from contractors',
      "select current_setting('TimeZone')",
      'select relname from pg_class limit 5',
      'select * from information_schema.columns',
      "with m as (select date_trunc('month', now()) as d) select extract(year from d) from m",
      "select ($1::text)::date + interval '1 day'",
    ]) {
      expect(await rules(text, 'console')).toBeNull();
    }
  });
});

describe('шаблоны и токены: только разрешённые функции (блок 2, пункт 7)', () => {
  it('обычные функции отчётов можно', async () => {
    for (const text of [
      "select to_char(date_trunc('month', r.due), 'YYYY-MM') as m, sum(coalesce(r.amount, 0)) from reports r group by 1",
      "select round(avg(x), 2), string_agg(name, ', ' order by name) from t",
      'select extract(year from now()), make_date(2026, 1, 1), generate_series(1, 3)',
      'select row_number() over (order by id), lag(id) over () from t',
      "select trim(both ' ' from name), substring(name from 1 for 3), position('a' in name) from t",
      "select now() at time zone 'Asia/Bishkek', greatest(1, 2), nullif(a, 0) from t",
    ]) {
      expect(await rules(text, 'template')).toBeNull();
    }
  });

  it('не из списка, системные таблицы — отказ', async () => {
    expect(await rules("select current_setting('role')", 'template')).toMatchObject({
      code: 'function',
      name: 'current_setting',
    });
    expect(await rules('select * from pg_roles', 'template')).toMatchObject({
      code: 'system_table',
      name: 'pg_roles',
    });
    expect(await rules('select * from information_schema.tables', 'template')).toMatchObject({
      code: 'system_table',
    });
    expect(await rules('select pg_sleep(1)', 'template')).toMatchObject({ code: 'function' });
  });
});
