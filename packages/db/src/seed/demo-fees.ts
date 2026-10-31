import { defaultUiTexts } from '@buhuchet/domain';
import { z } from 'zod';
import type { Db } from '../client';
import { feeAllocations, feePayments } from '../schema';
import type { DemoIdOf } from './demo';

/*
 * Плата за обслуживание демо-организации (задача 2.21): оплаты `feePayments` из demoDB.json — у
 * каждой месяц и сумма, деньги на счёте организации. Каждая оплата закрывает свой месяц (строка
 * распределения), начисления считаются по журналу тарифов контрагента. Суммы в прототипе — в сомах, в
 * базе — в тыйынах. Повторный запуск досоздаёт только недостающие оплаты.
 */

const tyiyn = (som: number) => Math.round(som * 100);

const DemoFeePayment = z.object({
  id: z.string(),
  cp: z.number().int(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().positive(),
  date: z.iso.date(),
  by: z.string(),
  holder: z.enum(['org', 'owner']).default('org'),
  note: z.string().default(''),
});

const DemoFeesFile = z.object({ feePayments: z.array(DemoFeePayment).default([]) });

export async function seedDemoFees(
  db: Db,
  file: unknown,
  { orgId, demoId }: { orgId: string; demoId: DemoIdOf },
): Promise<void> {
  const demo = DemoFeesFile.parse(file);
  if (!demo.feePayments.length) return;
  const texts = defaultUiTexts();
  const label = { org: texts['fee.to.org'] ?? '', owner: texts['fee.to.owner'] ?? '' };
  const rows = demo.feePayments.map((f) => ({
    id: demoId('fee_payment', f.id),
    orgId,
    contractorId: demoId('contractor', String(f.cp)),
    amount: tyiyn(f.amount),
    paidOn: f.date,
    toKind: f.holder,
    toLabel: label[f.holder],
    note: f.note,
    createdBy: demoId('user', f.by),
    updatedBy: demoId('user', f.by),
    createdAt: new Date(`${f.date}T12:00:00+06:00`),
    updatedAt: new Date(`${f.date}T12:00:00+06:00`),
  }));
  const inserted = new Set<string>();
  for (let i = 0; i < rows.length; i += 500) {
    for (const { id } of await db
      .insert(feePayments)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({ id: feePayments.id })) {
      inserted.add(id);
    }
  }
  const allocations = demo.feePayments
    .filter((f) => inserted.has(demoId('fee_payment', f.id)))
    .map((f) => ({
      orgId,
      paymentId: demoId('fee_payment', f.id),
      month: `${f.month}-01`,
      amount: tyiyn(f.amount),
    }));
  for (let i = 0; i < allocations.length; i += 500) {
    await db
      .insert(feeAllocations)
      .values(allocations.slice(i, i + 500))
      .onConflictDoNothing();
  }
}
