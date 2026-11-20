import type { DmTemplateState, IsoDate, ListQuery, ListSort } from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
} from './list';

/*
 * API-токены «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 5; блок 8, пункт 6; поток Т,
 * этап 1, П14; прототип v153–v155 `modules/vitrina.js`). Таблица `dm_tokens` — миграция 0165: хранится
 * только SHA-256 токена и начало «bk_a1b2c3»; выпуск, отзыв и перевыпуск — «сейчас» по часам базы
 * (так требуют её проверки), не дольше 180 дней и раз. Факты для состояния — функция
 * `app.dm_token_facts` (шаблон в любом состоянии, доступ, блокировка, подписка, кто создал и отозвал).
 * Список — строки, посчитанные API, одним параметром (`jsonb_to_recordset`), как «Запуски».
 * Организация — в своём `withOrgContext`, Админка — в `withUserContext` администратора платформы.
 */

const asDate = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
const mustDate = (v: unknown): Date => asDate(v) ?? new Date(NaN);

/** Всё о токене для списка, окна и правил (без самого токена и хеша). */
export interface DmTokenFact {
  id: string;
  /** null — токен Админки. */
  orgId: string | null;
  orgName: string | null;
  orgBlocked: boolean;
  extApi: boolean;
  subClosed: boolean;
  templateId: string;
  templateName: string;
  templateState: DmTemplateState;
  templateAccess: boolean;
  name: string;
  prefix: string;
  createdBy: string;
  /** Краткое ФИО сотрудника; null — администратор платформы. */
  createdByName: string | null;
  createdByLeft: boolean;
  createdByAdmin: boolean;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Краткое ФИО отозвавшего сотрудника; у администратора платформы — null (`revokedByAdmin`). */
  revokedByName: string | null;
  revokedByAdmin: boolean;
  replacedBy: string | null;
  graceUntil: Date | null;
  /** Начало токена, который этот заменил при перевыпуске. */
  prevPrefix: string | null;
  lastUsedAt: Date | null;
  lastIp: string | null;
  /** Запросов с `since`. */
  requests: number;
}

interface FactRow {
  id: string;
  org_id: string | null;
  org_name: string | null;
  org_blocked: boolean;
  ext_api: boolean;
  sub_closed: boolean;
  template_id: string;
  template_name: string;
  template_state: DmTemplateState;
  template_access: boolean;
  name: string;
  prefix: string;
  created_by: string;
  created_by_name: string | null;
  created_by_left: boolean;
  created_by_admin: boolean;
  created_at: unknown;
  expires_at: unknown;
  revoked_at: unknown;
  revoked_by_name: string | null;
  revoked_by_admin: boolean;
  replaced_by: string | null;
  grace_until: unknown;
  prev_prefix: string | null;
  last_used_at: unknown;
  last_ip: string | null;
  requests: number;
  db_now: unknown;
  [key: string]: unknown;
}

const factOf = (r: FactRow): DmTokenFact => ({
  id: r.id,
  orgId: r.org_id,
  orgName: r.org_name,
  orgBlocked: r.org_blocked,
  extApi: r.ext_api,
  subClosed: r.sub_closed,
  templateId: r.template_id,
  templateName: r.template_name,
  templateState: r.template_state,
  templateAccess: r.template_access,
  name: r.name,
  prefix: r.prefix,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  createdByLeft: r.created_by_left,
  createdByAdmin: r.created_by_admin,
  createdAt: mustDate(r.created_at),
  expiresAt: mustDate(r.expires_at),
  revokedAt: asDate(r.revoked_at),
  revokedByName: r.revoked_by_name,
  revokedByAdmin: r.revoked_by_admin,
  replacedBy: r.replaced_by,
  graceUntil: asDate(r.grace_until),
  prevPrefix: r.prev_prefix,
  lastUsedAt: asDate(r.last_used_at),
  lastIp: r.last_ip,
  requests: Number(r.requests),
});

