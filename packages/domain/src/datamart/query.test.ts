import { describe, expect, it } from 'vitest';
import refDB from '../../../../spec/data/refDB.json';
import {
  dmBind,
  dmCell,
  dmParamDefault,
  dmParamValue,
  dmParseSql,
  type DmParamDef,
  isDmParamType,
} from './query';

const p = (k: string, type: DmParamDef['type'], req = true, def: string | null = null) => ({
  k,
  type,
  req,
  def,
});

describe('dmParseSql: параметры :имя становятся $n с приведением к типу', () => {
  const defs = [p('month', 'month'), p('date_from', 'date'), p('cp', 'list:cp', false)];

  it('один параметр дважды — один номер; порядок номеров — по первому появлению', () => {
    expect(
      dmParseSql(
        "SELECT * FROM r WHERE m = to_date(:month, 'YYYY-MM') AND d >= :date_from AND m2 = :month",
        defs,
      ),
    ).toEqual({
      text: "SELECT * FROM r WHERE m = to_date(($1::text), 'YYYY-MM') AND d >= ($2::date) AND m2 = ($1::text)",
      names: ['month', 'date_from'],
    });
  });

  it('приведение ::, строки, имена в кавычках, комментарии и $метка$ не трогаются', () => {
    const sql = [
      "SELECT x::date, ':month' AS a, E'\\' :month' AS b, \"col:month\" AS c, $q$ :month $q$ AS d",
      '-- :month в комментарии',
      '/* :month /* вложенный :month */ всё ещё комментарий */',
      'FROM t WHERE v = :cp',
    ].join('\n');
    const r = dmParseSql(sql, defs);
    expect(r).toEqual({ text: sql.replace(':cp', '($1::uuid)'), names: ['cp'] });
  });

  it('последняя «;» и комментарий после неё убираются; второй оператор — отказ', () => {
    expect(dmParseSql('SELECT 1; -- конец\n', defs)).toEqual({ text: 'SELECT 1', names: [] });
    expect(dmParseSql('SELECT 1; DELETE FROM contractors', defs)).toEqual({
      problem: 'two_statements',
    });
    expect(dmParseSql("SELECT ';' AS s; SELECT 2", defs)).toEqual({ problem: 'two_statements' });
  });

  it('позиционные $1, незакрытая строка и параметр не из шаблона — отказ', () => {
    expect(dmParseSql('SELECT $1', defs)).toEqual({ problem: 'positional' });
    expect(dmParseSql("SELECT 'x", defs)).toEqual({ problem: 'unclosed' });
    expect(dmParseSql('SELECT "x', defs)).toEqual({ problem: 'unclosed' });
    expect(dmParseSql('SELECT 1 /* x', defs)).toEqual({ problem: 'unclosed' });
    expect(dmParseSql('SELECT $a$ x', defs)).toEqual({ problem: 'unclosed' });
    expect(dmParseSql('SELECT :org_id', defs)).toEqual({
      problem: 'unknown_param',
      name: 'org_id',
    });
  });

  it('знак $ внутри имени и одиночный $ — не строка и не параметр', () => {
    expect(dmParseSql('SELECT a$b, 1 $ 2', defs)).toEqual({ text: 'SELECT a$b, 1 $ 2', names: [] });
  });
});

