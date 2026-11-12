import {
  NO_ACTIVITY_COUNTERS,
  OPEN_REPORT_STATUSES,
  type ActivityCounters,
  type ActivityDay,
  type ActivityEmployee,
  type ActivityRow,
  type IsoDate,
  type ListQuery,
  type ListSort,
} from '@buhuchet/domain';
import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
} from './list';
import {
  auditLog,
  contractors,
  employees,
  projects,
  reports,
  roles,
  statusHistory,
  tasks,
} from './schema';
import { dateLiteral, textLiteral } from './sql-text';

/*
 * «Главная» → «Активность» (прототип v84, modules/activity.js; docs/deviations.md п. О-71): действия
 * сотрудников — из истории изменений и «Истории статусов», входы и выходы — из журнала сеансов
 * (представление app.org_sessions — только сеансы своей организации, миграция 0115), сданные отчёты,
 * контрагенты и задачи — по данным организации. Всё читается в `withOrgContext`: чужих записей не даёт
 * RLS, право «Смотреть аналитику по сотрудникам» проверяет API.
 */

/** Сотрудник с учётной записью: по ней история и журнал сеансов называют автора. */
export interface ActivityStaff extends ActivityEmployee {
  userId: string;
}

/** Все сотрудники организации по дате заведения (прототип `EMP`). */
export async function activityStaff(tx: Tx): Promise<ActivityStaff[]> {
  return tx
    .select({
      id: employees.id,
      userId: employees.userId,
      name: employees.fullName,
      role: roles.name,
      active: employees.active,
    })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .orderBy(asc(employees.createdAt), asc(employees.id));
}

/** Один сотрудник — для окна «Активность по дням». */
export async function activityStaffMember(tx: Tx, id: string): Promise<ActivityStaff | null> {
  const [row] = await tx
    .select({
      id: employees.id,
      userId: employees.userId,
      name: employees.fullName,
      role: roles.name,
      active: employees.active,
    })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(eq(employees.id, id));
  return row ?? null;
}

/** Начало дня по Бишкеку — граница периода для моментов. */
const dayStart = (day: IsoDate) =>
  sql`(${dateLiteral(day)}::timestamp at time zone 'Asia/Bishkek')`;
const bishkekDay = (at: SQL) => sql`(${at} at time zone 'Asia/Bishkek')::date`;

/** Период в днях: `to` — последний наступивший день (дальше событий нет). */
export interface ActivitySpan {
  from: IsoDate;
  to: IsoDate;
}

/**
 * События сотрудников за период одной выборкой: действие — запись истории изменений или смена
 * статуса, вход — начало сеанса, выход — сеанс, закрытый кнопкой «Выйти», «был в программе» —
 * последнее обращение сеанса. `userId` — только один пользователь.
 *
 * Одна операция — одно действие, как `log()` прототипа: смена статуса не считается, если та же
 * операция записала и историю изменений (время обеих записей — время транзакции), и начальный статус
 * новой записи тоже — её создание уже есть в истории.
 */
function eventsOf(span: ActivitySpan, userId?: string): SQL {
  const from = dayStart(span.from);
  const to = sql`(${dayStart(span.to)} + interval '1 day')`;
  const within = (at: SQL) => sql`${at} >= ${from} and ${at} < ${to}`;
  const one = (col: SQL) => (userId ? sql` and ${col} = ${userId}` : sql``);
  return sql`(
    select a.actor_user_id as user_id, a.at as at, 'act'::text as kind, a.contractor_id as contractor_id
      from ${auditLog} a
      where a.actor_user_id is not null and ${within(sql`a.at`)}${one(sql`a.actor_user_id`)}
    union all
    select s.actor_user_id, s.at, 'act'::text,
        case when s.scale = 'service' then s.entity_id
          else coalesce(sr.contractor_id, st.contractor_id, sp.contractor_id) end
      from ${statusHistory} s
      left join ${reports} sr on s.scale in ('report', 'payment') and sr.id = s.entity_id
      left join ${tasks} st on s.scale = 'task' and st.id = s.entity_id
      left join ${projects} sp on s.scale = 'project' and sp.id = s.entity_id
      where s.actor_user_id is not null and s.from_status is not null and ${within(sql`s.at`)}${one(sql`s.actor_user_id`)}
        and not exists (
          select 1 from ${auditLog} sa
          where sa.org_id = s.org_id and sa.at = s.at and sa.actor_user_id = s.actor_user_id
        )
    union all
    select l.user_id, l.started_at, 'in'::text, null::uuid
      from app.org_sessions l
      where ${within(sql`l.started_at`)}${one(sql`l.user_id`)}
    union all
    select l.user_id, l.ended_at, 'out'::text, null::uuid
      from app.org_sessions l
      where l.logged_out and ${within(sql`l.ended_at`)}${one(sql`l.user_id`)}
    union all
    select l.user_id, l.last_seen_at, 'seen'::text, null::uuid
      from app.org_sessions l
      where ${within(sql`l.last_seen_at`)}${one(sql`l.user_id`)}
  ) e`;
}