/**
 * Токены вошедшего (в контексте организации — её, вне его — все, только администратору платформы) и
 * «сейчас» по часам базы: по ним выпуск и отзыв ставят свои отметки, по ним и состояние. `id` — один
 * токен; `since` — с какого момента считать запросы («за 30 дней»); `today` — для закрытия по подписке.
 */
export async function dmTokenFacts(
  tx: Tx,
  opts: { since: Date; today: IsoDate; id?: string },
): Promise<{ now: Date; items: DmTokenFact[] }> {
  const rows = await tx.execute<FactRow>(sql`
    select f.*, now() as db_now
    from app.dm_token_facts(${opts.since.toISOString()}::timestamptz, ${opts.today}::date,
      ${opts.id ?? null}::uuid) f
    order by f.created_at desc, f.id`);
  const [clock] = rows.length
    ? [rows[0]!.db_now]
    : (await tx.execute<{ db_now: unknown }>(sql`select now() as db_now`)).map((r) => r.db_now);
  return { now: mustDate(clock), items: rows.map(factOf) };
}

/**
 * Выпуски и перевыпуски одного владельца (организации или Админки) — по одному до конца транзакции:
 * предел «действующих — не больше 20» и «такое название уже действует» не обойти двумя вкладками.
 */
export async function lockDmTokens(tx: Tx, orgId: string | null): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`dm_tokens:${orgId ?? 'admin'}`}, 0))`,
  );
}

/**
 * Новый токен от имени вошедшего в его контексте (организация — из контекста, у Админки — пусто):
 * выпущен «сейчас» по часам базы, действует `termDays` суток. Хеш считает вызывающий.
 */
export async function insertDmToken(
  tx: Tx,
  t: { templateId: string; name: string; tokenHash: string; prefix: string; termDays: number },
): Promise<{ id: string; createdAt: Date; expiresAt: Date }> {
  const [row] = await tx.execute<{ id: string; created_at: unknown; expires_at: unknown }>(sql`
    insert into public.dm_tokens (template_id, name, token_hash, prefix, expires_at)
    values (${t.templateId}::uuid, ${t.name}, ${t.tokenHash}, ${t.prefix},
      now() + make_interval(days => ${t.termDays}::integer))
    returning id, created_at, expires_at`);
  if (!row) throw new Error('dm_tokens: токен не записан');
  return { id: row.id, createdAt: mustDate(row.created_at), expiresAt: mustDate(row.expires_at) };
}

/** «Отозвать»: сейчас и от имени вошедшего; уже отозванный — false. */
export async function revokeDmToken(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    update public.dm_tokens set revoked_at = now(), revoked_by = app.current_user_id()
    where id = ${id}::uuid and revoked_at is null
    returning id`);
  return rows.length > 0;
}

/**
 * Перевыпуск: прежний токен помнит новый и работает ещё сутки, но не дольше своего срока. Уже
 * перевыпущенный или отозванный — null.
 */
export async function replaceDmToken(tx: Tx, oldId: string, newId: string): Promise<Date | null> {
  const rows = await tx.execute<{ grace_until: unknown }>(sql`
    update public.dm_tokens
    set replaced_by = ${newId}::uuid, grace_until = least(now() + interval '24 hours', expires_at)
    where id = ${oldId}::uuid and replaced_by is null and revoked_at is null
    returning grace_until`);
  return rows.length ? asDate(rows[0]!.grace_until) : null;
}

/** «Внешний доступ по API» своей организации (`org_settings.ext_api`, по умолчанию выключен). */
export async function orgExtApi(tx: Tx): Promise<boolean> {
  const [row] = await tx.execute<{ ext_api: boolean }>(sql`
    select ext_api from public.org_settings where org_id = app.current_org_id()`);
  return row?.ext_api ?? false;
}

/** Опубликованный шаблон для окна «Новый API-токен»: что нужно правилу видимости. */
export interface DmTokenTemplate {
  id: string;
  code: string;
  name: string;
  module: string | null;
  needPermission: string | null;
  columns: unknown;
}

