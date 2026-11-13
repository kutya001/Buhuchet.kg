import {
  auditActorName,
  periodLabel,
  type HistoryChange,
  type ReportPeriod,
  type Translate,
} from '@buhuchet/domain';
import { and, desc, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import {
  assignments,
  auditLog,
  contractors,
  employees,
  moneyOperations,
  ownershipForms,
  projectPayments,
  projects,
  reports,
  reportTypes,
  tasks,
  taxBenefits,
  taxOffices,
  taxRegimes,
} from './schema';

/**
 * История контрагента для вкладки «История» карточки (ТЗ «История изменений»; прототип
 * contractor-card.js, вкладка «hist»: записи HIST контрагента, у записи отчёта — «НДС 09.2026 · »):
 * записи `audit_log` с `contractor_id` — сам контрагент, его назначения, отчёты, задачи и страница, —
 * от новых к старым, не больше `limit`. Сотрудники и справочные коды в «было → стало» — названиями из
 * `names`, у записи отчёта, назначения и задачи — `subject`.
 */

export interface ContractorHistoryRow {
  id: number;
  at: Date;
  actor: string | null;
  entity: string;
  action: string;
  reason: string | null;
  changes: HistoryChange[];
  /** «НДС 09.2026» у отчёта, название вида у назначения, название задачи; иначе null. */
  subject: string | null;
}

export interface ContractorHistory {
  items: ContractorHistoryRow[];
  /** Номер сотрудника или код справочника → название. */
  names: Record<string, string>;
}

const actor = alias(employees, 'cp_hist_actor');

/** Поля, значения которых — сотрудник. */
// `executor` — исполнитель работы проекта («Добавлена работа: … (исполнитель)», задача 2.26).
const EMPLOYEE_FIELDS = new Set(['responsibleEmployeeId', 'executorEmployeeId', 'executor']);
/** Поля со справочным кодом: форма собственности, режимы, УГНС, льготы. */
const CODE_FIELDS = new Set(['formCode', 'regimeCode', 'regime2Code', 'taxOfficeCode', 'benefits']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Номера и коды из изменений, которым нужны названия. */
function referencesOf(rows: readonly { changes: HistoryChange[] }[]) {
  const ids = new Set<string>();
  const codes = new Set<string>();
  const add = (set: Set<string>, v: unknown) => {
    if (typeof v === 'string' && v) set.add(v);
    if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === 'string') set.add(x);
        else if (x && typeof x === 'object' && 'code' in x && typeof x.code === 'string')
          set.add(x.code);
      }
    }
  };
  for (const r of rows) {
    for (const c of r.changes) {
      if (EMPLOYEE_FIELDS.has(c.field)) {
        add(ids, c.from);
        add(ids, c.to);
      }
      if (c.field === 'gkedConfirmation' && c.to && typeof c.to === 'object') {
        add(ids, (c.to as { employeeId?: unknown }).employeeId);
      }
      if (CODE_FIELDS.has(c.field)) {
        add(codes, c.from);
        add(codes, c.to);
      }
    }
  }
  return { ids: [...ids].filter((id) => UUID_RE.test(id)), codes: [...codes] };
}

/** Названия сотрудников и справочных кодов для «было → стало». */
async function namesOf(
  tx: Tx,
  refs: { ids: string[]; codes: string[] },
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (refs.ids.length) {
    const rows = await tx
      .select({ id: employees.id, name: employees.shortName })
      .from(employees)
      .where(inArray(employees.id, refs.ids));
    for (const r of rows) out[r.id] = r.name;
  }
  if (refs.codes.length) {
    const named = (table: typeof ownershipForms | typeof taxRegimes | typeof taxBenefits) =>
      tx
        .select({ code: table.code, name: table.name })
        .from(table)
        .where(inArray(table.code, refs.codes));
    const [forms, regimes, benefits, offices] = await Promise.all([
      named(ownershipForms),
      named(taxRegimes),
      named(taxBenefits),
      tx
        .select({ code: taxOffices.code, name: taxOffices.shortName })
        .from(taxOffices)
        .where(inArray(taxOffices.code, refs.codes)),
    ]);
    for (const r of [...forms, ...regimes, ...benefits, ...offices]) out[r.code] = r.name;
  }
  return out;
}