/**
 * Дни с активностью по пользователям (прототип `actEmpDay`): действия, входы, выходы, первый вход и
 * последняя активность дня по Бишкеку. Ключ — учётная запись (`users.id`), дни — по возрастанию.
 */
export async function activityDays(
  tx: Tx,
  span: ActivitySpan,
  userId?: string,
): Promise<Map<string, ActivityDay[]>> {
  const out = new Map<string, ActivityDay[]>();
  if (span.to < span.from) return out;
  const day = bishkekDay(sql`e.at`);
  const rows = await tx.execute<{
    user_id: string;
    day: string;
    n: number;
    in: number;
    out: number;
    first: string | null;
    last: string;
  }>(sql`
    select e.user_id, ${day}::text as day,
      count(*) filter (where e.kind = 'act')::int as n,
      count(*) filter (where e.kind = 'in')::int as "in",
      count(*) filter (where e.kind = 'out')::int as "out",
      to_char(min(e.at) filter (where e.kind = 'in') at time zone 'Asia/Bishkek', 'HH24:MI') as first,
      to_char(max(e.at) at time zone 'Asia/Bishkek', 'HH24:MI') as last
    from ${eventsOf(span, userId)}
    group by e.user_id, ${day}
    order by e.user_id, ${day}`);
  for (const r of rows) {
    const list = out.get(r.user_id) ?? [];
    list.push({
      day: r.day,
      n: Number(r.n),
      in: Number(r.in),
      out: Number(r.out),
      first: r.first,
      last: r.last,
    });
    out.set(r.user_id, list);
  }
  return out;
}

/** Отчёт со сдачей (у вида «Уплата» сдачи нет; прототип `!tR(r).payOnly`). */
const WITH_SUBMIT = sql`${reports.act} <> 'pay'`;
const OPEN = sql`${reports.status} in (${sql.join([...OPEN_REPORT_STATUSES].map(textLiteral), sql`, `)})`;

/**
 * Сдан в периоде — по дню сдачи (прототип `actIn(r.subDate, rg)`): отчёт, возвращённый на исправление,
 * день сдачи хранит и в «сдано» остаётся.
 */
const submittedIn = (span: ActivitySpan) =>
  sql`(${WITH_SUBMIT} and ${reports.submittedOn} between ${dateLiteral(span.from)} and ${dateLiteral(span.to)})`;

/** Срок сдачи в периоде: без «Не требуется» и прежних версий (прототип `due`). */
const dueIn = (range: ActivitySpan) =>
  sql`(not ${reports.superseded} and ${reports.status} <> 'not_required' and ${WITH_SUBMIT} and ${reports.dueDate} between ${dateLiteral(range.from)} and ${dateLiteral(range.to)})`;

/** Просрочена сдача сейчас — как в списке отчётов (report-list.ts, `overdueOf`). */
const overdueNow = (today: IsoDate) =>
  sql`(not ${reports.superseded} and ${contractors.serviceStatus} <> 'paused' and ${WITH_SUBMIT} and ${OPEN} and ${reports.dueDate} < ${dateLiteral(today)})`;

const count = (where: SQL) => sql<number>`count(*) filter (where ${where})::int`;

/** Период целиком (`range`) и его наступившая часть (`span`), сегодня. */
export interface ActivityWindow {
  range: ActivitySpan;
  span: ActivitySpan;
  today: IsoDate;
}

/**
 * Числа сотрудников по данным организации (прототип `actEmp`): сдано и сдано позже срока — у того, кто
 * сдал (не записано — у ответственного), срок в периоде и просрочено сейчас — у ответственного,
 * контрагенты в ответственности (не в архиве), выполненные в периоде задачи — у исполнителя.
 */
