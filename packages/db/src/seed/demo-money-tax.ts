import { MONEY_OP_KINDS } from '@buhuchet/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { moneyAllocations, moneyOperations, reports } from '../schema';
import type { DemoIdOf } from './demo';

/*
 * Деньги по отчётам демо-организации (задача 2.19): поступления с детализацией, оплаты налогов и
 * списания в бонус (`moneyOps` в demoDB.json), «Оплачено в бюджет» отчётов — сумма их оплат. Суммы в
 * прототипе — в сомах, в базе — в тыйынах. Повторный запуск досоздаёт только недостающие операции,
 * «Оплачено» пересчитывается по операциям.
 */

const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
/** «2026-08-22 14:29» — момент по Бишкеку, как `_ca` записей прототипа. */
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);
const tyiyn = (som: number) => Math.round(som * 100);

const DemoOperation = z.object({
  id: z.number().int(),
  cp: z.number().int(),
  kind: z.enum(MONEY_OP_KINDS),
  /** Сумма на налоги в сомах; у поступления `total` — вся сумма. */
  amount: z.number().positive(),
  total: z.number().positive().optional(),
  date: z.iso.date(),
  by: z.string(),
  /** Чей счёт: 'org', код сотрудника; у контрагента без ответственного — пусто. */
  holder: z.string().nullable().default(null),
  report: z.number().int().optional(),
  alloc: z.array(z.object({ r: z.number().int(), a: z.number().positive() })).default([]),
  self: z.boolean().default(false),
  note: z.string().default(''),
  _ca: Stamp,
});

const DemoMoneyTaxFile = z.object({
  moneyOps: z.array(DemoOperation).default([]),
  reports: z.array(z.object({ id: z.number().int() })),
});

export async function seedDemoMoneyTax(
  db: Db,
  file: unknown,
  { orgId, demoId }: { orgId: string; demoId: DemoIdOf },
): Promise<void> {
  const demo = DemoMoneyTaxFile.parse(file);
  const reportId = (id: number) => demoId('report', String(id));
  const holderOf = (o: z.infer<typeof DemoOperation>) => {
    if (o.self) return { holderKind: 'client' as const, holderEmployeeId: null };
    // У контрагента без ответственного деньги прототипа ни на чьём кошельке — в базе на счёте организации.
    if (!o.holder || o.holder === 'org')
      return { holderKind: 'org' as const, holderEmployeeId: null };
    return { holderKind: 'employee' as const, holderEmployeeId: demoId('employee', o.holder) };
  };
  const ops = demo.moneyOps.map((o) => ({
    id: demoId('money_operation', String(o.id)),
    orgId,
    contractorId: demoId('contractor', String(o.cp)),
    kind: o.kind,
    amount: tyiyn(o.amount),
    total: o.kind === 'in' ? tyiyn(o.total ?? o.amount) : null,
    opDate: o.date,
    ...holderOf(o),
    reportId: o.kind === 'pay' || o.kind === 'back' ? reportId(o.report!) : null,
    self: o.self,
    // Основание поступления и оплаты экран собирает по отчётам; комментарий — только у остальных.
    note: o.kind === 'in' || o.kind === 'pay' ? '' : o.note,
    createdBy: demoId('user', o.by),
    updatedBy: demoId('user', o.by),
    createdAt: stampOf(o._ca),
    updatedAt: stampOf(o._ca),
  }));
  if (!ops.length) return;
  const inserted = new Set<string>();
  for (let i = 0; i < ops.length; i += 500) {
    for (const { id } of await db
      .insert(moneyOperations)
      .values(ops.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({ id: moneyOperations.id })) {
      inserted.add(id);
    }
  }
  const allocations = demo.moneyOps
    .filter((o) => inserted.has(demoId('money_operation', String(o.id))))
    .flatMap((o) =>
      o.alloc.map((x) => ({
        orgId,
        operationId: demoId('money_operation', String(o.id)),
        reportId: reportId(x.r),
        amount: tyiyn(x.a),
      })),
    );
  if (allocations.length)
    await db.insert(moneyAllocations).values(allocations).onConflictDoNothing();

  // «Оплачено в бюджет» — сумма действующих оплат отчёта (как после окна «Оплата налога»).
  const ids = demo.reports.map((r) => reportId(r.id));
  for (let i = 0; i < ids.length; i += 500) {
    await db
      .update(reports)
      .set({
        paid: sql`coalesce((select sum(${moneyOperations.amount}) from ${moneyOperations} where ${moneyOperations.reportId} = ${reports.id} and ${moneyOperations.kind} = 'pay' and ${moneyOperations.cancelledAt} is null), 0)`,
      })
      .where(and(eq(reports.orgId, orgId), inArray(reports.id, ids.slice(i, i + 500))));
  }
}