/**
 * Подписи записей отчётов, назначений, задач и проектов: вид и период, название вида, название. Название
 * задачи — только пока она у этого контрагента: перенесённую к другому или общую не подписываем.
 */
async function subjectsOf(
  tx: Tx,
  contractorId: string,
  rows: readonly { entity: string; entityId: string }[],
  t: Translate,
): Promise<Map<string, string>> {
  const idsOf = (entity: string) => [
    ...new Set(
      rows.filter((r) => r.entity === entity && UUID_RE.test(r.entityId)).map((r) => r.entityId),
    ),
  ];
  const out = new Map<string, string>();
  const reportIds = idsOf('report');
  const assignmentIds = idsOf('assignment');
  const taskIds = idsOf('task');
  const projectIds = idsOf('project');
  const paymentIds = idsOf('project_payment');
  const [reportRows, assignmentRows, taskRows, projectRows, paymentRows] = await Promise.all([
    reportIds.length
      ? tx
          .select({
            id: reports.id,
            short: reportTypes.shortName,
            period: reports.period,
            start: reports.periodStart,
            event: reports.eventDate,
          })
          .from(reports)
          .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
          .where(inArray(reports.id, reportIds))
      : [],
    assignmentIds.length
      ? tx
          .select({ id: assignments.id, name: reportTypes.shortName })
          .from(assignments)
          .innerJoin(reportTypes, eq(reportTypes.code, assignments.reportTypeCode))
          .where(inArray(assignments.id, assignmentIds))
      : [],
    taskIds.length
      ? tx
          .select({ id: tasks.id, name: tasks.title })
          .from(tasks)
          .where(and(inArray(tasks.id, taskIds), eq(tasks.contractorId, contractorId)))
      : [],
    projectIds.length
      ? tx
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(and(inArray(projects.id, projectIds), eq(projects.contractorId, contractorId)))
      : [],
    // Транш — название своего проекта (прототип: запись проекта «Оплата …»).
    paymentIds.length
      ? tx
          .select({ id: projectPayments.id, name: projects.name })
          .from(projectPayments)
          .innerJoin(projects, eq(projects.id, projectPayments.projectId))
          .where(
            and(inArray(projectPayments.id, paymentIds), eq(projects.contractorId, contractorId)),
          )
      : [],
  ]);
  for (const r of reportRows) {
    const label = periodLabel(
      { period: r.period as ReportPeriod, start: r.start, event: r.event },
      t,
    );
    out.set(`report:${r.id}`, `${r.short} ${label}`);
  }
  for (const r of assignmentRows) out.set(`assignment:${r.id}`, r.name);
  for (const r of taskRows) out.set(`task:${r.id}`, r.name);
  for (const r of projectRows) out.set(`project:${r.id}`, r.name);
  for (const r of paymentRows) out.set(`project_payment:${r.id}`, r.name);
  return out;
}

/**
 * Что из истории контрагента видно сотруднику — как вкладки карточки по правам, функциям и областям.
 * Область — условие над контрагентом (`contractorScope`) или, у отчётов, над отчётом и контрагентом
 * (`reportScope`); undefined — все; false — модуль не виден.
 */
export interface ContractorHistoryAccess {
  /** «Видеть плату за обслуживание» с включённой функцией: иначе поля платы убираются из записей. */
  fee: boolean;
  /** Отчёты и назначения («Просматривать отчёты»). */
  reports: SQL | undefined | false;
  /** Задачи (функция «Задачи»). */
  tasks: boolean;
  /** Показатели (функция «Показатели контрагентов» и право их смотреть). */
  kpi: SQL | undefined | false;
  /** Файлы (функция «Файлы в карточках» и право их смотреть): записи прикрепления и удаления. */
  files: SQL | undefined | false;
  /** Деньги по отчётам: поступления (функция «Учёт оплаты налогов», право и область «Финансовых операций»). */
  money: SQL | undefined | false;
  /**
   * Разовые услуги и их оплаты (задача 2.22): «Финансовые операции» включены, видна вкладка «Проекты и
   * услуги», контрагент в области, где сотрудник видит услуги.
   */
  services: SQL | undefined | false;
  /**
   * Проекты контрагента (задача 2.26): функция «Проекты контрагентов» включена, право «Просматривать
   * проекты»; условие — какие проекты видны (`projectVisibility`, как вкладка «Проекты» карточки).
   */
  projects: SQL | undefined | false;
  /** Деньги проектов видны (`projectMoneyVisible`): иначе «было → стало» стоимости проекта убирается. */
  projectMoney?: boolean;
  /**
   * Бонусы сотрудникам в записях разовых услуг — тому, кто видит все бонусы услуги (право «Списывать
   * остаток в бонус» или «Сотрудники и роли»); иначе строки бонусов убираются (docs/deviations.md п. О-75).
   */
  serviceBonuses?: boolean;
}

