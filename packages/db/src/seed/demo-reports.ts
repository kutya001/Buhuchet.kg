import { REPORT_PERIODS, type ReportStatus } from '@buhuchet/domain';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { assignments, reports, reportTypes, statusHistory } from '../schema';
import type { DemoIdOf } from './demo';

const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
/** «2026-08-22 14:29» — момент по Бишкеку, как `_ca`, `subAt` и `confAt` записей прототипа. */
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/** Назначение контрагента в demoDB.json (`contractors[].assign`, прототип a). */
const DemoAssignment = z.object({
  t: z.string(),
  from: z.iso.date(),
  /** Дата, с которой назначение снято (прототип unassignDlg). */
  to: z.iso.date().nullable().default(null),
  /** «До какого периода» — «2026-12». */
  until: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable()
    .default(null),
  resp: z.string().nullable().default(null),
  rate: z.string().nullable().default(null),
  en: z.array(z.object({ code: z.string(), v: z.number().int().optional() })).default([]),
  add: z.array(z.string()).default([]),
  dueDay: z.number().int().nullable().default(null),
  per: z.enum(REPORT_PERIODS).optional(),
  day: z.number().int().optional(),
  mo: z.number().int().optional(),
  /** Повторяющаяся сумма в сомах. */
  fixed: z.number().nonnegative().nullable().default(null),
  note: z.string().default(''),
});

const STATUS: Record<string, ReportStatus> = {
  'К сдаче': 'todo',
  'В работе': 'in_progress',
  Сдан: 'submitted',
  'Требует исправления': 'needs_fix',
  'Не требуется': 'not_required',
};

/** Отчёт в demoDB.json (`reports`): поля задачи 2.06 — сроки, статус, сдача, подтверждение, сумма. */
const DemoReport = z.object({
  id: z.number().int(),
  cp: z.number().int(),
  t: z.string(),
  pkey: z.iso.date(),
  ev: z.iso.date().optional(),
  ver: z.number().int().nonnegative(),
  superseded: z.boolean(),
  dueBase: z.iso.date(),
  due: z.iso.date(),
  payDue: z.iso.date().nullable().default(null),
  status: z.string().refine((s) => s in STATUS),
  subDate: z.iso.date().nullable().default(null),
  subBy: z.string().optional(),
  subAt: Stamp.optional(),
  confBy: z.string().optional(),
  confAt: Stamp.optional(),
  confNote: z.string().default(''),
  /** Сумма к уплате в сомах. */
  sum: z.number().nonnegative().nullable(),
  auto: z.boolean().default(false),
  resp: z.string().nullable(),
  fixWhy: z.string().optional(),
  _ca: Stamp,
  _ub: z.string().nullable(),
  _ua: Stamp,
});

const DemoFile = z.object({
  contractors: z.array(
    z.object({ id: z.number().int(), assign: z.array(DemoAssignment).default([]) }),
  ),
  reports: z.array(DemoReport).default([]),
});

/**
 * Назначения и отчёты демо-организации (задача 2.06): ставки, строки ЕНС, периодичность в назначении,
 * повторяющиеся суммы; у отчётов — сроки, статус, сдача и подтверждение, сумма к уплате, первая запись
 * «Истории статусов» и переход в нынешний статус. Повторный запуск досоздаёт только недостающее.
 * Строки суммы, оплата и файлы добавят задачи 2.14, 2.19 и поток Г.
 */
