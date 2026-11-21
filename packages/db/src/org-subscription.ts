import type {
  IsoDate,
  SubscriptionCalcLine,
  SubscriptionPaymentKind,
  SubscriptionPaymentStatus,
  SubscriptionReceiptType,
  SubscriptionStartMode,
} from '@buhuchet/domain';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import {
  employees,
  orgSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
  subscriptionSettings,
} from './schema';

/*
 * Экран «Подписка» владельца и заявка с чеком (доработки 20.11.2026, блок 5; прототип v154
 * `modules/org-sub.js`; пакет 2, этап 1, П7, поток И). Всё — в контексте своей организации
 * (`withOrgContext`): подписку, оплаты и чек чужой организации RLS не показывает. Что занято и закрыт
 * ли доступ — `orgUsage` (`subscriptions.ts`). Подписку меняет только администратор платформы; здесь —
 * чтение, вставка заявки и замена файла чека до проверки (что ещё можно менять — триггер
 * `app.subscription_payments_guard`, миграция 0165).
 */

/** Подписка организации (прототип `org.sub`); строки нет — «Нет подписки». */
export interface OrgSubscriptionRow {
  planId: string;
  planName: string;
  seats: number;
  extraGb: number;
  paidUntil: IsoDate;
  extraDiscountPct: number;
  firstPaid: boolean;
  free: boolean;
  next: { seats: number | null; extraGb: number | null; from: IsoDate } | null;
}

export async function readOrgSubscription(tx: Tx): Promise<OrgSubscriptionRow | null> {
  const [row] = await tx
    .select({
      planId: orgSubscriptions.planId,
      planName: subscriptionPlans.name,
      seats: orgSubscriptions.seats,
      extraGb: orgSubscriptions.extraGb,
      paidUntil: orgSubscriptions.paidUntil,
      extraDiscountPct: orgSubscriptions.extraDiscountPct,
      firstPaid: orgSubscriptions.firstPaid,
      free: orgSubscriptions.free,
      nextSeats: orgSubscriptions.nextSeats,
      nextExtraGb: orgSubscriptions.nextExtraGb,
      nextFrom: orgSubscriptions.nextFrom,
    })
    .from(orgSubscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, orgSubscriptions.planId))
    .where(eq(orgSubscriptions.orgId, sql`app.current_org_id()`))
    .limit(1);
  if (!row) return null;
  const { nextSeats, nextExtraGb, nextFrom, ...rest } = row;
  return {
    ...rest,
    paidUntil: rest.paidUntil as IsoDate,
    next: nextFrom ? { seats: nextSeats, extraGb: nextExtraGb, from: nextFrom as IsoDate } : null,
  };
}

/** «Цены и реквизиты» платформы (одна строка `subscription_settings`). */
export interface SubscriptionSettingsRow {
  seatPrice: number;
  seatStep: number;
  gbPrice: number;
  baseMb: number;
  seatMb: number;
  firstMonthPct: number;
  extraDiscountOver: number;
  remindDays: number;
  checkDays: number;
  recipient: string | null;
  recipientInn: string | null;
  bank: string | null;
  bik: string | null;
  account: string | null;
  purpose: string | null;
}

export async function readSubscriptionSettings(tx: Tx): Promise<SubscriptionSettingsRow | null> {
  const [row] = await tx
    .select({
      seatPrice: subscriptionSettings.seatPrice,
      seatStep: subscriptionSettings.seatStep,
      gbPrice: subscriptionSettings.gbPrice,
      baseMb: subscriptionSettings.baseMb,
      seatMb: subscriptionSettings.seatMb,
      firstMonthPct: subscriptionSettings.firstMonthPct,
      extraDiscountOver: subscriptionSettings.extraDiscountOver,
      remindDays: subscriptionSettings.remindDays,
      checkDays: subscriptionSettings.checkDays,
      recipient: subscriptionSettings.recipient,
      recipientInn: subscriptionSettings.recipientInn,
      bank: subscriptionSettings.bank,
      bik: subscriptionSettings.bik,
      account: subscriptionSettings.account,
      purpose: subscriptionSettings.purpose,
    })
    .from(subscriptionSettings)
    .where(eq(subscriptionSettings.id, 1))
    .limit(1);
  return row ?? null;
}