/**
 * Поля платы за обслуживание: без права их «было → стало» не отдаются (ТЗ: «скрыты везде») — ставка,
 * день оплаты, первый месяц, новая ставка журнала, напоминание о долге, часть за обслуживание в
 * поступлении (задача 2.21). «Платит одной суммой» — отметка без суммы, видна всем, как в прототипе.
 */
const FEE_FIELDS: ReadonlySet<string> = new Set([
  'tariff',
  'feeDay',
  'firstMonthMode',
  'tariffAdded',
  'tariffEdited',
  'tariffDeleted',
  'feeReminder',
  'feeTotal',
  'feeAllocations',
]);
const KPI_ENTITIES = ['indicator', 'indicator_value'] as const;
const FILE_ACTIONS = ['file_attach', 'file_delete', 'file_edit', 'file_hide', 'file_show'] as const;

/**
 * Какие записи истории видны: сам контрагент и его страница — всем, кто видит карточку; остальное —
 * по модулю. Сущность, которой здесь нет, не видна, пока её модуль не добавит сюда своё правило.
 */
async function visibleEntries(
  tx: Tx,
  id: string,
  access: ContractorHistoryAccess,
): Promise<SQL | undefined> {
  const inScope = async (scope: SQL | undefined | false) => {
    if (scope === false) return false;
    if (!scope) return true;
    const [row] = await tx
      .select({ id: contractors.id })
      .from(contractors)
      .where(and(eq(contractors.id, id), scope));
    return !!row;
  };
  const [kpi, files, money, services] = await Promise.all([
    inScope(access.kpi),
    inScope(access.files),
    inScope(access.money),
    inScope(access.services),
  ]);
  const own: SQL[] = [inArray(auditLog.entity, ['contractor', 'contractor_page'])];
  if (access.reports !== false) {
    own.push(eq(auditLog.entity, 'assignment'));
    // Отчёт — в области отчётов: «Свои» — отчёты своего контрагента или где ответственный он сам.
    own.push(
      access.reports
        ? and(
            eq(auditLog.entity, 'report'),
            inArray(
              auditLog.entityId,
              tx
                .select({ id: sql<string>`${reports.id}::text` })
                .from(reports)
                .innerJoin(contractors, eq(contractors.id, reports.contractorId))
                .where(and(eq(reports.contractorId, id), access.reports)),
            ),
          )!
        : eq(auditLog.entity, 'report'),
    );
  }
  if (access.tasks) own.push(eq(auditLog.entity, 'task'));
  if (kpi) own.push(inArray(auditLog.entity, [...KPI_ENTITIES]));
  if (files) own.push(eq(auditLog.entity, 'file'));
  // ОТКЛОНЕНИЕ: docs/deviations.md#В-19
  // Поступление только за обслуживание (часть на налоги 0) — только тому, кто видит плату.
  if (money) {
    own.push(
      access.fee
        ? eq(auditLog.entity, 'money_operation')
        : and(
            eq(auditLog.entity, 'money_operation'),
            notInArray(
              auditLog.entityId,
              tx
                .select({ id: sql<string>`${moneyOperations.id}::text` })
                .from(moneyOperations)
                .where(
                  and(
                    eq(moneyOperations.contractorId, id),
                    eq(moneyOperations.kind, 'in'),
                    eq(moneyOperations.amount, 0),
                  ),
                ),
            ),
          )!,
    );
  }
  // Оплаты за обслуживание — с правом «Видеть плату» и включённой функцией (как вкладка «Обслуживание»).
  if (access.fee) own.push(eq(auditLog.entity, 'fee_payment'));
  if (services) own.push(inArray(auditLog.entity, ['one_off_service', 'one_off_service_payment']));
  // Проекты — те, что сотрудник видит (`projectVisibility`: условие над проектом и его контрагентом).
  if (access.projects !== false) {
    own.push(
      access.projects
        ? and(
            eq(auditLog.entity, 'project'),
            inArray(
              auditLog.entityId,
              tx
                .select({ id: sql<string>`${projects.id}::text` })
                .from(projects)
                .innerJoin(contractors, eq(contractors.id, projects.contractorId))
                .where(and(eq(projects.contractorId, id), access.projects)),
            ),
          )!
        : eq(auditLog.entity, 'project'),
    );
    // Транши — тех же проектов и только тому, кто видит деньги проектов.
    if (access.projectMoney)
      own.push(
        and(
          eq(auditLog.entity, 'project_payment'),
          inArray(
            auditLog.entityId,
            tx
              .select({ id: sql<string>`${projectPayments.id}::text` })
              .from(projectPayments)
              .innerJoin(projects, eq(projects.id, projectPayments.projectId))
              .innerJoin(contractors, eq(contractors.id, projects.contractorId))
              .where(and(eq(projects.contractorId, id), access.projects || undefined)),
          ),
        )!,
      );
  }
  return and(or(...own), files ? undefined : notInArray(auditLog.action, [...FILE_ACTIONS]));
}

