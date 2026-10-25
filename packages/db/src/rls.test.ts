import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { organizations } from './schema';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const ORG_A = '0b2d4e6f-0000-4000-8000-00000000000a';
const ORG_B = '0b2d4e6f-0000-4000-8000-00000000000b';

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

  it('нельзя создать запись чужой организации', async () => {
    await expect(
      withOrgContext(t.app.db, { orgId: ORG_A }, (tx) =>
        tx
          .insert(organizations)
          .values({ id: '0b2d4e6f-0000-4000-8000-00000000000c', slug: 'org-c', name: 'В' }),
      ),
    ).rejects.toThrow();
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
    const [owner] = await t.app.sql<{ owner: string }[]>`
      select tableowner as owner from pg_tables where tablename = 'organizations'`;
    const [me] = await t.app.sql<{ me: string }[]>`select current_user as me`;
    expect(owner?.owner).not.toBe(me?.me);
  });
});
