import {
  addDays,
  isPermissionId,
  OPEN_REPORT_STATUSES,
  SCOPE_GROUPS,
  type AccessSubject,
  type IsoDate,
  type NotifySettings,
  type PermissionId,
  type ReportAct,
  type ReportPeriod,
  type ReportStatus,
  type Scope,
  type ScopeGroupId,
  type TaskStatus,
} from '@buhuchet/domain';
import { and, eq, inArray, lte, ne, or, sql } from 'drizzle-orm';
import type { Tx } from './client';
import {
  contractors,
  employees,
  organizations,
  orgReportTypes,
  orgSettings,
  reports,
  reportTypes,
  rolePermissions,
  roleScopes,
  roles,
  tasks,
  telegramLinks,
  users,
} from './schema';
import { getNotifySettings, notifySettingsOf } from './telegram-outbox';

/*
 * Данные для напоминаний за день одной организации (задача 2.25, docs/decisions.md, п. Б-5) — в
 * контексте организации `withOrgContext`: учётная политика, сотрудники с правами и привязанным Telegram,
 * несданные и неоплаченные отчёты на ближайшие 60 дней и просроченные, ждущие подтверждения сдачи;
 * открытые и ждущие подтверждения ручные задачи. Правила, кому что писать, — в @buhuchet/domain
 * (`dailyReminders`).
 */

/** Сколько дней вперёд смотреть: больше дней напоминания у вида не бывает (1–60). */
export const REMINDER_HORIZON_DAYS = 60;

export interface ReminderEmployee {
  employeeId: string;
  userId: string;
  shortName: string;
  /** Шаблон роли «Главный бухгалтер». */
  chief: boolean;
  subject: AccessSubject;
  chatId: number | null;
  settings: NotifySettings;
}

export interface ReminderReportRow {
  id: string;
  contractorName: string;
  contractorResponsibleId: string | null;
  typeShort: string;
  period: ReportPeriod;
  periodStart: IsoDate;
  act: ReportAct;
  status: ReportStatus;
  dueDate: IsoDate;
  payDue: IsoDate | null;
  amount: number | null;
  paid: number;
  responsibleId: string | null;
  remindDays: number[];
  /** День сдачи по Бишкеку, если сдача ждёт подтверждения. */
  waitingSince: IsoDate | null;
  submittedById: string | null;
}

export interface ReminderTaskRow {
  id: string;
  title: string;
  executorId: string;
  authorId: string;
  dueDate: IsoDate;
  status: TaskStatus;
  /** День «Выполнена» по Бишкеку. */
  doneOn: IsoDate | null;
}

export interface ReminderOrgData {
  orgName: string;
  features: Record<string, boolean>;
  overdueRepeat: boolean;
  confirmWaitDays: number;
  reportConfirm: boolean;
  employees: ReminderEmployee[];
  reports: ReminderReportRow[];
  tasks: ReminderTaskRow[];
}

const OPEN = sql.raw(`(${[...OPEN_REPORT_STATUSES].map((s) => `'${s}'`).join(', ')})`);

