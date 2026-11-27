import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  cancelDmConsole,
  cleanupDmConsoleLog,
  dmConsoleTag,
  explainDmConsole,
  runDmConsole,
  type DmQuery,
} from './datamart-run';
import { createOrganization, type CreatedOrganization } from './organizations';
import { dmConsoleQueries, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const pgCode = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });
const q = (text: string, params: (string | null)[] = [], maxRows = 1000): DmQuery => ({
  text,
  params,
  maxRows,
});

// Консоль запросов «Витрины данных», этап 0, П1–П2 (миграция 0177): «Мои запросы», исполнитель консоли,
// «План запроса», «Остановить», уборка журнала. Каждая преграда базы — сама по себе, без разборщика.
describe.skipIf(!databaseAvailable())('витрина данных: консоль запросов в базе', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId = '';
  let admin2Id = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810490',
      slug: 'dmc-a',
      owner: owner('dmc-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810491',
      slug: 'dmc-b',
      owner: owner('dmc-owner-b'),
    });
    const admins = await db.admin.db
      .insert(users)
      .values([
        { login: 'dmc-platform', passwordHash: 'x', isPlatformAdmin: true },
        { login: 'dmc-platform-2', passwordHash: 'x', isPlatformAdmin: true },
      ])
      .returning({ id: users.id });
    adminId = admins[0]!.id;
    admin2Id = admins[1]!.id;
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe('«Мои запросы» (блок 4, пункт 2)', () => {
    it('видит и меняет только автор; организации и консоли таблица закрыта', async () => {
      const [mine] = await withUserContext(db.app.db, adminId, (tx) =>
        tx
          .insert(dmConsoleQueries)
          .values({ name: 'Мой запрос', query: 'select 1', params: { month: '2026-11' } })
          .returning(),
      );
      expect(mine!.authorId).toBe(adminId);
      // Другой администратор чужой строки не видит и не меняет.
      const seen = await withUserContext(db.app.db, admin2Id, (tx) =>
        tx.select().from(dmConsoleQueries),
      );
      expect(seen).toEqual([]);
      const changed = await withUserContext(db.app.db, admin2Id, (tx) =>
        tx.update(dmConsoleQueries).set({ name: 'чужое' }).returning(),
      );
      expect(changed).toEqual([]);
      // Записать от имени другого автора нельзя.
      await expect(
        withUserContext(db.app.db, admin2Id, (tx) =>
          tx.insert(dmConsoleQueries).values({ authorId: adminId, name: 'x', query: 'select 1' }),
        ),
      ).rejects.toThrow();
      // Сотрудник организации — ничего, даже владелец.
      const inOrg = await withOrgContext(
        db.app.db,
        { orgId: a.orgId, userId: a.ownerUserId },
        (tx) => tx.select().from(dmConsoleQueries),
      );
      expect(inOrg).toEqual([]);
      // Консоль (роль шаблонов Админки) таблицу не читает: права нет совсем.
      await expect(
        runDmConsole(db.app.db, adminId, q('select * from dm_console_queries')),
      ).rejects.toEqual(pgCode('42501'));
      await expect(
        runDmConsole(db.app.db, adminId, q('select count(*) from public.dm_console_queries')),
      ).rejects.toEqual(pgCode('42501'));
    });

    it('пустое название и неверные параметры база не примет', async () => {
      await expect(
        withUserContext(db.app.db, adminId, (tx) =>
          tx.insert(dmConsoleQueries).values({ name: '  ', query: 'select 1' }),
        ),
      ).rejects.toThrow();
      await expect(
        withUserContext(db.app.db, adminId, (tx) =>
          tx.insert(dmConsoleQueries).values({ name: 'x', query: 'select 1', params: [] as never }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('исполнитель консоли (блок 2, пункты 1–4)', () => {
    it('видит все организации, предел — 60 с, соединение помечено', async () => {
      const res = await runDmConsole(
        db.app.db,
        adminId,
        q(
          "select count(*)::int as n, current_setting('statement_timeout') as st, current_setting('application_name') as tag from organizations where id in ($1::uuid, $2::uuid)",
          [a.orgId, b.orgId],
        ),
      );
      expect(res.rows).toEqual([[2, '1min', dmConsoleTag(adminId)]]);
    });

    it('секреты закрыты, запись не идёт, смена роли не идёт', async () => {
      await expect(
        runDmConsole(db.app.db, adminId, q('select password_hash from users')),
      ).rejects.toEqual(pgCode('42501'));
      await expect(runDmConsole(db.app.db, adminId, q('select * from sessions'))).rejects.toEqual(
        pgCode('42501'),
      );
      await expect(
        runDmConsole(db.app.db, adminId, q('select * from dm_template_sql')),
      ).rejects.toEqual(pgCode('42501'));
      // Подзапросом запись не пройдёт: база видит DML внутри SELECT * FROM (…) как ошибку разбора.
      await expect(
        runDmConsole(db.app.db, adminId, q('delete from organizations returning id')),
      ).rejects.toEqual(pgCode('42601'));
      await expect(
        runDmConsole(db.app.db, adminId, q("select set_config('role', 'buhuchet_app', true)")),
      ).rejects.toThrow();
    });

    it('предел строк: 1 000 на экран, «ещё есть»', async () => {
      const res = await runDmConsole(
        db.app.db,
        adminId,
        q('select g from generate_series(1, 1500) g'),
      );
      expect(res.rows).toHaveLength(1000);
      expect(res.more).toBe(true);
    });

    it('не администратор платформы консоль не запустит', async () => {
      await expect(runDmConsole(db.app.db, a.ownerUserId, q('select 1'))).rejects.toEqual(
        pgCode('42501'),
      );
    });
  });

  describe('«План запроса» (блок 1, пункт 3)', () => {
    it('оценка без выполнения: pg_sleep(30) не ждёт, в плане нет замеров', async () => {
      const plan = (await explainDmConsole(db.app.db, adminId, {
        text: 'select pg_sleep(30), count(*) from organizations where id = $1::uuid',
        params: [a.orgId],
      })) as { Plan: { 'Node Type': string } }[];
      expect(plan[0]!.Plan['Node Type']).toBeTruthy();
      // Без ANALYZE: замеров выполнения в плане нет.
      expect(JSON.stringify(plan)).not.toContain('Actual Total Time');
    });

    it('«;» второй оператор не выполнит: курсор принимает ровно один', async () => {
      await expect(
        explainDmConsole(db.app.db, adminId, {
          text: "select 1) x; select set_config('application_name', 'buhuchet_dm_console:x', false); select * from (select 1",
          params: [],
        }),
        // «cannot open multi-query plan as cursor»: без курсора EXECUTE выполнил бы все три.
      ).rejects.toEqual(pgCode('42P11'));
    });

    it('секретное и не администратор — отказ', async () => {
      await expect(
        explainDmConsole(db.app.db, adminId, {
          text: 'select password_hash from users',
          params: [],
        }),
      ).rejects.toEqual(pgCode('42501'));
      await expect(
        explainDmConsole(db.app.db, a.ownerUserId, { text: 'select 1', params: [] }),
      ).rejects.toEqual(pgCode('42501'));
    });
  });

  describe('«Остановить» (блок 2, пункт 3)', () => {
    it('отменяет только свой запрос консоли', async () => {
      // Отказ ловим сразу: иначе отмена, пришедшая раньше `await`, — «необработанный отказ» vitest.
      const running = runDmConsole(db.app.db, adminId, q('select pg_sleep(20)')).then(
        () => null,
        (err: unknown) => err,
      );
      // Ждём, пока сам запрос (а не подготовка запуска) ждёт в базе с меткой.
      await expect
        .poll(
          async () =>
            (
              await db.admin.db.execute<{ n: number }>(
                sql`select count(*)::int as n from pg_stat_activity where application_name = ${dmConsoleTag(adminId)} and wait_event = 'PgSleep'`,
              )
            )[0]!.n,
          { timeout: 15_000 },
        )
        .toBe(1);
      // Другой администратор чужой запрос не остановит.
      expect(await cancelDmConsole(db.app.db, admin2Id)).toBe(0);
      expect(await cancelDmConsole(db.app.db, adminId)).toBe(1);
      expect(await running).toEqual(pgCode('57014'));
      // Нечего останавливать — 0.
      expect(await cancelDmConsole(db.app.db, adminId)).toBe(0);
    });

    it('сотрудник организации — отказ', async () => {
      await expect(
        withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
          tx.execute(sql`select app.dm_console_cancel()`),
        ),
      ).rejects.toEqual(pgCode('42501'));
    });
  });

  describe('журнал консоли хранится год (блок 2, пункт 9)', () => {
    it('задача убирает только строки консоли старше года; приложение удалить не может', async () => {
      await db.admin.db.execute(sql`
        insert into platform_audit_log (entity, entity_id, action, actor_user_id, at) values
          ('dm_console', 'old', 'dm_console_run', ${adminId}, now() - interval '1 year 1 day'),
          ('dm_console', 'fresh', 'dm_console_run', ${adminId}, now() - interval '364 days'),
          ('dm_template', 'other', 'dm_state', ${adminId}, now() - interval '2 years')`);
      expect(await cleanupDmConsoleLog(db.app.db)).toBe(1);
      expect(await cleanupDmConsoleLog(db.app.db)).toBe(0);
      const left = await db.admin.db.execute<{ entity_id: string }>(
        sql`select entity_id from platform_audit_log where entity_id in ('old', 'fresh', 'other') order by 1`,
      );
      expect(left.map((r) => r.entity_id)).toEqual(['fresh', 'other']);
      await expect(
        withUserContext(db.app.db, adminId, (tx) =>
          tx.execute(sql`delete from platform_audit_log where entity = 'dm_console'`),
        ),
      ).rejects.toEqual(pgCode('42501'));
    });
  });
});
