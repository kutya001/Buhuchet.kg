import {
  CODE_KINDS,
  OUTBOX_KINDS,
  OUTBOX_UNDELIVERABLE,
  type ListQuery,
  type OutboxKind,
  type OutboxStatus,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminOrganizations } from './admin-orgs';
import type { Db, Tx } from './client';
import { writePlatformHistory } from './platform-history';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';

/*
 * Админка → «Телеграм» → «Журнал» и «Рассылка» (ТЗ «Админка» → «Модуль Телеграмм»; прототип
 * admin/telegram.js; задача 2.41, docs/decisions.md п. Д-13). Журнал всех организаций — представление
 * `app.admin_telegram_log` (миграция 0084): строки отдаются, только если в контексте — незаблокированный
 * администратор платформы (`withUserContext`); сотруднику организации и без контекста оно пусто.
 * Объявлено здесь, а не в `schema/`: представление создаёт SQL-миграция, drizzle-kit его не ведёт.
 */
export const adminTelegramLog = pgSchema('app')
  .view('admin_telegram_log', {
    id: uuid('id').notNull(),
    orgId: uuid('org_id'),
    orgName: text('org_name'),
    userId: uuid('user_id').notNull(),
    recipient: text('recipient'),
    tgUsername: text('tg_username'),
    kind: text('kind').$type<OutboxKind>().notNull(),
    status: text('status').$type<OutboxStatus>().notNull(),
    tries: integer('tries').notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  })
  .existing();

const v = adminTelegramLog;

/** Строка журнала Админки: без текста сообщения и номера чата. */
export interface AdminTelegramLogRecord {
  id: string;
  /** null — сообщение администратору платформы («Платформа»). */
  orgId: string | null;
  /** У сообщения о заявке на тестовом стенде — «Тестовый стенд» (подпись словаря). */
  orgName: string | null;
  /** Краткое ФИО сотрудника (у администратора платформы — логин) и «@имя» в Telegram. */
  recipient: string;
  kind: OutboxKind;
  status: OutboxStatus;
  tries: number;
  /** Ответ Telegram или код итога (`recipient_unlinked`); подпись кода — по словарю на экране. */
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

/** «Иванов А. @ivanov»: как столбец «Получатель» прототипа (`u.short + ' ' + u.tg`). */
const RECIPIENT = sql<string>`concat_ws(' ', ${v.recipient}, '@' || ${v.tgUsername})`;

const fields = {
  id: v.id,
  orgId: v.orgId,
  orgName: v.orgName,
  recipient: RECIPIENT,
  kind: v.kind,
  status: v.status,
  tries: v.tries,
  lastError: v.lastError,
  createdAt: v.createdAt,
  sentAt: v.sentAt,
};

type Row = {
  id: string | null;
  orgId: string | null;
  orgName: string | null;
  recipient: string | null;
  kind: OutboxKind | null;
  status: OutboxStatus | null;
  tries: number | null;
  lastError: string | null;
  createdAt: Date | null;
  sentAt: Date | null;
};

function toRecord(r: Row): AdminTelegramLogRecord {
  return {
    id: r.id!,
    orgId: r.orgId,
    orgName: r.orgName,
    recipient: r.recipient ?? '',
    kind: r.kind!,
    status: r.status!,
    tries: r.tries ?? 0,
    lastError: r.lastError,
    createdAt: r.createdAt!,
    sentAt: r.sentAt,
  };
}

/** Подписи статусов (прототип: «Отправлено», «Ожидает», «Ошибка»). */
const STATUS_ORDER: readonly OutboxStatus[] = ['sent', 'pending', 'error'];

function caseOf(column: SQLWrapper, codes: readonly string[], label: (code: string) => string) {
  return sql`case ${sql.join(
    codes.map((c) => sql`when ${column} = ${c} then ${label(c)}`),
    sql` `,
  )} else ${column} end`;
}

/**
 * Сообщение о заявке с лендинга на тестовом стенде: «Организация» — «Тестовый стенд», а не
 * «Платформа» (прототип v74 leadNotify: `org: LAND.test ? 'Тестовый стенд' : 'Платформа'`).
 */
function standLead(stand: boolean): SQL {
  return stand ? sql`(${v.orgId} is null and ${v.kind} = 'lead')` : sql`false`;
}

/**
 * Столбцы журнала на сервере (прототип admin/telegram.js, grid 'tg-log'): ключи — как у столбцов
 * экрана. «Организация» у сообщения без организации — «Платформа», у сообщения о заявке на стенде —
 * «Тестовый стенд»; «Ошибка» с кодом `recipient_unlinked` — подпись словаря.
 */
export function adminTelegramLogColumns(t: ListTexts, stand = false): ListColumns {
  const lead = standLead(stand);
  const orgValue = sql`coalesce(${v.orgId}::text, case when ${lead} then 'stand' else 'platform' end)`;
  return {
    at: { type: 'datetime', label: 'tgadm.col.at', value: v.createdAt },
    to: { type: 'text', label: 'tgadm.col.to', value: RECIPIENT },
    org: {
      type: 'enum',
      label: 'tgadm.col.org',
      value: orgValue,
      display: sql`coalesce(${v.orgName}, case when ${lead} then ${t('tgadm.org.stand')} else ${t('tgadm.org.platform')} end)`,
      sort: { value: sql`coalesce(${v.orgName}, '')`, text: true },
    },
    kind: {
      type: 'enum',
      label: 'tgadm.col.kind',
      value: v.kind,
      display: caseOf(v.kind, OUTBOX_KINDS, (k) => t(`telegram.kind.${k}`)),
    },
    st: {
      type: 'enum',
      label: 'tgadm.col.st',
      value: v.status,
      display: caseOf(v.status, STATUS_ORDER, (s) => t(`tgadm.st.${s}`)),
    },
    tries: { type: 'int', label: 'tgadm.col.tries', value: v.tries },
    err: {
      type: 'text',
      label: 'tgadm.col.err',
      value: sql`case when ${v.lastError} = ${OUTBOX_UNDELIVERABLE} then ${t('tgadm.err.unlinked')} else ${v.lastError} end`,
    },
  };
}

const NATURAL = [v.createdAt, v.id];
/** Сначала новые (прототип: `sort: {key: 'at', dir: -1}`); служебных столбцов у журнала нет. */
const DEFAULT_SORT = { key: 'at', dir: 'desc' } as const;

function logFrom(tx: Tx): ListFrom {
  return (f) => tx.select(f).from(v).$dynamic();
}

function selectPage(tx: Tx, window: ListWindowFields) {
  return tx
    .select({ ...fields, ...window })
    .from(v)
    .$dynamic();
}

/**
 * Страница журнала отправок всех организаций: сортировка, страница, фильтры, поиск и группы — на
 * сервере. Не администратору журнал пуст (представление).
 */
export async function listAdminTelegramLogPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
  stand = false,
): Promise<ListPageResult<AdminTelegramLogRecord>> {
  const page = await selectListPage({
    query,
    columns: adminTelegramLogColumns(t, stand),
    natural: NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      selectPage(tx, window)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: logFrom(tx),
  });
  const standOrg = t('tgadm.org.stand');
  return {
    ...page,
    rows: page.rows.map((r) => {
      const rec = toRecord(r as Row);
      return stand && rec.orgId === null && rec.kind === 'lead'
        ? { ...rec, orgName: standOrg }
        : rec;
    }),
  };
}