/** «Виды подписок» по порядку справочника — и выключенные: оплаченный срок дорабатывает. */
export function listSubscriptionPlans(tx: Tx) {
  return tx
    .select({
      id: subscriptionPlans.id,
      name: subscriptionPlans.name,
      months: subscriptionPlans.months,
      discountPct: subscriptionPlans.discountPct,
      perks: subscriptionPlans.perks,
      active: subscriptionPlans.active,
    })
    .from(subscriptionPlans)
    .orderBy(asc(subscriptionPlans.sortOrder), asc(subscriptionPlans.id));
}

/** Сколько оплат показывает «История оплат»: оплата — раз в месяц, больше за жизнь организации не наберётся. */
export const SUBSCRIPTION_PAYMENTS_SHOWN = 500;

/** Оплата «Истории оплат» (прототип `DB.subPays`). */
export interface SubscriptionPaymentRow {
  id: string;
  createdAt: Date;
  kind: SubscriptionPaymentKind;
  startMode: SubscriptionStartMode;
  planId: string;
  planName: string;
  months: number;
  seats: number;
  extraGb: number;
  amount: number;
  lines: SubscriptionCalcLine[];
  receiptName: string | null;
  receiptType: string | null;
  receiptBytes: number | null;
  status: SubscriptionPaymentStatus;
  opensAccess: boolean;
  reason: string | null;
  decidedAt: Date | null;
  paidUntil: IsoDate | null;
  /** Краткое ФИО отправившего; null — «Система» или администратор платформы. */
  byName: string | null;
  createdBy: string | null;
  version: number;
}

const author = alias(employees, 'sub_pay_author');

/** «История оплат» своей организации — от новых к старым. */
export async function listSubscriptionPayments(
  tx: Tx,
  limit = SUBSCRIPTION_PAYMENTS_SHOWN,
): Promise<SubscriptionPaymentRow[]> {
  const rows = await tx
    .select({
      id: subscriptionPayments.id,
      createdAt: subscriptionPayments.createdAt,
      kind: subscriptionPayments.kind,
      startMode: subscriptionPayments.startMode,
      planId: subscriptionPayments.planId,
      planName: subscriptionPlans.name,
      months: subscriptionPayments.months,
      seats: subscriptionPayments.seats,
      extraGb: subscriptionPayments.extraGb,
      amount: subscriptionPayments.amount,
      lines: subscriptionPayments.lines,
      receiptName: subscriptionPayments.receiptName,
      receiptType: subscriptionPayments.receiptType,
      receiptBytes: subscriptionPayments.receiptBytes,
      status: subscriptionPayments.status,
      opensAccess: subscriptionPayments.opensAccess,
      reason: subscriptionPayments.reason,
      decidedAt: subscriptionPayments.decidedAt,
      paidUntil: subscriptionPayments.paidUntil,
      byName: author.shortName,
      createdBy: subscriptionPayments.createdBy,
      version: subscriptionPayments.version,
    })
    .from(subscriptionPayments)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptionPayments.planId))
    .leftJoin(author, eq(author.userId, subscriptionPayments.createdBy))
    .orderBy(desc(subscriptionPayments.createdAt), desc(subscriptionPayments.id))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    lines: (Array.isArray(r.lines) ? r.lines : []) as SubscriptionCalcLine[],
    paidUntil: r.paidUntil as IsoDate | null,
  }));
}

/** Заявка владельца с чеком (`status = 'pending'`): сумму и строки расчёта посчитал сервер. */
export interface SubscriptionPaymentInsert {
  id: string;
  kind: 'renew' | 'grow' | 'mem';
  startMode: SubscriptionStartMode;
  planId: string;
  months: number;
  seats: number;
  extraGb: number;
  amount: number;
  lines: readonly SubscriptionCalcLine[];
  receiptKey: string;
  receiptName: string;
  receiptType: SubscriptionReceiptType;
  receiptBytes: number;
}