export async function activityCounters(
  tx: Tx,
  w: ActivityWindow,
): Promise<Map<string, ActivityCounters>> {
  const submitter = sql`coalesce((select se.id from ${employees} se where se.user_id = ${reports.submittedBy}), ${reports.responsibleEmployeeId})`;
  const [subs, owned, cps, done] = await Promise.all([
    tx
      .select({
        id: sql<string | null>`${submitter}`,
        sub: sql<number>`count(*)::int`,
        late: count(sql`${reports.submittedOn} > ${reports.dueDate}`),
      })
      .from(reports)
      .where(submittedIn(w.span))
      .groupBy(submitter),
    tx
      .select({
        id: reports.responsibleEmployeeId,
        due: count(dueIn(w.range)),
        over: count(overdueNow(w.today)),
      })
      .from(reports)
      .innerJoin(contractors, eq(contractors.id, reports.contractorId))
      .groupBy(reports.responsibleEmployeeId),
    tx
      .select({ id: contractors.responsibleEmployeeId, cps: sql<number>`count(*)::int` })
      .from(contractors)
      .where(ne(contractors.serviceStatus, 'archived'))
      .groupBy(contractors.responsibleEmployeeId),
    tx
      .select({ id: tasks.executorEmployeeId, tasks: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        sql`${bishkekDay(sql`${tasks.doneAt}`)} between ${dateLiteral(w.span.from)} and ${dateLiteral(w.span.to)}`,
      )
      .groupBy(tasks.executorEmployeeId),
  ]);
  const out = new Map<string, ActivityCounters>();
  const put = (id: string | null, part: Partial<ActivityCounters>) => {
    if (!id) return;
    out.set(id, { ...(out.get(id) ?? NO_ACTIVITY_COUNTERS), ...part });
  };
  for (const r of subs) put(r.id, { sub: Number(r.sub), late: Number(r.late) });
  for (const r of owned) put(r.id, { due: Number(r.due), over: Number(r.over) });
  for (const r of cps) put(r.id, { cps: Number(r.cps) });
  for (const r of done) put(r.id, { tasks: Number(r.tasks) });
  return out;
}

/** Сколько отчётов сотрудник сдал по дням периода (окно сотрудника, «По дням»). */
export async function activitySubmittedByDay(
  tx: Tx,
  span: ActivitySpan,
  employeeId: string,
): Promise<Map<IsoDate, number>> {
  const out = new Map<IsoDate, number>();
  if (span.to < span.from) return out;
  const rows = await tx
    .select({ day: reports.submittedOn, n: sql<number>`count(*)::int` })
    .from(reports)
    .where(
      and(
        submittedIn(span),
        sql`coalesce((select se.id from ${employees} se where se.user_id = ${reports.submittedBy}), ${reports.responsibleEmployeeId}) = ${employeeId}`,
      ),
    )
    .groupBy(reports.submittedOn);
  for (const r of rows) if (r.day) out.set(r.day, Number(r.n));
  return out;
}

/** Строка «По контрагентам» окна сотрудника (прототип `actEmpDlg`, сетка `home-act-c`). */
export interface ActivityContractor {
  id: string;
  name: string;
  /** Отчётов сдано сотрудником в периоде. */
  sub: number;
  /** Со сроком в периоде. */
  due: number;
  /** Из них не сдано. */
  open: number;
  /** Просрочено сейчас. */
  over: number;
  /** Действий сотрудника по контрагенту в периоде. */
  act: number;
  /** Контрагент в области сотрудника, который смотрит: карточку можно открыть. */
  inScope: boolean;
}

/**
 * Контрагенты в ответственности сотрудника (не в архиве) с его числами за период, по названию.
 * `scope` — область «Свои контрагенты» того, кто смотрит (undefined — вся организация).
 */
export async function activityContractors(
  tx: Tx,
  w: ActivityWindow,
  staff: ActivityStaff,
  scope: SQL | undefined,
): Promise<ActivityContractor[]> {
  const mine = eq(reports.responsibleEmployeeId, staff.id);
  const [list, numbers, actions] = await Promise.all([
    tx
      .select({
        id: contractors.id,
        name: contractors.name,
        inScope: sql<boolean>`${scope ?? sql`true`}`,
      })
      .from(contractors)
      .where(
        and(
          eq(contractors.responsibleEmployeeId, staff.id),
          ne(contractors.serviceStatus, 'archived'),
        ),
      )
      .orderBy(sql`${contractors.name} collate app.ru_natural`, asc(contractors.id)),
    tx
      .select({
        id: reports.contractorId,
        sub: count(
          sql`${submittedIn(w.span)} and coalesce((select se.id from ${employees} se where se.user_id = ${reports.submittedBy}), ${reports.responsibleEmployeeId}) = ${staff.id}`,
        ),
        due: count(sql`${mine} and ${dueIn(w.range)}`),
        open: count(sql`${mine} and ${dueIn(w.range)} and ${OPEN}`),
        over: count(sql`${mine} and ${overdueNow(w.today)}`),
      })
      .from(reports)
      .innerJoin(contractors, eq(contractors.id, reports.contractorId))
      .where(
        and(
          eq(contractors.responsibleEmployeeId, staff.id),
          ne(contractors.serviceStatus, 'archived'),
        ),
      )
      .groupBy(reports.contractorId),
    w.span.to < w.span.from
      ? Promise.resolve([] as { id: string; n: number }[])
      : tx.execute<{ id: string; n: number }>(sql`
          select e.contractor_id as id, count(*)::int as n
          from ${eventsOf(w.span, staff.userId)}
          where e.kind = 'act' and e.contractor_id is not null
          group by e.contractor_id`),
  ]);
  const byId = new Map(numbers.map((r) => [r.id, r]));
  const acts = new Map([...actions].map((r) => [r.id, Number(r.n)]));
  return list.map((c) => {
    const n = byId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      sub: Number(n?.sub ?? 0),
      due: Number(n?.due ?? 0),
      open: Number(n?.open ?? 0),
      over: Number(n?.over ?? 0),
      act: acts.get(c.id) ?? 0,
      inScope: Boolean(c.inScope),
    };
  });
}

