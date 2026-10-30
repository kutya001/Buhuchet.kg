import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getContractorPage } from './contractor-page';
import { withOrgContext } from './context';
import { auditLog, contractorPages } from './schema';
import { DEMO_ORG_ID, demoId, seedAll } from './seed';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

describe.skipIf(!databaseAvailable())(
  'Страницы контрагентов демо-организации из demoDB.json',
  () => {
    let db: TestDatabase;
    const inDemo = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
      withOrgContext(db.app.db, { orgId: DEMO_ORG_ID, userId: demoId('user', 'e1') }, fn);
    const history = (protoId: string) =>
      db.admin.db
        .select({ action: auditLog.action, changes: auditLog.changes, actor: auditLog.actorUserId })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entity, 'contractor_page'),
            eq(auditLog.contractorId, demoId('contractor', protoId)),
          ),
        )
        .orderBy(asc(auditLog.at), asc(auditLog.id));

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAll(db.admin.db, { update: false, demo: true });
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('ОсОО «Укс» и «Бишкек Стройсервис»: страницы включены с кодами прототипа, история перенесена', async () => {
      const uks = await inDemo((tx) => getContractorPage(tx, demoId('contractor', '29')));
      expect(uks).toMatchObject({ enabled: true, code: '482915', hiddenSections: [] });
      expect(uks?.lastDevice).toBe('Телефон · Safari');
      expect(uks?.lastOpenAt?.toISOString()).toBe('2026-10-23T13:42:00.000Z');
      expect((await history('29')).map((h) => h.action)).toEqual([
        'page_on',
        'page_send',
        'page_open',
        'page_open',
      ]);

      const stroy = await inDemo((tx) => getContractorPage(tx, demoId('contractor', '2')));
      expect(stroy).toMatchObject({ enabled: true, code: '730264', hiddenSections: ['fee'] });
      expect(stroy?.lastOpenAt).toBeNull();
      const log = await history('2');
      expect(log.map((h) => h.action)).toEqual(['page_on', 'update']);
      expect(log[1]!.changes).toEqual([{ field: 'hiddenSections', from: [], to: ['fee'] }]);
      expect(log[0]!.actor).toBe(demoId('user', 'e2'));
    });

    it('повторное наполнение не задваивает страницы и историю', async () => {
      await seedAll(db.admin.db, { update: true, demo: true });
      const pages = await db.admin.db
        .select()
        .from(contractorPages)
        .where(eq(contractorPages.orgId, DEMO_ORG_ID));
      expect(pages).toHaveLength(2);
      expect(await history('29')).toHaveLength(4);
    });
  },
);
