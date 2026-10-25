import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withOrgContext } from './context';
import { verifyPassword } from '@buhuchet/adapters/password';
import { eq } from 'drizzle-orm';
import { employees, gkedItems, organizations, platformReference, roles, users } from './schema';
import {
  checksumOf,
  DEMO_ORG_ID,
  demoId,
  seedAll,
  seedPermissions,
  seedPlatformReference,
} from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

describe('checksumOf', () => {
  it('не зависит от порядка ключей', () => {
    expect(checksumOf({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      checksumOf({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
    expect(checksumOf({ a: 1 })).not.toBe(checksumOf({ a: 2 }));
  });
});

describe.skipIf(!databaseAvailable())('начальное наполнение из spec/data', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('заливает справочники платформы, ГКЭД и демо-организацию', async () => {
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    const gked = await readSpecJson<{ items: unknown[] }>('data/gkedDB.json');
    const result = await seedAll(t.admin.db, { update: false, demo: true });
    expect(result.platformReference.inserted).toBe(Object.keys(refDB).length);
    expect(result.gked.inserted).toBe(gked.items.length);
    expect(result.demo).toEqual({ orgId: DEMO_ORG_ID, created: true, employees: 7 });
    expect(result.permissions.inserted).toBe(39);
    expect(result.roleTemplates.inserted).toBe(2);

    const [reportTypes] = await t.admin.db
      .select()
      .from(platformReference)
      .where(sql`${platformReference.key} = 'reportTypes'`);
    expect(Array.isArray(reportTypes?.payload)).toBe(true);
    expect(
      await t.admin.db.$count(gkedItems, sql`${gkedItems.level} = 'subclass'`),
    ).toBeGreaterThan(0);
  });

  it('повторный запуск ничего не дублирует и не меняет', async () => {
    const result = await seedAll(t.admin.db, { update: true, demo: true });
    expect(result.platformReference.inserted).toBe(0);
    expect(result.platformReference.updated).toBe(0);
    expect(result.gked).toMatchObject({ inserted: 0, updated: 0 });
    expect(result.permissions).toEqual({ inserted: 0, updated: 0, unchanged: 39 });
    expect(result.roleTemplates).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect(result.demo).toMatchObject({ created: false, employees: 0 });
  });

  it('изменённый раздел обновляется только с --update и повышает версию', async () => {
    const changed = { holidays: { '2026': ['2026-01-01'] } };
    const quiet = await seedPlatformReference(t.admin.db, changed, 'test', { update: false });
    expect(quiet).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    const loud = await seedPlatformReference(t.admin.db, changed, 'test', { update: true });
    expect(loud.updated).toBe(1);
    const [row] = await t.admin.db
      .select()
      .from(platformReference)
      .where(sql`${platformReference.key} = 'holidays'`);
    expect(row?.version).toBe(2);
    expect(row?.source).toBe('test');
  });

  it('справочники платформы читаются ролью приложения, демо-организация — только в своём контексте', async () => {
    expect(await t.app.db.$count(platformReference)).toBeGreaterThan(0);
    expect(await t.app.db.$count(gkedItems)).toBeGreaterThan(1000);
    const own = await withOrgContext(t.app.db, { orgId: DEMO_ORG_ID }, (tx) =>
      tx.select().from(organizations),
    );
    expect(own[0]?.slug).toBe('buhgalter-plyus');
  });

  it('демо-сотрудники: роли из demoDB.json, вход паролем DEMO_PASSWORD только после --update с паролем', async () => {
    const staff = await withOrgContext(t.app.db, { orgId: DEMO_ORG_ID }, (tx) =>
      tx
        .select({
          login: users.login,
          role: roles.name,
          isOwner: roles.isOwner,
          active: employees.active,
        })
        .from(employees)
        .innerJoin(users, eq(users.id, employees.userId))
        .innerJoin(roles, eq(roles.id, employees.roleId))
        .orderBy(users.login),
    );
    expect(staff).toHaveLength(7);
    expect(staff.find((e) => e.login === 'erkin')).toMatchObject({ isOwner: true });
    expect(staff.find((e) => e.login === 'meerim')?.role).toBe('Главный бухгалтер');
    expect(staff.find((e) => e.login === 'bakyt')).toMatchObject({
      role: 'Бухгалтер',
      active: false,
    });

    const hashOf = async () =>
      (
        await t.admin.db
          .select()
          .from(users)
          .where(eq(users.id, demoId('user', 'e3')))
      )[0]!.passwordHash;
    expect(await verifyPassword(await hashOf(), 'demo')).toBe(false);
    await seedAll(t.admin.db, { update: true, demo: true, demoPassword: 'demo' });
    expect(await verifyPassword(await hashOf(), 'demo')).toBe(true);
  });

  it('каталог прав из refDB.json должен совпадать с системным', async () => {
    const refDB = await readSpecJson<{ permissions: { id: string }[] }>('data/refDB.json');
    const extra = [...refDB.permissions, { id: 'newRight', group: 'cps', name: 'Новое', desc: '' }];
    await expect(seedPermissions(t.admin.db, extra, { update: true })).rejects.toThrow(
      /расходится/,
    );
  });
});
