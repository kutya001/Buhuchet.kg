/** Код ошибки PostgreSQL и имя нарушенного ограничения — из ошибки драйвера или её причины. */
function pgError(error: unknown, code: string): string | null {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === code) return pg.constraint_name ?? '';
  }
  return null;
}

/** Имя нарушенного ограничения уникальности (код 23505), если ошибка — она; иначе null. */
export function uniqueViolation(error: unknown): string | null {
  return pgError(error, '23505');
}

/** Имя нарушенного внешнего ключа (код 23503), если ошибка — она; иначе null. */
export function foreignKeyViolation(error: unknown): string | null {
  return pgError(error, '23503');
}

/**
 * Запрос прерван по пределу времени (`statement_timeout`, код 57014): так база отвечает на запрос
 * дольше предела вида работы (`QUERY_TIMEOUT_MS`). Отменять запросы иначе приложение не умеет.
 */
export function queryTimedOut(error: unknown): boolean {
  return pgError(error, '57014') !== null;
}
