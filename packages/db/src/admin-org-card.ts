import {
  addMonths,
  bishkekDate,
  FEATURES,
  formatPhone,
  localPhoneText,
  OPEN_REPORT_STATUSES,
  requisiteText,
  tariffAt,
  type Feature,
  type IsoDate,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, lt, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { adminGetOrganization, type AdminOrganizationRecord } from './admin-orgs';
import { ADMIN_CARD_ROWS, adminSessions, capped, countAll, type CardList } from './admin-user-card';
import { bankNamesOf, feeLedgers, feeSubjectsOf } from './fees';
import { writeHistory } from './history';
import { adminLeadOfOrganization } from './leads';
import { getOrgPolicy, getOrgProfile } from './org';
import {
  auditLog,
  banks,
  contractors,
  employees,
  files,
  orgAccounts,
  orgReportTypes,
  ownershipForms,
  reports,
  reportTypes,
  rolePermissions,
  roles,
  tasks,
  taxRegimes,
  telegramLinks,
  users,
} from './schema';
import { dateLiteral } from './sql-text';
import { phoneCodeList, phoneCodes } from './staff';

// Карточка организации в Админке (ТЗ «Админка» → «Карточка организации», решение заказчика
// 09.11.2026; прототип admin/admin-cards.js, orgCard). Только чтение: администратор платформы не
// меняет контрагентов, отчёты и настройки организации. Всё читается в `withOrgContext` этой
// организации от имени администратора платформы (RLS).

export interface AdminOrgCardRecord {
  org: AdminOrganizationRecord;
  /** «Основное»: реквизиты из «Моя организация». */
  profile: {
    address: string | null;
    phone: string | null;
    head: string | null;
    hasLogo: boolean;
    /** Счета организации строкой, как в сообщениях контрагентам. */
    accounts: string[];
  };
  owner: { userId: string; login: string; fullName: string } | null;
  /** Заявка с сайта, по которой создана организация. */
  lead: { id: string; title: string; at: Date } | null;
  summary: {
    staff: number;
    staffBlocked: number;
    contractors: { regular: number; oneoff: number; paused: number; archived: number };
    month: YearMonth;
    reports: { todo: number; inWork: number; submitted: number; overdue: number };
    tasks: number;
    files: { count: number; bytes: number };
    telegram: number;
    logins30: number;
  };
  staff: CardList<{
    userId: string;
    fullName: string;
    login: string;
    role: string;
    telegram: boolean;
    lastLoginAt: Date | null;
    blocked: boolean;
    employeeActive: boolean;
    loginLocked: boolean;
    mustChangePassword: boolean;
  }>;
  contractors: CardList<{
    id: string;
    name: string;
    inn: string;
    form: string;
    regime: string | null;
    responsible: string | null;
    kind: string;
    /** Стоимость обслуживания по действующей ставке; null — ставки нет или контрагент разовый. */
    fee: Tyiyn | null;
    serviceStatus: string;
  }>;
  reports: {
    /** По месяцам срока и видам отчётов за последние 6 месяцев: сверху новые. */
    byMonth: {
      month: YearMonth;
      type: string;
      total: number;
      submitted: number;
      overdue: number;
    }[];
    overdue: CardList<{
      id: string;
      contractor: string;
      type: string;
      period: string;
      periodStart: string;
      eventDate: string | null;
      dueDate: string;
      responsible: string | null;
      status: string;
    }>;
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

/** Сколько последних загрузок показывает вкладка «Файлы» (прототип ocGrids: `slice(0, 30)`). */
const RECENT_FILES = 30;

/**
 * Поля организации и роли, чьи значения «было → стало» уходят в «Историю» карточки; у остальных
 * (ключ логотипа в хранилище, перечни прав) — только название поля. Настройки (`org_settings`) —
 * значения учётной политики, отдаются целиком: секретов в них нет.
 */
const HISTORY_VALUE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  organization: new Set([
    'name',
    'inn',
    'address',
    'phone',
    'head',
    'slug',
    'status',
    'blockedReason',
  ]),
  role: new Set(['name']),
};

function historyChanges(
  entity: string,
  changes: readonly { field: string; from?: unknown; to?: unknown }[],
): AdminOrgCardRecord['history'][number]['changes'] {
  if (entity === 'org_settings') return changes.map((c) => ({ ...c }));
  const shown = HISTORY_VALUE_FIELDS[entity];
  const scalar = (v: unknown) =>
    typeof v === 'string' ? v.slice(0, 300) : typeof v === 'boolean' ? v : null;
  return changes.map((c) =>
    shown?.has(c.field)
      ? { field: c.field, from: scalar(c.from), to: scalar(c.to) }
      : { field: c.field },
  );
}

const ROLE_ID = sql.raw('"roles"."id"');
const actor = alias(employees, 'actor');
const responsible = alias(employees, 'responsible');
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
  const monthFrom = dateLiteral(`${month}-01`);
  const monthTo = sql`(${monthFrom} + interval '1 month' - interval '1 day')::date`;
  const inMonth = sql`${reports.dueDate} between ${monthFrom} and ${monthTo}`;
  const live = eq(reports.superseded, false);

  // «Основное».
  const profile = await getOrgProfile(tx, input.orgId);
  const codes = await phoneCodes(tx);
  const accountRows = await tx
    .select({
      kind: orgAccounts.kind,
      accountNo: orgAccounts.accountNo,
      bik: orgAccounts.bik,
      phone: orgAccounts.phone,
      phoneBanks: orgAccounts.phoneBanks,
      holderName: orgAccounts.holderName,
      bankName: banks.name,
    })
    .from(orgAccounts)
    .leftJoin(banks, eq(banks.code, orgAccounts.bankCode))
    .orderBy(asc(orgAccounts.createdAt), asc(orgAccounts.id));
  const [localCodes, bankNames] = await Promise.all([
    phoneCodeList(tx),
    bankNamesOf(
      tx,
      accountRows.flatMap((a) => a.phoneBanks),
    ),
  ]);
  const accounts = accountRows.map((a) =>
    requisiteText(
      {
        kind: a.kind,
        bankNames:
          a.kind === 'phone' ? a.phoneBanks.map((c) => bankNames.get(c) ?? c) : [a.bankName ?? ''],
        accountNo: a.accountNo,
        bik: a.bik,
        phoneText: a.phone ? localPhoneText(a.phone, localCodes) : '',
        holderName: a.holderName,
      },
      'org',
      input.t,
    ),
  );
  const [owner] = await tx
    .select({
      userId: users.id,
      login: sql<string>`${users.login}::text`,
      fullName: employees.fullName,
    })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(roles.isOwner, true))
    .orderBy(asc(employees.createdAt), asc(employees.id))
    .limit(1);
  const lead = await adminLeadOfOrganization(tx, input.orgId);

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
  const [repN = { todo: 0, inWork: 0, submitted: 0, overdue: 0 }] = await tx
    .select({
      todo: sql<number>`(count(*) filter (where ${reports.status} = 'todo'))::int`,
      inWork: sql<number>`(count(*) filter (where ${reports.status} = 'in_progress'))::int`,
      submitted: sql<number>`(count(*) filter (where ${reports.status} = 'submitted'))::int`,
      overdue: sql<number>`(count(*) filter (where ${overdueOf(today)}))::int`,
    })
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .where(and(live, inMonth));
  const [taskN = { n: 0 }] = await tx
    .select({ n: countAll })
    .from(tasks)
    .where(inArray(tasks.status, ['todo', 'in_progress', 'rework']));
  const shownFiles = and(eq(files.state, 'ready'), sql`${files.deletedAt} is null`);
  const byKind = await tx
    .select({
      kind: files.sourceKind,
      count: countAll,
      bytes: sql<string>`coalesce(sum(${files.sizeBytes}), 0)::text`,
    })
    .from(files)
    .where(shownFiles)
    .groupBy(files.sourceKind);
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

  // «Сотрудники».
  const staff = await capped(
    await tx
      .select({
        userId: users.id,
        fullName: employees.fullName,
        login: sql<string>`${users.login}::text`,
        role: roles.name,
        telegram: sql<boolean>`${telegramLinks.userId} is not null`,
        lastLoginAt: users.lastLoginAt,
        blocked: users.blocked,
        employeeActive: employees.active,
        loginLocked: sql<boolean>`${users.loginLockedAt} is not null`,
        mustChangePassword: users.mustChangePassword,
      })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .innerJoin(roles, eq(roles.id, employees.roleId))
      .leftJoin(telegramLinks, eq(telegramLinks.userId, employees.userId))
      .orderBy(asc(employees.fullName), asc(employees.id))
      .limit(ADMIN_CARD_ROWS),
    () => tx.select({ n: countAll }).from(employees),
  );

  // «Контрагенты»: стоимость — действующая ставка журнала тарифов (прототип `tariffAt(c, ym(TODAY))`).
  const cpRows = await capped(
    await tx
      .select({
        id: contractors.id,
        name: contractors.name,
        inn: contractors.inn,
        form: sql<string>`coalesce(${ownershipForms.name}, ${contractors.formCode})`,
        regime: taxRegimes.name,
        responsible: responsible.shortName,
        kind: contractors.kind,
        serviceStatus: contractors.serviceStatus,
      })
      .from(contractors)
      .leftJoin(ownershipForms, eq(ownershipForms.code, contractors.formCode))
      .leftJoin(taxRegimes, eq(taxRegimes.code, contractors.regimeCode))
      .leftJoin(responsible, eq(responsible.id, contractors.responsibleEmployeeId))
      .orderBy(asc(contractors.name), asc(contractors.id))
      .limit(ADMIN_CARD_ROWS),
    () => tx.select({ n: countAll }).from(contractors),
  );
  const subjects = await feeSubjectsOf(
    tx,
    cpRows.rows.map((c) => c.id),
  );
  const cps: AdminOrgCardRecord['contractors'] = {
    count: cpRows.count,
    rows: cpRows.rows.map((c) => {
      const s = subjects.get(c.id);
      const tariff = s && !s.oneOff ? tariffAt(s.tariffs, month) : null;
      return { ...c, fee: tariff ? tariff.amount : null };
    }),
  };

  // «Отчёты».
  const firstMonth = addMonths(month, -5);
  const dueMonth = sql<string>`to_char(${reports.dueDate}, 'YYYY-MM')`;
  const typeName = sql<string>`coalesce(${reportTypes.shortName}, ${reportTypes.name}, ${reports.reportTypeCode})`;
  const byMonth = await tx
    .select({
      month: dueMonth,
      type: typeName,
      total: countAll,
      submitted: sql<number>`(count(*) filter (where ${reports.status} = 'submitted'))::int`,
      overdue: sql<number>`(count(*) filter (where ${overdueOf(today)}))::int`,
    })
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .leftJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .where(
      and(live, sql`${reports.dueDate} between ${dateLiteral(`${firstMonth}-01`)} and ${monthTo}`),
    )
    .groupBy(dueMonth, typeName)
    .orderBy(desc(dueMonth), asc(typeName));
  const overdueCond = and(live, overdueOf(today));
  const overdue = await capped(
    await tx
      .select({
        id: reports.id,
        contractor: contractors.name,
        type: typeName,
        period: reports.period,
        periodStart: reports.periodStart,
        eventDate: reports.eventDate,
        dueDate: reports.dueDate,
        responsible: responsible.shortName,
        status: reports.status,
      })
      .from(reports)
      .innerJoin(contractors, eq(contractors.id, reports.contractorId))
      .leftJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
      .leftJoin(responsible, eq(responsible.id, reports.responsibleEmployeeId))
      .where(overdueCond)
      .orderBy(asc(reports.dueDate), asc(reports.id))
      .limit(ADMIN_CARD_ROWS),
    () =>
      tx
        .select({ n: countAll })
        .from(reports)
        .innerJoin(contractors, eq(contractors.id, reports.contractorId))
        .where(overdueCond),
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
  const policy = await getOrgPolicy(tx, input.orgId);
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
      kind: files.sourceKind,
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

  // «История»: организация, настройки и роли; автор без сотрудника — администратор платформы.
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
  const entry = (h: HistoryRow): AdminOrgHistoryEntry => ({
    id: `${h.entity}-${h.id}`,
    at: h.at,
    actor: h.actorName,
    actorAdmin: h.actorAdmin === true,
    entity: h.entity,
    action: h.action,
    subject: h.subject,
    changes: historyChanges(h.entity, h.changes),
    reason: h.reason,
  });
  const history = await historyRows(
    inArray(auditLog.entity, ['organization', 'org_settings', 'role']),
    ADMIN_CARD_ROWS,
  );
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
      address: profile?.address ?? null,
      phone: profile?.phone ? formatPhone(profile.phone, codes) : null,
      head: profile?.head ?? null,
      hasLogo: Boolean(profile?.logoKey),
      accounts,
    },
    owner: owner ?? null,
    lead,
    summary: {
      staff: staffN.active,
      staffBlocked: staffN.blocked,
      contractors: cpN,
      month,
      reports: repN,
      tasks: taskN.n,
      files: {
        count: kinds.reduce((n, k) => n + k.count, 0),
        bytes: kinds.reduce((n, k) => n + k.bytes, 0),
      },
      telegram: tgN.n,
      logins30: loginN.n,
    },
    staff,
    contractors: cps,
    reports: { byMonth: byMonth.map((r) => ({ ...r, month: r.month as YearMonth })), overdue },
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
