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

/**
 * Текст словаря прямо в запросе — там, где нельзя параметр (`textLiteral`). Тексты правит
 * администратор платформы, поэтому они в долларовых кавычках: внутри них ничего не экранируется, и ни
 * кавычка, ни обратная косая черта запрос не меняют. Метка подбирается так, чтобы закрывающая метка не
 * нашлась раньше конца текста; нулевой символ (в тексте PostgreSQL его не бывает) убирается. Ввод
 * пользователя организации — всё равно только параметром.
 */
export function dictLiteral(value: string): SQL {
  const text = value.replaceAll('\0', '');
  let tag = 't';
  for (let i = 1; `${text}$${tag}$`.indexOf(`$${tag}$`) !== text.length; i++) tag = `t${i}`;
  return sql.raw(`$${tag}$${text}$${tag}$`);
}
