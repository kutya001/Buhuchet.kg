import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withOrgContext } from './context';
import { gkedItems, organizations, platformReference } from './schema';
import { checksumOf, DEMO_ORG_ID, seedAll, seedPlatformReference } from './seed';
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
    expect(result.demo).toEqual({ orgId: DEMO_ORG_ID, created: true });

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
    expect(result.demo?.created).toBe(false);
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
});
