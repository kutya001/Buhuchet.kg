import { hashPassword } from '@buhuchet/adapters/password';
import type { ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminGetUser,
  adminSetUserBlocked,
  listAdminUsersPage,
  listAdminUserValues,
} from './admin-users';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import { employees, sessions, users } from './schema';
import { setTemporaryPassword } from './telegram';
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
  'Админка → «Учётные записи»: только администратор платформы',
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

    const sessionOf = (userId: string, orgId: string, n: number) =>
      db.admin.db.insert(sessions).values({
        userId,
        orgId,
        tokenHash: `test-${userId}-${n}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      });

    it('администратор видит всех пользователей платформы: организация, ФИО, роль, статус, кто создал', async () => {
      const page = await withUserContext(db.app.db, adminId, (tx) =>
        listAdminUsersPage(tx, query({ sort: { key: 'login', dir: 'asc' } }), t),
      );
      expect(page.total).toBe(4);
      expect(page.rows.map((r) => [r.login, r.fullName, r.orgName, r.role, r.status])).toEqual([
        ['asanov', 'Асанов Асан', 'ОсОО «Альфа»', 'Владелец организации', 'active'],
        ['bekova', 'Бекова Бермет', 'ОсОО «Бета»', 'Владелец организации', 'active'],
        ['platform', 'Администратор платформы', 'Платформа', 'Администратор платформы', 'active'],
        [
          'platform-old',
          'Администратор платформы',
          'Платформа',
          'Администратор платформы',
          'blocked',
        ],
      ]);
      const [asanov, bekova, platform] = page.rows;
      expect(asanov!.audit.createdBy).toBeNull();
      expect(bekova!.audit).toMatchObject({
        createdBy: 'Администратор платформы',
        updatedBy: 'Администратор платформы',
      });
      expect(platform).toMatchObject({ isPlatformAdmin: true, orgId: null, lastLoginAt: null });

      const orgs = await withUserContext(db.app.db, adminId, (tx) =>
        listAdminUserValues(tx, 'org', t),
      );
      expect(orgs.items.map((i) => [i.value, i.count])).toEqual([
        ['ОсОО «Альфа»', 1],
        ['ОсОО «Бета»', 1],
        ['Платформа', 2],
      ]);
      const found = await withUserContext(db.app.db, adminId, (tx) =>
        listAdminUsersPage(
          tx,
          query({
            search: { q: 'платформ', keys: ['org'] },
            filters: { active: { type: 'enum', vals: ['active'] } },
          }),
          t,
        ),
      );
      expect(found.rows.map((r) => r.login)).toEqual(['platform']);
    });

    it('сотрудник организации, заблокированный администратор и запрос без контекста не видят ничего', async () => {
      const asOwner = await withOrgContext(
        db.app.db,
        { orgId: a.orgId, userId: a.ownerUserId },
        async (tx) => ({
          page: await listAdminUsersPage(tx, query(), t),
          other: await adminGetUser(tx, b.ownerUserId),
        }),
      );
      expect(asOwner.page.total).toBe(0);
      expect(asOwner.other).toBeNull();
      const asBlocked = await withUserContext(db.app.db, blockedAdminId, (tx) =>
        listAdminUsersPage(tx, query(), t),
      );
      expect(asBlocked.total).toBe(0);
      const bare = await db.app.db.transaction((tx) => listAdminUsersPage(tx, query(), t));
      expect(bare.total).toBe(0);
    });

    it('блокировка закрывает сеансы и пишет историю; разблокировка; устаревшая версия и повтор', async () => {
      await sessionOf(b.ownerUserId, b.orgId, 1);
      await sessionOf(b.ownerUserId, b.orgId, 2);
      const ctx = { orgId: b.orgId, userId: adminId };
      const before = (await withUserContext(db.app.db, adminId, (tx) =>
        adminGetUser(tx, b.ownerUserId),
      ))!;
      const blocked = await withOrgContext(db.app.db, ctx, (tx) =>
        adminSetUserBlocked(tx, { userId: b.ownerUserId, blocked: true, version: before.version }),
      );
      expect(blocked).toMatchObject({ ok: true, record: { blocked: true, status: 'blocked' } });
      if (!blocked.ok) return;
      expect(blocked.record.version).toBe(before.version + 1);
      expect(blocked.record.audit.updatedBy).toBe('Администратор платформы');
      const left = await db.admin.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, b.ownerUserId));
      expect(left).toEqual([]);

      const again = await withOrgContext(db.app.db, ctx, (tx) =>
        adminSetUserBlocked(tx, {
          userId: b.ownerUserId,
          blocked: true,
          version: blocked.record.version,
        }),
      );
      expect(again).toMatchObject({ ok: true, record: { version: blocked.record.version } });
      const stale = await withOrgContext(db.app.db, ctx, (tx) =>
        adminSetUserBlocked(tx, { userId: b.ownerUserId, blocked: false, version: before.version }),
      );
      expect(stale).toEqual({ ok: false, reason: 'changed' });

      const unblocked = await withOrgContext(db.app.db, ctx, (tx) =>
        adminSetUserBlocked(tx, {
          userId: b.ownerUserId,
          blocked: false,
          version: blocked.record.version,
        }),
      );
      expect(unblocked).toMatchObject({ ok: true, record: { blocked: false, status: 'active' } });

      const history = await withOrgContext(db.app.db, { orgId: b.orgId }, (tx) =>
        readHistory(tx, 'user', b.ownerUserId),
      );
      const changes = history.filter((h) => h.reason?.includes('администратором платформы'));
      expect(changes.map((h) => [h.actorUserId, h.changes])).toEqual([
        [adminId, [{ field: 'blocked', from: false, to: true }]],
        [adminId, [{ field: 'blocked', from: true, to: false }]],
      ]);
    });

    it('сотрудник, заблокированный владельцем, — свой статус; разблокировка администратором его не снимает', async () => {
      await db.admin.db
        .update(employees)
        .set({ active: false })
        .where(eq(employees.userId, a.ownerUserId));
      const ctx = { orgId: a.orgId, userId: adminId };
      const owner = (await withUserContext(db.app.db, adminId, (tx) =>
        adminGetUser(tx, a.ownerUserId),
      ))!;
      expect(owner).toMatchObject({
        status: 'owner_blocked',
        blocked: false,
        employeeActive: false,
      });
      const blocked = await withOrgContext(db.app.db, ctx, (tx) =>
        adminSetUserBlocked(tx, { userId: a.ownerUserId, blocked: true, version: owner.version }),
      );
      expect(blocked).toMatchObject({ ok: true, record: { status: 'blocked' } });
      if (!blocked.ok) return;
      const unblocked = await withOrgContext(db.app.db, ctx, (tx) =>
        adminSetUserBlocked(tx, {
          userId: a.ownerUserId,
          blocked: false,
          version: blocked.record.version,
        }),
      );
      expect(unblocked).toMatchObject({ ok: true, record: { status: 'owner_blocked' } });
      const values = await withUserContext(db.app.db, adminId, (tx) =>
        listAdminUserValues(tx, 'active', t),
      );
      expect(values.items).toEqual([
        { value: 'active', label: 'accounts.active', count: 2 },
        { value: 'blocked', label: 'accounts.blocked', count: 1 },
        { value: 'owner_blocked', label: 'accounts.owner_blocked', count: 1 },
      ]);
      await db.admin.db
        .update(employees)
        .set({ active: true })
        .where(eq(employees.userId, a.ownerUserId));
    });

    it('учётную запись администратора платформы и пользователя другой организации так не заблокировать', async () => {
      const admin = await withOrgContext(db.app.db, { orgId: a.orgId, userId: adminId }, (tx) =>
        adminSetUserBlocked(tx, { userId: blockedAdminId, blocked: false, version: 1 }),
      );
      expect(admin).toEqual({ ok: false, reason: 'not_found' });
      const user = (await withUserContext(db.app.db, adminId, (tx) =>
        adminGetUser(tx, b.ownerUserId),
      ))!;
      // В контексте чужой организации функция строку не находит — значит, ни истории, ни сеансов.
      const otherOrg = await withOrgContext(db.app.db, { orgId: a.orgId, userId: adminId }, (tx) =>
        adminSetUserBlocked(tx, { userId: b.ownerUserId, blocked: true, version: user.version }),
      );
      expect(otherOrg).toEqual({ ok: false, reason: 'changed' });
      const still = await withUserContext(db.app.db, adminId, (tx) =>
        adminGetUser(tx, b.ownerUserId),
      );
      expect(still?.blocked).toBe(false);
    });

    it('владелец, заблокированный администратор и запрос без контекста блокировку не ставят ни функцией, ни напрямую', async () => {
      const owner = { orgId: a.orgId, userId: a.ownerUserId };
      const block = sql`select app.admin_set_user_blocked(${a.ownerUserId}, true, 1) as v`;
      const viaOwner = await withOrgContext(db.app.db, owner, (tx) =>
        tx.execute<{ v: number | null }>(block),
      );
      expect(viaOwner[0]!.v).toBeNull();
      const viaBlocked = await withOrgContext(
        db.app.db,
        { orgId: a.orgId, userId: blockedAdminId },
        (tx) => tx.execute<{ v: number | null }>(block),
      );
      expect(viaBlocked[0]!.v).toBeNull();
      const bare = await db.app.db.transaction((tx) => tx.execute<{ v: number | null }>(block));
      expect(bare[0]!.v).toBeNull();
      // Права на столбцы: роль приложения не меняет блокировку, логин и признак администратора даже
      // в своей организации; временный пароль задаёт по-прежнему.
      for (const set of [sql`blocked = true`, sql`login = 'hijack'`, sql`last_login_at = now()`]) {
        await expect(
          withOrgContext(db.app.db, owner, (tx) =>
            tx.execute(sql`update users set ${set} where id = ${a.ownerUserId}`),
          ),
        ).rejects.toThrow(
          expect.objectContaining({
            cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
          }),
        );
      }
      const reset = await withOrgContext(db.app.db, owner, (tx) =>
        setTemporaryPassword(tx, { userId: a.ownerUserId, passwordHash: 'x' }),
      );
      expect(reset).not.toBeNull();
      const row = await withUserContext(db.app.db, adminId, (tx) =>
        adminGetUser(tx, a.ownerUserId),
      );
      expect(row?.blocked).toBe(false);
    });
  },
);
