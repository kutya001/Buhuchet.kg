import type { IsoDate, SubscriptionStatus } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { writeHistory } from './history';

/*
 * Занято мест и памяти и закрыт ли доступ (доработки 20.11.2026, блоки 2 и 4; пакет 2, блок 5, пункт 2;
 * миграция 0165) — одна функция базы `app.org_usage` на все экраны и проверки: экран «Подписка»,
 * вкладка «Подписки» и модуль «Файлы» Админки, загрузка файлов, новый контрагент, вход. Сегодня — по
 * Бишкеку, от часов приложения.
 */

type Exec = Db | Tx;

export interface OrgUsage {
  orgId: string;
  /** Демо-организация: без подписки, пределов и закрытия (блок 4, пункт 8). */
  demo: boolean;
  /** Активные контрагенты — все, кроме «В архиве» (блок 1, пункт 3). */
  seatsUsed: number;
  /** Пакет сейчас (с «Со следующего месяца» и чеком на проверке); у демо — null. */
  seatsLimit: number | null;
  /** Память сверх сейчас, ГБ; у демо — null. */
  extraGb: number | null;
  /** Занято, байт; null — спрошено без суммы (`bytes: false`). */
  bytesUsed: number | null;
  /**
   * Предел памяти, байт; null — предела нет: у демо и без подписки, пока нет чека, открывшего доступ
   * (прототип `afMem`; без подписки доступ и так закрыт — `closed`).
   */
  bytesLimit: number | null;
  /** «Оплачено до», включительно; null — подписки нет. */
  paidUntil: IsoDate | null;
  status: SubscriptionStatus;
  /** Доступ закрыт по подписке (блокировка организации — отдельно). */
  closed: boolean;
}

interface UsageRow {
  org_id: string;
  demo: boolean;
  seats_used: number;
  seats_limit: number | null;
  extra_gb: number | null;
  bytes_used: string | number | null;
  bytes_limit: string | number | null;
  paid_until: string | null;
  status: SubscriptionStatus;
  closed: boolean;
  [key: string]: unknown;
}

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

const usageOf = (r: UsageRow): OrgUsage => ({
  orgId: r.org_id,
  demo: r.demo,
  seatsUsed: Number(r.seats_used),
  seatsLimit: r.seats_limit === null ? null : Number(r.seats_limit),
  extraGb: r.extra_gb === null ? null : Number(r.extra_gb),
  bytesUsed: num(r.bytes_used),
  bytesLimit: num(r.bytes_limit),
  paidUntil: r.paid_until === null ? null : (String(r.paid_until).slice(0, 10) as IsoDate),
  status: r.status,
  closed: r.closed,
});

async function usageRows(db: Exec, today: IsoDate, bytes: boolean): Promise<OrgUsage[]> {
  const rows = await db.execute<UsageRow>(sql`
    select org_id, demo, seats_used, seats_limit, extra_gb, bytes_used, bytes_limit,
      paid_until::text as paid_until, status, closed
    from app.org_usage(${today}::date, ${bytes})`);
  return rows.map(usageOf);
}

/**
 * Своя организация — в её контексте (`withOrgContext`); вне контекста организации — null.
 * `bytes: false` — без суммы занятой памяти: быстрая проверка доступа и мест.
 */
export async function orgUsage(
  db: Exec,
  today: IsoDate,
  opts: { bytes?: boolean } = {},
): Promise<OrgUsage | null> {
  const rows = await usageRows(db, today, opts.bytes ?? true);
  return rows.length === 1 ? rows[0]! : null;
}

/** Все организации — администратору платформы вне контекста организации (`withUserContext`). */
export async function adminOrgUsage(
  db: Exec,
  today: IsoDate,
  opts: { bytes?: boolean } = {},
): Promise<OrgUsage[]> {
  return usageRows(db, today, opts.bytes ?? true);
}

/**
 * Закрыт ли доступ организации контекста (`withOrgContext`) по подписке на день `today` (блок 4,
 * пункты 4–5): срок прошёл или подписки нет, и нет чека, открывшего доступ до проверки. Демо и вне
 * контекста организации — нет.
 */
export async function orgSubscriptionClosed(tx: Tx, today: IsoDate): Promise<boolean> {
  return (await orgUsage(tx, today, { bytes: false }))?.closed ?? false;
}

/** Подписка новой организации (`createOrganization`): что ставит администратор или служебная команда. */
export interface NewOrgSubscription {
  /** Вид подписки; нет — первый действующий по порядку («Месяц»). */
  planId?: string | null;
  /** Пакет; нет — шаг пакета из «Цен и реквизитов». */
  seats?: number | null;
  extraGb?: number;
  /** «Оплачено до», включительно. */
  paidUntil: IsoDate;
  extraDiscountPct?: number;
  /** Бесплатный период: ещё и строка «Истории оплат» без суммы. */
  free: boolean;
  /** Причина — в историю подписки и в строку «Истории оплат». */
  reason: string;
}

/**
 * Поставить подписку организации, созданной в этой же транзакции (функция базы
 * `app.subscription_new_org`, миграция 0167: другой организации она подписку не поставит), и записать
 * это в историю подписки. Только `tx` транзакции `createOrganization`.
 */
export async function startOrgSubscription(
  tx: Tx,
  orgId: string,
  sub: NewOrgSubscription,
): Promise<void> {
  const extraGb = sub.extraGb ?? 0;
  const discount = sub.extraDiscountPct ?? 0;
  const [row] = await tx.execute<{ plan: string; pack: number }>(sql`
    select plan, pack from app.subscription_new_org(${sub.planId ?? null}::text,
      ${sub.seats ?? null}::integer, ${extraGb}::integer, ${sub.paidUntil}::date,
      ${discount}::integer, ${sub.free}, ${sub.reason})`);
  await writeHistory(tx, {
    entity: 'subscription',
    entityId: orgId,
    action: 'create',
    changes: [
      { field: 'planId', to: row!.plan },
      { field: 'seats', to: Number(row!.pack) },
      ...(extraGb ? [{ field: 'extraGb', to: extraGb }] : []),
      { field: 'paidUntil', to: sub.paidUntil },
      ...(discount ? [{ field: 'extraDiscountPct', to: discount }] : []),
      ...(sub.free ? [{ field: 'free', to: true }] : []),
    ],
    reason: sub.reason,
  });
}
