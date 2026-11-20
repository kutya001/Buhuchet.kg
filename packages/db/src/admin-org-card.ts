import {
  addMonths,
  bishkekDate,
  FEATURES,
  FILE_LIST_KIND_OF,
  formatPhone,
  OPEN_REPORT_STATUSES,
  type Feature,
  type IsoDate,
  type LeadDocKind,
  type OrgLegalForm,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  not,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { adminGetOrganization, type AdminOrganizationRecord } from './admin-orgs';
import { ADMIN_CARD_ROWS, adminSessions, countAll } from './admin-user-card';
import { bankNamesOf, feeLedgers } from './fees';
import { writeHistory } from './history';
import { adminLeadDocs } from './lead-docs';
import { adminLeadOfOrganization } from './leads';
import { getOrgPolicy, getOrgProfile } from './org';
import {
  assignments,
  auditLog,
  banks,
  contractors,
  employees,
  files,
  orgAccounts,
  orgReportTypes,
  reports,
  reportTypes,
  rolePermissions,
  roles,
  subscriptionPlans,
  tasks,
  telegramLinks,
  users,
} from './schema';
import { reportPlateCounts, type ReportPlate } from './report-list';
import { dateLiteral } from './sql-text';
import { phoneCodes } from './staff';

// Карточка организации в Админке (ТЗ «Админка» → «Карточка организации», решение заказчика
// 09.11.2026; прототип admin/admin-cards.js, orgCard). Только чтение: администратор платформы не
// меняет контрагентов, отчёты и настройки организации. Всё читается в `withOrgContext` этой
// организации от имени администратора платформы (RLS).

export interface AdminOrgCardRecord {
  org: AdminOrganizationRecord;
  /** «Основное»: реквизиты из «Моя организация». */
  profile: {
    /** Форма (ОсОО, ИП) и ОКПО — доработки 14.11.2026, блок 1; форму меняет только администратор. */
    legalForm: OrgLegalForm | null;
    okpo: string | null;
    address: string | null;
    phone: string | null;
    head: string | null;
    hasLogo: boolean;
    /** Банки счетов организации — только названия, как в прототипе: номеров и получателей нет. */
    accounts: string[];
  };
  /**
   * `passwordUnset` — пароль ещё не задан по ссылке «Задать пароль» (доработки 14.11.2026, блок 1):
   * ссылка выдавалась или это свежий владелец организации по заявке (`app.password_unset`);
   * `telegram` — у владельца привязан Telegram (куда отправить новую ссылку).
   */
  owner: {
    userId: string;
    login: string;
    fullName: string;
    passwordUnset: boolean;
    telegram: boolean;
  } | null;
  /** Заявка с сайта, по которой создана организация. */
  lead: { id: string; title: string; at: Date } | null;
  /**
   * Документы заявки, по которой организацию одобрили (прототип v114 ocFiles, `leadFiles`): что было
   * приложено; сами файлы — в «Файловом менеджере» с источником «Заявка на подключение».
   */
  leadFiles: { kind: LeadDocKind; name: string; bytes: number; at: Date }[];
  summary: {
    staff: number;
    staffBlocked: number;
    contractors: { regular: number; oneoff: number; paused: number; archived: number };
    month: YearMonth;
    /**
     * Плитки «Отчёты» и «Просрочено» (доработки 20.11.2026, пакет 2, блок 1, пункт 4; прототип v150
     * orgSum): все несданные на сегодня — «в этом месяце» (срок до конца месяца) и «позже», все
     * просроченные — как на вкладке «Просроченные» самой фирмы.
     */
    reports: { open: number; month: number; later: number; overdue: number };
    tasks: number;
    files: { count: number; bytes: number };
    telegram: number;
    logins30: number;
  };
  reports: {
    /** Числа плиток-фильтров списка «Отчёты» (`reportPlateCounts`). */
    plates: Record<ReportPlate, number>;
    /** Пустая вкладка: контрагентов без архива и у скольких из них есть действующее назначение. */
    contractors: number;
    assigned: number;
    /** «Учёт оплаты налогов» организации: столбец «Оплачено» списка. */
    taxpay: boolean;
    /** «Сдача отчётов требует подтверждения»: отметки подтверждения в статусе. */
    confirm: boolean;
  };
  money: {
    feeMonth: { charged: Tyiyn; paid: Tyiyn };
    feeYear: { charged: Tyiyn; paid: Tyiyn };
    /** Налоги контрагентов по месяцам уплаты: 12 прошедших месяцев и следующий; сверху новые. */
    taxes: { month: YearMonth; sum: Tyiyn; paid: Tyiyn }[];
  };
  settings: {
    reportConfirm: boolean;
    confirmWaitDays: number;
    taskConfirm: boolean;
    payBeforeSubmit: boolean;
    timezone: string;
    features: Record<Feature, boolean>;
    reportTypes: string[];
    roles: { id: string; name: string; isOwner: boolean; permissions: number; employees: number }[];
    remindDays: number[];
    digestTime: string;
    weekDay: number;
    overdueRepeat: boolean;
  } | null;
  files: {
    byKind: { kind: string; count: number; bytes: number }[];
    recent: {
      id: string;
      name: string;
      kind: string;
      contractor: string | null;
      by: string | null;
      at: Date;
      bytes: number;
    }[];
  };
  history: AdminOrgHistoryEntry[];
  /**
   * Блокировки и разблокировки организации — отдельным списком: открытия карточки тоже пишутся в
   * историю и со временем вытеснили бы их из последних `ADMIN_CARD_ROWS` записей.
   */
  blocks: AdminOrgHistoryEntry[];
}

export interface AdminOrgHistoryEntry {
  id: string;
  at: Date;
  actor: string | null;
  actorAdmin: boolean;
  entity: string;
  action: string;
  /** Название роли у записи о роли (нынешнее; у удалённой — null, прежнее есть в изменениях). */
  subject: string | null;
  changes: { field: string; from?: unknown; to?: unknown }[];
  reason: string | null;
}

/** Сколько блокировок и разблокировок показывает «Основное». */
const BLOCK_ROWS = 50;

/** Сколько последних открытий карточки показывает «История». */
export const ADMIN_ORG_VIEW_ROWS = 30;

/** Сколько последних загрузок показывает вкладка «Файлы» (прототип ocGrids: `slice(0, 30)`). */
const RECENT_FILES = 30;

/**
 * Файлы карточки — те же, что в «Файловом менеджере» организации (прототип allFiles): файлов оплат
 * за обслуживание и финансовых операций в нём нет (у этих источников нет списка, `FileListSource.list`).
 */
const HIDDEN_FILE_KINDS = ['fee_payment', 'money_operation'] as const;

/** Вид источника как в менеджере (`FILE_LIST_KIND_OF`): файлы оплат услуги и проекта — их вид. */
const FILE_KIND = sql.raw(
  `(case "files"."source_kind" ${Object.entries(FILE_LIST_KIND_OF)
    .map(([from, to]) => {
      // Страховка: в текст запроса попадают только имена видов из кода.
      if (!/^[a-z_]+$/.test(from) || !/^[a-z_]+$/.test(to)) {
        throw new Error(`Неверный вид источника файла: ${from}`);
      }
      return `when '${from}' then '${to}'`;
    })
    .join(' ')} else "files"."source_kind" end)`,
);

/**
 * Поля записей истории подписки со значениями: «Изменить подписку», подтверждение и отклонение чека.
 * Вид подписки — названием (`planNames`), секретов нет.
 */
export const SUBSCRIPTION_HISTORY_VALUE_FIELDS = [
  'planId',
  'seats',
  'extraGb',
  'paidUntil',
  'extraDiscountPct',
  'free',
  'kind',
  'amount',
  'months',
  'status',
] as const;

/**
 * Поля организации, роли и подписки, чьи значения «было → стало» уходят в «Историю» карточки; у остальных
 * (ключ логотипа в хранилище, перечни прав) — только название поля. Настройки (`org_settings`) —
 * значения учётной политики, отдаются целиком: секретов в них нет.
 */
const HISTORY_VALUE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  organization: new Set([
    'name',
    'inn',
    'legalForm',
    'okpo',
    'address',
    'phone',
    'head',
    'slug',
    'status',
    'blockedReason',
    // «Одобрить» заявки с сайта: логин владельца (прототип v114 ldApproveDlg).
    'fromLead',
  ]),
  role: new Set(['name']),
  // Подписка (доработки 20.11.2026, блок 6; прототип: log('porg') в subPayOk, subPayRej, subSet).
  subscription: new Set(SUBSCRIPTION_HISTORY_VALUE_FIELDS),
};

