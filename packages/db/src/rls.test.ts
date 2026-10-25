import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { gkedItems, organizations, platformReference, schedulerRuns } from './schema';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const ORG_A = '0b2d4e6f-0000-4000-8000-00000000000a';
const ORG_B = '0b2d4e6f-0000-4000-8000-00000000000b';

/** Ошибка именно RLS, а не любая (у drizzle она в cause). */
const rlsViolation = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
});

describe.skipIf(!databaseAvailable())('RLS: организации не видят друг друга', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
    await t.admin.db.insert(organizations).values([
      { id: ORG_A, slug: 'org-a', name: 'Организация А' },
      { id: ORG_B, slug: 'org-b', name: 'Организация Б' },
    ]);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('в контексте организации видна только она сама', async () => {
    const rows = await withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
      tx.select().from(organizations),
    );
    expect(rows.map((r) => r.id)).toEqual([ORG_A]);
  });

  it('без контекста организации не видно ничего', async () => {
    expect(await t.app.db.select().from(organizations)).toEqual([]);
  });

  it('чужую организацию нельзя изменить', async () => {
    const updated = await withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
      tx
        .update(organizations)
        .set({ name: 'Взлом' })
        .where(eq(organizations.id, ORG_B))
        .returning(),
    );
    expect(updated).toEqual([]);
    const [b] = await t.admin.db.select().from(organizations).where(eq(organizations.id, ORG_B));
    expect(b?.name).toBe('Организация Б');
  });

  it('чужую организацию нельзя удалить', async () => {
    const deleted = await withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
      tx.delete(organizations).where(eq(organizations.id, ORG_B)).returning(),
    );
    expect(deleted).toEqual([]);
    const rows = await t.admin.db.select().from(organizations).where(eq(organizations.id, ORG_B));
    expect(rows).toHaveLength(1);
  });

  it('нельзя создать запись чужой организации', async () => {
    await expect(
      withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
        tx
          .insert(organizations)
          .values({ id: '0b2d4e6f-0000-4000-8000-00000000000c', slug: 'org-c', name: 'В' }),
      ),
    ).rejects.toThrow(rlsViolation);
  });

  it('контекст живёт только внутри транзакции', async () => {
    await withOrgContext(t.app.db, { orgId: ORG_A }, async () => {});
    const [row] = await t.app.sql<{ org: string | null }[]>`select app.current_org_id() as org`;
    expect(row?.org).toBeNull();
  });

  it('роль приложения не владелец таблиц и не обходит RLS', async () => {
    const [role] = await t.app.sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await t.app.sql<{ tablename: string }[]>`
      select tablename from pg_tables
      where schemaname = 'public' and pg_has_role(current_user, tableowner, 'USAGE')`;
    expect(owned).toEqual([]);
  });

  it('RLS включён у каждой таблицы public, политики только у роли приложения', async () => {
    const withoutRls = await t.admin.sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
    expect(withoutRls).toEqual([]);
    const foreign = await t.admin.sql<{ policyname: string }[]>`
      select policyname from pg_policies
      where schemaname = 'public' and roles <> '{buhuchet_app}'::name[]`;
    expect(foreign).toEqual([]);
  });

  it('справочники платформы приложение только читает', async () => {
    await t.admin.db.insert(gkedItems).values({
      code: 'A',
      name: 'Сельское хозяйство',
      level: 'section',
      sortOrder: 1,
    });
    await t.admin.db
      .insert(platformReference)
      .values({ key: 'holidays', payload: [], checksum: 'x', source: 'test' });
    expect(await t.app.db.select().from(gkedItems)).toHaveLength(1);
    expect(await t.app.db.select().from(platformReference)).toHaveLength(1);
    expect(await t.app.db.update(gkedItems).set({ name: 'Взлом' }).returning()).toEqual([]);
    expect(await t.app.db.delete(platformReference).returning()).toEqual([]);
    await expect(
      t.app.db.insert(gkedItems).values({ code: 'B', name: 'Б', level: 'section', sortOrder: 2 }),
    ).rejects.toThrow(rlsViolation);
  });

  it('запуски задач по расписанию приложение пишет и читает', async () => {
    const slot = new Date('2026-10-18T03:00:00Z');
    await t.app.db.insert(schedulerRuns).values({ job: 'test', slot });
    expect(await t.app.db.select().from(schedulerRuns)).toHaveLength(1);
  });
});