/** Действующие сотрудники организации из контекста с правами, областями, Telegram и настройками. */
export async function reminderEmployees(tx: Tx): Promise<ReminderEmployee[]> {
  const rows = await tx
    .select({
      employeeId: employees.id,
      userId: employees.userId,
      shortName: employees.shortName,
      roleId: roles.id,
      isOwner: roles.isOwner,
      templateCode: roles.templateCode,
      chatId: telegramLinks.chatId,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .leftJoin(telegramLinks, eq(telegramLinks.userId, employees.userId))
    .where(and(eq(employees.active, true), eq(users.blocked, false)));
  const roleIds = [...new Set(rows.map((r) => r.roleId))];
  const [perms, scopes, settings] = await Promise.all([
    roleIds.length
      ? tx
          .select({ roleId: rolePermissions.roleId, id: rolePermissions.permissionId })
          .from(rolePermissions)
          .where(inArray(rolePermissions.roleId, roleIds))
      : [],
    roleIds.length
      ? tx
          .select({
            roleId: roleScopes.roleId,
            group: roleScopes.permGroup,
            scope: roleScopes.scope,
          })
          .from(roleScopes)
          .where(inArray(roleScopes.roleId, roleIds))
      : [],
    notifySettingsOf(tx),
  ]);
  return rows.map((r) => {
    const own: Partial<Record<ScopeGroupId, Scope>> = {};
    for (const s of scopes) {
      if (s.roleId === r.roleId && (SCOPE_GROUPS as readonly string[]).includes(s.group)) {
        own[s.group as ScopeGroupId] = s.scope as Scope;
      }
    }
    return {
      employeeId: r.employeeId,
      userId: r.userId,
      shortName: r.shortName,
      chief: r.templateCode === 'chief',
      subject: {
        employeeId: r.employeeId,
        isOwner: r.isOwner,
        permissions: new Set(
          perms.filter((p) => p.roleId === r.roleId && isPermissionId(p.id)).map((p) => p.id),
        ) as ReadonlySet<PermissionId>,
        scopes: own,
      },
      chatId: r.chatId,
      settings: settings.get(r.userId) ?? { mode: 'all', off: [] },
    };
  });
}

/** Всё для напоминаний за день `today`. */
export async function loadReminderData(tx: Tx, today: IsoDate): Promise<ReminderOrgData> {
  const horizon = addDays(today, REMINDER_HORIZON_DAYS);
  const [settings] = await tx
    .select({
      name: organizations.name,
      features: orgSettings.features,
      remindDays: orgSettings.remindDays,
      overdueRepeat: orgSettings.overdueRepeat,
      confirmWaitDays: orgSettings.confirmWaitDays,
      reportConfirm: orgSettings.reportConfirm,
    })
    .from(orgSettings)
    .innerJoin(organizations, eq(organizations.id, orgSettings.orgId));
  if (!settings) throw new Error('loadReminderData: нет учётной политики организации');
  const submittedDay = sql<
    string | null
  >`coalesce((${reports.submittedAt} at time zone 'Asia/Bishkek')::date, ${reports.submittedOn})::text`;
  const [employeeRows, reportRows, taskRows] = await Promise.all([
    reminderEmployees(tx),
    tx
      .select({
        id: reports.id,
        contractorName: contractors.name,
        contractorResponsibleId: contractors.responsibleEmployeeId,
        typeShort: reportTypes.shortName,
        period: reports.period,
        periodStart: reports.periodStart,
        act: reports.act,
        status: reports.status,
        dueDate: reports.dueDate,
        payDue: reports.payDue,
        amount: reports.amount,
        paid: reports.paid,
        responsibleId: reports.responsibleEmployeeId,
        remindDays: orgReportTypes.remindDays,
        confirmedAt: reports.confirmedAt,
        submittedDay,
        submittedById: sql<
          string | null
        >`(select e.id from ${employees} e where e.user_id = ${reports.submittedBy})`,
      })
      .from(reports)
      .innerJoin(contractors, eq(contractors.id, reports.contractorId))
      .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
      .leftJoin(orgReportTypes, eq(orgReportTypes.reportTypeCode, reports.reportTypeCode))
      .where(
        and(
          eq(reports.superseded, false),
          ne(reports.status, 'not_required'),
          eq(contractors.serviceStatus, 'active'),
          or(
            sql`(${reports.status} in ${OPEN} and ${reports.act} <> 'pay' and ${reports.dueDate} <= ${horizon}::date)`,
            sql`(${reports.act} <> 'sub' and ${reports.payDue} <= ${horizon}::date and (${reports.amount} is null or ${reports.amount} > ${reports.paid}))`,
            sql`(${reports.status} = 'submitted' and ${reports.act} <> 'pay' and ${reports.confirmedAt} is null)`,
          ),
        ),
      ),
    tx
      .select({
        id: tasks.id,
        title: tasks.title,
        executorId: tasks.executorEmployeeId,
        authorId: tasks.authorEmployeeId,
        dueDate: tasks.dueDate,
        status: tasks.status,
        doneOn: sql<string | null>`(${tasks.doneAt} at time zone 'Asia/Bishkek')::date::text`,
      })
      .from(tasks)
      .where(
        or(
          and(
            inArray(tasks.status, ['todo', 'in_progress', 'rework']),
            lte(tasks.dueDate, addDays(today, 1)),
          ),
          eq(tasks.status, 'on_confirm'),
        ),
      ),
  ]);
  return {
    orgName: settings.name,
    features: settings.features,
    overdueRepeat: settings.overdueRepeat,
    confirmWaitDays: settings.confirmWaitDays,
    reportConfirm: settings.reportConfirm,
    employees: employeeRows,
    reports: reportRows.map((r) => ({
      id: r.id,
      contractorName: r.contractorName,
      contractorResponsibleId: r.contractorResponsibleId,
      typeShort: r.typeShort,
      period: r.period,
      periodStart: r.periodStart,
      act: r.act,
      status: r.status,
      dueDate: r.dueDate,
      payDue: r.payDue,
      amount: r.amount,
      paid: r.paid,
      responsibleId: r.responsibleId,
      // Дни напоминаний вида в организации; не задавали — из учётной политики.
      remindDays: r.remindDays ?? settings.remindDays ?? [],
      waitingSince:
        r.status === 'submitted' && r.act !== 'pay' && r.confirmedAt === null
          ? (r.submittedDay?.slice(0, 10) ?? null)
          : null,
      submittedById: r.submittedById,
    })),
    tasks: taskRows.map((t) => ({ ...t, doneOn: t.doneOn?.slice(0, 10) ?? null })),
  };
}

/** Кому писать о событии: сотрудник, его Telegram, владелец или главный бухгалтер, его настройки. */
export interface NotifyTarget {
  employeeId: string;
  userId: string;
  shortName: string;
  boss: boolean;
  chatId: number | null;
  settings: NotifySettings;
}

/**
 * Получатель сообщения о событии в организации из контекста; null — сотрудника нет или он неактивен
 * (заблокирован). Telegram может быть не привязан (`chatId` null).
 */
export async function notifyTarget(tx: Tx, employeeId: string): Promise<NotifyTarget | null> {
  const [row] = await tx
    .select({
      userId: employees.userId,
      shortName: employees.shortName,
      isOwner: roles.isOwner,
      templateCode: roles.templateCode,
      chatId: telegramLinks.chatId,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .leftJoin(telegramLinks, eq(telegramLinks.userId, employees.userId))
    .where(and(eq(employees.id, employeeId), eq(employees.active, true), eq(users.blocked, false)));
  if (!row) return null;
  const { mode, off } = await getNotifySettings(tx, row.userId);
  const settings: NotifySettings = { mode, off };
  return {
    employeeId,
    userId: row.userId,
    shortName: row.shortName,
    boss: row.isOwner || row.templateCode === 'chief',
    chatId: row.chatId,
    settings,
  };
}

/** Включены ли «Напоминания в Telegram» у организации из контекста. */
export async function telegramFeatureOn(tx: Tx): Promise<boolean> {
  const [row] = await tx.select({ features: orgSettings.features }).from(orgSettings);
  return row?.features.telegram === true;
}

/** Название организации из контекста (RLS показывает только её). */
export async function contextOrgName(tx: Tx): Promise<string | null> {
  const [row] = await tx.select({ name: organizations.name }).from(organizations).limit(1);
  return row?.name ?? null;
}

/** Краткое имя сотрудника организации из контекста — «кто сделал» в сообщении о событии. */
export async function employeeShortName(tx: Tx, employeeId: string): Promise<string> {
  const [row] = await tx
    .select({ shortName: employees.shortName })
    .from(employees)
    .where(eq(employees.id, employeeId));
  return row?.shortName ?? '';
}

/** Что нужно для строки отчёта в сообщении: вид, период, контрагент и ответственный. */
export async function reportMessageFacts(
  tx: Tx,
  reportId: string,
): Promise<{
  typeShort: string;
  period: ReportPeriod;
  periodStart: IsoDate;
  contractorName: string;
  responsibleId: string | null;
} | null> {
  const [row] = await tx
    .select({
      typeShort: reportTypes.shortName,
      period: reports.period,
      periodStart: reports.periodStart,
      contractorName: contractors.name,
      responsibleId: reports.responsibleEmployeeId,
    })
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .where(eq(reports.id, reportId));
  return row ?? null;
}
