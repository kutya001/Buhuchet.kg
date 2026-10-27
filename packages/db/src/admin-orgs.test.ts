import { hashPassword } from '@buhuchet/adapters/password';
import type { ListQuery } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminGetOrganization,
  adminOrgSlugs,
  adminOrgSummary,
  adminSetOrganizationStatus,
  listAdminOrgsPage,
  listAdminOrgValues,
} from './admin-orgs';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import { users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const t = (key: string) => key;
const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  sort: undefined,
  page: 1,
  size: 25,
  filters: {},
  ...over,
});

describe.skipIf(!databaseAvailable())(
  'Админка → «Организации»: только администратор платформы',
  () => {
    let db: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;
    let adminId: string;
    let blockedAdminId: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      const passwordHash = await hashPassword('Bh-4821-temp');
      const [admin, blocked] = await db.admin.db
        .insert(users)
        .values([
          { login: 'platform', passwordHash, isPlatformAdmin: true },
          { login: 'platform-old', passwordHash, isPlatformAdmin: true, blocked: true },
        ])
        .returning({ id: users.id });
      adminId = admin!.id;
      blockedAdminId = blocked!.id;
      a = await createOrganization(db.app.db, {
        name: 'ОсОО «Альфа»',
        inn: '01811201810456',
        slug: 'alfa',
        owner: { fullName: 'Асанов Асан', login: 'asanov', passwordHash },
      });
      b = await createOrganization(db.app.db, {
        name: 'ОсОО «Бета»',
        inn: '02811201810457',
        slug: 'beta',
        owner: { fullName: 'Бекова Бермет', login: 'bekova', passwordHash },
        createdBy: adminId,
      });
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('администратор видит все организации: владелец, сотрудники, кто создал', async () => {
      const page = await withUserContext(db.app.db, adminId, (tx) =>
        listAdminOrgsPage(tx, query({ sort: { key: 'name', dir: 'asc' } }), t),
      );
      expect(page.total).toBe(2);
      expect(page.rows.map((r) => [r.name, r.inn, r.ownerLogin, r.employees, r.active])).toEqual([
        ['ОсОО «Альфа»', '01811201810456', 'asanov', 1, true],
        ['ОсОО «Бета»', '02811201810457', 'bekova', 1, true],
      ]);
      const beta = page.rows[1]!;
      expect(beta.audit.createdBy).toBe('Администратор платформы');
      expect(page.rows[0]!.audit.createdBy).toBeNull();
      expect(page.totals.employees).toBe(2);

      const values = await withUserContext(db.app.db, adminId, (tx) =>
        listAdminOrgValues(tx, 'active', t),
      );
      expect(values.items).toEqual([{ value: 'active', label: 'orgs.active', count: 2 }]);
      const summary = await withUserContext(db.app.db, adminId, (tx) => adminOrgSummary(tx));
      expect(summary).toEqual({ active: 2, contractors: 0, users: 2, requests: 0 });
      const slugs = await withUserContext(db.app.db, adminId, (tx) => adminOrgSlugs(tx));
      expect(slugs.sort()).toEqual(['alfa', 'beta']);
    });

    it('сотрудник организации, заблокированный администратор и запрос без контекста не видят ничего', async () => {
      const asOwner = await withOrgContext(
        db.app.db,
        { orgId: a.orgId, userId: a.ownerUserId },
        async (tx) => ({
          page: await listAdminOrgsPage(tx, query(), t),
          other: await adminGetOrganization(tx, b.orgId),
          summary: await adminOrgSummary(tx),
        }),
      );
      expect(asOwner.page.total).toBe(0);
      expect(asOwner.other).toBeNull();
      expect(asOwner.summary.users).toBe(0);
      const asBlocked = await withUserContext(db.app.db, blockedAdminId, (tx) =>
        listAdminOrgsPage(tx, query(), t),
      );
      expect(asBlocked.total).toBe(0);
      const bare = await db.app.db.transaction((tx) => listAdminOrgsPage(tx, query(), t));
      expect(bare.total).toBe(0);
    });

    it('блокировка и разблокировка: статус, причина, версия и история; устаревшая версия — отказ', async () => {
      const before = (await withUserContext(db.app.db, adminId, (tx) =>
        adminGetOrganization(tx, b.orgId),
      ))!;
      const blocked = await withOrgContext(db.app.db, { orgId: b.orgId, userId: adminId }, (tx) =>
        adminSetOrganizationStatus(tx, {
          orgId: b.orgId,
          blocked: true,
          reason: 'Заблокирована администратором',
          version: before.version,
        }),
      );
      expect(blocked).toMatchObject({
        ok: true,
        record: { active: false, blockedReason: 'Заблокирована администратором' },
      });
      if (!blocked.ok) return;
      expect(blocked.record.version).toBe(before.version + 1);
      expect(blocked.record.audit.updatedBy).toBe('Администратор платформы');

      const stale = await withOrgContext(db.app.db, { orgId: b.orgId, userId: adminId }, (tx) =>
        adminSetOrganizationStatus(tx, {
          orgId: b.orgId,
          blocked: false,
          reason: null,
          version: before.version,
        }),
      );
      expect(stale).toEqual({ ok: false, reason: 'changed' });

      const unblocked = await withOrgContext(db.app.db, { orgId: b.orgId, userId: adminId }, (tx) =>
        adminSetOrganizationStatus(tx, {
          orgId: b.orgId,
          blocked: false,
          reason: 'не сохраняется у активной',
          version: blocked.record.version,
        }),
      );
      expect(unblocked).toMatchObject({ ok: true, record: { active: true, blockedReason: null } });

      const history = await withOrgContext(db.app.db, { orgId: b.orgId }, (tx) =>
        readHistory(tx, 'organization', b.orgId),
      );
      const statusChanges = history.filter((h) => h.reason?.includes('администратором платформы'));
      expect(statusChanges.map((h) => [h.actorUserId, h.changes])).toEqual([
        [
          adminId,
          [
            { field: 'status', from: 'active', to: 'blocked' },
            { field: 'blockedReason', from: null, to: 'Заблокирована администратором' },
          ],
        ],
        [
          adminId,
          [
            { field: 'status', from: 'blocked', to: 'active' },
            { field: 'blockedReason', from: 'Заблокирована администратором', to: null },
          ],
        ],
      ]);
    });

    it('владелец организации статус не меняет ни функцией, ни напрямую', async () => {
      const owner = { orgId: a.orgId, userId: a.ownerUserId };
      const viaFunction = await withOrgContext(db.app.db, owner, (tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_set_org_status(${a.orgId}, 'blocked', null, 1) as v`,
        ),
      );
      expect(viaFunction[0]!.v).toBeNull();
      await expect(
        withOrgContext(db.app.db, owner, (tx) =>
          tx.execute(sql`update organizations set status = 'blocked' where id = ${a.orgId}`),
        ),
      ).rejects.toThrow();
      const org = await withUserContext(db.app.db, adminId, (tx) =>
        adminGetOrganization(tx, a.orgId),
      );
      expect(org?.active).toBe(true);
    });
  },
);
