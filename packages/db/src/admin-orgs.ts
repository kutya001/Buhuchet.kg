import { auditActorName, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory } from './history';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';

/**
 * Организации платформы для Админки (миграция 0024): представление от владельца схемы, которое
 * отдаёт строки, только если в контексте — незаблокированный администратор платформы (`withUserContext`
 * или `withOrgContext` с его `userId`); сотруднику организации и без контекста оно пусто. Объявлено
 * здесь, а не в `schema/`: представление создаёт SQL-миграция, drizzle-kit его не ведёт.
 */
export const adminOrganizations = pgSchema('app')
  .view('admin_organizations', {
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    inn: text('inn'),
    slug: text('slug').notNull(),
    status: text('status').$type<'active' | 'blocked'>().notNull(),
    blockedReason: text('blocked_reason'),
    isDemo: boolean('is_demo').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    version: integer('version').notNull(),
    ownerLogin: text('owner_login'),
    employees: integer('employees').notNull(),
    createdByName: text('created_by_name'),
    updatedByName: text('updated_by_name'),
  })
  .existing();

const v = adminOrganizations;

/** Организация в списке Админки. */
export interface AdminOrganizationRecord {
  id: string;
  name: string;
  inn: string | null;
  slug: string;
  ownerLogin: string | null;
  /** Контрагентов — появится с модулем «Контрагенты» (поток А); пока 0. */
  contractors: number;
  /** Активных сотрудников. */
  employees: number;
  active: boolean;
  blockedReason: string | null;
  isDemo: boolean;
  audit: { createdAt: Date; createdBy: string | null; updatedAt: Date; updatedBy: string | null };
  version: number;
}

const fields = {
  id: v.id,
  name: v.name,
  inn: v.inn,
  slug: v.slug,
  status: v.status,
  blockedReason: v.blockedReason,
  isDemo: v.isDemo,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
  createdBy: v.createdBy,
  updatedBy: v.updatedBy,
  version: v.version,
  ownerLogin: v.ownerLogin,
  employees: v.employees,
  createdByName: v.createdByName,
  updatedByName: v.updatedByName,
};

type Row = {
  [K in keyof typeof fields]: (typeof fields)[K]['_']['data'] | null;
};

function toRecord(r: Row): AdminOrganizationRecord {
  return {
    id: r.id!,
    name: r.name!,
    inn: r.inn,
    slug: r.slug!,
    ownerLogin: r.ownerLogin,
    contractors: 0,
    employees: r.employees ?? 0,
    active: r.status === 'active',
    blockedReason: r.blockedReason,
    isDemo: r.isDemo ?? false,
    audit: {
      createdAt: r.createdAt!,
      createdBy: auditActorName(r.createdBy, r.createdByName),
      updatedAt: r.updatedAt!,
      updatedBy: auditActorName(r.updatedBy, r.updatedByName),
    },
    version: r.version!,
  };
}

const CREATED_BY = auditActorValue(v.createdBy, v.createdByName);

/**
 * Столбцы списка «Организации» на сервере (ТЗ «Админка» → «Модуль организаций»: название, ИНН,
 * владелец, число контрагентов и сотрудников, дата регистрации, активна; прототип
 * admin/accounts-orgs.js, renderOrgs): ключи — как у столбцов экрана. Статус — коды `active`/`blocked`,
 * сортируется и ищется как подписи («Активна» выше «Заблокирована»). Контрагентов пока нет — 0.
 */