/** Названия видов подписки — для «было → стало» вида в истории (удалённый вид — кодом). */
export async function subscriptionPlanNames(tx: Tx): Promise<ReadonlyMap<string, string>> {
  const rows = await tx
    .select({ id: subscriptionPlans.id, name: subscriptionPlans.name })
    .from(subscriptionPlans);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Вид подписки в изменениях истории — названием. */
export function withPlanNames<C extends { field: string; from?: unknown; to?: unknown }>(
  changes: readonly C[],
  names: ReadonlyMap<string, string>,
): C[] {
  const name = (v: unknown) => (typeof v === 'string' ? (names.get(v) ?? v) : v);
  return changes.map((c) =>
    c.field === 'planId'
      ? { ...c, ...('from' in c ? { from: name(c.from) } : {}), to: name(c.to) }
      : c,
  );
}

function historyChanges(
  entity: string,
  changes: readonly { field: string; from?: unknown; to?: unknown }[],
  plans: ReadonlyMap<string, string>,
): AdminOrgCardRecord['history'][number]['changes'] {
  if (entity === 'org_settings') return changes.map((c) => ({ ...c }));
  const shown = HISTORY_VALUE_FIELDS[entity];
  const scalar = (v: unknown) =>
    typeof v === 'string'
      ? v.slice(0, 300)
      : typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
        ? v
        : null;
  const list = entity === 'subscription' ? withPlanNames(changes, plans) : changes;
  return list.map((c) =>
    shown?.has(c.field)
      ? { field: c.field, from: scalar(c.from), to: scalar(c.to) }
      : { field: c.field },
  );
}

const ROLE_ID = sql.raw('"roles"."id"');
const actor = alias(employees, 'actor');
const uploader = alias(employees, 'uploader');

/** Просрочена сдача — как в списке отчётов (report-list.ts, overdueOf) и в карточке пользователя. */
function overdueOf(today: IsoDate): SQL {
  return and(
    inArray(reports.status, [...OPEN_REPORT_STATUSES]),
    lt(reports.dueDate, today),
    ne(reports.act, 'pay'),
    ne(contractors.serviceStatus, 'paused'),
  )!;
}

/** Месяцы блока «По месяцам и видам отчётов»: 6 прошлых, текущий и 3 следующих (пакет 2, блок 1, п. 2). */
export function adminRepMonths(today: IsoDate): YearMonth[] {
  const month = today.slice(0, 7) as YearMonth;
  return Array.from({ length: 10 }, (_, i) => addMonths(month, i - 6));
}

/**
 * Строки «По месяцам и видам отчётов» карточки (прототип v150 ocGrids, oc-rep): месяц срока `m`, вид
 * отчёта `t` (краткое название), всего `n`, сданных `done`, просроченных `over` — по месяцам
 * `adminRepMonths`, без прежних версий уточнённых. Источник `r` для общего слоя списков.
 */
export function adminRepMonthsSource(today: IsoDate): SQL {
  const months = adminRepMonths(today);
  const lastDay = sql`(${dateLiteral(`${months[months.length - 1]}-01`)} + interval '1 month' - interval '1 day')::date`;
  return sql`(select to_char(${reports.dueDate}, 'YYYY-MM') as m,
      coalesce(${reportTypes.shortName}, ${reportTypes.name}, ${reports.reportTypeCode}) as t,
      count(*)::int as n,
      (count(*) filter (where ${reports.status} = 'submitted'))::int as done,
      (count(*) filter (where ${overdueOf(today)}))::int as over
    from ${reports}
    inner join ${contractors} on ${contractors.id} = ${reports.contractorId}
    left join ${reportTypes} on ${reportTypes.code} = ${reports.reportTypeCode}
    where ${reports.superseded} = false
      and ${reports.dueDate} between ${dateLiteral(`${months[0]}-01`)} and ${lastDay}
    group by 1, 2) as r`;
}

/**
 * Карточка организации — в её контексте от имени администратора платформы: всё, что показывают
 * вкладки, одним ответом. null — организации нет или в контексте не администратор платформы.
 */
export async function adminOrgCard(
  tx: Tx,
  input: { orgId: string; now: Date; t: Translate },
): Promise<AdminOrgCardRecord | null> {
  const org = await adminGetOrganization(tx, input.orgId);
  if (!org) return null;
  const today = bishkekDate(input.now);
  const month = today.slice(0, 7) as YearMonth;
  const live = eq(reports.superseded, false);

  // «Основное».
  const profile = await getOrgProfile(tx, input.orgId);
  const codes = await phoneCodes(tx);
  const accountRows = await tx
    .select({
      kind: orgAccounts.kind,
      phoneBanks: orgAccounts.phoneBanks,
      bankName: banks.name,
    })
    .from(orgAccounts)
    .leftJoin(banks, eq(banks.code, orgAccounts.bankCode))
    .orderBy(asc(orgAccounts.createdAt), asc(orgAccounts.id));
  const bankNames = await bankNamesOf(
    tx,
    accountRows.flatMap((a) => a.phoneBanks),
  );
  // Только названия банков (прототип ocMain): номер счёта, БИК, телефон перевода и получатель
  // администратору платформы не отдаются.
  const accounts = [
    ...new Set(
      accountRows
        .flatMap((a) =>
          a.kind === 'phone' ? a.phoneBanks.map((c) => bankNames.get(c) ?? c) : [a.bankName ?? ''],
        )
        .filter((name) => name !== ''),
    ),
  ];
  const [owner] = await tx
    .select({
      userId: users.id,
      login: sql<string>`${users.login}::text`,
      fullName: employees.fullName,
      passwordUnset: sql<boolean>`app.password_unset(${users.id})`,
      telegram: sql<boolean>`exists (select 1 from ${telegramLinks} k where k.user_id = ${users.id})`,
    })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(roles.isOwner, true))
    .orderBy(asc(employees.createdAt), asc(employees.id))
    .limit(1);
  const lead = await adminLeadOfOrganization(tx, input.orgId);
  const leadFiles = lead
    ? (await adminLeadDocs(tx, lead.id)).map((d) => ({
        kind: d.kind,
        name: d.name,
        bytes: d.sizeBytes,
        at: d.createdAt,
      }))
    : [];

  // «Сводка».
  const [staffN = { active: 0, blocked: 0 }] = await tx
    .select({
      active: sql<number>`(count(*) filter (where ${employees.active} and not ${users.blocked}))::int`,
      blocked: sql<number>`(count(*) filter (where not (${employees.active} and not ${users.blocked})))::int`,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId));
  const [cpN = { regular: 0, oneoff: 0, paused: 0, archived: 0 }] = await tx
    .select({
      regular: sql<number>`(count(*) filter (where ${contractors.serviceStatus} = 'active' and ${contractors.kind} <> 'oneoff'))::int`,
      oneoff: sql<number>`(count(*) filter (where ${contractors.serviceStatus} <> 'archived' and ${contractors.kind} = 'oneoff'))::int`,
      paused: sql<number>`(count(*) filter (where ${contractors.serviceStatus} = 'paused'))::int`,
      archived: sql<number>`(count(*) filter (where ${contractors.serviceStatus} = 'archived'))::int`,
    })
    .from(contractors);
  const policy = await getOrgPolicy(tx, input.orgId);
  const taxpay = policy?.features.taxpay ?? false;
  const plateN = await reportPlateCounts(tx, { today, taxpay });
  const [assignedN = { n: 0 }] = await tx
    .select({ n: sql<number>`count(distinct ${assignments.contractorId})::int` })
    .from(assignments)
    .innerJoin(contractors, eq(contractors.id, assignments.contractorId))
    .where(and(isNull(assignments.endedOn), ne(contractors.serviceStatus, 'archived')));
  const [taskN = { n: 0 }] = await tx
    .select({ n: countAll })
    .from(tasks)
    .where(inArray(tasks.status, ['todo', 'in_progress', 'rework']));
  const shownFiles = and(
    eq(files.state, 'ready'),
    sql`${files.deletedAt} is null`,
    notInArray(files.sourceKind, [...HIDDEN_FILE_KINDS]),
  );
  const byKind = await tx
    .select({
      kind: sql<string>`${FILE_KIND}`,
      count: countAll,
      bytes: sql<string>`coalesce(sum(${files.sizeBytes}), 0)::text`,
    })
    .from(files)
    .where(shownFiles)
    .groupBy(FILE_KIND);
  const kinds = byKind
    .map((k) => ({ kind: k.kind, count: k.count, bytes: Number(k.bytes) }))
    .sort((a, b) => b.bytes - a.bytes || a.kind.localeCompare(b.kind));
  const [tgN = { n: 0 }] = await tx.select({ n: countAll }).from(telegramLinks);
  const [loginN = { n: 0 }] = await tx
    .select({ n: countAll })
    .from(adminSessions)
    .where(
      and(
        inArray(adminSessions.userId, tx.select({ id: employees.userId }).from(employees)),
        sql`${adminSessions.startedAt} >= ${input.now.toISOString()}::timestamptz - interval '30 days'`,
      ),
    );

  // «Деньги»: итоги без операций (прототип ocMoney).
  const ledgers = await feeLedgers(tx, { scope: undefined, today });
  const feeMonth = { charged: 0, paid: 0 };
  const feeYear = { charged: 0, paid: 0 };
  const yearFrom = `${month.slice(0, 4)}-01`;
  for (const fees of ledgers.values()) {
    for (const m of fees.months) {
      if (m.month === month) {
        feeMonth.charged += m.charge;
        feeMonth.paid += m.got;
      }
      if (m.month >= yearFrom && m.month <= month) {
        feeYear.charged += m.charge;
        feeYear.paid += m.got;
      }
    }
  }
  const payMonth = sql<string>`to_char(coalesce(${reports.payDue}, ${reports.dueDate}), 'YYYY-MM')`;
  const taxes = await tx
    .select({
      month: payMonth,
      sum: sql<string>`sum(${reports.amount})::text`,
      paid: sql<string>`sum(least(${reports.paid}, ${reports.amount}))::text`,
    })
    .from(reports)
    .where(
      and(
        live,
        sql`${reports.amount} > 0`,
        sql`${payMonth} between ${addMonths(month, -11)} and ${addMonths(month, 1)}`,
      ),
    )
    .groupBy(payMonth)
    .orderBy(desc(payMonth));

  // «Настройки».
  const typeRows = await tx
    .select({ name: sql<string>`coalesce(${reportTypes.shortName}, ${reportTypes.name})` })
    .from(orgReportTypes)
    .innerJoin(reportTypes, eq(reportTypes.code, orgReportTypes.reportTypeCode))
    .where(eq(orgReportTypes.enabled, true))
    .orderBy(asc(reportTypes.code));
  const roleRows = await tx
    .select({
      id: roles.id,
      name: roles.name,
      isOwner: roles.isOwner,
      // Столбцы названы с таблицей: без соединений Drizzle пишет их без неё, и подзапрос сравнил бы
      // столбцы своей же таблицы.
      permissions: sql<number>`(select count(*) from ${rolePermissions} p where p.role_id = ${ROLE_ID})::int`,
      employees: sql<number>`(select count(*) from ${employees} e where e.role_id = ${ROLE_ID})::int`,
    })
    .from(roles)
    .orderBy(desc(roles.isOwner), asc(roles.name), asc(roles.id));

  // «Файлы»: последние загрузки.
  const recent = await tx
    .select({
      id: files.id,
      name: files.name,
      kind: sql<string>`${FILE_KIND}`,
      contractor: contractors.name,
      by: uploader.shortName,
      at: files.createdAt,
      bytes: files.sizeBytes,
    })
    .from(files)
    .leftJoin(contractors, eq(contractors.id, files.contractorId))
    .leftJoin(uploader, eq(uploader.userId, files.createdBy))
    .where(shownFiles)
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(RECENT_FILES);

  // «История»: организация, настройки, роли и подписка; автор без сотрудника — администратор платформы.
  const historyRows = (where: SQL, limit: number) =>
    tx
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorName: actor.shortName,
        actorAdmin: sql<boolean>`${auditLog.actorUserId} is not null and ${actor.id} is null`,
        entity: auditLog.entity,
        action: auditLog.action,
        subject: roles.name,
        changes: auditLog.changes,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .leftJoin(actor, eq(actor.userId, auditLog.actorUserId))
      .leftJoin(
        roles,
        and(eq(auditLog.entity, 'role'), sql`${roles.id}::text = ${auditLog.entityId}`),
      )
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit);
  type HistoryRow = Awaited<ReturnType<typeof historyRows>>[number];
  const plans = await subscriptionPlanNames(tx);
  const entry = (h: HistoryRow): AdminOrgHistoryEntry => ({
    id: `${h.entity}-${h.id}`,
    at: h.at,
    actor: h.actorName,
    actorAdmin: h.actorAdmin === true,
    entity: h.entity,
    action: h.action,
    subject: h.subject,
    changes: historyChanges(h.entity, h.changes, plans),
    reason: h.reason,
  });
  // Открытия карточки — отдельным пределом: частые открытия не вытесняют из «Истории» правки
  // организации, её учётной политики и ролей.
  const inHistory = inArray(auditLog.entity, [
    'organization',
    'org_settings',
    'role',
    'subscription',
  ]);
  const isView = and(eq(auditLog.entity, 'organization'), eq(auditLog.action, 'card_view'))!;
  const changed = await historyRows(and(inHistory, not(isView))!, ADMIN_CARD_ROWS);
  const viewed = await historyRows(isView, ADMIN_ORG_VIEW_ROWS);
  const history = [...changed, ...viewed].sort((x, y) => y.at.getTime() - x.at.getTime());
  const blocks = await historyRows(
    and(
      eq(auditLog.entity, 'organization'),
      eq(auditLog.action, 'update'),
      sql`${auditLog.changes} @> '[{"field":"status"}]'::jsonb`,
    )!,
    BLOCK_ROWS,
  );

  return {
    org,
    profile: {
      legalForm: profile?.legalForm ?? null,
      okpo: profile?.okpo ?? null,
      address: profile?.address ?? null,
      phone: profile?.phone ? formatPhone(profile.phone, codes) : null,
      head: profile?.head ?? null,
      hasLogo: Boolean(profile?.logoKey),
      accounts,
    },
    owner: owner ?? null,
    lead,
    leadFiles,
    summary: {
      staff: staffN.active,
      staffBlocked: staffN.blocked,
      contractors: cpN,
      month,
      reports: {
        open: plateN.due,
        month: plateN.dueMonth,
        later: plateN.dueLater,
        overdue: plateN.over,
      },
      tasks: taskN.n,
      files: {
        count: kinds.reduce((n, k) => n + k.count, 0),
        bytes: kinds.reduce((n, k) => n + k.bytes, 0),
      },
      telegram: tgN.n,
      logins30: loginN.n,
    },
    reports: {
      plates: {
        due: plateN.due,
        work: plateN.work,
        done: plateN.done,
        over: plateN.over,
        all: plateN.all,
      },
      contractors: cpN.regular + cpN.oneoff + cpN.paused,
      assigned: assignedN.n,
      taxpay,
      confirm: policy?.reportConfirm ?? false,
    },
    money: {
      feeMonth,
      feeYear,
      taxes: taxes.map((x) => ({
        month: x.month as YearMonth,
        sum: Number(x.sum),
        paid: Number(x.paid),
      })),
    },
    settings: policy
      ? {
          reportConfirm: policy.reportConfirm,
          confirmWaitDays: policy.confirmWaitDays,
          taskConfirm: policy.taskConfirm,
          payBeforeSubmit: policy.payBeforeSubmit,
          timezone: policy.timezone,
          features: Object.fromEntries(FEATURES.map((f) => [f, policy.features[f]])) as Record<
            Feature,
            boolean
          >,
          reportTypes: typeRows.map((r) => r.name),
          roles: roleRows,
          remindDays: policy.remindDays,
          digestTime: policy.digestTime,
          weekDay: policy.weekDay,
          overdueRepeat: policy.overdueRepeat,
        }
      : null,
    files: { byKind: kinds, recent },
    history: history.map(entry),
    blocks: blocks.map(entry),
  };
}

/** Сколько минут повторное чтение уже открытой карточки не считается новым открытием. */
const CARD_REFRESH_MINUTES = 30;

/**
 * Открытие карточки организации — в историю этой организации (прототип orgCard: «Открыта карточка
 * организации»). `refresh` — карточка уже открыта и перечитывается: новой записи нет, только если этот
 * же администратор открывал её не раньше `CARD_REFRESH_MINUTES` минут назад (как у карточки
 * пользователя).
 */
export async function logOrgCardView(tx: Tx, orgId: string, refresh = false): Promise<void> {
  if (refresh) {
    const [seen] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'organization'),
          eq(auditLog.entityId, orgId),
          eq(auditLog.action, 'card_view'),
          sql`${auditLog.actorUserId} = app.current_user_id()`,
          sql`${auditLog.at} > now() - make_interval(mins => ${CARD_REFRESH_MINUTES})`,
        ),
      )
      .limit(1);
    if (seen) return;
  }
  await writeHistory(tx, {
    entity: 'organization',
    entityId: orgId,
    action: 'card_view',
    reason: 'Открыта карточка организации',
  });
}
