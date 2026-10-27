import {
  accountStatus,
  auditActorName,
  PLATFORM_ADMIN_NAME,
  PLATFORM_ORG_NAME,
  type AccountStatus,
  type ListQuery,
} from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory } from './history';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  textLiteral,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import { endUserSessions } from './staff';

/**
 * Учётные записи платформы для Админки (миграция 0033): представление от владельца схемы, которое
 * отдаёт строки, только если в контексте — незаблокированный администратор платформы (`withUserContext`
 * или `withOrgContext` с его `userId`); сотруднику организации и без контекста оно пусто. Объявлено
 * здесь, а не в `schema/`: представление создаёт SQL-миграция, drizzle-kit его не ведёт.
 */
export const adminUsers = pgSchema('app')
  .view('admin_users', {
    id: uuid('id').notNull(),
    login: text('login').notNull(),
    orgId: uuid('org_id'),
    orgName: text('org_name'),
    fullName: text('full_name'),
    roleName: text('role_name'),
    isPlatformAdmin: boolean('is_platform_admin').notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    blocked: boolean('blocked').notNull(),
    employeeActive: boolean('employee_active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdByName: text('created_by_name'),
    updatedByName: text('updated_by_name'),
    version: integer('version').notNull(),
  })
  .existing();

const v = adminUsers;

/** Учётная запись в списке Админки. */
export interface AdminUserRecord {
  id: string;
  login: string;
  /** ФИО сотрудника; у администратора платформы — «Администратор платформы». */
  fullName: string;
  orgId: string | null;
  /** Организация; у администратора платформы — «Платформа». */
  orgName: string;
  /** Роль сотрудника; у администратора платформы — «Администратор платформы». */
  role: string;
  isPlatformAdmin: boolean;
  lastLoginAt: Date | null;
  /** Заблокирована администратором платформы. */
  blocked: boolean;
  /** Сотрудник не заблокирован владельцем (у администратора платформы сотрудника нет — да). */
  employeeActive: boolean;
  status: AccountStatus;
  audit: { createdAt: Date; createdBy: string | null; updatedAt: Date; updatedBy: string | null };
  version: number;
}

const fields = {
  id: v.id,
  login: v.login,
  orgId: v.orgId,
  orgName: v.orgName,
  fullName: v.fullName,
  roleName: v.roleName,
  isPlatformAdmin: v.isPlatformAdmin,
  lastLoginAt: v.lastLoginAt,
  blocked: v.blocked,
  employeeActive: v.employeeActive,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
  createdBy: v.createdBy,
  updatedBy: v.updatedBy,
  createdByName: v.createdByName,
  updatedByName: v.updatedByName,
  version: v.version,
};

type Row = {
  [K in keyof typeof fields]: (typeof fields)[K]['_']['data'] | null;
};

function toRecord(r: Row): AdminUserRecord {
  const blocked = r.blocked ?? false;
  const employeeActive = r.employeeActive ?? true;
  const createdBy = auditActorName(r.createdBy, r.createdByName);
  return {
    id: r.id!,
    login: r.login!,
    fullName: r.fullName ?? PLATFORM_ADMIN_NAME,
    orgId: r.orgId,
    orgName: r.orgName ?? PLATFORM_ORG_NAME,
    role: r.roleName ?? PLATFORM_ADMIN_NAME,
    isPlatformAdmin: r.isPlatformAdmin ?? false,
    lastLoginAt: r.lastLoginAt,
    blocked,
    employeeActive,
    status: accountStatus({ blocked, employeeActive }),
    audit: {
      createdAt: r.createdAt!,
      createdBy,
      updatedAt: r.updatedAt!,
      updatedBy: auditActorName(r.updatedBy, r.updatedByName) ?? createdBy,
    },
    version: r.version!,
  };
}

const CREATED_BY = auditActorValue(v.createdBy, v.createdByName);
const ADMIN_NAME = textLiteral(PLATFORM_ADMIN_NAME);
const STATUS = sql`case when ${v.blocked} then 'blocked' when not ${v.employeeActive} then 'owner_blocked' else 'active' end`;

/**
 * Столбцы списка «Учётные записи» на сервере (ТЗ «Админка» → «Модуль учётных записей»: логин, ФИО,
 * организация, роль, последний вход, активен; прототип admin/accounts-orgs.js, renderAccounts): ключи —
 * как у столбцов экрана. У администратора платформы ФИО и роль — «Администратор платформы»,
 * организация — «Платформа» (как в прототипе); эти тексты — прямо в запросе, как у «Создал». Статус —
 * коды `active`/`blocked`/`owner_blocked`, сортируется и ищется как подписи («Активен» выше
 * «Заблокирован», затем «Заблокирован владельцем»).
 */
export function adminUserListColumns(t: ListTexts): ListColumns {
  return {
    login: { type: 'text', label: 'accounts.col.login', value: v.login },
    fullName: {
      type: 'text',
      label: 'accounts.col.full_name',
      value: sql`coalesce(${v.fullName}, ${ADMIN_NAME}::text)`,
    },
    org: {
      type: 'enum',
      label: 'accounts.col.org',
      value: sql`coalesce(${v.orgName}, ${textLiteral(PLATFORM_ORG_NAME)}::text)`,
    },
    role: {
      type: 'enum',
      label: 'accounts.col.role',
      value: sql`coalesce(${v.roleName}, ${ADMIN_NAME}::text)`,
    },
    lastLoginAt: { type: 'datetime', label: 'accounts.col.last_login', value: v.lastLoginAt },
    active: {
      type: 'enum',
      label: 'accounts.col.active',
      value: STATUS,
      display: sql`case when ${v.blocked} then ${t('accounts.blocked')} when not ${v.employeeActive} then ${t('accounts.owner_blocked')} else ${t('accounts.active')} end`,
      sort: {
        value: sql`case when ${v.blocked} then 1 when not ${v.employeeActive} then 2 else 0 end`,
        text: false,
      },
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

function adminUserFrom(tx: Tx): ListFrom {
  return (f) => tx.select(f).from(v).$dynamic();
}

/**
 * Страница списка учётных записей платформы: сортировка, страница, фильтры, поиск и группы — на
 * сервере. Не администратору список пуст (представление).
 */
export async function listAdminUsersPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<AdminUserRecord>> {
  const page = await selectListPage({
    query,
    columns: adminUserListColumns(t),
    natural: NATURAL,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      selectPage(tx, window)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: adminUserFrom(tx),
  });
  return { ...page, rows: page.rows.map((r) => toRecord(r)) };
}

function selectPage(tx: Tx, window: ListWindowFields) {
  return tx
    .select({ ...fields, ...window })
    .from(v)
    .$dynamic();
}

/** Значения столбца списка учётных записей для фильтра-галочек; `q` — «Найти значение». */
export function listAdminUserValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: adminUserListColumns(t),
    key,
    scope: undefined,
    from: adminUserFrom(tx),
    q,
  });
}

/** Учётные записи для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys` по порядку экрана. */
export function exportAdminUsers(tx: Tx, query: ListQuery, keys: readonly string[], t: ListTexts) {
  return selectListExport({
    query,
    columns: adminUserListColumns(t),
    keys,
    natural: NATURAL,
    scope: undefined,
    from: adminUserFrom(tx),
  });
}

/** Одна учётная запись для Админки; нет такой (или в контексте не администратор) — null. */
export async function adminGetUser(tx: Tx, id: string): Promise<AdminUserRecord | null> {
  const [row] = await tx.select(fields).from(v).where(eq(v.id, id));
  return row ? toRecord(row) : null;
}

export type AdminUserBlockResult =
  { ok: true; record: AdminUserRecord } | { ok: false; reason: 'not_found' | 'changed' };

/**
 * Блокировка и разблокировка учётной записи администратором платформы (прототип accActions:
 * «Пользователь не сможет войти, его сеансы завершатся»): «заблокирован», версия; при блокировке
 * сеансы пользователя закрываются; «было → стало» — в историю учётной записи в той же транзакции.
 * Транзакция — `withOrgContext` организации пользователя от имени администратора. Блокировку
 * владельцем (сотрудник не активен) не трогает: её снимает владелец. Устаревшая версия — `changed`.
 */
export async function adminSetUserBlocked(
  tx: Tx,
  input: { userId: string; blocked: boolean; version: number },
): Promise<AdminUserBlockResult> {
  const before = await adminGetUser(tx, input.userId);
  if (!before || before.isPlatformAdmin) return { ok: false, reason: 'not_found' };
  if (before.version !== input.version) return { ok: false, reason: 'changed' };
  // Уже так (повторное нажатие) — без новой версии и записи в историю.
  if (before.blocked === input.blocked) return { ok: true, record: before };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_set_user_blocked(${input.userId}, ${input.blocked}, ${input.version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  if (input.blocked) await endUserSessions(tx, input.userId);
  await writeHistory(tx, {
    entity: 'user',
    entityId: input.userId,
    action: 'update',
    changes: [{ field: 'blocked', from: before.blocked, to: input.blocked }],
    reason: input.blocked
      ? 'Учётная запись заблокирована администратором платформы'
      : 'Учётная запись разблокирована администратором платформы',
  });
  const after = await adminGetUser(tx, input.userId);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}
