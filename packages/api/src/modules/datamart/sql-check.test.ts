import { describe, expect, it, vi } from 'vitest';

// Разборщика нет (worker на VPS без wasm): опубликованный шаблон проверяется запасной проверкой по
// словам, сохранить шаблон нельзя (доработки 27.11.2026: консоль запросов, этап 0, П2).
vi.mock('@buhuchet/adapters/sql-parser', () => ({
  parsePgSql: async () => ({
    ok: false,
    unavailable: true,
    message: 'нет разборщика',
    position: null,
  }),
}));

const { dmPublishedSqlProblem, dmTemplateSqlProblem } = await import('./sql-check');

describe('проверка SQL без разборщика', () => {
  it('опубликованный шаблон: ожидание и блокировка — отказ, обычный запрос идёт; промах — в журнал', async () => {
    const miss = vi.fn();
    expect(await dmPublishedSqlProblem('select pg_sleep(20)', miss)).toEqual({
      code: 'forbidden',
      word: 'pg_sleep',
    });
    expect(await dmPublishedSqlProblem('select * from contractors for update', miss)).toEqual({
      code: 'lock',
    });
    expect(await dmPublishedSqlProblem('select count(*) from contractors', miss)).toBeNull();
    expect(miss).toHaveBeenCalledWith('unavailable');
  });

  it('сохранить шаблон без разборщика нельзя', async () => {
    expect(await dmTemplateSqlProblem('select 1 as n')).toEqual({
      code: 'syntax',
      error: 'нет разборщика',
    });
  });
});
