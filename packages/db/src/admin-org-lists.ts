import { ACCOUNT_LOCK_FAILURES, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { linkedFiles } from './file-links';
import { listSourceFiles, type FileRecord } from './files';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
} from './list';
import { employees, roles, telegramLinks, users } from './schema';
import { textLiteral } from './sql-text';

// Списки карточки организации в Админке, читаемые с сервера страницами (доработки 20.11.2026, пакет 2,
// блок 1, пункт 5; прототип v150 ocGrids): «Сотрудники» здесь, «Контрагенты» и «Отчёты» — общие
// списки модулей (`listContractorsPage`, `listReportsPage`). Всё — в `withOrgContext` организации от
// имени администратора платформы (RLS), только чтение.

/** Состояние учётной записи — первое по порядку `accountStates` домена (у списка одно значение). */
const STATE = sql<string>`case when ${users.blocked} then 'blocked_admin' when not ${employees.active} then 'blocked_owner' when ${users.loginLockedAt} is not null then (case when ${users.loginLockReason} = 'not_me' then 'login_locked_not_me' else 'login_locked' end) when ${users.mustChangePassword} then 'temp_password' when app.password_unset(${users.id}) then 'no_password' else 'active' end`;
const STATE_ORDER = sql`case when ${users.blocked} then 1 when not ${employees.active} then 2 when ${users.loginLockedAt} is not null then 3 when ${users.mustChangePassword} then 4 when app.password_unset(${users.id}) then 5 else 0 end`;
const TELEGRAM = sql<boolean>`exists (select 1 from ${telegramLinks} k where k.user_id = ${users.id})`;

const STATES = [
  'active',
  'blocked_admin',
  'blocked_owner',
  'login_locked',
  'login_locked_not_me',
  'temp_password',
  'no_password',
] as const;

/** Столбцы «Сотрудников» карточки (прототип ocGrids, oc-staff): ключи — как у столбцов экрана. */
export function adminOrgStaffColumns(t: ListTexts): ListColumns {
  const stateText = (s: string) =>
    t(`accounts.card.state.${s}`).replace('{n}', String(ACCOUNT_LOCK_FAILURES));
  return {
    fullName: { type: 'text', label: 'orgs.card.staff.col.name', value: employees.fullName },
    login: { type: 'text', label: 'orgs.card.staff.col.login', value: sql`${users.login}::text` },
    role: { type: 'enum', label: 'orgs.card.staff.col.role', value: roles.name },
    tg: {
      type: 'enum',
      label: 'orgs.card.staff.col.tg',
      value: sql`case when ${TELEGRAM} then 'on' else 'off' end`,
      display: sql`case when ${TELEGRAM} then ${t('orgs.card.staff.tg_on')} else ${t('orgs.card.staff.tg_off')} end`,
    },
    lastLoginAt: {
      type: 'datetime',
      label: 'orgs.card.staff.col.last',
      value: users.lastLoginAt,
    },
    state: {
      type: 'enum',
      label: 'orgs.card.staff.col.state',
      value: STATE,
      display: sql`case ${STATE} ${sql.join(
        STATES.map((s) => sql`when ${textLiteral(s)} then ${stateText(s)}`),
        sql` `,
      )} end`,
      sort: { value: STATE_ORDER, text: false },
    },
  };
}

/** Строка «Сотрудников» карточки: состояния — для `accountStates` домена. */
export interface AdminOrgStaffRow {
  userId: string;
  fullName: string;
  login: string;
  role: string;
  telegram: boolean;
  lastLoginAt: Date | null;
  blocked: boolean;
  employeeActive: boolean;
  loginLocked: boolean;
  loginLockReason: string | null;
  mustChangePassword: boolean;
  passwordUnset: boolean;
}

const staffFields = {
  userId: users.id,
  fullName: employees.fullName,
  login: sql<string>`${users.login}::text`,
  role: roles.name,
  telegram: TELEGRAM,
  lastLoginAt: users.lastLoginAt,
  blocked: users.blocked,
  employeeActive: employees.active,
  loginLocked: sql<boolean>`${users.loginLockedAt} is not null`,
  loginLockReason: users.loginLockReason,
  mustChangePassword: users.mustChangePassword,
  passwordUnset: sql<boolean>`app.password_unset(${users.id})`,
};

const STAFF_NATURAL = [employees.fullName, employees.id];
const STAFF_SORT = { key: 'fullName', dir: 'asc' } as const;

function staffFrom(tx: Tx): ListFrom {
  return (f) =>
    tx
      .select(f)
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .innerJoin(roles, eq(roles.id, employees.roleId))
      .$dynamic();
}

/** Страница «Сотрудников» карточки организации: по умолчанию — по ФИО (прототип: sort fio). */
export async function listAdminOrgStaffPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<AdminOrgStaffRow>> {
  const page = await selectListPage({
    query,
    columns: adminOrgStaffColumns(t),
    natural: STAFF_NATURAL,
    defaultSort: STAFF_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...staffFields, ...window })
        .from(employees)
        .innerJoin(users, eq(users.id, employees.userId))
        .innerJoin(roles, eq(roles.id, employees.roleId))
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: staffFrom(tx),
  });
  return {
    ...page,
    rows: page.rows.map((r) => ({
      userId: r.userId,
      fullName: r.fullName,
      login: r.login,
      role: r.role,
      telegram: r.telegram === true,
      lastLoginAt: r.lastLoginAt,
      blocked: r.blocked,
      employeeActive: r.employeeActive,
      loginLocked: r.loginLocked === true,
      loginLockReason: r.loginLockReason,
      mustChangePassword: r.mustChangePassword,
      passwordUnset: r.passwordUnset === true,
    })),
  };
}

export function listAdminOrgStaffValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: adminOrgStaffColumns(t),
    key,
    scope: undefined,
    from: staffFrom(tx),
    q,
  });
}

export function exportAdminOrgStaff(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  return selectListExport({
    query,
    columns: adminOrgStaffColumns(t),
    keys,
    natural: STAFF_NATURAL,
    defaultSort: STAFF_SORT,
    scope: undefined,
    from: staffFrom(tx),
  });
}

/**
 * Файлы отчёта для окна «Отчёт» Админки (доработки 20.11.2026, пакет 2, блок 1, пункт 3): свои файлы
 * отчёта и прикреплённые к нему ссылкой, без ключей хранилища.
 */
export async function adminReportFiles(
  tx: Tx,
  reportId: string,
): Promise<
  Pick<FileRecord, 'id' | 'name' | 'sizeBytes' | 'contentType' | 'uploadedBy' | 'createdAt'>[]
> {
  const own = await listSourceFiles(tx, 'report', reportId);
  const linked = await linkedFiles(tx, { kind: 'report', id: reportId });
  const seen = new Set<string>();
  return [...own, ...linked]
    .filter((f) => !seen.has(f.id) && seen.add(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      sizeBytes: f.sizeBytes,
      contentType: f.contentType,
      uploadedBy: f.uploadedBy,
      createdAt: f.createdAt,
    }));
}
