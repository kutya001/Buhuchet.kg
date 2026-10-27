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