/**
 * Вставить заявку от имени вошедшего, «сейчас» и непроверенной (политика
 * `subscription_payments_insert_guard`); открывает ли чек доступ до проверки, ставит база. Вторая
 * непроверенная заявка организации — ошибка уникального индекса `subscription_payments_one_pending`.
 */
export async function insertSubscriptionPayment(
  tx: Tx,
  p: SubscriptionPaymentInsert,
): Promise<{ opensAccess: boolean; createdAt: Date }> {
  const [row] = await tx
    .insert(subscriptionPayments)
    .values({
      id: p.id,
      kind: p.kind,
      startMode: p.startMode,
      planId: p.planId,
      months: p.months,
      seats: p.seats,
      extraGb: p.extraGb,
      amount: p.amount,
      lines: [...p.lines],
      receiptKey: p.receiptKey,
      receiptName: p.receiptName,
      receiptType: p.receiptType,
      receiptBytes: p.receiptBytes,
    })
    .returning({
      opensAccess: subscriptionPayments.opensAccess,
      createdAt: subscriptionPayments.createdAt,
    });
  return row!;
}

/** Есть ли у организации непроверенная заявка (одна за раз, блок 5, пункт 5). */
export async function pendingSubscriptionPaymentId(tx: Tx): Promise<string | null> {
  const [row] = await tx
    .select({ id: subscriptionPayments.id })
    .from(subscriptionPayments)
    .where(sql`${subscriptionPayments.status} = 'pending'`)
    .limit(1);
  return row?.id ?? null;
}

const paymentLockFields = {
  id: subscriptionPayments.id,
  kind: subscriptionPayments.kind,
  status: subscriptionPayments.status,
  receiptKey: subscriptionPayments.receiptKey,
  receiptName: subscriptionPayments.receiptName,
  amount: subscriptionPayments.amount,
  version: subscriptionPayments.version,
};

/**
 * Оплата своей организации (замена чека); чужой RLS не покажет. Непроверенная — под блокировкой
 * строки; проверенную блокировка не находит (политика правки видит только `pending`), она читается
 * без блокировки — чтобы ответить «Чек уже проверен», а не «не найдена».
 */
export async function lockSubscriptionPayment(tx: Tx, id: string) {
  const [locked] = await tx
    .select(paymentLockFields)
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.id, id))
    .for('update')
    .limit(1);
  if (locked) return locked;
  const [row] = await tx
    .select(paymentLockFields)
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Новый файл чека непроверенной заявки (блок 5, пункт 5): ключ хранилища тот же, меняются название,
 * тип и размер; версия +1. Возвращает новую версию; заявка уже проверена — null (политика
 * `subscription_payments_update_guard` её не меняет).
 */
export async function setSubscriptionReceipt(
  tx: Tx,
  id: string,
  receipt: { name: string; type: SubscriptionReceiptType; bytes: number },
): Promise<number | null> {
  const [row] = await tx
    .update(subscriptionPayments)
    .set({
      receiptName: receipt.name,
      receiptType: receipt.type,
      receiptBytes: receipt.bytes,
      // `updated_by` не ставится: решение администратора (политика `subscription_payments_update_guard`
      // пускает только пустой или свой `updated_by`) не должно зависеть от замены файла владельцем;
      // кто заменил — в истории (`sub_receipt_replace`).
      updatedAt: sql`now()`,
      version: sql`${subscriptionPayments.version} + 1`,
    })
    .where(eq(subscriptionPayments.id, id))
    .returning({ version: subscriptionPayments.version });
  return row?.version ?? null;
}

/** Чек оплаты своей организации — для ссылки на просмотр и скачивание; нет чека — null. */
export async function subscriptionReceiptOf(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      key: subscriptionPayments.receiptKey,
      name: subscriptionPayments.receiptName,
      type: subscriptionPayments.receiptType,
    })
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.id, id))
    .limit(1);
  return row?.key && row.name ? { key: row.key, name: row.name, type: row.type } : null;
}