/**
 * Опубликованные шаблоны для токена: «Для организаций» — видимые организации по RLS (доступ), права
 * сотрудника проверяет вызывающий (`dmTemplateSeen`); «Для администратора» — Админке.
 */
export async function dmTokenTemplates(
  tx: Tx,
  audience: 'org' | 'admin',
): Promise<DmTokenTemplate[]> {
  const rows = await tx.execute<{
    id: string;
    code: string;
    name: string;
    module: string | null;
    need_permission: string | null;
    columns: unknown;
  }>(sql`
    select id, code, name, module, need_permission, columns
    from public.dm_templates
    where state = 'published' and audience = ${audience}
    order by name collate app.ru_natural, code`);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    module: r.module,
    needPermission: r.need_permission,
    columns: r.columns,
  }));
}

/** Запрос журнала токена для его окна (прототип `dmTokDlg`, «Журнал запросов»). */
export interface DmTokenRequest {
  at: Date;
  params: Record<string, unknown>;
  rows: number | null;
  ms: number | null;
  outcome: string;
  error: string | null;
  ip: string | null;
}

/** Последние `limit` запросов по токену и сколько всего (журнал хранится 90 дней). */
export async function dmTokenRequests(
  tx: Tx,
  tokenId: string,
  limit = 50,
): Promise<{ total: number; items: DmTokenRequest[] }> {
  const rows = await tx.execute<{
    at: unknown;
    params: Record<string, unknown> | null;
    row_count: number | null;
    duration_ms: number | null;
    outcome: string;
    error: string | null;
    ip: string | null;
    total: number;
  }>(sql`
    select at, params, row_count, duration_ms, outcome, error, ip, count(*) over ()::integer as total
    from public.dm_requests
    where token_id = ${tokenId}::uuid
    order by at desc, id desc
    limit ${limit}`);
  const total = rows.length ? Number(rows[0]!.total) : 0;
  return {
    total,
    items: rows.map((r) => ({
      at: mustDate(r.at),
      params: r.params ?? {},
      rows: r.row_count,
      ms: r.duration_ms,
      outcome: r.outcome,
      error: r.error,
      ip: r.ip,
    })),
  };
}

// ───── Список «API Токены» ─────

/** Строка списка токенов: значения и подписи, как на экране (посчитаны API). */
export interface DmTokenListRow {
  id: string;
  name: string;
  prefix: string;
  state: string;
  stateText: string;
  stateRank: number;
  /** Пояснение под состоянием: почему остановлен, кто отозвал, до когда работает перевыпущенный. */
  note: string;
  orgName: string;
  tplName: string;
  byName: string;
  createdAt: string;
  till: string;
  lastAt: string | null;
  lastIp: string | null;
  n30: number;
}

