import { verifyPassword, hashPassword } from '@buhuchet/adapters/password';
import { effectivePermissions, PERMISSION_IDS, type PermissionId } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import {
  createOrganization,
  OrganizationInputError,
  type CreateOrganizationInput,
} from './organizations';
import {
  employees,
  orgSettings,
  rolePermissions,
  roleScopes,
  roleTemplates,
  users,
} from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

describe.skipIf(!databaseAvailable())('создание организации и владельца', () => {
  let t: TestDatabase;
  let passwordHash: string;

  const input = (over: Partial<CreateOrganizationInput> = {}): CreateOrganizationInput => ({
    name: 'ОсОО «Финконсалт Ош»',
    inn: '01811201810456',
    slug: 'finkonsalt-osh',
    owner: { fullName: 'Токтомаматов Бекзат', login: ' B.Toktomamatov ', passwordHash },
    ...over,
  });

  beforeAll(async () => {
    t = await createTestDatabase();
    passwordHash = await hashPassword('Bh-4821-temp');
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(t.admin.db, refDB.permissions, { update: false });
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('без шаблонов ролей платформы организация не создаётся', async () => {
    await expect(createOrganization(t.app.db, input())).rejects.toThrow(OrganizationInputError);
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedRoleTemplates(t.admin.db, refDB.roleTemplates, { update: false });
  });

  it('ролью приложения под RLS: роли из ТЗ, владелец с временным паролем, учётная политика', async () => {
    const org = await createOrganization(t.app.db, input());
    expect(org.roles.map((r) => [r.name, r.isOwner, r.templateCode])).toEqual([
      ['Владелец организации', true, null],
      ['Главный бухгалтер', false, 'chief'],
      ['Бухгалтер', false, 'acc'],
    ]);

    const data = await withOrgContext(t.app.db, { orgId: org.orgId }, async (tx) => ({
      perms: await tx.select().from(rolePermissions),
      scopes: await tx.select().from(roleScopes),
      user: (await tx.select().from(users))[0]!,
      employee: (await tx.select().from(employees))[0]!,
      settings: (await tx.select().from(orgSettings))[0]!,
    }));
    const permsOf = (roleId: string) =>
      new Set(
        data.perms.filter((p) => p.roleId === roleId).map((p) => p.permissionId as PermissionId),
      );
    const scopesOf = (roleId: string) =>
      Object.fromEntries(
        data.scopes.filter((s) => s.roleId === roleId).map((s) => [s.permGroup, s.scope]),
      );
    const [owner, chief, acc] = org.roles as [
      (typeof org.roles)[0],
      (typeof org.roles)[0],
      (typeof org.roles)[0],
    ];

    // Владелец имеет все 39 прав — по признаку роли, без перечня прав.
    expect(permsOf(owner.id).size).toBe(0);
    expect(
      effectivePermissions({
        employeeId: org.ownerEmployeeId,
        isOwner: true,
        permissions: permsOf(owner.id),
        scopes: {},
      }),
    ).toHaveLength(39);

    const [template] = await t.admin.db
      .select()
      .from(roleTemplates)
      .where(eq(roleTemplates.code, 'chief'));
    expect([...permsOf(chief.id)].sort()).toEqual([...template!.permissions].sort());
    expect(PERMISSION_IDS.filter((p) => !permsOf(chief.id).has(p))).toEqual([
      'cpArchive',
      'archiveRest',
      'staff',
      'org',
      'rollback',
    ]);
    expect(new Set(Object.values(scopesOf(chief.id)))).toEqual(new Set(['all']));
    expect(permsOf(acc.id).size).toBe(14);
    expect(Object.keys(scopesOf(acc.id))).toHaveLength(6);
    expect(new Set(Object.values(scopesOf(acc.id)))).toEqual(new Set(['own']));

    expect(data.user).toMatchObject({
      login: 'b.toktomamatov',
      mustChangePassword: true,
      orgId: org.orgId,
    });
    expect(await verifyPassword(data.user.passwordHash, 'Bh-4821-temp')).toBe(true);
    expect(data.employee).toMatchObject({
      id: org.ownerEmployeeId,
      fullName: 'Токтомаматов Бекзат',
      shortName: 'Бекзат Т.',
      roleId: owner.id,
      active: true,
    });
    expect(data.settings).toMatchObject({
      remindDays: [7, 3],
      digestTime: '09:00:00',
      defaultRoleId: acc.id,
      taskConfirm: true,
      reportConfirm: true,
      payBeforeSubmit: true,
    });
    expect(data.settings.features).toMatchObject({
      tasks: true,
      files: true,
      fee: false,
      cppage: false,
    });
  });

  it('второй организации с тем же ИНН, адресом или логином владельца не будет', async () => {
    const other = { name: 'Другая', inn: '01811201810999', slug: 'drugaya' };
    const login = { fullName: 'Другой', passwordHash };
    await expect(
      createOrganization(
        t.app.db,
        input({ ...other, inn: '01811201810456', owner: { ...login, login: 'x-1' } }),
      ),
    ).rejects.toMatchObject({ field: 'inn' });
    await expect(
      createOrganization(
        t.app.db,
        input({ ...other, slug: 'finkonsalt-osh', owner: { ...login, login: 'x-2' } }),
      ),
    ).rejects.toMatchObject({ field: 'slug' });
    await expect(
      createOrganization(
        t.app.db,
        input({ ...other, owner: { ...login, login: 'B.TOKTOMAMATOV' } }),
      ),
    ).rejects.toMatchObject({ field: 'ownerLogin', message: 'Логин уже занят' });
  });

  it('неверные данные отклоняются до записи в базу', async () => {
    const bad: [Partial<CreateOrganizationInput>, OrganizationInputError['field']][] = [
      [{ name: '  ' }, 'name'],
      [{ inn: '123' }, 'inn'],
      [{ slug: 'Не латиница' }, 'slug'],
      [{ owner: { fullName: '', login: 'ok-login', passwordHash: 'x' } }, 'ownerFullName'],
      [{ owner: { fullName: 'Ф', login: 'эр', passwordHash: 'x' } }, 'ownerLogin'],
    ];
    for (const [over, field] of bad) {
      await expect(createOrganization(t.app.db, input(over))).rejects.toMatchObject({ field });
    }
  });
});
