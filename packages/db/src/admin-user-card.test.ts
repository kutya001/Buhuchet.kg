import { hashPassword } from '@buhuchet/adapters/password';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminAccountCard,
  adminEmployeeCard,
  adminEndUserSessions,
  adminSessions,
  adminUserSessions,
  logAdminCardView,
  logUserCardView,
} from './admin-user-card';
import { endSession, startSession, withUserContext } from './auth';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { sessions, users } from './schema';
import { endUserSessions } from './staff';
import { setTemporaryPassword } from './telegram';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

describe.skipIf(!databaseAvailable())(
  'Админка → карточка пользователя: журнал сеансов и данные карточки',
  () => {
    let db: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;
    let adminId: string;
    const now = () => new Date();
    let n = 0;
    const hash = () => `card-test-${++n}`;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      const passwordHash = await hashPassword('Bh-4821-temp');
      const [admin] = await db.admin.db
        .insert(users)
        .values([{ login: 'platform', passwordHash, isPlatformAdmin: true }])
        .returning({ id: users.id });
      adminId = admin!.id;
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
      });
    });

    afterAll(async () => {
      await db?.drop();
    });

    const sessionsOf = (userId: string) =>
      withUserContext(db.app.db, adminId, (tx) => adminUserSessions(tx, userId, now()));

    it('сеанс попадает в журнал с устройством; выход закрывает его как «Выход»', async () => {
      const token = hash();
      await startSession(db.app.db, {
        userId: a.ownerUserId,
        tokenHash: token,
        device: 'Chrome 130 · Windows 10 или 11',
      });
      let log = await sessionsOf(a.ownerUserId);
      expect(log).toMatchObject({ total: 1, open: 1 });
      expect(log.rows[0]).toMatchObject({
        device: 'Chrome 130 · Windows 10 или 11',
        open: true,
        endReason: null,
      });
      expect(log.rows[0]!.till).not.toBeNull();

      await endSession(db.app.db, token);
      log = await sessionsOf(a.ownerUserId);
      expect(log).toMatchObject({ total: 1, open: 0 });
      expect(log.rows[0]).toMatchObject({ open: false, endReason: 'logout', till: null });
    });

    it('журнал повторяет продление сеанса; вход без устройства — прочерк', async () => {
      const token = hash();
      const id = await startSession(db.app.db, { userId: b.ownerUserId, tokenHash: token });
      const seen = new Date(Date.now() + 60_000);
      await db.admin.db.update(sessions).set({ lastSeenAt: seen }).where(eq(sessions.id, id));
      const log = await sessionsOf(b.ownerUserId);
      expect(log.rows[0]).toMatchObject({ id, device: null, open: true });
      expect(log.rows[0]!.lastAt.getTime()).toBe(seen.getTime());
    });

    it('причины закрытия: сброс пароля, блокировка, администратор, срок, прочее', async () => {
      const start = () => startSession(db.app.db, { userId: a.ownerUserId, tokenHash: hash() });
      const reasonOf = async (id: string) =>
        (await sessionsOf(a.ownerUserId)).rows.find((r) => r.id === id)?.endReason;
      const ctx = { orgId: a.orgId, userId: adminId };

      const reset = await start();
      await withOrgContext(db.app.db, ctx, async (tx) => {
        await setTemporaryPassword(tx, {
          userId: a.ownerUserId,
          passwordHash: await hashPassword('Bh-9999-temp'),
        });
      });
      expect(await reasonOf(reset)).toBe('reset');

      const blocked = await start();
      expect(await withOrgContext(db.app.db, ctx, (tx) => endUserSessions(tx, a.ownerUserId))).toBe(
        1,
      );
      expect(await reasonOf(blocked)).toBe('blocked');

      const byAdmin = [await start(), await start()];
      expect(
        await withOrgContext(db.app.db, ctx, (tx) => adminEndUserSessions(tx, a.ownerUserId)),
      ).toBe(2);
      expect(await reasonOf(byAdmin[0]!)).toBe('admin');
      expect(await reasonOf(byAdmin[1]!)).toBe('admin');

      // Истёкший сеанс: открытым не считается ещё до удаления, после удаления — «Истёк срок».
      const expired = await start();
      const past = new Date(Date.now() - 60_000);
      await db.admin.db.update(sessions).set({ expiresAt: past }).where(eq(sessions.id, expired));
      let row = (await sessionsOf(a.ownerUserId)).rows.find((r) => r.id === expired)!;
      expect(row).toMatchObject({ open: false, endReason: 'expired' });
      await db.admin.db.delete(sessions).where(eq(sessions.id, expired));
      row = (await sessionsOf(a.ownerUserId)).rows.find((r) => r.id === expired)!;
      expect(row).toMatchObject({ open: false, endReason: 'expired' });
      expect(row.lastAt.getTime()).toBe(past.getTime());

      // Удаление без причины и с неизвестной причиной — «Закрыт».
      const other = await start();
      await db.admin.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.session_end', 'что угодно', true)`);
        await tx.delete(sessions).where(eq(sessions.id, other));
      });
      expect(await reasonOf(other)).toBe('closed');
    });

    it('журнал видит только администратор платформы; роль приложения таблицу не читает', async () => {
      await startSession(db.app.db, { userId: a.ownerUserId, tokenHash: hash() });
      const own = await withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
        tx.select().from(adminSessions),
      );
      expect(own).toEqual([]);
      const none = await db.app.db.select().from(adminSessions);
      expect(none).toEqual([]);
      await expect(db.app.db.execute(sql`select * from public.session_log`)).rejects.toThrow();
      await expect(
        withUserContext(db.app.db, adminId, (tx) =>
          tx.execute(sql`delete from public.session_log`),
        ),
      ).rejects.toThrow();
    });

    it('карточка сотрудника: только администратору и только в организации пользователя', async () => {
      const card = await withOrgContext(
        db.app.db,
        { orgId: a.orgId, userId: adminId },
        async (tx) => {
          await logUserCardView(tx, a.ownerUserId);
          return adminEmployeeCard(tx, db.app.db, {
            userId: a.ownerUserId,
            orgId: a.orgId,
            now: now(),
          });
        },
      );
      expect(card).not.toBeNull();
      expect(card!.user.login).toBe('asanov');
      expect(card!.employee).toMatchObject({
        isOwner: true,
        loginFailures: 0,
        loginLocked: false,
        telegram: null,
      });
      expect(card!.employee!.role!.permissions.length).toBeGreaterThan(0);
      expect(card!.work).toMatchObject({
        contractors: { count: 0, rows: [] },
        overdue: { count: 0 },
        tasks: { count: 0 },
      });
      expect(card!.telegram).toEqual({ count: 0, rows: [] });
      // История: открытие карточки и завершение сеансов — от имени администратора платформы.
      const actions = card!.history.map((h) => h.action);
      expect(actions[0]).toBe('card_view');
      expect(actions).toContain('sessions_end');
      expect(card!.history[0]).toMatchObject({
        actorAdmin: true,
        reason: 'Открыта карточка пользователя',
      });

      // Чужая организация в контексте: сотрудника не видно.
      const foreign = await withOrgContext(db.app.db, { orgId: b.orgId, userId: adminId }, (tx) =>
        adminEmployeeCard(tx, db.app.db, { userId: a.ownerUserId, orgId: b.orgId, now: now() }),
      );
      expect(foreign).toBeNull();
      // Владелец организации — не администратор платформы: карточки нет.
      const byOwner = await withOrgContext(
        db.app.db,
        { orgId: a.orgId, userId: a.ownerUserId },
        (tx) =>
          adminEmployeeCard(tx, db.app.db, { userId: a.ownerUserId, orgId: a.orgId, now: now() }),
      );
      expect(byOwner).toBeNull();
    });

    it('карточка администратора платформы: без работы и обучения, открытия — в истории платформы', async () => {
      const card = await withUserContext(db.app.db, adminId, async (tx) => {
        await logAdminCardView(tx, adminId);
        return adminAccountCard(tx, adminId);
      });
      expect(card).toMatchObject({ employee: null, work: null, kb: null, telegram: null });
      expect(card!.history[0]).toMatchObject({ action: 'card_view', actorAdmin: true });
      // Пользователь организации — не эта карточка.
      expect(
        await withUserContext(db.app.db, adminId, (tx) => adminAccountCard(tx, a.ownerUserId)),
      ).toBeNull();
    });
  },
);
