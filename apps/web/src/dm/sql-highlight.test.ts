import { describe, expect, it } from 'vitest';
import { sqlLineNumbers, sqlTokens } from './sql-highlight';

// Подсветка SQL в окне шаблона — прототип v161 `dmHl`, `dmLn` (просьба заказчика 21.11.2026).

const kinds = (sql: string) => sqlTokens(sql).map((t) => [t.kind, t.text]);
const joined = (sql: string) =>
  sqlTokens(sql)
    .map((t) => t.text)
    .join('');

describe('sqlTokens', () => {
  it('ключевые слова, таблицы базы, параметры, строки, числа и комментарии — своим видом', () => {
    expect(
      kinds(
        "SELECT c.name AS cp -- имя\nFROM contractors c\nWHERE r.due_date >= :date_from AND r.status = 'Сдан' LIMIT 10",
      ),
    ).toEqual([
      ['keyword', 'SELECT'],
      ['plain', ' c.name '],
      ['keyword', 'AS'],
      ['plain', ' cp '],
      ['comment', '-- имя'],
      ['plain', '\n'],
      ['keyword', 'FROM'],
      ['plain', ' '],
      ['table', 'contractors'],
      ['plain', ' c\n'],
      ['keyword', 'WHERE'],
      ['plain', ' r.due_date >= '],
      ['param', ':date_from'],
      ['plain', ' '],
      ['keyword', 'AND'],
      ['plain', ' r.status = '],
      ['string', "'Сдан'"],
      ['plain', ' '],
      ['keyword', 'LIMIT'],
      ['plain', ' '],
      ['number', '10'],
    ]);
  });

  it('`::тип` — приведение типа, а не параметр; таблицы администратора тоже подсвечены', () => {
    expect(kinds('x::date')).toEqual([
      ['plain', 'x'],
      ['keyword', '::date'],
    ]);
    expect(kinds('from Organizations')).toEqual([
      ['keyword', 'from'],
      ['plain', ' '],
      ['table', 'Organizations'],
    ]);
  });

  it('слова и параметры внутри строки и комментария не подсвечиваются', () => {
    expect(kinds("'select :a 1' /* from :b 2 */")).toEqual([
      ['string', "'select :a 1'"],
      ['plain', ' '],
      ['comment', '/* from :b 2 */'],
    ]);
    // Удвоенная кавычка — часть строки.
    expect(kinds("'it''s' x")).toEqual([
      ['string', "'it''s'"],
      ['plain', ' x'],
    ]);
  });

  it('незакрытые строка и комментарий — до конца текста', () => {
    expect(kinds("a 'не закрыта\nselect")).toEqual([
      ['plain', 'a '],
      ['string', "'не закрыта\nselect"],
    ]);
    expect(kinds('a /* не закрыт\nselect')).toEqual([
      ['plain', 'a '],
      ['comment', '/* не закрыт\nselect'],
    ]);
  });

  it('куски подряд дают исходный текст: разметки и знаков `<`, `&` подсветка не меняет', () => {
    for (const sql of [
      '',
      '\n\n',
      'SELECT 1',
      'SELECT \'<b>\' AS a, 1 < 2 AND 3 > 2 -- <script>alert(1)</script> & "x"\n',
      'select 1.5, 10, a1, _x, :p, ::int, 2026-11',
      "/*/ '' -- :: 'a",
    ]) {
      expect(joined(sql), sql).toBe(sql);
    }
    expect(sqlTokens('')).toEqual([]);
  });

  it('длинный запрос разбирается за время, а не за квадрат', () => {
    const long = `${"'".repeat(20_000)}${'/*'.repeat(20_000)}${'-'.repeat(20_000)}`;
    expect(joined(long)).toBe(long);
  });
});

describe('sqlLineNumbers', () => {
  it('номера строк по числу переводов строки', () => {
    expect(sqlLineNumbers('')).toBe('1');
    expect(sqlLineNumbers('select 1')).toBe('1');
    expect(sqlLineNumbers('a\nb\nc')).toBe('1\n2\n3');
    expect(sqlLineNumbers('a\n')).toBe('1\n2');
  });
});