export async function seedDemoReports(
  db: Db,
  file: unknown,
  ids: { orgId: string; demoId: DemoIdOf; employees: readonly string[] },
): Promise<number> {
  const demo = DemoFile.parse(file);
  const { orgId, demoId } = ids;
  const user = (protoId: string | null | undefined) =>
    protoId && ids.employees.includes(protoId) ? demoId('user', protoId) : null;
  const employee = (protoId: string | null) =>
    protoId && ids.employees.includes(protoId) ? demoId('employee', protoId) : null;
  const assignmentId = (cp: number, type: string) => demoId('assignment', `${cp}:${type}`);

  const assignmentRows = demo.contractors.flatMap((c) =>
    c.assign.map((a) => ({
      id: assignmentId(c.id, a.t),
      orgId,
      contractorId: demoId('contractor', String(c.id)),
      reportTypeCode: a.t,
      fromMonth: `${a.from.slice(0, 7)}-01`,
      untilMonth: a.until ? `${a.until}-01` : null,
      endedOn: a.to,
      responsibleEmployeeId: employee(a.resp),
      rate: a.en.length ? null : a.rate,
      enRates: a.en.map((e) => ({ code: e.code, variant: e.v ?? null })),
      rateAdditions: a.add,
      dueDay: a.dueDay,
      ownPeriod: a.per ?? null,
      ownDay: a.per ? (a.day ?? null) : null,
      ownMonth: a.per ? (a.mo ?? null) : null,
      fixedAmount: a.fixed === null ? null : Math.round(a.fixed * 100),
      note: a.note,
    })),
  );
  if (assignmentRows.length) {
    await db.insert(assignments).values(assignmentRows).onConflictDoNothing();
  }
  if (demo.reports.length === 0) return 0;

  const codes = [...new Set(demo.reports.map((r) => r.t))];
  const types = new Map(
    (
      await db
        .select({ code: reportTypes.code, period: reportTypes.period, act: reportTypes.act })
        .from(reportTypes)
        .where(inArray(reportTypes.code, codes))
    ).map((t) => [t.code, t]),
  );
  const own = new Map(assignmentRows.map((a) => [a.id, a.ownPeriod]));
  const rows = demo.reports.map((r) => {
    const type = types.get(r.t);
    if (!type) throw new Error(`demoDB.json: нет вида отчёта «${r.t}»`);
    const aId = assignmentId(r.cp, r.t);
    const status = STATUS[r.status]!;
    const submitted = status === 'submitted' || status === 'needs_fix';
    return {
      id: demoId('report', String(r.id)),
      orgId,
      contractorId: demoId('contractor', String(r.cp)),
      reportTypeCode: r.t,
      assignmentId: own.has(aId) ? aId : null,
      period: own.get(aId) ?? type.period,
      periodStart: r.pkey,
      eventDate: r.ev ?? null,
      act: type.act,
      revision: r.ver,
      superseded: r.superseded,
      dueBase: r.dueBase,
      dueDate: r.due,
      payDue: type.act === 'sub' ? null : r.payDue,
      status,
      submittedOn: submitted ? r.subDate : null,
      submittedAt: submitted && r.subAt ? stampOf(r.subAt) : null,
      submittedBy: submitted ? user(r.subBy) : null,
      confirmedAt: status === 'submitted' && r.confAt ? stampOf(r.confAt) : null,
      confirmedBy: status === 'submitted' ? user(r.confBy) : null,
      confirmNote: r.confNote,
      amount: r.sum === null ? null : Math.round(r.sum * 100),
      amountAuto: r.auto,
      responsibleEmployeeId: employee(r.resp),
      createdBy: null,
      updatedBy: user(r._ub),
      createdAt: stampOf(r._ca),
      updatedAt: stampOf(r._ua),
      r,
    };
  });
  const inserted = new Set<string>();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(({ r: _r, ...row }) => row);
    for (const { id } of await db
      .insert(reports)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: reports.id })) {
      inserted.add(id);
    }
  }

  // «История статусов» — только у новых: создан в «К сдаче», затем переход в нынешний статус.
  const history = rows
    .filter((x) => inserted.has(x.id))
    .flatMap((x) => [
      {
        orgId,
        scale: 'report' as const,
        entityId: x.id,
        fromStatus: null,
        toStatus: 'todo',
        actorUserId: null,
        at: x.createdAt,
      },
      ...(x.status === 'todo'
        ? []
        : [
            {
              orgId,
              scale: 'report' as const,
              entityId: x.id,
              fromStatus: 'todo',
              toStatus: x.status,
              reason: x.status === 'needs_fix' ? (x.r.fixWhy ?? null) : null,
              actorUserId: x.status === 'submitted' ? (x.submittedBy ?? x.updatedBy) : x.updatedBy,
              at: x.status === 'submitted' && x.submittedAt ? x.submittedAt : x.updatedAt,
            },
          ]),
    ]);
  for (let i = 0; i < history.length; i += 500) {
    await db.insert(statusHistory).values(history.slice(i, i + 500));
  }
  return inserted.size;
}
