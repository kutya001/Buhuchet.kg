import {
  formatText,
  type HomeProgress,
  type IsoDate,
  type ListQuery,
  type ListSort,
  type RevenueContractor,
  type RevenueGridRow,
  type RevenuePayment,
  type Tyiyn,
} from '@buhuchet/domain';
import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import { FEE_DEBT, feeDebtTable, feeLedgers } from './fees';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import {
  contractors,
  employees,
  feePayments,
  oneOffServicePayments,
  oneOffServices,
  projectPayments,
  projects,
  reports,
  roles,
} from './schema';
import { dateLiteral } from './sql-text';

/*
 * «Главная» (задача 2.34; ТЗ «Главная»; прототип modules/home.js, modules/analytics.js): блоки «Сводки»,
 * которых нет в списках модулей, и выручка «Аналитики». Числа плашек «Сводки» считает API теми же
 * функциями списков, что открываются по плашке.
 */

/**
 * «Отчёты со сроком в этом месяце: сдано» (прототип renderHome, `prog`): у каждого сотрудника — отчёты, где
 * он ответственный, со сроком в текущем месяце, кроме «Не требуется» и прежних версий; сданные из них.
 * `employeeId` — только этот сотрудник (область «Свои»); null — все действующие, кроме владельца.
 * Сотрудник без таких отчётов не показывается.
 */
export async function homeMonthProgress(
  tx: Tx,
  o: { today: IsoDate; employeeId: string | null },
): Promise<HomeProgress[]> {
  const from = dateLiteral(`${o.today.slice(0, 7)}-01`);
  const to = sql`(${from} + interval '1 month' - interval '1 day')::date`;
  const rows = await tx
    .select({
      employeeId: employees.id,
      name: employees.shortName,
      all: sql<number>`count(${reports.id})::int`,
      done: sql<number>`count(${reports.id}) filter (where ${reports.status} = 'submitted')::int`,
    })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .innerJoin(
      reports,
      and(
        eq(reports.responsibleEmployeeId, employees.id),
        eq(reports.superseded, false),
        ne(reports.status, 'not_required'),
        sql`${reports.dueDate} between ${from} and ${to}`,
      ),
    )
    .where(
      o.employeeId
        ? eq(employees.id, o.employeeId)
        : and(eq(employees.active, true), eq(roles.isOwner, false)),
    )
    .groupBy(employees.id, employees.shortName, employees.createdAt)
    // ОТКЛОНЕНИЕ: docs/deviations.md#Г-12 — сотрудники по дате заведения.
    .orderBy(employees.createdAt, employees.id);
  return rows.map((r) => ({ ...r, all: Number(r.all), done: Number(r.done) }));
}

/**
 * «Должники по обслуживанию» (прототип renderHome: `visCps().filter(c => c.feeDebt > 0)`): контрагенты в
 * области группы «Контрагенты», не в архиве, с долгом за обслуживание — сколько и сумма долгов.
 */
export async function feeDebtors(
  tx: Tx,
  o: { scope: SQL | undefined; today: IsoDate },
): Promise<{ count: number; sum: Tyiyn }> {
  const fd = await feeDebtTable(tx, o.today);
  const [row] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      sum: sql<number>`coalesce(sum(${FEE_DEBT.debt}), 0)::bigint`.mapWith(Number),
    })
    .from(contractors)
    .innerJoin(fd, sql`${FEE_DEBT.id} = ${contractors.id}`)
    .where(and(ne(contractors.serviceStatus, 'archived'), o.scope, sql`${FEE_DEBT.debt} > 0`));
  return { count: Number(row?.count ?? 0), sum: Number(row?.sum ?? 0) };
}

/** В организации ещё нет ни одного контрагента (прототип `!CPS.length`): «Сводка» с подсказкой. */
export async function orgHasNoContractors(tx: Tx): Promise<boolean> {
  const [row] = await tx.select({ id: contractors.id }).from(contractors).limit(1);
  return !row;
}

/** Данные выручки: контрагенты в области с начислениями и долгами и их оплаты за годы. */
export interface RevenueSource {
  contractors: RevenueContractor[];
  payments: RevenuePayment[];
}

