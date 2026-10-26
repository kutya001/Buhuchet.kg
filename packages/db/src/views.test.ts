import { hashPassword } from '@buhuchet/adapters/password';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext, type OrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { users, viewSettings } from './schema';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';
import { listViewSettings, resetViewSettings, saveViewSettings } from './views';

/** Ошибка именно RLS, а не любая (у drizzle она в cause). */
const rlsViolation = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
});

describe.skipIf(!databaseAvailable())('настройки вида списков: только свои', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let colleagueId: string;
  let adminId: string;
  const ownerA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ownerB = (): OrgContext => ({ orgId: b.orgId, userId: b.ownerUserId });
  const colleague = (): OrgContext => ({ orgId: a.orgId, userId: colleagueId });

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const passwordHash = await hashPassword('Bh-4821-temp');
    const org = (name: string, inn: string, slug: string, login: string) =>
      createOrganization(t.app.db, {
        name,
        inn,
        slug,
        owner: { fullName: `Владелец ${name}`, login, passwordHash },
      });
    a = await org('Организация А', '01811201810456', 'org-a', 'owner-a');
    b = await org('Организация Б', '02811201810457', 'org-b', 'owner-b');
    const accRole = a.roles.find((r) => r.templateCode === 'acc')!;
    await withOrgContext(t.app.db, ownerA(), (tx) =>
      createEmployee(tx, {
        fullName: 'Коллега Тестовый',
        shortName: 'Коллега Т.',
        login: 'colleague-a',
        passwordHash,
        phone: null,
        role: { id: accRole.id, name: accRole.name },
      }),
    );
    const all = await t.admin.db.select({ id: users.id, login: users.login }).from(users);
    colleagueId = all.find((u) => u.login === 'colleague-a')!.id;
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform-admin', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('сохранить, прочитать, заменить и сбросить свой вид', async () => {
    await withOrgContext(t.app.db, ownerA(), (tx) =>
      saveViewSettings(tx, 'staff.list', { hidden: ['phone'] }),
    );
    await withOrgContext(t.app.db, ownerA(), (tx) =>
      saveViewSettings(tx, 'staff.list', { hidden: ['login'], sort: null }),
    );
    expect(await withOrgContext(t.app.db, ownerA(), listViewSettings)).toEqual({
      'staff.list': { hidden: ['login'], sort: null },
    });
    await withOrgContext(t.app.db, ownerA(), (tx) => resetViewSettings(tx, 'staff.list'));
    expect(await withOrgContext(t.app.db, ownerA(), listViewSettings)).toEqual({});
  });

  it('вид не виден другому сотруднику организации и другой организации', async () => {
    await withOrgContext(t.app.db, ownerA(), (tx) =>
      saveViewSettings(tx, 'staff.list', { density: 'compact' }),
    );
    expect(await withOrgContext(t.app.db, colleague(), listViewSettings)).toEqual({});
    expect(await withOrgContext(t.app.db, ownerB(), listViewSettings)).toEqual({});
    // Сброс чужим пользователем ничего не удаляет.
    await withOrgContext(t.app.db, colleague(), (tx) => resetViewSettings(tx, 'staff.list'));
    expect(await withOrgContext(t.app.db, ownerA(), listViewSettings)).toEqual({
      'staff.list': { density: 'compact' },
    });
  });

  it('без контекста не видно ничего и ничего не записать', async () => {
    expect(await t.app.db.select().from(viewSettings)).toEqual([]);
    await expect(
      t.app.db
        .insert(viewSettings)
        .values({ userId: a.ownerUserId, orgId: a.orgId, gridKey: 'staff.list', settings: {} }),
    ).rejects.toThrow(rlsViolation);
  });

  it('нельзя записать вид за другого пользователя или в чужую организацию', async () => {
    await expect(
      withOrgContext(t.app.db, ownerA(), (tx) =>
        tx
          .insert(viewSettings)
          .values({ userId: colleagueId, orgId: a.orgId, gridKey: 'staff.list', settings: {} }),
      ),
    ).rejects.toThrow(rlsViolation);
    await expect(
      withOrgContext(t.app.db, ownerA(), (tx) =>
        tx
          .insert(viewSettings)
          .values({ userId: a.ownerUserId, orgId: b.orgId, gridKey: 'staff.list', settings: {} }),
      ),
    ).rejects.toThrow(rlsViolation);
    // Строка без организации — только у администратора платформы, вне контекста организации.
    await expect(
      withOrgContext(t.app.db, ownerA(), (tx) =>
        tx
          .insert(viewSettings)
          .values({ userId: a.ownerUserId, orgId: null, gridKey: 'staff.list', settings: {} }),
      ),
    ).rejects.toThrow(rlsViolation);
  });

  it('у администратора платформы свои настройки без организации', async () => {
    await withUserContext(t.app.db, adminId, (tx) =>
      saveViewSettings(tx, 'admin.users', { size: 50 }),
    );
    expect(await withUserContext(t.app.db, adminId, listViewSettings)).toEqual({
      'admin.users': { size: 50 },
    });
    expect(await withOrgContext(t.app.db, ownerA(), listViewSettings)).not.toHaveProperty(
      'admin.users',
    );
    expect(await withUserContext(t.app.db, adminId, listViewSettings)).not.toHaveProperty(
      'staff.list',
    );
    const rows = await t.admin.db.select().from(viewSettings);
    expect(rows.find((r) => r.gridKey === 'admin.users')).toMatchObject({ orgId: null });
  });

  it('ключ списка и размер настроек проверяет база', async () => {
    await expect(
      withOrgContext(t.app.db, ownerA(), (tx) => saveViewSettings(tx, 'Staff List', {})),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ constraint_name: 'view_settings_grid_key_check' }),
    });
    await expect(
      withOrgContext(t.app.db, ownerA(), (tx) =>
        saveViewSettings(tx, 'staff.list', { pad: 'x'.repeat(33_000) }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ constraint_name: 'view_settings_size_check' }),
    });
  });
});