/* ───────────── Список «Активности» ───────────── */

/** Столбец строки из `jsonb_to_recordset`. */
const field = (key: string) => sql.raw(`"r"."${key.replace(/[^a-z0-9_]/gi, '')}"`);

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

const NUMBER_KEYS = [
  'in',
  'out',
  'days',
  'n',
  'sub',
  'late',
  'due',
  'over',
  'cps',
  'tasks',
] as const;

/** Посчитанные строки одним параметром запроса — общий механизм списков ищет, фильтрует и сортирует их. */
function activityRecordset(rows: readonly ActivityRow[]): SQL {
  const json = rows.map((r, n) => ({
    id: r.id,
    pos: n,
    fio: r.name,
    role: r.role,
    // Момент по Бишкеку (UTC+6) — столбец «Последняя активность».
    last: r.last ? `${r.last.replace(' ', 'T')}:00+06:00` : null,
    in: r.in,
    out: r.out,
    days: r.days,
    n: r.n,
    sub: r.sub,
    late: r.late,
    due: r.due,
    over: r.over,
    cps: r.cps,
    tasks: r.tasks,
  }));
  const defs = [
    ['id', 'text'],
    ['pos', 'integer'],
    ['fio', 'text'],
    ['role', 'text'],
    ['last', 'timestamptz'],
    ...NUMBER_KEYS.map((k) => [k, 'integer']),
  ]
    .map(([k, type]) => `"${k}" ${type}`)
    .join(', ');
  return sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb) as r(${sql.raw(defs)})`;
}

/**
 * Столбцы списка (прототип: сетка `home-act`): сотрудник, роль, последняя активность, входы, выходы, дни
 * с активностью, действия, сдано, сдано позже срока, срок в периоде, просрочено сейчас, контрагенты,
 * задачи.
 */
const ACTIVITY_COLUMNS: ListColumns = {
  fio: { type: 'text', label: 'home.act.col.fio', value: field('fio') },
  role: { type: 'enum', label: 'home.act.col.role', value: field('role') },
  last: { type: 'datetime', label: 'home.act.col.last', value: field('last') },
  ...Object.fromEntries(
    NUMBER_KEYS.map((k) => [
      k,
      { type: 'int', label: `home.act.col.${k}`, value: field(k), total: true },
    ]),
  ),
};

/** По умолчанию — по «Действий», от больших (прототип: `sort: {key: 'n', dir: -1}`). */
const ACTIVITY_SORT: ListSort = { key: 'n', dir: 'desc' };
const NATURAL = [field('pos')];

export async function listActivityPage(tx: Tx, query: ListQuery, rows: readonly ActivityRow[]) {
  const source = activityRecordset(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const page = await selectListPage({
    query,
    columns: ACTIVITY_COLUMNS,
    natural: NATURAL,
    defaultSort: ACTIVITY_SORT,
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

export function listActivityValues(tx: Tx, key: string, rows: readonly ActivityRow[], q?: string) {
  return selectListValues({
    columns: ACTIVITY_COLUMNS,
    key,
    scope: undefined,
    from: fromOf(tx, activityRecordset(rows)),
    q,
  });
}

export function exportActivity(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  rows: readonly ActivityRow[],
) {
  return selectListExport({
    query,
    columns: ACTIVITY_COLUMNS,
    keys,
    natural: NATURAL,
    defaultSort: ACTIVITY_SORT,
    scope: undefined,
    from: fromOf(tx, activityRecordset(rows)),
  });
}
