import type {
  IsoDate,
  MemoryWarnLevel,
  SubscriptionNow,
  SubscriptionPaymentKind,
  SubscriptionPlanTerms,
  SubscriptionPrices,
} from '@buhuchet/domain';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { adminOrganizations } from './admin-orgs';
import type { Db, Tx } from './client';
import {
  orgMemoryNotices,
  orgSubscriptions,
  storageCheckItems,
  storageCheckRuns,
  subscriptionPayments,
  subscriptionPlans,
  subscriptionSettings,
} from './schema';

/*
 * Сообщения о подписке, памяти и сверке хранилища (доработки 20.11.2026, блок 4, пункт 3; блок 2,
 * пункт 5; пакет 2, блок 3, пункт 6; блок 6, пункт 3; поток Т, этап 1, П12–П13; миграции 0166–0167).
 * Что и когда сказать — правила домена (`subscriptions/notify.ts`), отправка — модуль telegram API.
 */

/** Цены, срок напоминаний и срок проверки чека (настройки подписок, одна строка). */
export interface SubscriptionNoticeSettings {
  prices: SubscriptionPrices;
  /** За сколько дней до «Оплачено до» напоминать (прототип `remind`). */
  remindDays: number;
  /** Через сколько дней чек «ждёт проверки больше N дней» (прототип `chk`). */
  checkDays: number;
}

export async function subscriptionNoticeSettings(db: Db | Tx): Promise<SubscriptionNoticeSettings> {
  const [s] = await db.select().from(subscriptionSettings).where(eq(subscriptionSettings.id, 1));
  return {
    prices: {
      seatPrice: s?.seatPrice ?? 10_000,
      gbPrice: s?.gbPrice ?? 10_000,
      seatStep: s?.seatStep ?? 10,
      baseMb: s?.baseMb ?? 2_000,
      seatMb: s?.seatMb ?? 200,
      firstMonthPct: s?.firstMonthPct ?? 50,
      extraDiscountOver: s?.extraDiscountOver ?? 150,
    },
    remindDays: s?.remindDays ?? 7,
    checkDays: s?.checkDays ?? 3,
  };
}

/**
 * Подписка организации из контекста и её вид — для суммы «продление на тот же срок и пакет»
 * (прототип `subRemindText`: `subCalc` вида «renew» с нынешними пакетом и памятью); null — подписки нет.
 */
export async function orgSubscriptionTerms(
  tx: Tx,
): Promise<{ sub: SubscriptionNow; plan: SubscriptionPlanTerms } | null> {
  const [r] = await tx
    .select({
      planId: orgSubscriptions.planId,
      seats: orgSubscriptions.seats,
      extraGb: orgSubscriptions.extraGb,
      paidUntil: orgSubscriptions.paidUntil,
      extraDiscountPct: orgSubscriptions.extraDiscountPct,
      firstPaid: orgSubscriptions.firstPaid,
      months: subscriptionPlans.months,
      discountPct: subscriptionPlans.discountPct,
    })
    .from(orgSubscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, orgSubscriptions.planId))
    .where(sql`${orgSubscriptions.orgId} = app.current_org_id()`);
  if (!r) return null;
  return {
    sub: {
      planId: r.planId,
      seats: r.seats,
      extraGb: r.extraGb,
      paidUntil: r.paidUntil as IsoDate,
      extraDiscountPct: r.extraDiscountPct,
      firstPaid: r.firstPaid,
    },
    plan: { id: r.planId, months: r.months, discountPct: r.discountPct },
  };
}

/** Порог памяти, о котором организации из контекста уже сообщили (нет строки — 0). */
export async function memoryNoticeLevel(tx: Tx): Promise<MemoryWarnLevel> {
  const [r] = await tx
    .select({ level: orgMemoryNotices.level })
    .from(orgMemoryNotices)
    .where(sql`${orgMemoryNotices.orgId} = app.current_org_id()`);
  const level = r?.level ?? 0;
  return level === 100 || level === 80 ? level : 0;
}

/** Запомнить порог памяти организации из контекста (в транзакции сообщения). */
export async function setMemoryNoticeLevel(
  tx: Tx,
  level: MemoryWarnLevel,
  now: Date,
): Promise<void> {
  await tx
    .insert(orgMemoryNotices)
    .values({ orgId: sql`app.current_org_id()`, level, updatedAt: now })
    .onConflictDoUpdate({
      target: orgMemoryNotices.orgId,
      set: { level, updatedAt: now },
    });
}

/** Чек подписки на проверке. */
export interface PendingSubscriptionPayment {
  id: string;
  orgId: string;
  kind: SubscriptionPaymentKind;
  /** К оплате, тыйыны. */
  amount: number;
  createdAt: Date;
}

const pendingCols = {
  id: subscriptionPayments.id,
  orgId: subscriptionPayments.orgId,
  kind: subscriptionPayments.kind,
  amount: subscriptionPayments.amount,
  createdAt: subscriptionPayments.createdAt,
};

const asPending = (r: {
  id: string;
  orgId: string;
  kind: string;
  amount: number;
  createdAt: Date;
}): PendingSubscriptionPayment => ({
  ...r,
  kind: r.kind as SubscriptionPaymentKind,
  amount: Number(r.amount),
});

