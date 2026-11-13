import { describe, expect, it } from 'vitest';
import { dateLiteral, monthLiteral } from './sql-text';

// Значения, которые встают прямо в текст запроса, проверяются в самом слое базы: схема метода API —
// не единственная защита (месяц вкладки «По месяцам» приходит из запроса пользователя).
describe('значения прямо в тексте запроса', () => {
  it('месяц — только ГГГГ-ММ; кавычка, лишний текст и 13-й месяц — ошибка', () => {
    expect(() => monthLiteral('2026-09')).not.toThrow();
    for (const bad of [
      "2026-09'",
      "2026-09' or '1'='1",
      '2026-13',
      '2026-00',
      '2026-9',
      '',
      '2026-09-01',
    ]) {
      expect(() => monthLiteral(bad), bad).toThrow(/не месяц/);
    }
  });

  it('дата — только ГГГГ-ММ-ДД', () => {
    expect(() => dateLiteral('2026-09-30')).not.toThrow();
    for (const bad of ["2026-09-30'", '2026-09', "'; select 1; --"]) {
      expect(() => dateLiteral(bad), bad).toThrow(/не дата/);
    }
  });
});
