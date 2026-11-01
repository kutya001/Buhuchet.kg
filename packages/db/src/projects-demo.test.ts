import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { listProjectsPage, projectCard, projectSummary } from './projects';
import { projects } from './schema';
import { DEMO_ORG_ID, demoId, seedAll } from './seed';
import { readStatusHistory } from './status';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {} }) as unknown as ListQuery;
const TODAY = '2026-10-18';

describe.skipIf(!databaseAvailable())('Проекты демо-организации из demoDB.json', () => {
  let db: TestDatabase;
  const inDemo = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: DEMO_ORG_ID, userId: demoId('user', 'e1') }, fn);
  const card = (id: string) => inDemo((tx) => projectCard(tx, demoId('project', id), undefined));

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('четыре проекта: статусы, ответственные, главный, работы, план в тыйынах, задачи', async () => {
    const all = await db.admin.db.select().from(projects).where(eq(projects.orgId, DEMO_ORG_ID));
    expect(all).toHaveLength(4);
    const p1 = (await card('p1'))!;
    expect(p1.project).toMatchObject({
      name: 'Восстановление учёта 2024–2025',
      status: 'in_progress',
      plan: 120_000 * 100,
      startsOn: '2026-08-19',
      endsOn: '2026-11-17',
    });
    expect(p1.members).toEqual([demoId('employee', 'e3'), demoId('employee', 'e2')]);
    expect(p1.project.leadEmployeeId).toBe(demoId('employee', 'e3'));
    expect(p1.works.map((w) => w.done)).toEqual([true, true, true, false, false]);
    expect(p1.tasks.map((x) => x.id)).toEqual([demoId('task', 't15')]);
    expect((await card('p4'))!.project.plan).toBeNull();
    expect((await card('p4'))!.tasks.map((x) => x.id)).toEqual([demoId('task', 't16')]);
    const p3 = await inDemo((tx) => readStatusHistory(tx, 'project', demoId('project', 'p3')));
    expect(p3.map((h) => h.to)).toEqual(['planned', 'in_progress', 'done']);
  });

  it('бухгалтер Алишер (область «Свои») видит проекты своего контрагента и где он ответственный', async () => {
    const viewer = { employeeId: demoId('employee', 'e3'), seeAll: false };
    const page = await inDemo((tx) =>
      listProjectsPage(tx, query(), { t, today: TODAY, viewer, tab: 'all', money: false }),
    );
    expect(page.rows.map((r) => r.id).sort()).toEqual(
      [demoId('project', 'p1'), demoId('project', 'p4')].sort(),
    );
    expect(page.rows.find((r) => r.id === demoId('project', 'p1'))).toMatchObject({
      worksDone: 3,
      worksTotal: 5,
      plan: null,
    });
    const owner = await inDemo((tx) =>
      projectSummary(tx, { employeeId: demoId('employee', 'e1'), seeAll: true }, TODAY, true),
    );
    // Активные: p1, p2, p4; «Мои» у руководителя — нет; осталось получить — планы p1 и p2 (оплат ещё нет).
    expect(owner).toMatchObject({
      active: 3,
      mine: 0,
      inProgress: 2,
      planned: 1,
      overdue: 0,
      any: true,
    });
    expect(owner.left).toBe((120_000 + 50_000) * 100);
  });
});
