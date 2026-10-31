import { and, eq, gt } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractors, moneyAllocations, moneyOperations, reports } from './schema';
import { DEMO_ORG_ID, demoId, seedAll } from './seed';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

describe.skipIf(!databaseAvailable())('Деньги по отчётам демо-организации из demoDB.json', () => {
  let db: TestDatabase;

  const count = async () => ({
    ops: (
      await db.admin.db.select().from(moneyOperations).where(eq(moneyOperations.orgId, DEMO_ORG_ID))
    ).length,
    allocations: (
      await db.admin.db
        .select()
        .from(moneyAllocations)
        .where(eq(moneyAllocations.orgId, DEMO_ORG_ID))
    ).length,
    paidReports: (
      await db.admin.db
        .select()
        .from(reports)
        .where(and(eq(reports.orgId, DEMO_ORG_ID), gt(reports.paid, 0)))
    ).length,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('поступления с детализацией, оплаты и «Оплачено в бюджет» отчётов; повтор не дублирует', async () => {
    expect(await count()).toEqual({ ops: 324, allocations: 179, paidReports: 144 });
    const [first] = await db.admin.db
      .select()
      .from(reports)
      .where(eq(reports.id, demoId('report', '1')));
    expect(first).toMatchObject({ amount: 2_062_000, paid: 2_062_000 });
    const [receipt] = await db.admin.db
      .select()
      .from(moneyOperations)
      .where(eq(moneyOperations.id, demoId('money_operation', '322')));
    expect(receipt).toMatchObject({
      kind: 'in',
      amount: 1_500_000,
      total: 1_500_000,
      holderKind: 'employee',
      holderEmployeeId: demoId('employee', 'e3'),
      reportId: null,
      opDate: '2026-10-18',
    });
    const parts = await db.admin.db
      .select()
      .from(moneyAllocations)
      .where(eq(moneyAllocations.operationId, demoId('money_operation', '322')));
    expect(parts.map((p) => p.amount).sort()).toEqual([500_000, 500_000, 500_000]);
    // Деньги на счёт организации; у контрагента без ответственного — тоже на счёте организации.
    const [org] = await db.admin.db
      .select()
      .from(moneyOperations)
      .where(eq(moneyOperations.id, demoId('money_operation', '250')));
    expect(org).toMatchObject({ holderKind: 'org', holderEmployeeId: null });
    // «Файл при поступлении» у контрагентов прототипа с needInFile.
    const files = await db.admin.db
      .select({ id: contractors.id })
      .from(contractors)
      .where(and(eq(contractors.orgId, DEMO_ORG_ID), eq(contractors.needReceiptFile, true)));
    expect(files.map((c) => c.id).sort()).toEqual(
      ['3', '4', '12'].map((id) => demoId('contractor', id)).sort(),
    );

    await seedAll(db.admin.db, { update: true, demo: true });
    expect(await count()).toEqual({ ops: 324, allocations: 179, paidReports: 144 });
  });
});
