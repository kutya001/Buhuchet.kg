import { diffDays, type IsoDate } from '../common/dates';
import {
  SUBSCRIPTION_OWNER_PAYMENT_KINDS,
  SUBSCRIPTION_RECEIPT_MAX_BYTES,
  type SUBSCRIPTION_RECEIPT_TYPES,
  type SubscriptionPaymentKind,
  type SubscriptionPaymentStatus,
} from './subscriptions';

/*
 * Чек об оплате подписки и «История оплат» на экране «Подписка» владельца (доработки 20.11.2026, блок
 * 5, пункты 2–6; прототип v154 `modules/org-sub.js`: `subFileErr`, `subFileType`, `subLastRej`,
 * `subAgainOk`; пакет 2, этап 1, П7, поток И).
 */

export type SubscriptionReceiptType = (typeof SUBSCRIPTION_RECEIPT_TYPES)[number];

/** Сколько первых байт чека читает проверка содержимого: подписи PDF, JPG и PNG короче. */
export const SUBSCRIPTION_RECEIPT_SNIFF_BYTES = 8;
/** Длина названия файла чека (как у файлов: столбец `receipt_name`). */
export const SUBSCRIPTION_RECEIPT_NAME_MAX = 255;

/** Что мешает начать загрузку чека: имя, пустой файл, больше 20 МБ (прототип `subFileErr`). */
export type SubscriptionReceiptProblem =
  | 'sub_receipt_name'
  | 'sub_receipt_empty'
  | 'sub_receipt_large';

/** Название файла чека как его покажет экран: без пути и лишних пробелов. */
export const subscriptionReceiptName = (name: string): string =>
  (name.split(/[\\/]/).pop() ?? '').replace(/\s+/g, ' ').trim();

export function subscriptionReceiptProblem(f: {
  name: string;
  size: number;
}): SubscriptionReceiptProblem | null {
  const name = subscriptionReceiptName(f.name);
  // Знаки управления в названии не пропускаются: имя уходит в заголовок скачивания.
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > SUBSCRIPTION_RECEIPT_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    return 'sub_receipt_name';
  }
  if (!Number.isInteger(f.size) || f.size <= 0) return 'sub_receipt_empty';
  if (f.size > SUBSCRIPTION_RECEIPT_MAX_BYTES) return 'sub_receipt_large';
  return null;
}

/**
 * Тип, с которым браузер кладёт чек в хранилище, — по расширению (прототип `subFileType`); настоящий
 * тип потом даёт содержимое (`subscriptionReceiptSniff`).
 */
export function subscriptionReceiptUploadType(name: string): SubscriptionReceiptType {
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.png$/i.test(name)) return 'image/png';
  return 'image/jpeg';
}

const startsWith = (head: Uint8Array, sig: readonly number[]) =>
  head.length >= sig.length && sig.every((b, i) => head[i] === b);

/** `%PDF-`, JPEG (FF D8 FF) и PNG (89 50 4E 47 0D 0A 1A 0A) — как проверка прототипа. */
const SIGNATURES: readonly [SubscriptionReceiptType, readonly number[]][] = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
];

/**
 * Тип чека по содержимому, а не по расширению (блок 5, пункт 3; прототип `subFileErr`): PDF, JPG или
 * PNG; другое — null («Это не PDF и не фото JPG или PNG»).
 */
export function subscriptionReceiptSniff(head: Uint8Array): SubscriptionReceiptType | null {
  return SIGNATURES.find(([, sig]) => startsWith(head, sig))?.[0] ?? null;
}

/** Оплата «Истории оплат» — то, что нужно правилам экрана; список — от новых к старым. */
export interface SubscriptionPaymentFacts {
  id: string;
  kind: SubscriptionPaymentKind;
  status: SubscriptionPaymentStatus;
}

const isOwnerKind = (kind: SubscriptionPaymentKind) =>
  (SUBSCRIPTION_OWNER_PAYMENT_KINDS as readonly string[]).includes(kind);

/**
 * Последняя проверенная заявка владельца отклонена — новый чек доступ заранее не откроет (блок 4,
 * пункт 6; прототип `subLastRej`). Записи администратора и бесплатный период не считаются.
 */
export function subscriptionLastRejected(pays: readonly SubscriptionPaymentFacts[]): boolean {
  const last = pays.find((p) => p.status !== 'pending' && isOwnerKind(p.kind));
  return last?.status === 'rejected';
}

/**
 * У какой оплаты «Прикрепить другой чек» (блок 5, пункт 6; прототип `subAgainOk`): только у самой новой
 * записи «Истории оплат», когда она отклонена и непроверенного чека нет.
 */
export function subscriptionAgainId(pays: readonly SubscriptionPaymentFacts[]): string | null {
  const first = pays[0];
  if (!first || first.status !== 'rejected') return null;
  return pays.some((p) => p.status === 'pending') ? null : first.id;
}

/** Сколько дней до конца срока: 0 — сегодня последний день, меньше нуля — просрочено (прототип `subDaysLeft`). */
export const subscriptionDaysLeft = (paidUntil: IsoDate, today: IsoDate): number =>
  diffDays(paidUntil, today);

/**
 * Отказы экрана «Подписка» и окна оплаты (тексты прототипа `subPayDlg`, `subFileErr`, `subFileDlg`);
 * на экране — ключ словаря `err.<код>` с подстановками из `details`.
 */
export const SUBSCRIPTION_MESSAGES = {
  sub_owner_only: 'Подписку видит и оплачивает только владелец организации',
  sub_demo: 'У демо-организации подписки нет',
  sub_pending: 'Дождитесь проверки прошлого чека: новая оплата — после проверки',
  sub_renew_first: 'Сначала продлите подписку: расширить можно только действующую',
  sub_plan_required: 'Выберите вид подписки',
  sub_seats_step: 'Пакет — по {step} контрагентов',
  sub_seats_active: 'Сначала переведите в архив лишних контрагентов: активных {active}',
  sub_seats_not_more: 'Новый пакет должен быть больше нынешнего: сейчас {now}',
  sub_gb_invalid: 'Память сверх — целое число ГБ, 0 и больше',
  sub_gb_not_more: 'Укажите больше, чем сейчас: {now} ГБ сверх',
  sub_gb_used: 'Сначала удалите лишние файлы: с такой памятью занятое не помещается',
  sub_next_unavailable:
    'Срок подписки кончается в этом месяце: новый размер укажите при продлении',
  sub_nothing_to_pay: 'Доплаты нет: выберите больший пакет или память, или «Сейчас»',
  sub_receipt_name: 'Название файла чека пустое или слишком длинное',
  sub_receipt_empty: 'Файл пустой: выберите другой',
  sub_receipt_large: 'Файл больше 20 МБ: сожмите фото или прикрепите PDF',
  sub_receipt_type: 'Это не PDF и не фото JPG или PNG: прикрепите чек в одном из этих форматов',
  sub_receipt_missing: 'Чек не дошёл до хранилища: прикрепите его ещё раз',
  sub_receipt_limit: 'Слишком много попыток отправить чек. Попробуйте через час',
  sub_receipt_busy: 'Чек уже отправляется',
  sub_pay_decided: 'Чек уже проверен: заменить файл нельзя',
} as const;
export type SubscriptionMessageCode = keyof typeof SUBSCRIPTION_MESSAGES;
