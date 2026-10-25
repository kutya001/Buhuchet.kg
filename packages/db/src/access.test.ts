import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { orgIds } from './organizations';
import {
  employees,
  organizations,
  orgSettings,
  permissions,
  rolePermissions,
  roleScopes,
  roles,
  roleTemplates,
  users,
} from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const ORG_A = '0b2d4e6f-0000-4000-8000-00000000000a';
const ORG_B = '0b2d4e6f-0000-4000-8000-00000000000b';
const ROLE_A = '0b2d4e6f-0000-4000-8001-00000000000a';
const ROLE_B = '0b2d4e6f-0000-4000-8001-00000000000b';
const USER_A = '0b2d4e6f-0000-4000-8002-00000000000a';
const USER_B = '0b2d4e6f-0000-4000-8002-00000000000b';

const rlsViolation = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
});
const fkViolation = expect.objectContaining({
  cause: expect.objectContaining({ code: '23503' }),
});

describe.skipIf(!databaseAvailable())('RLS: сотрудники, роли и учётные записи', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(t.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(t.admin.db, refDB.roleTemplates, { update: false });
    const db = t.admin.db;
    await db.insert(organizations).values([
      { id: ORG_A, slug: 'org-a', name: 'Организация А' },
      { id: ORG_B, slug: 'org-b', name: 'Организация Б' },
    ]);
    for (const [org, role, user, login] of [
      [ORG_A, ROLE_A, USER_A, 'user-a'],
      [ORG_B, ROLE_B, USER_B, 'user-b'],
    ] as const) {
      await db.insert(roles).values({ id: role, orgId: org, name: 'Бухгалтер' });
      await db.insert(rolePermissions).values({ orgId: org, roleId: role, permissionId: 'cpView' });
      await db
        .insert(roleScopes)
        .values({ orgId: org, roleId: role, permGroup: 'cps', scope: 'own' });
      await db.insert(users).values({ id: user, orgId: org, login, passwordHash: '!' });
      await db
        .insert(employees)
        .values({ orgId: org, userId: user, fullName: login, shortName: login, roleId: role });
      await db.insert(orgSettings).values({ orgId: org, features: { tasks: true } });
    }
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('сотрудник организации А не видит сотрудников и роли организации Б', async () => {
    const seen = await withOrgContext(t.app.db, { orgId: ORG_A, userId: USER_A }, async (tx) => ({
      employees: await tx.select().from(employees),
      roles: await tx.select().from(roles),
      rolePermissions: await tx.select().from(rolePermissions),
      roleScopes: await tx.select().from(roleScopes),
      users: await tx.select().from(users),
      orgSettings: await tx.select().from(orgSettings),
    }));
    for (const rows of Object.values(seen)) {
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.orgId === ORG_A)).toBe(true);
    }
  });

  it('без контекста организации не видно ни сотрудников, ни учётных записей', async () => {
    expect(await t.app.db.select().from(employees)).toEqual([]);
    expect(await t.app.db.select().from(users)).toEqual([]);
    expect(await t.app.db.select().from(roles)).toEqual([]);
  });

  it('чужую роль и чужого сотрудника нельзя изменить', async () => {
    const changed = await withOrgContext(t.app.db, { orgId: ORG_A }, async (tx) => [
      ...(await tx.update(roles).set({ name: 'Взлом' }).where(eq(roles.id, ROLE_B)).returning()),
      ...(await tx.update(users).set({ blocked: true }).where(eq(users.id, USER_B)).returning()),
      ...(await tx.delete(employees).where(eq(employees.orgId, ORG_B)).returning()),
    ]);
    expect(changed).toEqual([]);
    const [roleB] = await t.admin.db.select().from(roles).where(eq(roles.id, ROLE_B));
    expect(roleB?.name).toBe('Бухгалтер');
  });

  it('нельзя создать учётную запись или роль в чужой организации', async () => {
    await expect(
      withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
        tx.insert(users).values({ orgId: ORG_B, login: 'intruder', passwordHash: '!' }),
      ),
    ).rejects.toThrow(rlsViolation);
    await expect(
      withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
        tx.insert(roles).values({ orgId: ORG_B, name: 'Чужая' }),
      ),
    ).rejects.toThrow(rlsViolation);
  });

  it('сотрудника нельзя связать с ролью или учётной записью другой организации', async () => {
    await expect(
      withOrgContext(t.app.db, { orgId: ORG_A }, async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ orgId: ORG_A, login: 'new-a', passwordHash: '!' })
          .returning({ id: users.id });
        await tx
          .insert(employees)
          .values({ orgId: ORG_A, userId: u!.id, fullName: 'Н', shortName: 'Н', roleId: ROLE_B });
      }),
    ).rejects.toThrow(fkViolation);
    const [looseB] = await t.admin.db
      .insert(users)
      .values({ orgId: ORG_B, login: 'loose-b', passwordHash: '!' })
      .returning({ id: users.id });
    await expect(
      withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
        tx
          .insert(employees)
          .values({
            orgId: ORG_A,
            userId: looseB!.id,
            fullName: 'Н',
            shortName: 'Н',
            roleId: ROLE_A,
          }),
      ),
    ).rejects.toThrow(fkViolation);
    await expect(
      withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
        tx
          .insert(rolePermissions)
          .values({ orgId: ORG_A, roleId: ROLE_B, permissionId: 'repView' }),
      ),
    ).rejects.toThrow(fkViolation);
  });

  it('логин уникален на платформе без учёта регистра; у организации одна роль владельца', async () => {
    await expect(
      t.admin.db.insert(users).values({ orgId: ORG_B, login: 'USER-A', passwordHash: '!' }),
    ).rejects.toThrow();
    await t.admin.db.insert(roles).values({ orgId: ORG_A, name: 'Владелец', isOwner: true });
    await expect(
      t.admin.db.insert(roles).values({ orgId: ORG_A, name: 'Второй владелец', isOwner: true }),
    ).rejects.toThrow();
  });

  it('у администратора платформы нет организации, у сотрудника — обязательно есть', async () => {
    await t.admin.db
      .insert(users)
      .values({ login: 'platform-admin', passwordHash: '!', isPlatformAdmin: true });
    await expect(
      t.admin.db.insert(users).values({ login: 'nobody', passwordHash: '!' }),
    ).rejects.toThrow();
    // Ролью приложения администратора не видно ни в одной организации.
    const visible = await withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
      tx.select({ login: users.login }).from(users),
    );
    expect(visible.map((u) => u.login)).not.toContain('platform-admin');
  });

  it('каталог прав и шаблоны ролей приложение только читает', async () => {
    expect(await t.app.db.$count(permissions)).toBe(39);
    expect(await t.app.db.$count(roleTemplates)).toBe(2);
    expect(await t.app.db.update(permissions).set({ name: 'Взлом' }).returning()).toEqual([]);
    await expect(
      t.app.db
        .insert(roleTemplates)
        .values({ code: 'x', name: 'X', permissions: [], scopes: {}, sortOrder: 9 }),
    ).rejects.toThrow(rlsViolation);
  });

  it('app.org_ids() отдаёт роли приложения все организации для задач по расписанию', async () => {
    expect(await orgIds(t.app.db)).toEqual([ORG_A, ORG_B]);
    const [fn] = await t.admin.sql<{ prosecdef: boolean; public_exec: boolean }[]>`
      select p.prosecdef, has_function_privilege('public', p.oid, 'execute') as public_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'org_ids'`;
    expect(fn).toEqual({ prosecdef: true, public_exec: false });
  });
});