/**
 * Выручка контрагентов в области `scope` группы «Контрагенты», в том числе разовых и архивных (прототип
 * `revenueData`: `visCps(true)`): оплаты за обслуживание, по проектам (транши) и за разовые услуги за
 * годы `from`–`to` (удалённые не считаются, у разовой услуги — и оплаты удалённой услуги), начисления за
 * обслуживание по месяцам и долг сейчас — за обслуживание и недоплата неудалённых разовых услуг.
 * Транши — только проектов, которые сотрудник видит (`projects`: `visibleProjectIds`; undefined — все).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-12
export async function revenueSource(
  tx: Tx,
  o: {
    scope: SQL | undefined;
    projects?: SQL | undefined;
    today: IsoDate;
    from: number;
    to: number;
  },
): Promise<RevenueSource> {
  const years = (col: SQL) =>
    sql`${col} between ${dateLiteral(`${o.from}-01-01`)} and ${dateLiteral(`${o.to}-12-31`)}`;
  const servicePaid = sql`coalesce((select sum(p.amount) from ${oneOffServicePayments} p where p.service_id = ${oneOffServices.id} and p.deleted_at is null), 0)`;
  const [list, ledgers, fees, tranches, services, serviceDebts] = await Promise.all([
    tx
      .select({
        id: contractors.id,
        name: contractors.name,
        kind: contractors.kind,
        status: contractors.serviceStatus,
        responsible: employees.shortName,
      })
      .from(contractors)
      .leftJoin(employees, eq(employees.id, contractors.responsibleEmployeeId))
      .where(o.scope),
    feeLedgers(tx, { scope: o.scope, today: o.today }),
    tx
      .select({
        contractorId: feePayments.contractorId,
        date: feePayments.paidOn,
        amount: feePayments.amount,
      })
      .from(feePayments)
      .innerJoin(contractors, eq(contractors.id, feePayments.contractorId))
      .where(and(isNull(feePayments.deletedAt), years(sql`${feePayments.paidOn}`), o.scope)),
    tx
      .select({
        contractorId: projects.contractorId,
        date: projectPayments.paidOn,
        amount: projectPayments.amount,
      })
      .from(projectPayments)
      .innerJoin(projects, eq(projects.id, projectPayments.projectId))
      .innerJoin(contractors, eq(contractors.id, projects.contractorId))
      .where(
        and(
          isNull(projectPayments.deletedAt),
          years(sql`${projectPayments.paidOn}`),
          o.scope,
          o.projects ? sql`${projects.id} in ${o.projects}` : undefined,
        ),
      ),
    tx
      .select({
        contractorId: oneOffServices.contractorId,
        date: oneOffServicePayments.paidOn,
        amount: oneOffServicePayments.amount,
      })
      .from(oneOffServicePayments)
      .innerJoin(oneOffServices, eq(oneOffServices.id, oneOffServicePayments.serviceId))
      .innerJoin(contractors, eq(contractors.id, oneOffServices.contractorId))
      .where(
        and(
          isNull(oneOffServicePayments.deletedAt),
          isNull(oneOffServices.deletedAt),
          years(sql`${oneOffServicePayments.paidOn}`),
          o.scope,
        ),
      ),
    tx
      .select({
        contractorId: oneOffServices.contractorId,
        debt: sql<number>`coalesce(sum(greatest(0, ${oneOffServices.amount} - ${servicePaid})), 0)::bigint`.mapWith(
          Number,
        ),
      })
      .from(oneOffServices)
      .innerJoin(contractors, eq(contractors.id, oneOffServices.contractorId))
      .where(and(isNull(oneOffServices.deletedAt), o.scope))
      .groupBy(oneOffServices.contractorId),
  ]);
  const svcDebt = new Map(serviceDebts.map((r) => [r.contractorId, Number(r.debt)]));
  return {
    contractors: list.map((c) => {
      const fees = ledgers.get(c.id);
      return {
        id: c.id,
        name: c.name,
        responsible: c.responsible,
        oneOff: c.kind === 'oneoff',
        archived: c.status === 'archived',
        charges: fees?.months.map((m) => ({ month: m.month, charge: m.charge })) ?? [],
        feeDebt: fees?.debt ?? 0,
        serviceDebt: svcDebt.get(c.id) ?? 0,
      };
    }),
    payments: [
      ...fees.map((p) => ({ ...p, kind: 'fee' as const })),
      ...tranches.map((p) => ({ ...p, kind: 'proj' as const })),
      ...services.map((p) => ({ ...p, kind: 'svc' as const })),
    ],
  };
}

/* ───────────── Список «Аналитики» ───────────── */

/** Столбец строки из `jsonb_to_recordset`. */
const field = (key: string) => sql.raw(`"r"."${key.replace(/[^a-z0-9_]/gi, '')}"`);

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

const MONEY_KEYS = ['fee_ch', 'fee', 'proj', 'svc', 'total', 'debt', 'prev'] as const;

