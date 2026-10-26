import {
  auditActorName,
  formatPhone,
  isPermissionId,
  normalizeScopes,
  PERMISSION_IDS,
  SCOPE_GROUPS,
  type ListQuery,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from '@buhuchet/domain';
import { count, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import { writeHistory } from './history';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ExportCell,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import {
  employees,
  platformReference,
  rolePermissions,
  roleScopes,
  roles,
  sessions,
  telegramLinks,
  users,
} from './schema';

/**
 * Модуль «Сотрудники»: сотрудники организации из контекста `withOrgContext` (RLS) вместе с учётной
 * записью, ролью и привязкой Telegram. Хеш пароля отсюда не читается.
 */

/** «Создал» и «Изменил»: момент и имя (null — система). */
export interface AuditRecord {
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface EmployeeRecord {
  id: string;
  userId: string;
  fullName: string;
  shortName: string;
  login: string;
  phone: string | null;
  /** Телефон для показа по маске справочника «Коды телефонов»: «+996 555 100 200». */
  phoneText: string | null;
  role: { id: string; name: string; isOwner: boolean };
  active: boolean;
  telegram: { username: string | null; firstName: string | null; linkedAt: Date } | null;
  lastLoginAt: Date | null;
  audit: AuditRecord;
  version: number;
}

const creator = alias(employees, 'creator');
const updater = alias(employees, 'updater');

const employeeFields = {
  id: employees.id,
  userId: employees.userId,
  fullName: employees.fullName,
  shortName: employees.shortName,
  login: users.login,
  phone: employees.phone,
  roleId: roles.id,
  roleName: roles.name,
  roleIsOwner: roles.isOwner,
  active: employees.active,
  tgUsername: telegramLinks.username,
  tgFirstName: telegramLinks.firstName,
  tgLinkedAt: telegramLinks.linkedAt,
  lastLoginAt: users.lastLoginAt,
  createdAt: employees.createdAt,
  createdBy: employees.createdBy,
  createdByName: creator.shortName,
  updatedAt: employees.updatedAt,
  updatedBy: employees.updatedBy,
  updatedByName: updater.shortName,
  version: employees.version,
};

/** Сотрудники с учётной записью, ролью, Telegram и именами «Создал» и «Изменил». */
function selectEmployees(tx: Tx) {
  return tx
    .select(employeeFields)
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .leftJoin(telegramLinks, eq(telegramLinks.userId, employees.userId))
    .leftJoin(creator, eq(creator.userId, employees.createdBy))
    .leftJoin(updater, eq(updater.userId, employees.updatedBy));
}

/** То же для страницы списка — с числом записей, итогами и группами (`selectListPage`). */
function selectEmployeePage(tx: Tx, window: ListWindowFields) {
  return tx
    .select({ ...employeeFields, ...window })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .leftJoin(telegramLinks, eq(telegramLinks.userId, employees.userId))
    .leftJoin(creator, eq(creator.userId, employees.createdBy))
    .leftJoin(updater, eq(updater.userId, employees.updatedBy));
}

/** Те же таблицы с любыми полями — для групп, значений фильтра и выгрузки (`ListFrom`). */
function employeeListFrom(tx: Tx): ListFrom {
  return (fields) =>
    tx
      .select(fields)
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .innerJoin(roles, eq(roles.id, employees.roleId))
      .leftJoin(telegramLinks, eq(telegramLinks.userId, employees.userId))
      .leftJoin(creator, eq(creator.userId, employees.createdBy))
      .leftJoin(updater, eq(updater.userId, employees.updatedBy))
      .$dynamic();
}

type EmployeeRow = Awaited<ReturnType<typeof selectEmployees>>[number];

type PhoneCodes = Awaited<ReturnType<typeof phoneCodes>>;

function toEmployee(r: EmployeeRow, codes: PhoneCodes): EmployeeRecord {
  return {
    id: r.id,
    userId: r.userId,
    fullName: r.fullName,
    shortName: r.shortName,
    login: r.login,
    phone: r.phone,
    phoneText: r.phone && formatPhone(r.phone, codes),
    role: { id: r.roleId, name: r.roleName, isOwner: r.roleIsOwner },
    active: r.active,
    telegram: r.tgLinkedAt
      ? { username: r.tgUsername, firstName: r.tgFirstName, linkedAt: r.tgLinkedAt }
      : null,
    lastLoginAt: r.lastLoginAt,
    audit: {
      createdAt: r.createdAt,
      createdBy: auditActorName(r.createdBy, r.createdByName),
      updatedAt: r.updatedAt,
      updatedBy: auditActorName(r.updatedBy, r.updatedByName),
    },
    version: r.version,
  };
}

/**
 * Столбцы списка сотрудников на сервере (ТЗ «Сотрудники» → список; прототип modules/staff.js,
 * renderStaff): ключи — как у столбцов экрана. Роль фильтруется по номеру роли, а сортируется и
 * ищется по названию; статус и Telegram — коды `active`/`blocked`, `linked`/`none`, а сортируются и
 * ищутся как подписи на экране («Активен» выше «Заблокирован», «Не привязан» выше «Привязан»;
 * подписи — из словаря `t`). «Создал» и «Изменил» — как на экране; «Изменил» у записи без правок —
 * тот, кто создал. Контрагенты, отчёты, счёт и уровень знаний добавят их модули.
 */
const CREATED_BY = auditActorValue(employees.createdBy, creator.shortName);

export function employeeListColumns(t: ListTexts): ListColumns {
  return {
    fullName: { type: 'text', label: 'staff.col.full_name', value: employees.fullName },
    login: { type: 'text', label: 'staff.col.login', value: users.login },
    phone: { type: 'text', label: 'staff.col.phone', value: employees.phone, compact: true },
    role: {
      type: 'enum',
      label: 'staff.col.role',
      value: roles.id,
      display: roles.name,
      sort: { value: roles.name, text: true },
    },
    telegram: {
      type: 'enum',
      label: 'staff.col.telegram',
      value: sql`case when ${telegramLinks.linkedAt} is null then 'none' else 'linked' end`,
      display: sql`case when ${telegramLinks.linkedAt} is null then ${t('staff.telegram.none')} else ${t('staff.telegram.linked')} end`,
      sort: {
        value: sql`case when ${telegramLinks.linkedAt} is null then 0 else 1 end`,
        text: false,
      },
    },
    lastLoginAt: { type: 'datetime', label: 'staff.col.last_login', value: users.lastLoginAt },
    active: {
      type: 'enum',
      label: 'staff.col.active',
      value: sql`case when ${employees.active} then 'active' else 'blocked' end`,
      display: sql`case when ${employees.active} then ${t('staff.active')} else ${t('staff.blocked')} end`,
      sort: { value: sql`case when ${employees.active} then 0 else 1 end`, text: false },
    },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: employees.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: employees.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(employees.updatedBy, updater.shortName)}, ${CREATED_BY})`,
    },
  };
}

const EMPLOYEE_NATURAL = [employees.createdAt, employees.id];

/**
 * Страница списка сотрудников: сортировка, страница, фильтры, поиск и группы — на сервере, в ответе
 * только текущая страница; по умолчанию — от новых к старым по «Создано». Неизвестный столбец —
 * `ListQueryError`. `t` — тексты словаря для поиска по подписям статуса и Telegram.
 */
export async function listEmployeesPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<EmployeeRecord>> {
  const page = await selectListPage({
    query,
    columns: employeeListColumns(t),
    natural: EMPLOYEE_NATURAL,
    // У сотрудников нет области «Свои»: список — вся организация (её отсекает RLS).
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      selectEmployeePage(tx, window)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: employeeListFrom(tx),
  });
  const codes = await phoneCodes(tx);
  return { ...page, rows: page.rows.map((r) => toEmployee(r, codes)) };
}

/**
 * Счётчики вкладок модуля «Сотрудники» (прототип staffTabs): активных сотрудников и ролей
 * организации (её отсекает RLS).
 */
export async function staffTabCounts(tx: Tx): Promise<{ active: number; roles: number }> {
  const [active] = await tx
    .select({ n: count() })
    .from(employees)
    .where(eq(employees.active, true));
  const [all] = await tx.select({ n: count() }).from(roles);
  return { active: Number(active?.n ?? 0), roles: Number(all?.n ?? 0) };
}

/**
 * Значения столбца списка сотрудников для фильтра-галочек (роль — названия ролей, статус — подписи);
 * `q` — «Найти значение» по всем значениям столбца.
 */
export function listEmployeeValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: employeeListColumns(t),
    key,
    scope: undefined,
    from: employeeListFrom(tx),
    q,
  });
}

/**
 * Сотрудники для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys` по порядку экрана;
 * телефон — по маске справочника, как на экране.
 */
export async function exportEmployees(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  const result = await selectListExport({
    query,
    columns: employeeListColumns(t),
    keys,
    natural: EMPLOYEE_NATURAL,
    scope: undefined,
    from: employeeListFrom(tx),
  });
  const phone = keys.indexOf('phone');
  if (phone < 0) return result;
  const codes = await phoneCodes(tx);
  const rows = result.rows.map((row): ExportCell[] =>
    row.map((cell, i) =>
      i === phone && typeof cell === 'string' ? formatPhone(cell, codes) : cell,
    ),
  );
  return { ...result, rows };
}

/** Карточка сотрудника; null — нет такого в организации. */
export async function getEmployee(tx: Tx, id: string): Promise<EmployeeRecord | null> {
  const [row] = await selectEmployees(tx).where(eq(employees.id, id));
  return row ? toEmployee(row, await phoneCodes(tx)) : null;
}

/** Заблокировать запись сотрудника до конца транзакции, перед проверкой правил и правкой. */
export async function lockEmployee(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.id, id))
    .for('update');
  return rows.length > 0;
}

/** Роль организации, её права и область (у роли владельца права не перечисляются, область — «Все»). */
export interface RoleAccess {
  id: string;
  name: string;
  isOwner: boolean;
  permissions: PermissionId[];
  scopes: Record<ScopeGroupId, Scope>;
}

/**
 * Роль с правами и областью для решения о сотруднике; null — нет такой роли в организации. Строка
 * роли блокируется на чтение до конца транзакции (FOR SHARE): правка роли (`lockRole`, FOR UPDATE)
 * дождётся решения, а решение — уже сохранённой правки, и права читаются отдельным запросом после
 * блокировки, то есть свежие.
 */
export async function roleAccess(tx: Tx, roleId: string): Promise<RoleAccess | null> {
  const [role] = await tx
    .select({ id: roles.id, name: roles.name, isOwner: roles.isOwner })
    .from(roles)
    .where(eq(roles.id, roleId))
    .for('share');
  if (!role) return null;
  if (role.isOwner) {
    const all = normalizeScopes(Object.fromEntries(SCOPE_GROUPS.map((g) => [g, 'all'])));
    return { ...role, permissions: [], scopes: all };
  }
  return {
    ...role,
    permissions: await rolePermissionIds(tx, roleId),
    scopes: await roleScopeMap(tx, roleId),
  };
}

/** Область групп роли, как сохранена; недостающие группы — «Свои». */
export async function roleScopeMap(tx: Tx, roleId: string): Promise<Record<ScopeGroupId, Scope>> {
  const rows = await tx
    .select({ group: roleScopes.permGroup, scope: roleScopes.scope })
    .from(roleScopes)
    .where(eq(roleScopes.roleId, roleId));
  return normalizeScopes(Object.fromEntries(rows.map((r) => [r.group, r.scope])));
}

/** Права роли в порядке каталога. */
export async function rolePermissionIds(tx: Tx, roleId: string): Promise<PermissionId[]> {
  const rows = await tx
    .select({ id: rolePermissions.permissionId })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  const ids = new Set(rows.map((r) => r.id).filter(isPermissionId));
  return PERMISSION_IDS.filter((p) => ids.has(p));
}

export interface NewEmployee {
  fullName: string;
  shortName: string;
  /** Уже после normalizeLogin. */
  login: string;
  /** Хеш временного пароля: при первом входе его нужно сменить. */
  passwordHash: string;
  phone: string | null;
  role: { id: string; name: string };
}

/**
 * Новый сотрудник организации из контекста: учётная запись с временным паролем и сотрудник с ролью,
 * обе записи — в историю. Занятый на платформе логин — ошибка уникальности `users_login_unique`
 * (`uniqueViolation`), транзакция откатывается.
 */
export async function createEmployee(tx: Tx, input: NewEmployee): Promise<string> {
  const [user] = await tx
    .insert(users)
    .values({
      orgId: sql`app.current_org_id()`,
      login: input.login,
      passwordHash: input.passwordHash,
      mustChangePassword: true,
    })
    .returning({ id: users.id });
  const [employee] = await tx
    .insert(employees)
    .values({
      orgId: sql`app.current_org_id()`,
      userId: user!.id,
      fullName: input.fullName,
      shortName: input.shortName,
      phone: input.phone,
      roleId: input.role.id,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: employees.id });
  await writeHistory(
    tx,
    {
      entity: 'user',
      entityId: user!.id,
      action: 'create',
      changes: [{ field: 'login', to: input.login }],
    },
    {
      entity: 'employee',
      entityId: employee!.id,
      action: 'create',
      changes: [
        { field: 'fullName', to: input.fullName },
        { field: 'phone', to: input.phone },
        { field: 'roleId', to: input.role.id },
        { field: 'roleName', to: input.role.name },
      ],
    },
  );
  return employee!.id;
}

/** Заблокированный сотрудник: все его сеансы закрываются сразу. */
export async function endUserSessions(tx: Tx, userId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

/** Строка справочника «Коды телефонов» для поля ввода телефона. */
export interface PhoneCodeRecord {
  /** Страна: KG, KZ… */
  cc: string;
  flag: string;
  name: string;
  code: string;
  mask: string;
  /** Выключенный код в поле ввода не предлагается, но номер с ним по-прежнему читается. */
  active: boolean;
}

/**
 * Справочник платформы «Коды телефонов» (refDB → phoneCodes) по порядку справочника; строки без
 * страны, кода из цифр или маски пропускаются.
 */
export async function phoneCodeList(db: Db | Tx): Promise<PhoneCodeRecord[]> {
  const [row] = await db
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, 'phoneCodes'));
  const payload = row?.payload;
  if (!Array.isArray(payload)) return [];
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return payload.flatMap((p: unknown) => {
    const c = p as Record<string, unknown>;
    const code = text(c.code);
    const mask = text(c.mask);
    const cc = text(c.cc);
    if (!cc || !/^\d+$/.test(code) || !mask.includes('X')) return [];
    return [{ cc, flag: text(c.flag), name: text(c.name), code, mask, active: c.active !== false }];
  });
}

/** Справочник платформы «Коды телефонов» (refDB → phoneCodes): код страны и маска номера. */
export async function phoneCodes(db: Db | Tx): Promise<{ code: string; mask: string }[]> {
  return (await phoneCodeList(db)).map(({ code, mask }) => ({ code, mask }));
}
