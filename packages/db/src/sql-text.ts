import { sql, type SQL } from 'drizzle-orm';

/**
 * Постоянный текст прямо в запросе, а не параметром: Drizzle даёт параметру новый номер в каждом месте
 * запроса, и PostgreSQL не считает `select` и `group by` с ним одним выражением. Только для
 * постоянных текстов из кода (константы домена), никогда — для ввода пользователя; поэтому модуль не
 * выходит из пакета (`src/index.ts` его не экспортирует).
 */
export function textLiteral(value: string): SQL {
  return sql.raw(`'${value.replace(/'/g, "''")}'`);
}

/** Дата `YYYY-MM-DD` прямо в запросе (сегодня по Бишкеку для «Дней до срока» и просрочки). */
export function dateLiteral(value: string): SQL {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`dateLiteral: не дата «${value}»`);
  return sql.raw(`'${value}'::date`);
}
