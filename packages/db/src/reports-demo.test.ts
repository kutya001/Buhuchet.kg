import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { createDueReports } from './reports';
import { assignments, reports, reportTaxLines, statusHistory } from './schema';
import { DEMO_ORG_ID, demoId, seedAll } from './seed';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

describe.skipIf(!databaseAvailable())('Назначения и отчёты демо-организации из demoDB.json', () => {
  let db: TestDatabase;

  const count = async () => ({
    assignments: (
      await db.admin.db.select().from(assignments).where(eq(assignments.orgId, DEMO_ORG_ID))
    ).length,
    reports: (await db.admin.db.select().from(reports).where(eq(reports.orgId, DEMO_ORG_ID)))
      .length,
    history: (
      await db.admin.db
        .select()
        .from(statusHistory)
        .where(and(eq(statusHistory.orgId, DEMO_ORG_ID), eq(statusHistory.scale, 'report')))
    ).length,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('все назначения и отчёты со сроками, сдачей, подтверждением и суммой', async () => {
    expect(await count()).toMatchObject({ assignments: 172, reports: 542 });

    const [first] = await db.admin.db
      .select()
      .from(reports)
      .where(eq(reports.id, demoId('report', '1')));
    expect(first).toMatchObject({
      contractorId: demoId('contractor', '1'),
      reportTypeCode: 'nds',
      assignmentId: demoId('assignment', '1:nds'),
      period: 'M',
      periodStart: '2026-07-01',
      revision: 0,
      superseded: false,
      dueBase: '2026-08-25',
      dueDate: '2026-08-25',
      payDue: '2026-08-25',
      status: 'submitted',
      submittedOn: '2026-08-22',
      submittedBy: demoId('user', 'e3'),
      confirmedBy: demoId('user', 'e2'),
      amount: 2_062_000,
      responsibleEmployeeId: demoId('employee', 'e3'),
    });
    expect(first!.confirmedAt?.toISOString()).toBe('2026-08-24T05:20:00.000Z');

    // Периодичность в назначении (прототип a.per): квартальная отчётность раз в квартал.
    const [quarterly] = await db.admin.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, demoId('assignment', '12:opu')));
    expect(quarterly).toMatchObject({ ownPeriod: 'Q', ownDay: 15, ownMonth: 1 });
  });

  it('«История статусов»: создан в «К сдаче», переход в нынешний статус и подтверждение', async () => {
    const history = await db.admin.db
      .select()
      .from(statusHistory)
      .where(eq(statusHistory.entityId, demoId('report', '1')));
    expect(history.map((h) => [h.fromStatus, h.toStatus, h.actorUserId])).toEqual([
      [null, 'todo', null],
      ['todo', 'submitted', demoId('user', 'e3')],
      ['submitted', 'confirmed', demoId('user', 'e2')],
    ]);
    // Возврат на исправление — кем и когда вернули, с причиной (прототип fixBy, fixAt, fixWhy).
    const [, fix] = await db.admin.db
      .select()
      .from(statusHistory)
      .where(eq(statusHistory.entityId, demoId('report', '345')))
      .orderBy(statusHistory.at);
    expect(fix).toMatchObject({
      toStatus: 'needs_fix',
      actorUserId: demoId('user', 'e2'),
      reason: 'В декларации не отражён импорт за август — исправьте раздел 4 и сдайте снова',
    });
  });

  it('строки суммы по ставкам: ЕН мес. за август — ЕНС-02 безнал и нал, ЕНС-16', async () => {
    const lines = await db.admin.db
      .select()
      .from(reportTaxLines)
      .where(eq(reportTaxLines.reportId, demoId('report', '54')))
      .orderBy(reportTaxLines.sortOrder);
    expect(lines.map((l) => [l.lineKey, l.cash, l.revenue, l.tax])).toEqual([
      ['ЕНС-02:cl', false, 60_000_000, 1_200_000],
      ['ЕНС-02:ca', true, 37_600_000, 1_504_000],
      ['ЕНС-16:r', null, 7_500_000, 300_000],
    ]);
  });

  it('задача по расписанию на демо-данных досоздаёт только недостающее', async () => {
    const run = () =>
      withOrgContext(db.app.db, { orgId: DEMO_ORG_ID, kind: 'job' }, (tx) =>
        createDueReports(tx, { today: '2026-10-27' }),
      );
    const before = new Set(
      (
        await db.admin.db
          .select({ id: reports.id })
          .from(reports)
          .where(eq(reports.orgId, DEMO_ORG_ID))
      ).map((r) => r.id),
    );
    // В demoDB.json у контрагентов, добавленных позже, нет годовых отчётов за 2026 год.
    expect(await run()).toBe(10);
    const added = (
      await db.admin.db.select().from(reports).where(eq(reports.orgId, DEMO_ORG_ID))
    ).filter((r) => !before.has(r.id));
    expect(new Set(added.map((r) => `${r.reportTypeCode} ${r.periodStart}`))).toEqual(
      new Set(['endo 2026-01-01', 'tbo 2026-01-01']),
    );
    expect(await run()).toBe(0);
  });

  it('повторное наполнение ничего не дублирует', async () => {
    const before = await count();
    await seedAll(db.admin.db, { update: false, demo: true });
    expect(await count()).toEqual(before);
  });
});
