import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { tasks } from './schema';
import { DEMO_ORG_ID, demoId, seedAll } from './seed';
import { readStatusHistory } from './status';
import { getTask, listTaskComments, listTasksPage, taskTabCounts } from './tasks';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;

describe.skipIf(!databaseAvailable())('Задачи демо-организации из demoDB.json', () => {
  let db: TestDatabase;
  const inDemo = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: DEMO_ORG_ID, userId: demoId('user', 'e1') }, fn);
  const task = (id: string) => inDemo((tx) => getTask(tx, demoId('task', id), undefined));

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('все задачи с категориями, контрагентами, исполнителями и подтверждением', async () => {
    const all = await db.admin.db.select().from(tasks).where(eq(tasks.orgId, DEMO_ORG_ID));
    expect(all).toHaveLength(19);
    expect(await task('t18')).toMatchObject({
      title: 'Собрать договоры аренды за 2026 год',
      status: 'confirmed',
      confirm: true,
      author: { id: demoId('employee', 'e2') },
      executor: { id: demoId('employee', 'e5') },
      confirmedBy: { id: demoId('employee', 'e1') },
      confirmNote: 'Мээрим на больничном, проверил сам',
    });
    expect(await task('t3')).toMatchObject({
      status: 'rework',
      reworkReason: 'В выписке нет сентября: запросите выписку за весь квартал',
      reworkBy: { id: demoId('employee', 'e2') },
    });
    expect(await task('t19')).toMatchObject({ contractor: null, term: 'month' });
    expect(await task('t14')).toMatchObject({
      status: 'failed',
      failReason: 'Клиент не передал документы',
    });
  });

  it('«История статусов» — как statusHist прототипа; комментарии', async () => {
    const t18 = await inDemo((tx) => readStatusHistory(tx, 'task', demoId('task', 't18')));
    expect(t18.map((h) => [h.from, h.to])).toEqual([
      [null, 'todo'],
      ['todo', 'in_progress'],
      ['in_progress', 'on_confirm'],
      ['on_confirm', 'confirmed'],
    ]);
    expect(t18.at(-1)).toMatchObject({
      reason: 'вместо постановщика Мээрим К., Мээрим на больничном, проверил сам',
    });
    const t1 = await inDemo((tx) => readStatusHistory(tx, 'task', demoId('task', 't1')));
    expect(t1.map((h) => h.to)).toEqual(['todo', 'done']);
    const comments = await inDemo((tx) => listTaskComments(tx, demoId('task', 't2')));
    expect(comments).toMatchObject([
      { text: 'По акту сверки расхождение 1 250,00 — уточнить у клиента.' },
    ]);
  });

  it('вкладки бухгалтера Алишера: мои открытые и просроченные', async () => {
    const viewer = { employeeId: demoId('employee', 'e3'), all: false, canConfirm: false };
    const counts = await inDemo((tx) => taskTabCounts(tx, viewer, '2026-10-18'));
    // t3 (на доработке), t8, t9, t13 — открыты; t3 просрочена (срок 17.10).
    expect(counts).toMatchObject({ mine: 4, overdue: 1 });
    const page = await inDemo((tx) =>
      listTasksPage(tx, query(), { t, today: '2026-10-18', viewer, tab: 'mine' }),
    );
    expect(page.rows.every((r) => r.executor.id === viewer.employeeId)).toBe(true);
  });
});