/** Непроверенный чек организации из контекста (он один за раз); null — нет. */
export async function pendingSubscriptionPayment(
  tx: Tx,
): Promise<PendingSubscriptionPayment | null> {
  const [r] = await tx
    .select(pendingCols)
    .from(subscriptionPayments)
    .where(
      and(
        sql`${subscriptionPayments.orgId} = app.current_org_id()`,
        eq(subscriptionPayments.status, 'pending'),
      ),
    )
    .limit(1);
  return r ? asPending(r) : null;
}

/**
 * Непроверенные чеки всех организаций с названием организации — администратору платформы вне
 * организации (`withUserContext`; иначе RLS и представление пусты). Для колокольчика Админки.
 */
export async function adminPendingSubscriptionPayments(
  tx: Tx,
): Promise<(PendingSubscriptionPayment & { orgName: string })[]> {
  const rows = await tx
    .select(pendingCols)
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.status, 'pending'))
    .orderBy(subscriptionPayments.createdAt)
    .limit(500);
  if (!rows.length) return [];
  const names = await tx
    .select({ id: adminOrganizations.id, name: adminOrganizations.name })
    .from(adminOrganizations)
    .where(inArray(adminOrganizations.id, [...new Set(rows.map((r) => r.orgId))]));
  const byId = new Map(names.map((n) => [n.id, n.name]));
  return rows.map((r) => ({ ...asPending(r), orgName: byId.get(r.orgId) ?? '' }));
}

/**
 * Сообщение администраторам платформы в Telegram (`app.platform_notice`): вид `sub_check` или
 * `storage_check`, ключ — одно сообщение на ключ у администратора. Отвечает, скольким поставлено.
 * Внутри транзакции — её `tx`.
 */
export async function platformNotice(
  db: Db | Tx,
  o: { kind: 'sub_check' | 'storage_check'; text: string; key: string; now: Date },
): Promise<number> {
  const [row] = await db.execute<{ n: number | string | null }>(
    sql`select app.platform_notice(${o.kind}, ${o.text}, ${o.key}, ${o.now.toISOString()}::timestamptz) as n`,
  );
  return Number(row?.n ?? 0);
}

/** Объект хранилища для сверки (из списка хранилища). */
export interface StorageCheckObject {
  key: string;
  size: number;
  modifiedAt: Date;
}

/** Итог сверки хранилища. */
export interface StorageCheckSaved {
  run: number;
  state: 'done' | 'failed';
  objects: number;
  missing: number;
  extra: number;
  stuck: number;
  failed: number;
  /** Сколько в списках новых — найдено этим запуском впервые. */
  fresh: { missing: number; extra: number; stuck: number; failed: number };
}

/**
 * Записать сверку (`app.storage_check_save`): объекты хранилища под `org/`, момент начала чтения
 * списка; `error` — список прочитать не удалось. Только вне контекста организации и пользователя
 * (задача по расписанию на пуле).
 */
export async function saveStorageCheck(
  db: Db,
  objects: readonly StorageCheckObject[],
  now: Date,
  error: string | null = null,
): Promise<StorageCheckSaved> {
  const json = JSON.stringify(
    objects.map((o) => ({ k: o.key, s: o.size, t: o.modifiedAt.toISOString() })),
  );
  const [row] = await db.execute<{ r: Record<string, number | string> }>(
    sql`select app.storage_check_save(${error === null ? json : '[]'}::jsonb, ${now.toISOString()}::timestamptz, ${error}) as r`,
  );
  const r = row?.r ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    run: n('run'),
    state: r.state === 'failed' ? 'failed' : 'done',
    objects: n('objects'),
    missing: n('missing'),
    extra: n('extra'),
    stuck: n('stuck'),
    failed: n('failed'),
    fresh: {
      missing: n('new_missing'),
      extra: n('new_extra'),
      stuck: n('new_stuck'),
      failed: n('new_failed'),
    },
  };
}

/**
 * Знает ли база объект хранилища с этим ключом (`app.storage_key_known`): «Удалить» лишнего файла
 * ещё раз проверяет им, что записи нет. Только администратору платформы и задаче без вошедшего.
 */
export async function storageKeyKnown(db: Db | Tx, key: string): Promise<boolean> {
  const [row] = await db.execute<{ known: boolean }>(
    sql`select app.storage_key_known(${key}) as known`,
  );
  return row?.known === true;
}

/**
 * Запуски сверки с `since`, нашедшие новые расхождения (первое появление), — колокольчик администратора
 * платформы (RLS: читает только он). Сначала новые; не больше 30.
 */
export async function storageCheckRunsWithNews(
  tx: Tx,
  since: Date,
): Promise<{ run: number; at: Date; fresh: number }[]> {
  const rows = await tx
    .select({
      run: storageCheckRuns.id,
      at: storageCheckRuns.startedAt,
      // Столбец внешней таблицы — с её именем: без него в подзапросе он сравнился бы с `i.id`.
      fresh: sql<number>`(select count(*)::integer from ${storageCheckItems} i where i.first_run_id = storage_check_runs.id)`,
    })
    .from(storageCheckRuns)
    .where(and(eq(storageCheckRuns.state, 'done'), gte(storageCheckRuns.startedAt, since)))
    .orderBy(desc(storageCheckRuns.startedAt))
    .limit(30);
  return rows
    .map((r) => ({ run: Number(r.run), at: r.at, fresh: Number(r.fresh) }))
    .filter((r) => r.fresh > 0);
}