/** Значения столбца журнала для фильтра-галочек; `q` — «Найти значение». */
export function listAdminTelegramLogValues(
  tx: Tx,
  key: string,
  t: ListTexts,
  q?: string,
  stand = false,
) {
  return selectListValues({
    columns: adminTelegramLogColumns(t, stand),
    key,
    scope: undefined,
    from: logFrom(tx),
    q,
  });
}

/** Журнал для выгрузки в Excel: все строки под поиском и фильтрами, столбцы `keys` по порядку экрана. */
export function exportAdminTelegramLog(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
  stand = false,
) {
  return selectListExport({
    query,
    columns: adminTelegramLogColumns(t, stand),
    keys,
    natural: NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: undefined,
    from: logFrom(tx),
  });
}

/**
 * Плашки над журналом (прототип): «В очереди», «Ошибки отправки» и «Отправлено сегодня» — по дню
 * Бишкека, в который сообщение отправлено.
 */
export async function adminTelegramSummary(
  tx: Tx,
  today: string,
): Promise<{ pending: number; errors: number; sentToday: number }> {
  const [row] = await tx
    .select({
      pending: sql<number>`count(*) filter (where ${v.status} = 'pending')::integer`,
      errors: sql<number>`count(*) filter (where ${v.status} = 'error')::integer`,
      sentToday: sql<number>`count(*) filter (where ${v.status} = 'sent' and (${v.sentAt} at time zone 'Asia/Bishkek')::date = ${today}::date)::integer`,
    })
    .from(v);
  return { pending: row?.pending ?? 0, errors: row?.errors ?? 0, sentToday: row?.sentToday ?? 0 };
}