describe('dmParamValue и dmParamDefault: значения по типам и по умолчанию (прототип dmDef)', () => {
  it('значения по умолчанию на 20.11.2026', () => {
    const today = '2026-11-20';
    expect(dmParamDefault('today', today)).toBe('2026-11-20');
    expect(dmParamDefault('month', today)).toBe('2026-11');
    expect(dmParamDefault('year', today)).toBe('2026');
    expect(dmParamDefault('month_start', today)).toBe('2026-11-01');
    expect(dmParamDefault('month_end', today)).toBe('2026-11-30');
    expect(dmParamDefault('days_ago_30', today)).toBe('2026-10-21');
    expect(dmParamDefault('month_ago_5', today)).toBe('2026-06');
    expect(dmParamDefault('2026-01', today)).toBe('2026-01');
    expect(dmParamDefault(null, today)).toBeNull();
    expect(dmParamDefault('', today)).toBeNull();
  });

  it.each([
    ['date', '2026-02-28', '2026-02-28'],
    ['date', '2026-02-30', null],
    ['date', "2026-01-01'; drop", null],
    ['month', '2026-11', '2026-11'],
    ['month', '2026-13', null],
    ['year', '2026', '2026'],
    ['year', '1850', null],
    ['num', '-12.5', '-12.5'],
    ['num', '1e9', null],
    ['text', "O'Neil", "O'Neil"],
    ['text', 'x'.repeat(501), null],
    ['bool', 'true', 'true'],
    ['bool', 'да', null],
    ['list:cp', '7F1D7C8E-1E0B-4C3A-9F00-1234567890AB', '7f1d7c8e-1e0b-4c3a-9f00-1234567890ab'],
    ['list:emp', 'not-a-uuid', null],
    ['list:rtype', 'sti-091', 'sti-091'],
    ['list:status', 'сдан', null],
  ] as const)('%s «%s» → %s', (type, raw, out) => {
    expect(dmParamValue(type, raw)).toBe(out);
  });

  it('isDmParamType знает все типы прототипа', () => {
    expect(isDmParamType('list:cp')).toBe(true);
    expect(isDmParamType('list:org')).toBe(false);
  });
});

describe('dmBind: запрос и значения для исполнителя', () => {
  const defs = [p('month', 'month', true, 'month'), p('status', 'list:status', false)];
  const sql = 'SELECT * FROM r WHERE m = :month AND (:status IS NULL OR s = :status)';

  it('пусто — значение по умолчанию, лишние параметры отбрасываются', () => {
    expect(dmBind(sql, defs, { org_id: 'чужая', month: '' }, '2026-11-20')).toEqual({
      ok: true,
      text: 'SELECT * FROM r WHERE m = ($1::text) AND (($2::text) IS NULL OR s = ($2::text))',
      params: ['2026-11', null],
    });
  });

  it('значение не по типу и пустой обязательный — «Неверный параметр»', () => {
    expect(dmBind(sql, defs, { month: '11.2026' }, '2026-11-20')).toEqual({
      ok: false,
      error: 'param',
      param: 'month',
      why: 'type',
    });
    expect(dmBind('SELECT :month', [p('month', 'month')], {}, '2026-11-20')).toEqual({
      ok: false,
      error: 'param',
      param: 'month',
      why: 'required',
    });
  });

  it('ошибка текста запроса и больше 20 параметров — ошибка шаблона', () => {
    expect(dmBind('SELECT 1; SELECT 2', defs, {}, '2026-11-20')).toEqual({
      ok: false,
      error: 'sql',
      problem: 'two_statements',
    });
    const many = Array.from({ length: 21 }, (_, i) => p(`p${i}`, 'text', false));
    expect(dmBind('SELECT 1', many, {}, '2026-11-20')).toEqual({
      ok: false,
      error: 'sql',
      problem: 'too_many_params',
    });
  });

  it('все готовые шаблоны прототипа разбираются со значениями по умолчанию', () => {
    const templates = refDB.dmTemplates as { code: string; sql: string; params: DmParamDef[] }[];
    expect(templates.length).toBe(18);
    for (const t of templates) {
      const r = dmBind(t.sql, t.params, {}, '2026-11-20');
      expect(r, t.code).toMatchObject({ ok: true });
      if (r.ok) {
        expect(r.text, t.code).not.toMatch(/(^|[^:]):[a-z_]/);
        expect(r.params.length, t.code).toBeLessThanOrEqual(t.params.length);
      }
    }
  });
});

describe('dmCell: деньги — тыйыны в сомы числом', () => {
  it('125050 → 1250.5, строка bigint — тоже, остальное как есть', () => {
    expect(dmCell('money', 125050)).toBe(1250.5);
    expect(dmCell('money', '-99')).toBe(-0.99);
    expect(dmCell('money', null)).toBeNull();
    expect(dmCell('money', 'x')).toBe('x');
    expect(dmCell('num', 125050)).toBe(125050);
  });
});
