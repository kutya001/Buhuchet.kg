import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { updateWithHistory } from './history';
import { getOrgPolicy, getOrgProfile, orgFeatures, orgPolicyHistory } from './org';
import { createOrganization, type CreatedOrganization } from './organizations';
import { organizations, orgSettings } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

describe.skipIf(!databaseAvailable())(
  '«Моя организация»: профиль и учётная политика в базе',
  () => {
    let t: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;

    beforeAll(async () => {
      t = await createTestDatabase();
      await seedAccessReference(t.admin.db);
      const owner = (login: string) => ({
        fullName: 'Владелец Тестовый',
        login,
        passwordHash: '!',
      });
      a = await createOrganization(t.app.db, {
        name: 'ОсОО «Ахти»',
        inn: '01811201810111',
        slug: 'ahti',
        owner: owner('owner-a'),
      });
      b = await createOrganization(t.app.db, {
        name: 'ОсОО «Бета»',
        inn: '01811201810222',
        slug: 'beta',
        owner: owner('owner-b'),
      });
    });

    afterAll(async () => {
      await t?.drop();
    });

    const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
      withOrgContext(t.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);

    it('профиль и учётная политика чужой организации не видны', async () => {
      expect(await inA((tx) => getOrgProfile(tx, b.orgId))).toBeNull();
      expect(await inA((tx) => getOrgPolicy(tx, b.orgId))).toBeNull();
      expect(await inA((tx) => orgPolicyHistory(tx, b.orgId))).toEqual([]);
      expect(await inA((tx) => orgFeatures(tx, b.orgId))).toMatchObject({ tasks: false });
    });

    it('учётная политика новой организации — по умолчанию, время сводки «09:00»', async () => {
      const policy = await inA((tx) => getOrgPolicy(tx, a.orgId));
      expect(policy).toMatchObject({
        remindDays: [7, 3],
        digestTime: '09:00',
        timezone: 'Asia/Bishkek',
        pageSections: ['pay', 'reports', 'money', 'fee', 'kpi', 'contacts'],
        defaultRoleId: a.roles.find((r) => r.templateCode === 'acc')!.id,
        version: 1,
      });
      expect(await inA((tx) => orgFeatures(tx, a.orgId))).toMatchObject({
        tasks: true,
        projects: false,
      });
    });

    it('роль приложения меняет поля профиля с историей, а статус организации — нет', async () => {
      const updated = await inA((tx) =>
        updateWithHistory(tx, {
          table: organizations,
          entity: 'organization',
          id: a.orgId,
          version: 1,
          patch: { address: 'г. Бишкек, ул. Токтогула, 1', head: 'Иванов Иван' },
        }),
      );
      expect(updated).toMatchObject({ version: 2, updatedBy: a.ownerUserId });
      const profile = await inA((tx) => getOrgProfile(tx, a.orgId));
      expect(profile).toMatchObject({
        address: 'г. Бишкек, ул. Токтогула, 1',
        head: 'Иванов Иван',
        audit: { updatedBy: 'Тестовый В.' },
      });

      for (const set of [{ status: 'blocked' }, { blockedReason: 'x' }, { isDemo: true }]) {
        await expect(
          inA((tx) => tx.update(organizations).set(set).where(eq(organizations.id, a.orgId))),
        ).rejects.toThrow(permissionDenied);
      }
      const [row] = await t.admin.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, a.orgId));
      expect(row).toMatchObject({ status: 'active', blockedReason: null, isDemo: false });
    });

    it('история учётной политики — сначала новые, с автором', async () => {
      await inA((tx) =>
        updateWithHistory(tx, {
          table: orgSettings,
          entity: 'org_settings',
          key: orgSettings.orgId,
          id: a.orgId,
          version: 1,
          patch: { remindDays: [14, 7, 3] },
        }),
      );
      const history = await inA((tx) => orgPolicyHistory(tx, a.orgId));
      expect(history[0]).toMatchObject({
        actor: 'Тестовый В.',
        action: 'update',
        changes: [{ field: 'remindDays', from: [7, 3], to: [14, 7, 3] }],
      });
      // Создание организации записано от имени системы (организацию создаёт администратор или команда).
      expect(history.at(-1)).toMatchObject({ action: 'create', actor: null });
    });
  },
);
