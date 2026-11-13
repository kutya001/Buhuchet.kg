import type { IsoDate, ListQuery, ListSort, OrgActivityRow } from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { ActivitySpan } from './activity';
import type { Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';

/*
 * Админка → «Организации» → «Активность» (прототип v84, modules/activity.js — `actOrg`, `renderOrgAct`;
 * миграция 0116, docs/decisions.md п. О-44): числа организаций за период считают функции
 * `app.admin_org_activity` и `app.admin_activity_by_day` — не администратору платформы они и
 * представление `app.admin_organizations` отвечают пусто. Всё — в `withUserContext` администратора.
 */

const NUMBER_KEYS = ['users', 'staff', 'days', 'in', 'n', 'sub', 'cps'] as const;

const field = (key: string) => sql.raw(`"r"."${key.replace(/[^a-z0-9_]/gi, '')}"`);

/**
 * Организации платформы с числами за период. «Работали, пользователей» — не больше действующих
 * сотрудников (прототип `Math.min(umax, o.staff())`); период — два параметра-даты функции.
 */
function orgActivitySource(span: ActivitySpan): SQL {
  return sql`(
    select
      o.id as id,
      o.name as name,
      o.status as status,
      o.created_at as created_at,
      a.last_at as last,
      least(coalesce(a.users, 0), o.employees) as users,
      o.employees as staff,
      coalesce(a.days, 0) as days,
      coalesce(a.logins, 0) as "in",
      coalesce(a.actions, 0) as n,
      coalesce(a.submitted, 0) as sub,
      coalesce(a.contractors, 0) as cps
    from app.admin_organizations o
    left join app.admin_org_activity(${span.from}::date, ${span.to}::date) a on a.org_id = o.id
  ) as r`;
}

const rowFields = {
  id: sql<string>`${field('id')}`,
  name: sql<string>`${field('name')}`,
  status: sql<string>`${field('status')}`,
  last: sql<
    string | null
  >`to_char(${field('last')} at time zone 'Asia/Bishkek', 'YYYY-MM-DD HH24:MI')`,
  ...(Object.fromEntries(NUMBER_KEYS.map((k) => [k, sql<number>`${field(k)}`])) as Record<
    (typeof NUMBER_KEYS)[number],
    SQL<number>
  >),
};

type Raw = {
  [K in keyof typeof rowFields]: (typeof rowFields)[K] extends SQL<infer T> ? T : never;
};

const toRow = ({ status, ...r }: Raw): OrgActivityRow => ({ ...r, active: status === 'active' });

/** Все организации с числами за период — по дате регистрации (прототип `ORGS.map(actOrg)`). */
export async function adminOrgActivity(tx: Tx, span: ActivitySpan): Promise<OrgActivityRow[]> {
  const rows = await tx
    .select(rowFields)
    .from(orgActivitySource(span))
    .orderBy(field('created_at'), field('id'));
  return rows.map(toRow);
}

/** Действия всех организаций по дням периода — для столбиков. */
export async function adminActivityByDay(
  tx: Tx,
  span: ActivitySpan,
): Promise<Map<IsoDate, number>> {
  const rows = await tx.execute<{ day: string; actions: number }>(
    sql`select to_char(d.day, 'YYYY-MM-DD') as day, d.actions
        from app.admin_activity_by_day(${span.from}::date, ${span.to}::date) d`,
  );
  return new Map([...rows].map((r) => [r.day as IsoDate, Number(r.actions)]));
}

/**
 * Столбцы списка (прототип: сетка `adm-org-act`): организация, статус, последняя активность, работали
 * пользователей, сотрудников всего, дни с активностью, входы, действия, сдано отчётов, новых
 * контрагентов. Статус — как в списке организаций: «Активна» выше «Заблокирована».
 */
function orgActivityColumns(t: ListTexts): ListColumns {
  const status = field('status');
  return {
    name: { type: 'text', label: 'orgs.act.col.name', value: field('name') },
    st: {
      type: 'enum',
      label: 'orgs.act.col.st',
      value: sql`case when ${status} = 'active' then 'active' else 'blocked' end`,
      display: sql`case when ${status} = 'active' then ${t('orgs.active')} else ${t('orgs.blocked')} end`,
      sort: { value: sql`case when ${status} = 'active' then 0 else 1 end`, text: false },
    },
    last: { type: 'datetime', label: 'orgs.act.col.last', value: field('last') },
    ...Object.fromEntries(
      NUMBER_KEYS.map((k) => [
        k,
        { type: 'int', label: `orgs.act.col.${k}`, value: field(k), total: true },
      ]),
    ),
  };
}

/** По умолчанию — по «Действий», от больших (прототип: `sort: {key: 'n', dir: -1}`). */
const SORT: ListSort = { key: 'n', dir: 'desc' };
const NATURAL = [field('created_at'), field('id')];

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

export async function listOrgActivityPage(
  tx: Tx,
  query: ListQuery,
  span: ActivitySpan,
  t: ListTexts,
) {
  const source = orgActivitySource(span);
  const page = await selectListPage({
    query,
    columns: orgActivityColumns(t),
    natural: NATURAL,
    defaultSort: SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...rowFields, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return { ...page, rows: page.rows.map((r) => toRow(r)) };
}

export function listOrgActivityValues(
  tx: Tx,
  key: string,
  span: ActivitySpan,
  t: ListTexts,
  q?: string,
) {
  return selectListValues({
    columns: orgActivityColumns(t),
    key,
    scope: undefined,
    from: fromOf(tx, orgActivitySource(span)),
    q,
  });
}

export function exportOrgActivity(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  span: ActivitySpan,
  t: ListTexts,
) {
  return selectListExport({
    query,
    columns: orgActivityColumns(t),
    keys,
    natural: NATURAL,
    defaultSort: SORT,
    scope: undefined,
    from: fromOf(tx, orgActivitySource(span)),
  });
}
