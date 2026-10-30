import {
  auditActorName,
  periodLabel,
  type HistoryChange,
  type ReportPeriod,
  type Translate,
} from '@buhuchet/domain';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import {
  assignments,
  auditLog,
  contractors,
  employees,
  ownershipForms,
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
const EMPLOYEE_FIELDS = new Set(['responsibleEmployeeId', 'executorEmployeeId']);
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

/** Подписи записей отчётов, назначений и задач: вид и период, название вида, название задачи. */
async function subjectsOf(
  tx: Tx,
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
  const [reportRows, assignmentRows, taskRows] = await Promise.all([
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
      ? tx.select({ id: tasks.id, name: tasks.title }).from(tasks).where(inArray(tasks.id, taskIds))
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
  return out;
}

/** История контрагента в области `scope`; null — нет такого или он вне области. */
export async function contractorHistory(
  tx: Tx,
  id: string,
  o: { scope: SQL | undefined; t: Translate; limit?: number },
): Promise<ContractorHistory | null> {
  if (!UUID_RE.test(id)) return null;
  const [found] = await tx
    .select({ id: contractors.id })
    .from(contractors)
    .where(and(eq(contractors.id, id), o.scope));
  if (!found) return null;
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
    .where(eq(auditLog.contractorId, id))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(o.limit ?? 200);
  const [names, subjects] = await Promise.all([
    namesOf(tx, referencesOf(rows)),
    subjectsOf(tx, rows, o.t),
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
