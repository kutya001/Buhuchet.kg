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
  'contractor',
  // Страница контрагента по ссылке (задача 2.42): включение, код, разделы, открытия.
  'contractor_page',
  // Загрузка контрагентов из Excel (задача 2.16): кто, когда, сколько создано и пропущено.
  'contractor_import',
  'assignment',
  'report',
  'task',
  'file',
  'org_report_type',
  'dict_request',
  'org_account',
  'employee_wallet',
  // Деньги контрагента: поступление, оплата налога и другие операции (задача 2.19).
  'money_operation',
  // Оплата за обслуживание с распределением по месяцам (задача 2.21).
  'fee_payment',
  // Разовая услуга и её оплаты (задача 2.22).
  'one_off_service',
  'one_off_service_payment',
  // Проект контрагента (задача 2.26): поля, ответственные, работы, файлы.
  'project',
  // Оплата по проекту — транш (задача 2.26, часть 2).
  'project_payment',
  // Показатели контрагентов: показатель (настройка, «Кому вести»), значение за месяц, ввод из Excel.
  'indicator',
  'indicator_value',
  'indicator_import',
  'news',
  'ui_text',
  'platform_dict',
  // Админка → «Телеграм» → «Рассылка»: кто, когда, кому и с каким текстом поставил объявление (задача 2.41).
  'telegram_broadcast',
  // Админка → «Телеграм» → «Бот платформы» → «Сообщения с таблицами» (поток Т, задача Т1).
  'telegram_bot',
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
  // Учётная запись: вход закрыт после 10 неверных паролей подряд (от имени системы, миграция 0095).
  'login_lock',
  // Админка → карточка пользователя (прототип v83): карточку открыл администратор платформы; он же
  // завершил все сеансы пользователя.
  'card_view',
  'sessions_end',
  // Страница контрагента по ссылке: включена, выключена, сменён код, скопирована и отправлена ссылка,
  // открыта контрагентом, ввод кода закрыт после неверных кодов подряд, страница закрыта до смены
  // кода после неверных кодов за сутки (docs/deviations.md п. О-21).
  'page_on',
  'page_off',
  'page_code',
  'page_copy',
  // Скопирован код доступа (прототип v86, `codecopy`).
  'page_code_copy',
  'page_send',
  'page_open',
  'page_lock',
  'page_close',
  // Файлы записи (блок «Файлы»): «Прикреплён файл», «Удалён файл» — в истории той записи; скрыт со
  // страницы контрагента и снова показывается на ней (решение заказчика 06.11.2026).
  'file_attach',
  'file_delete',
  'file_hide',
  'file_show',
  // Плата за обслуживание: «Напоминание в WhatsApp о долге за обслуживание» (задача 2.21).
  'remind',
  // Работы проекта: «Добавлена работа», «Сделано», «Снова в работе» (задача 2.26).
  'work_add',
  'work_done',
  'work_undone',
  // Справочники платформы: загрузка из Excel и её откат («Загрузки»).
  'import',
  'rollback',
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