/**
 * «Повторить отправку» и «Повторить ошибки» (прототип `tgNoRetry`): строки с «Ошибкой», кроме кодов
 * (восстановления и замены Telegram), снова «Ожидают» (попыток 0) и уходят обычной очередью. Отвечает, сколько строк снова
 * в очереди и сколько из выбранных — коды восстановления с ошибкой (их повторно не отправляют).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-32 — повтор уходит очередью, в прежний чат — не отправляется.
export async function adminTelegramRetry(
  tx: Tx,
  ids: readonly string[],
  now: Date,
): Promise<{ queued: number; codes: number }> {
  if (!ids.length) return { queued: 0, codes: 0 };
  const [codes] = await tx
    .select({ n: sql<number>`count(*)::integer` })
    .from(v)
    .where(and(inArray(v.id, [...ids]), eq(v.status, 'error'), inArray(v.kind, [...CODE_KINDS])));
  const [row] = await tx.execute<{ n: number | null }>(
    sql`select app.admin_telegram_retry(array[${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[], ${now.toISOString()}::timestamptz) as n`,
  );
  return { queued: row?.n ?? 0, codes: codes?.n ?? 0 };
}

/**
 * «Рассылка» → «Поставить в очередь»: объявление каждому активному сотруднику действующей организации
 * (`orgId` — только этой; null — всем) с привязанным Telegram. Отвечает числом сообщений в очереди;
 * null — организация не найдена или заблокирована (или в контексте не администратор). Кто, когда, кому
 * и с каким текстом поставил объявление — в историю платформы в той же транзакции.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-31 — кому уходит объявление.
export async function adminTelegramBroadcast(
  tx: Tx,
  input: { orgId: string | null; text: string; now: Date },
): Promise<number | null> {
  const [row] = await tx.execute<{ n: number | null }>(
    sql`select app.admin_telegram_broadcast(${input.orgId}::uuid, ${input.text}, ${input.now.toISOString()}::timestamptz) as n`,
  );
  const queued = row?.n ?? null;
  if (queued === null) return null;
  await writePlatformHistory(tx, {
    entity: 'telegram_broadcast',
    entityId: input.orgId ?? 'all',
    action: 'create',
    changes: [
      { field: 'text', to: input.text },
      { field: 'queued', to: queued },
    ],
  });
  return queued;
}

/** Действующие организации для «Кому» (прототип `ORGS.filter(o => o.active)`), по названию. */
export async function adminTelegramOrgs(tx: Tx): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: adminOrganizations.id, name: adminOrganizations.name })
    .from(adminOrganizations)
    .where(eq(adminOrganizations.status, 'active'))
    .orderBy(asc(adminOrganizations.name), asc(adminOrganizations.id));
}

/** Строка без организации, взятая на отправку (как `ClaimedOutbox`). */
export interface ClaimedPlatformOutbox {
  id: string;
  chatId: number;
  kind: OutboxKind;
  text: string;
  tries: number;
}

/**
 * Строки без организации (сообщения администраторам платформы, снова поставленные в очередь «Повторить
 * отправку»): взять на отправку до `limit` строк, как `claimOutbox`. Под RLS их не видно ни в одной
 * организации, поэтому — функцией базы.
 */
export async function claimPlatformOutbox(
  db: Db,
  o: { now: Date; limit: number; leaseSeconds: number },
): Promise<ClaimedPlatformOutbox[]> {
  const rows = await db.execute<{
    id: string;
    chat_id: string | number;
    kind: OutboxKind;
    text: string;
    tries: number;
  }>(
    sql`select id, chat_id, kind, text, tries from app.telegram_platform_claim(${o.now.toISOString()}::timestamptz, ${o.limit}, ${o.leaseSeconds})`,
  );
  return rows.map((r) => ({
    id: r.id,
    chatId: Number(r.chat_id),
    kind: r.kind,
    text: r.text,
    tries: r.tries,
  }));
}

/** Итоги попыток строк без организации (как `finishOutbox`). */
export async function finishPlatformOutbox(
  db: Db,
  outcomes: readonly (
    | { id: string; result: 'sent'; at: Date }
    | { id: string; result: 'retry'; at: Date; error: string }
    | { id: string; result: 'error'; error: string }
  )[],
): Promise<void> {
  for (const o of outcomes) {
    const status = o.result === 'sent' ? 'sent' : o.result === 'retry' ? 'pending' : 'error';
    const nextAt = o.result === 'retry' ? o.at.toISOString() : null;
    const error = o.result === 'sent' ? null : o.error;
    const sentAt = o.result === 'sent' ? o.at.toISOString() : null;
    await db.execute(
      sql`select app.telegram_platform_finish(${o.id}::uuid, ${status}, ${nextAt}::timestamptz, ${error}, ${sentAt}::timestamptz)`,
    );
  }
}
