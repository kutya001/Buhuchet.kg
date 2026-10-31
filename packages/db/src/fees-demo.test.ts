import { UI_TEXTS } from '@buhuchet/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { contractorSummary } from './contractors';
import { contractorFeeView } from './fees';
import { contractors, feeAllocations, feePayments } from './schema';
import { DEMO_ORG_ID, demoId, seedAll } from './seed';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

// Плата за обслуживание демо-организации (задача 2.21): оплаты `feePayments` из demoDB.json; долги — как
// `feeDebt` контрагентов прототипа на день выгрузки (25.10.2026).
describe.skipIf(!databaseAvailable())('Плата за обслуживание демо-организации', () => {
  let db: TestDatabase;
  const DAY = '2026-10-25';
  const inDemo = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: DEMO_ORG_ID, userId: demoId('user', 'e1') }, fn);

  const count = async () => ({
    payments: (
      await db.admin.db.select().from(feePayments).where(eq(feePayments.orgId, DEMO_ORG_ID))
    ).length,
    allocations: (
      await db.admin.db.select().from(feeAllocations).where(eq(feeAllocations.orgId, DEMO_ORG_ID))
    ).length,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('оплаты по месяцам на счёт организации, «Платит одной суммой»; повтор не дублирует', async () => {
    expect(await count()).toEqual({ payments: 443, allocations: 443 });
    const [first] = await db.admin.db
      .select()
      .from(feePayments)
      .where(eq(feePayments.id, demoId('fee_payment', 'f1')));
    expect(first).toMatchObject({
      contractorId: demoId('contractor', '1'),
      amount: 2_800_000,
      paidOn: '2026-01-09',
      toKind: 'org',
      toLabel: 'Счёт организации',
      operationId: null,
    });
    const one = await db.admin.db
      .select({ id: contractors.id })
      .from(contractors)
      .where(and(eq(contractors.orgId, DEMO_ORG_ID), eq(contractors.oneSum, true)));
    expect(one.map((c) => c.id).sort()).toEqual(
      ['4', '23'].map((id) => demoId('contractor', id)).sort(),
    );

    await seedAll(db.admin.db, { update: true, demo: true });
    expect(await count()).toEqual({ payments: 443, allocations: 443 });
  });

  it('«Должники» на день выгрузки — как в прототипе: 4 контрагента, 151 000 сом', async () => {
    const summary = await inDemo((tx) =>
      contractorSummary(tx, {
        t: (key) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key,
        today: DAY,
        fee: true,
        scope: undefined,
      }),
    );
    expect(summary.debtors).toEqual({ count: 4, sum: 15_100_000 });
    const view = await inDemo((tx) =>
      contractorFeeView(tx, demoId('contractor', '5'), { today: DAY, scope: undefined }),
    );
    expect(view?.fees.debt).toBe(2_800_000);
  });
});