/** Строки списка одним параметром запроса — общий механизм списков ищет, фильтрует и сортирует их. */
function revenueRecordset(rows: readonly RevenueGridRow[], t: ListTexts): SQL {
  const json = rows.map((r, n) => ({
    id: r.id,
    n,
    cp: r.name,
    resp: r.responsible,
    kind: r.oneOff ? 'oneoff' : 'regular',
    kind_t: t(r.oneOff ? 'home.an.kind.oneoff' : 'home.an.kind.regular'),
    fee_ch: r.feeCh,
    fee: r.fee,
    proj: r.proj,
    svc: r.svc,
    total: r.total,
    debt: r.debt,
    // Доля — процент с десятыми (52,6), как `type: 'num'` прототипа: в Excel — число.
    share: r.share,
    share_t: `${String(r.share).replace('.', ',')} %`,
    prev: r.prev,
    change: r.change,
    change_t: r.change === null ? null : `${r.change > 0 ? '+' : ''}${r.change} %`,
  }));
  const defs = [
    ['id', 'text'],
    ['n', 'integer'],
    ['cp', 'text'],
    ['resp', 'text'],
    ['kind', 'text'],
    ['kind_t', 'text'],
    ...MONEY_KEYS.map((k) => [k, 'bigint']),
    ['share', 'numeric'],
    ['share_t', 'text'],
    ['change', 'integer'],
    ['change_t', 'text'],
  ]
    .map(([k, type]) => `"${k}" ${type}`)
    .join(', ');
  return sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb) as r(${sql.raw(defs)})`;
}

/**
 * Столбцы списка (прототип: сетка `an-cps`): контрагент, ответственный, тип, начислено и оплачено за
 * обслуживание, проекты, разовые услуги, итого, долг, доля, прошлый год и изменение. `prevLabel` —
 * «2025 год» в заголовке выгрузки.
 */
function revenueColumns(prevLabel: string): ListColumns {
  return {
    cp: { type: 'text', label: 'home.an.col.cp', value: field('cp') },
    resp: { type: 'enum', label: 'home.an.col.resp', value: field('resp') },
    kind: {
      type: 'enum',
      label: 'home.an.col.kind',
      value: field('kind'),
      display: field('kind_t'),
    },
    feeCh: { type: 'money', label: 'home.an.col.fee_ch', value: field('fee_ch'), total: true },
    fee: { type: 'money', label: 'home.an.col.fee', value: field('fee'), total: true },
    proj: { type: 'money', label: 'home.an.col.proj', value: field('proj'), total: true },
    svc: { type: 'money', label: 'home.an.col.svc', value: field('svc'), total: true },
    total: { type: 'money', label: 'home.an.col.total', value: field('total'), total: true },
    debt: { type: 'money', label: 'home.an.col.debt', value: field('debt'), total: true },
    share: {
      type: 'int',
      label: 'home.an.col.share',
      value: field('share'),
      display: field('share_t'),
    },
    prev: { type: 'money', label: prevLabel, value: field('prev'), total: true },
    change: {
      type: 'int',
      label: 'home.an.col.change',
      value: field('change'),
      display: field('change_t'),
    },
  };
}

/** По умолчанию — по «Итого получено», от больших (прототип: `sort: {key: 'total', dir: -1}`). */
const REVENUE_SORT: ListSort = { key: 'total', dir: 'desc' };
const NATURAL = [field('n')];

/** Строки «Аналитики» за год и прошлый год, тексты и подпись столбца прошлого года. */
export interface RevenueListInput {
  rows: readonly RevenueGridRow[];
  t: ListTexts;
  prevYear: number;
}

const prevLabelOf = (i: RevenueListInput) => formatText(i.t('home.an.year'), { y: i.prevYear });

export async function listRevenuePage(tx: Tx, query: ListQuery, input: RevenueListInput) {
  const source = revenueRecordset(input.rows, input.t);
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const page = await selectListPage({
    query,
    columns: revenueColumns(prevLabelOf(input)),
    natural: NATURAL,
    defaultSort: REVENUE_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${field('id')}`, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

export function listRevenueValues(tx: Tx, key: string, input: RevenueListInput, q?: string) {
  return selectListValues({
    columns: revenueColumns(prevLabelOf(input)),
    key,
    scope: undefined,
    from: fromOf(tx, revenueRecordset(input.rows, input.t)),
    q,
  });
}

export function exportRevenue(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  input: RevenueListInput,
) {
  return selectListExport({
    query,
    columns: revenueColumns(prevLabelOf(input)),
    keys,
    natural: NATURAL,
    defaultSort: REVENUE_SORT,
    scope: undefined,
    from: fromOf(tx, revenueRecordset(input.rows, input.t)),
  });
}
