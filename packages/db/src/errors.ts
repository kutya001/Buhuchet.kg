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