/** Столбец источника: ключи — постоянные имена, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

const TOKEN_DEFS = [
  'id uuid',
  'name text',
  'prefix text',
  'state text',
  'state_text text',
  'state_rank integer',
  'note text',
  'org_name text',
  'tpl_name text',
  'by_name text',
  'created_at timestamptz',
  'till timestamptz',
  'last_at timestamptz',
  'last_ip text',
  'n30 integer',
].join(', ');

function tokenRecordset(rows: readonly DmTokenListRow[]): SQL {
  const json = rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    state: r.state,
    state_text: r.stateText,
    state_rank: r.stateRank,
    note: r.note,
    org_name: r.orgName,
    tpl_name: r.tplName,
    by_name: r.byName,
    created_at: r.createdAt,
    till: r.till,
    last_at: r.lastAt,
    last_ip: r.lastIp,
    n30: r.n30,
  }));
  return sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb) as r(${sql.raw(TOKEN_DEFS)})`;
}

/** Столбцы списка «API Токены» (прототип grid `dm-tok`, `dm-tok-adm`): ключи — как у столбцов экрана. */
export const DM_TOKEN_COLUMNS: ListColumns = {
  name: {
    type: 'text',
    label: 'dm.tok.col.name',
    value: field('name'),
    searchDisplay: sql`concat_ws(' ', ${field('name')}, ${field('prefix')})`,
  },
  st: {
    type: 'enum',
    label: 'dm.tok.col.st',
    value: field('state'),
    display: field('state_text'),
    searchDisplay: sql`concat_ws(' ', ${field('state_text')}, ${field('note')})`,
    sort: { value: field('state_rank'), text: false },
  },
  org: { type: 'enum', label: 'dm.tok.col.org', value: field('org_name') },
  tpl: { type: 'enum', label: 'dm.tok.col.tpl', value: field('tpl_name') },
  by: { type: 'enum', label: 'dm.tok.col.by', value: field('by_name') },
  at: { type: 'datetime', label: 'dm.tok.col.at', value: field('created_at') },
  till: { type: 'datetime', label: 'dm.tok.col.till', value: field('till') },
  last: {
    type: 'datetime',
    label: 'dm.tok.col.last',
    value: field('last_at'),
    searchDisplay: sql`concat_ws(' ', to_char(${field('last_at')} at time zone 'Asia/Bishkek', 'DD.MM.YYYY HH24:MI'), ${field('last_ip')})`,
  },
  n30: { type: 'int', label: 'dm.tok.col.n30', value: field('n30') },
};

/** Сначала новые (прототип `sort: {key: 'at', dir: -1}`). */
const TOKEN_SORT: ListSort = { key: 'at', dir: 'desc' };
const TOKEN_NATURAL = [field('name'), field('prefix')];

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

export interface DmTokenPageRow {
  id: string;
  name: string;
  prefix: string;
  state: string;
  note: string;
  orgName: string;
  tplName: string;
  byName: string;
  createdAt: Date;
  till: Date;
  lastAt: Date | null;
  lastIp: string | null;
  n30: number;
}

/** Страница списка токенов. */
export function listDmTokensPage(tx: Tx, rows: readonly DmTokenListRow[], query: ListQuery) {
  const source = tokenRecordset(rows);
  return selectListPage({
    query,
    columns: DM_TOKEN_COLUMNS,
    natural: TOKEN_NATURAL,
    defaultSort: TOKEN_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({
          id: sql<string>`${field('id')}`,
          name: sql<string>`${field('name')}`,
          prefix: sql<string>`${field('prefix')}`,
          state: sql<string>`${field('state')}`,
          note: sql<string>`${field('note')}`,
          orgName: sql<string>`${field('org_name')}`,
          tplName: sql<string>`${field('tpl_name')}`,
          byName: sql<string>`${field('by_name')}`,
          createdAt: sql<Date>`${field('created_at')}`.mapWith((v) => mustDate(v)),
          till: sql<Date>`${field('till')}`.mapWith((v) => mustDate(v)),
          lastAt: sql<Date | null>`${field('last_at')}`.mapWith((v) => asDate(v)),
          lastIp: sql<string | null>`${field('last_ip')}`,
          n30: sql<number>`${field('n30')}`,
          ...window,
        })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
}

export function listDmTokenValues(
  tx: Tx,
  rows: readonly DmTokenListRow[],
  key: string,
  q?: string,
) {
  return selectListValues({
    columns: DM_TOKEN_COLUMNS,
    key,
    scope: undefined,
    from: fromOf(tx, tokenRecordset(rows)),
    q,
  });
}

export function exportDmTokens(
  tx: Tx,
  rows: readonly DmTokenListRow[],
  query: ListQuery,
  keys: readonly string[],
) {
  return selectListExport({
    query,
    columns: DM_TOKEN_COLUMNS,
    keys,
    natural: TOKEN_NATURAL,
    defaultSort: TOKEN_SORT,
    scope: undefined,
    from: fromOf(tx, tokenRecordset(rows)),
  });
}