export function adminOrgListColumns(t: ListTexts): ListColumns {
  return {
    name: { type: 'text', label: 'orgs.col.name', value: v.name },
    inn: { type: 'text', label: 'orgs.col.inn', value: v.inn, compact: true },
    owner: { type: 'text', label: 'orgs.col.owner', value: v.ownerLogin },
    slug: { type: 'text', label: 'orgs.col.slug', value: v.slug },
    contractors: { type: 'int', label: 'orgs.col.contractors', value: sql`0`, total: true },
    employees: { type: 'int', label: 'orgs.col.employees', value: v.employees, total: true },
    registered: {
      type: 'date',
      label: 'orgs.col.registered',
      value: sql`(${v.createdAt} at time zone 'Asia/Bishkek')::date`,
    },
    active: {
      type: 'enum',
      label: 'orgs.col.active',
      value: sql`case when ${v.status} = 'active' then 'active' else 'blocked' end`,
      display: sql`case when ${v.status} = 'active' then ${t('orgs.active')} else ${t('orgs.blocked')} end`,
      sort: { value: sql`case when ${v.status} = 'active' then 0 else 1 end`, text: false },
    },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: v.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: v.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(v.updatedBy, v.updatedByName)}, ${CREATED_BY})`,
    },
  };
}

const NATURAL = [v.createdAt, v.id];

function adminOrgFrom(tx: Tx): ListFrom {
  return (f) => tx.select(f).from(v).$dynamic();
}

function selectPage(tx: Tx, window: ListWindowFields) {
  return tx
    .select({ ...fields, ...window })
    .from(v)
    .$dynamic();
}

/**
 * Страница списка организаций платформы: сортировка, страница, фильтры, поиск и группы — на сервере.
 * Не администратору список пуст (представление).
 */
export async function listAdminOrgsPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<AdminOrganizationRecord>> {
  const page = await selectListPage({
    query,
    columns: adminOrgListColumns(t),
    natural: NATURAL,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      selectPage(tx, window)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: adminOrgFrom(tx),
  });
  return { ...page, rows: page.rows.map((r) => toRecord(r)) };
}

/** Значения столбца списка организаций для фильтра-галочек; `q` — «Найти значение». */
export function listAdminOrgValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: adminOrgListColumns(t),
    key,
    scope: undefined,
    from: adminOrgFrom(tx),
    q,
  });
}

/** Организации для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys` по порядку экрана. */
export function exportAdminOrgs(tx: Tx, query: ListQuery, keys: readonly string[], t: ListTexts) {
  return selectListExport({
    query,
    columns: adminOrgListColumns(t),
    keys,
    natural: NATURAL,
    scope: undefined,
    from: adminOrgFrom(tx),
  });
}

/** Одна организация для Админки; нет такой (или в контексте не администратор) — null. */
export async function adminGetOrganization(
  tx: Tx,
  id: string,
): Promise<AdminOrganizationRecord | null> {
  const [row] = await tx.select(fields).from(v).where(eq(v.id, id));
  return row ? toRecord(row) : null;
}

/**
 * Плашки над списком (прототип renderOrgs): активных организаций, контрагентов на платформе (пока 0 —
 * появятся с модулем «Контрагенты»), учётных записей организаций и запросов организаций на добавление
 * в справочники («Попросить добавить», все — как `REQUESTS.length` прототипа).
 */
export async function adminOrgSummary(
  tx: Tx,
): Promise<{ active: number; contractors: number; users: number; requests: number }> {
  const [orgs] = await tx
    .select({ n: sql<number>`count(*)::integer` })
    .from(v)
    .where(eq(v.status, 'active'));
  const [users] = await tx.execute<{ n: number }>(sql`select app.admin_platform_users() as n`);
  const [requests] = await tx.execute<{ n: number }>(sql`select app.admin_dict_requests() as n`);
  return {
    active: orgs?.n ?? 0,
    contractors: 0,
    users: users?.n ?? 0,
    requests: requests?.n ?? 0,
  };
}

/** Адреса страниц всех организаций — чтобы новой подобрать свободный (`slugFree`). */
export async function adminOrgSlugs(tx: Tx): Promise<string[]> {
  const rows = await tx.select({ slug: v.slug }).from(v);
  return rows.map((r) => r.slug);
}

export type AdminOrgStatusResult =
  { ok: true; record: AdminOrganizationRecord } | { ok: false; reason: 'not_found' | 'changed' };

/**
 * Блокировка и разблокировка организации администратором платформы (ТЗ «Блокировка организации»):
 * статус, причина у заблокированной, версия; «было → стало» — в историю организации в той же
 * транзакции. Транзакция — `withOrgContext` этой организации от имени администратора. Устаревшая
 * версия — `changed` («запись изменена другим пользователем»).
 */
export async function adminSetOrganizationStatus(
  tx: Tx,
  input: { orgId: string; blocked: boolean; reason: string | null; version: number },
): Promise<AdminOrgStatusResult> {
  const before = await adminGetOrganization(tx, input.orgId);
  if (!before) return { ok: false, reason: 'not_found' };
  const status = input.blocked ? 'blocked' : 'active';
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_set_org_status(${input.orgId}, ${status}, ${input.reason}, ${input.version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  const reasonAfter = input.blocked ? input.reason : null;
  await writeHistory(tx, {
    entity: 'organization',
    entityId: input.orgId,
    action: 'update',
    changes: [
      { field: 'status', from: before.active ? 'active' : 'blocked', to: status },
      ...(before.blockedReason !== reasonAfter
        ? [{ field: 'blockedReason', from: before.blockedReason, to: reasonAfter }]
        : []),
    ],
    reason: input.blocked
      ? 'Организация заблокирована администратором платформы'
      : 'Организация разблокирована администратором платформы',
  });
  const after = await adminGetOrganization(tx, input.orgId);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}
