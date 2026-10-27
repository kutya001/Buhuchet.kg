import { hashPassword } from '@buhuchet/adapters/password';
import { SCOPE_GROUPS } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { lockRole } from './roles';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { roleAccess, roleRightsMap } from './staff';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

describe.skipIf(!databaseAvailable())('роль для решения о сотруднике (roleAccess)', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  const ctx = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const accRoleId = () => a.roles.find((r) => r.templateCode === 'acc')!.id;

  beforeAll(async () => {
    t = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(t.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(t.admin.db, refDB.roleTemplates, { update: false });
    a = await createOrganization(t.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'org-a',
      owner: {
        fullName: 'Владелец Организации',
        login: 'owner-a',
        passwordHash: await hashPassword('Bh-4821-temp'),
      },
    });
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('права и область роли; у роли владельца — «Все» везде', async () => {
    const acc = await withOrgContext(t.app.db, ctx(), (tx) => roleAccess(tx, accRoleId()));
    expect(acc).toMatchObject({ name: 'Бухгалтер', isOwner: false });
    expect(acc!.permissions).toContain('cpView');
    expect(Object.values(acc!.scopes)).toEqual(SCOPE_GROUPS.map(() => 'own'));
    const ownerRoleId = a.roles.find((r) => r.isOwner)!.id;
    const owner = await withOrgContext(t.app.db, ctx(), (tx) => roleAccess(tx, ownerRoleId));
    expect(owner).toMatchObject({ isOwner: true, permissions: [] });
    expect(Object.values(owner!.scopes)).toEqual(SCOPE_GROUPS.map(() => 'all'));
  });

  it('права и область нескольких ролей сразу — как у roleAccess (roleRightsMap)', async () => {
    const ownerRoleId = a.roles.find((r) => r.isOwner)!.id;
    const unknown = '00000000-0000-4000-8000-000000000000';
    const [map, acc, owner, empty] = await withOrgContext(t.app.db, ctx(), async (tx) => [
      await roleRightsMap(tx, [accRoleId(), ownerRoleId, accRoleId(), unknown]),
      await roleAccess(tx, accRoleId()),
      await roleAccess(tx, ownerRoleId),
      await roleRightsMap(tx, []),
    ]);
    expect([...map.keys()].sort()).toEqual([accRoleId(), ownerRoleId].sort());
    expect(map.get(accRoleId())).toEqual({
      isOwner: false,
      permissions: acc!.permissions,
      scopes: acc!.scopes,
    });
    expect(map.get(ownerRoleId)).toEqual({ isOwner: true, permissions: [], scopes: owner!.scopes });
    expect(empty.size).toBe(0);
  });

  it('пока роль правят (lockRole), решение по ней ждёт сохранения правки', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const editing = withOrgContext(t.app.db, ctx(), async (tx) => {
      await lockRole(tx, accRoleId());
      locked();
      await held;
    });
    await isLocked;
    await expect(
      withOrgContext(t.app.db, ctx(), async (tx) => {
        await tx.execute(sql`set local lock_timeout = '200ms'`);
        return roleAccess(tx, accRoleId());
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/lock timeout/) }),
    });
    release();
    await editing;
    expect(
      await withOrgContext(t.app.db, ctx(), (tx) => roleAccess(tx, accRoleId())),
    ).not.toBeNull();
  });
});
