import { describe, expect, it } from 'vitest';
import {
  dmColumnsProblem,
  dmCopyCode,
  dmQueryParamNames,
  dmQueryProblem,
  dmResultColumnsProblem,
  dmStateChangeAllowed,
  dmSyncColumns,
  dmSyncParams,
  dmTemplatePublished,
  type DmEditorColumn,
} from './editor';

const col = (code: string, type: DmEditorColumn['type'] = 'text'): DmEditorColumn => ({
  code,
  name: `Столбец ${code}`,
  type,
  total: false,
});

describe('текст запроса (прототип dmSqlErr)', () => {
  it('пусто, не SELECT, второй оператор, лишнее слово', () => {
    expect(dmQueryProblem('  -- только комментарий\n ')).toEqual({ code: 'empty' });
    expect(dmQueryProblem('update contractors set name = 1')).toEqual({ code: 'not_select' });
    expect(dmQueryProblem('select 1; select 2')).toEqual({ code: 'two_statements' });
    expect(dmQueryProblem('select pg_sleep(10)')).toEqual({ code: 'forbidden', word: 'pg_sleep' });
    expect(dmQueryProblem('WITH x AS (select 1) DELETE FROM x')).toEqual({
      code: 'forbidden',
      word: 'delete',
    });
    expect(dmQueryProblem("select 'не закрыта")).toEqual({ code: 'unclosed' });
    expect(dmQueryProblem('select $1')).toEqual({ code: 'positional' });
  });

  it('обычные имена столбцов не считаются запрещёнными словами', () => {
    expect(
      dmQueryProblem(
        '/* шапка */ select c.created_at, c.updated_at, u.login_lock_reason, d.copied_from\nfrom contractors c;',
      ),
    ).toBeNull();
  });

  it('параметры по порядку, без строк, комментариев и приведения типа', () => {
    expect(
      dmQueryParamNames(
        'select :month, \':skip\', "x:y", now()::date -- :comment\n where a = :date_from and b = :month',
      ),
    ).toEqual(['month', 'date_from']);
    const many = Array.from({ length: 21 }, (_, i) => `:p${i}`).join(', ');
    expect(dmQueryParamNames(`select ${many}`)).toEqual({ code: 'too_many_params' });
    expect(dmQueryProblem(`select ${many}`)).toEqual({ code: 'too_many_params' });
  });
});

describe('параметры и столбцы после «Проверить» (прототип syncPars)', () => {
  it('новые параметры — обязательные, тип по имени; прежние сохраняют настройки', () => {
    const kept = {
      code: 'month',
      name: 'Месяц отчёта',
      type: 'month' as const,
      required: false,
      default: 'month',
    };
    expect(dmSyncParams(['date_from', 'month', 'year', 'q'], [kept])).toEqual([
      { code: 'date_from', name: 'date_from', type: 'date', required: true, default: null },
      kept,
      { code: 'year', name: 'year', type: 'year', required: true, default: null },
      { code: 'q', name: 'q', type: 'text', required: true, default: null },
    ]);
  });

  it('столбцы ответа: contractor_id — «Контрагент», прежние сохраняют название и тип', () => {
    const sum = { ...col('sum', 'money'), total: true };
    expect(dmSyncColumns(['contractor_id', 'sum', 'cp'], [sum])).toEqual([
      { code: 'contractor_id', name: 'contractor_id', type: 'cp', total: false },
      sum,
      { code: 'cp', name: 'cp', type: 'text', total: false },
    ]);
  });

  it('столбцы ответа: нет, не латиницей, дважды, пропал опубликованный', () => {
    expect(dmResultColumnsProblem([], null)).toEqual({ code: 'no_columns' });
    expect(dmResultColumnsProblem(['ok', '?column?'], null)).toEqual({
      code: 'bad_name',
      column: '?column?',
    });
    expect(dmResultColumnsProblem(['a', 'a'], null)).toEqual({ code: 'dup_name', column: 'a' });
    expect(dmResultColumnsProblem(['a'], [col('a'), col('b')])).toEqual({
      code: 'removed',
      column: 'Столбец b',
    });
    expect(dmResultColumnsProblem(['a', 'b', 'c'], [col('a'), col('b')])).toBeNull();
  });

  it('состав столбцов при сохранении: дважды, два «Контрагента», убран опубликованный', () => {
    expect(dmColumnsProblem([col('a'), col('a')], null)).toEqual({
      code: 'dup_name',
      column: 'a',
    });
    expect(dmColumnsProblem([col('a', 'cp'), col('b', 'cp')], null)).toEqual({ code: 'two_cp' });
    expect(dmColumnsProblem([col('a')], [col('a'), col('b')])).toEqual({
      code: 'removed',
      column: 'Столбец b',
    });
    expect(dmColumnsProblem([col('a'), col('b'), col('c')], [col('a'), col('b')])).toBeNull();
    expect(
      dmColumnsProblem(
        Array.from({ length: 101 }, (_, i) => col(`c${i}`)),
        null,
      ),
    ).toEqual({
      code: 'too_many',
    });
  });
});

describe('состояния и копия (прототип dmStateDlg, dmCopy)', () => {
  it('«Отключить» — опубликованный и сломанный, «Включить» — только отключённый', () => {
    expect(dmStateChangeAllowed('published', 'off')).toBe(true);
    expect(dmStateChangeAllowed('broken', 'off')).toBe(true);
    expect(dmStateChangeAllowed('draft', 'off')).toBe(false);
    expect(dmStateChangeAllowed('off', 'off')).toBe(false);
    expect(dmStateChangeAllowed('off', 'published')).toBe(true);
    expect(dmStateChangeAllowed('draft', 'published')).toBe(false);
    expect(dmStateChangeAllowed('broken', 'published')).toBe(false);
    expect(dmTemplatePublished('draft')).toBe(false);
    expect(dmTemplatePublished('off')).toBe(true);
  });

  it('код копии: -copy, затем -copy2…; длинный код укорачивается до 60 знаков', () => {
    expect(dmCopyCode('reports-due', new Set())).toBe('reports-due-copy');
    expect(dmCopyCode('reports-due', new Set(['reports-due-copy', 'reports-due-copy2']))).toBe(
      'reports-due-copy3',
    );
    const long = `a${'b'.repeat(58)}c`;
    const copy = dmCopyCode(long, new Set());
    expect(copy).toHaveLength(60);
    expect(copy.endsWith('-copy')).toBe(true);
    expect(dmCopyCode('ab-', new Set())).toBe('ab-copy');
  });
});
