/**
 * Подписки организаций (доработки 20.11.2026, блоки 1–6; пакет 2, блок 6): виды подписок, цены и
 * реквизиты, подписка организации и «История оплат» — та же модель, что у прототипа
 * (`spec/prototype/src/js/core/subs.js`: `org.sub`, `DB.subPays`, `ref.subKinds`, `ref.subPrices`).
 * Таблицы — миграция 0165 (этап 0), правила расчёта и экраны — этапы 1–2.
 */

/**
 * Что оплачено (прототип `SUB_WHAT`): продление, расширение пакета, память сверх — заявки владельца с
 * чеком; бесплатный период и «Изменено администратором» — записи администратора без чека.
 */
export const SUBSCRIPTION_OWNER_PAYMENT_KINDS = ['renew', 'grow', 'mem'] as const;
export const SUBSCRIPTION_ADMIN_PAYMENT_KINDS = ['free', 'admin'] as const;
export const SUBSCRIPTION_PAYMENT_KINDS = [
  ...SUBSCRIPTION_OWNER_PAYMENT_KINDS,
  ...SUBSCRIPTION_ADMIN_PAYMENT_KINDS,
] as const;
export type SubscriptionPaymentKind = (typeof SUBSCRIPTION_PAYMENT_KINDS)[number];

/** Расширение «Сейчас» или «Со следующего месяца» (блок 3, пункт 3; прототип `from`). */
export const SUBSCRIPTION_START_MODES = ['now', 'next'] as const;

/** Статусы оплаты (прототип `SUB_PAY_ST`: wait, ok, rej). */
export const SUBSCRIPTION_PAYMENT_STATUSES = ['pending', 'confirmed', 'rejected'] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

/**
 * Статусы подписки (блок 4, пункт 2; прототип `SUB_ST`): ставит система по дате и чекам,
 * «Ждёт подтверждения» — поверх остальных. У демо-организации подписки нет (блок 4, пункт 8).
 */
export const SUBSCRIPTION_STATUSES = [
  'pending',
  'overdue',
  'expiring',
  'none',
  'active',
  'demo',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Чек об оплате (блок 5, пункт 3): один файл, PDF или фото, до 20 МБ. */
export const SUBSCRIPTION_RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const SUBSCRIPTION_RECEIPT_MAX_BYTES = 20 * 1024 * 1024;

/** Причина записи «Истории оплат» и отклонения чека — до 500 знаков. */
export const SUBSCRIPTION_REASON_MAX = 500;

/**
 * Запуск тарификации (блок 4, пункт 7): действующим организациям — пакет по числу активных
 * контрагентов с округлением вверх до 10 и «Оплачено до» через 30 дней; причина записи — как в
 * демо-данных прототипа (`subPays`, `sp1`–`sp5`).
 */
export const SUBSCRIPTION_LAUNCH_DAYS = 30;
export const SUBSCRIPTION_LAUNCH_REASON =
  'Запуск подписок: пакет по числу активных контрагентов и 30 дней до первой оплаты';

/** Байт в мегабайте памяти: как размер файла на экране (`fileSizeParts`); 1 ГБ = 1 000 МБ (блок 2, пункт 2). */
export const SUBSCRIPTION_MB_BYTES = 1024 * 1024;
export const SUBSCRIPTION_GB_MB = 1000;