/** Запись без полей `fields`; запись только о них — null целиком, с причиной (в ней может быть сумма). */
function withoutFields<T extends { changes: HistoryChange[] }>(
  r: T,
  fields: ReadonlySet<string>,
): T | null {
  const changes = r.changes.filter((c) => !fields.has(c.field));
  if (changes.length === r.changes.length) return r;
  return changes.length ? { ...r, changes } : null;
}

/** Деньги проекта в его истории: планируемая стоимость (транши — часть 2 задачи 2.26). */
const PROJECT_MONEY_FIELDS: ReadonlySet<string> = new Set(['plan']);

/** Бонусы сотрудникам в истории разовой услуги (прототип v84). */
const SERVICE_BONUS_FIELDS: ReadonlySet<string> = new Set(['bonuses']);

/**
 * Записи, которые видит сотрудник: без полей платы без права «Видеть плату», без стоимости проекта —
 * тому, кто не видит деньги проектов.
 */
function visibleChanges<T extends { entity: string; changes: HistoryChange[] }>(
  r: T,
  access: ContractorHistoryAccess,
): T | null {
  const fee = access.fee ? r : withoutFields(r, FEE_FIELDS);
  if (!fee) return fee;
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-75
  // «Услуга создана» остаётся без строки бонусов; отдельная запись «Бонусы сотрудникам» убирается целиком.
  if (fee.entity === 'one_off_service' && !access.serviceBonuses)
    return withoutFields(fee, SERVICE_BONUS_FIELDS);
  if (fee.entity !== 'project' || access.projectMoney) return fee;
  return withoutFields(fee, PROJECT_MONEY_FIELDS);
}

/** История контрагента в области `scope`; null — нет такого или он вне области. */
export async function contractorHistory(
  tx: Tx,
  id: string,
  o: { scope: SQL | undefined; access: ContractorHistoryAccess; t: Translate; limit?: number },
): Promise<ContractorHistory | null> {
  if (!UUID_RE.test(id)) return null;
  const [found] = await tx
    .select({ id: contractors.id })
    .from(contractors)
    .where(and(eq(contractors.id, id), o.scope));
  if (!found) return null;
  const visible = await visibleEntries(tx, id, o.access);
  const rows = await tx
    .select({
      id: auditLog.id,
      at: auditLog.at,
      actorUserId: auditLog.actorUserId,
      actorName: actor.shortName,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      action: auditLog.action,
      reason: auditLog.reason,
      changes: auditLog.changes,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.userId, auditLog.actorUserId))
    .where(and(eq(auditLog.contractorId, id), visible))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(o.limit ?? 200)
    .then((list) => list.flatMap((r) => visibleChanges(r, o.access) ?? []));
  const [names, subjects] = await Promise.all([
    namesOf(tx, referencesOf(rows)),
    subjectsOf(tx, id, rows, o.t),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: auditActorName(r.actorUserId, r.actorName),
      entity: r.entity,
      action: r.action,
      reason: r.reason,
      changes: r.changes,
      subject: subjects.get(`${r.entity}:${r.entityId}`) ?? null,
    })),
    names,
  };
}
