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

  it('у каждой таблицы со столбцом org_id политика сравнивает его с организацией из контекста', async () => {
    const loose = await t.admin.sql<{ tablename: string }[]>`
      select c.table_name as tablename from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'org_id'
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.table_name
            and p.qual like '%org_id = app.current_org_id()%'
            and p.with_check like '%org_id = app.current_org_id()%'
        )`;
    expect(loose).toEqual([]);
  });

  it('функции SECURITY DEFINER: свой search_path и не исполняются кем угодно', async () => {
    const unsafe = await t.admin.sql<{ proname: string }[]>`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'public') and p.prosecdef
        and (not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
             or has_function_privilege('public', p.oid, 'execute'))`;
    expect(unsafe).toEqual([]);
  });

  // Ревью безопасности Р-21, docs/decisions.md п. О-31.
  it('функции контекста RLS встраиваются в запрос: без SET у функции', async () => {
    const fns = await t.admin.sql<{ proname: string; proconfig: string[] | null }[]>`
      select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname in ('current_org_id', 'current_user_id')
      order by p.proname`;
    expect(fns).toEqual([
      { proname: 'current_org_id', proconfig: null },
      { proname: 'current_user_id', proconfig: null },
    ]);
    // Встроенная функция в плане раскрыта в своё тело: в проверке RLS она не вызывается на каждую строку.
    const plan = await t.app.sql<{ 'QUERY PLAN': string }[]>`
      explain (verbose, costs off) select app.current_org_id(), app.current_user_id()`;
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('current_setting');
    expect(text).not.toMatch(/current_(org|user)_id\(/);
  });

  it('функции контекста RLS не подменить функцией, оператором или типом из схемы впереди пути', async () => {
    await t.admin.sql.unsafe(`
      create schema evil_path;
      create function evil_path.current_setting(text, boolean) returns text
        language sql as $$ select '${ORG_B}' $$;
      create function evil_path.always(text, text) returns boolean
        language sql immutable as $$ select true $$;
      create operator evil_path.= (leftarg = text, rightarg = text, function = evil_path.always);
      create domain evil_path.uuid as text;
      grant usage on schema evil_path to buhuchet_app;
      grant execute on all functions in schema evil_path to buhuchet_app;`);
    try {
      const rows = await t.app.sql.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${ORG_A}, true), set_config('app.user_id', '', true)`;
        await tx`set local search_path = evil_path, pg_catalog, public`;
        return tx<{ shadowed: string; org: string | null; user: string | null }[]>`
          select current_setting('app.org_id', true) as shadowed,
            app.current_org_id() as org, app.current_user_id() as user`;
      });
      // Без схемы в имени подмена срабатывает, у функций контекста — нет.
      expect(rows).toEqual([{ shadowed: ORG_B, org: ORG_A, user: null }]);
    } finally {
      await t.admin.sql`drop schema evil_path cascade`;
    }
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
