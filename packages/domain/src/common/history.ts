/**
 * История изменений (ТЗ «Общие правила для всей платформы»): любое изменение важных данных
 * записывается — кто, когда, что было и что стало. Здесь — что считается изменением и как значения
 * полей попадают в историю; запись в базу — `writeHistory` и `updateWithHistory` из @buhuchet/db.
 */

/** Записи, у которых ведётся история. Модуль добавляет свои, когда появляются его таблицы. */
export const HISTORY_ENTITIES = [
  'organization',
  'org_settings',
  'user',
  'employee',
  'role',
  'file',
  'org_report_type',
  'dict_request',
] as const;
export type HistoryEntity = (typeof HISTORY_ENTITIES)[number];

/**
 * Что сделали с записью. Смена статуса с откатом — отдельная «История статусов» (#17), не здесь.
 * Модуль добавляет свои действия (например, «напоминание отправлено»), когда они появляются.
 */
export const HISTORY_ACTIONS = [
  'create',
  'update',
  'delete',
  // Файлы записи (блок «Файлы»): «Прикреплён файл», «Удалён файл» — в истории той записи.
  'file_attach',
  'file_delete',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/** Значение поля в истории — как в JSON. */
export type HistoryValue =
  string | number | boolean | null | HistoryValue[] | { [key: string]: HistoryValue };

/** Одно изменённое поле: было → стало. У секретных полей значений нет — только факт изменения. */
export interface HistoryChange {
  field: string;
  from?: HistoryValue;
  to?: HistoryValue;
}

/**
 * Поля, значения которых в историю не пишутся никогда, — только факт изменения. Кроме списка
 * секретным считается любое поле с окончанием Hash, Token или Secret (хеш сеанса, код
 * привязки Telegram, хеш кода страницы контрагента): так новое секретное поле не утечёт случайно.
 */
export const HISTORY_SECRET_FIELDS: readonly string[] = ['passwordHash'];
const SECRET_FIELD_SUFFIX = /(Hash|Token|Secret)$/;

/** Секретное ли поле: по общему правилу или по списку вызова. */
export function isSecretField(field: string, extra: readonly string[] = []): boolean {
  return (
    HISTORY_SECRET_FIELDS.includes(field) ||
    SECRET_FIELD_SUFFIX.test(field) ||
    extra.includes(field)
  );
}

/** Убрать значения секретных полей из готового списка изменений. */
export function redactChanges(
  changes: readonly HistoryChange[],
  secretFields: readonly string[] = [],
): HistoryChange[] {
  return changes.map((c) => (isSecretField(c.field, secretFields) ? { field: c.field } : c));
}

/** Значение поля для истории: дата — строкой ISO, отсутствие — null, вложенное — как в JSON. */
export function toHistoryValue(value: unknown): HistoryValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toHistoryValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, toHistoryValue(v)]),
    );
  }
  return String(value);
}

/** Одинаковы ли значения; у объектов порядок ключей не важен, у массивов — важен. */
export function sameHistoryValue(a: HistoryValue, b: HistoryValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameHistoryValue(x, b[i]!))
    );
  }
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length && ka.every((k) => k in b && sameHistoryValue(a[k]!, b[k]!))
  );
}

/**
 * Что изменит правка: поля из `patch`, значение которых отличается от `before`. Поля со значением
 * undefined правкой не считаются (их не трогают). Порядок — как в `patch`.
 */
export function diffChanges(
  before: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
  /** Секретные поля сверх общего правила (`isSecretField`). */
  secretFields: readonly string[] = [],
): HistoryChange[] {
  const changes: HistoryChange[] = [];
  for (const [field, next] of Object.entries(patch)) {
    if (next === undefined) continue;
    const from = toHistoryValue(before[field]);
    const to = toHistoryValue(next);
    if (sameHistoryValue(from, to)) continue;
    changes.push(isSecretField(field, secretFields) ? { field } : { field, from, to });
  }
  return changes;
}
