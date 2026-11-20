import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  DM_ADMIN_ONLY_TABLES,
  DM_CLOSED_TABLES,
  DM_PLATFORM_TABLES,
  DM_SECRET_COLUMNS,
} from './datamart-roles';
import { dmErrorOf, runDmAdmin, runDmOrg, type DmQuery, type DmResult } from './datamart-run';
import { queryTimedOut } from './errors';
import { createOrganization, type CreatedOrganization } from './organizations';
import { users } from './schema';
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

// «Витрина данных», блок 8 (миграция 0166, этап 0, П6): роли базы только для чтения и исполнитель.
// Каждая преграда проверяется сама по себе — без проверки текста запроса (она — этап 2).
describe.skipIf(!databaseAvailable())('витрина данных: роли базы и исполнитель запросов', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId = '';
  /** Ответ исполнителя и его строки объектами «столбец → значение» — для проверок. */
  const withObjs = (r: DmResult) => ({
    ...r,
    objs: r.rows.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))),
  });
  const inA = async (query: DmQuery) =>
    withObjs(await runDmOrg(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, query));
  const asAdmin = async (query: DmQuery) => withObjs(await runDmAdmin(db.app.db, adminId, query));
  /** Таблицы схемы public: имя, есть ли org_id. */
  let tables: { name: string; hasOrg: boolean }[] = [];

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810480',
      slug: 'dmr-a',
      owner: owner('dmr-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810481',
      slug: 'dmr-b',
      owner: owner('dmr-owner-b'),
    });
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'dmr-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    tables = (
      await db.admin.db.execute<{ name: string; has_org: boolean }>(sql`
        select c.relname as name,
          exists (select 1 from pg_attribute x where x.attrelid = c.oid and x.attname = 'org_id'
            and not x.attisdropped) as has_org
        from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        order by 1`)
    ).map((r) => ({ name: r.name, hasOrg: r.has_org }));
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe('какие таблицы и столбцы открыты ролям (блок 8, пункт 3)', () => {
    it('каждая таблица разобрана: закрыта, только Админке, справочник платформы или таблица организации', () => {
      const listed = new Set<string>([
        ...DM_CLOSED_TABLES,
        ...DM_ADMIN_ONLY_TABLES,
        ...DM_PLATFORM_TABLES,
      ]);
      const names = new Set(tables.map((t) => t.name));
      // В списках нет устаревших имён.
      expect([...listed].filter((n) => !names.has(n))).toEqual([]);
      for (const c of DM_SECRET_COLUMNS) expect(names.has(c.split('.')[0]!), c).toBe(true);
      // Новая таблица без org_id попадает в один из списков той же миграцией, что её создаёт.
      const unsorted = tables.filter(
        (t) => !listed.has(t.name) && !t.hasOrg && t.name !== 'organizations',
      );
      expect(unsorted.map((t) => t.name)).toEqual([]);
      // Справочник платформы — без организации.
      expect(
        tables.filter((t) => t.hasOrg && DM_PLATFORM_TABLES.includes(t.name as never)),
      ).toEqual([]);
    });

    it('права ролей совпадают со списками: закрытые таблицы и секретные столбцы не видны никому', async () => {
      const rows = await db.admin.db.execute<{
        tbl: string;
        col: string;
        org: boolean;
        adm: boolean;
      }>(sql`
        select c.relname as tbl, a.attname as col,
          has_column_privilege('buhuchet_dm_org', c.oid, a.attname, 'SELECT') as org,
          has_column_privilege('buhuchet_dm_admin', c.oid, a.attname, 'SELECT') as adm
        from pg_class c
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`);
      const closed = new Set<string>(DM_CLOSED_TABLES);
      const adminOnly = new Set<string>(DM_ADMIN_ONLY_TABLES);
      const secret = new Set<string>(DM_SECRET_COLUMNS);
      const wrong = rows.filter((r) => {
        const hidden = closed.has(r.tbl) || secret.has(`${r.tbl}.${r.col}`);
        const wantAdm = !hidden;
        const wantOrg = !hidden && !adminOnly.has(r.tbl);
        return r.adm !== wantAdm || r.org !== wantOrg;
      });
      expect(wrong).toEqual([]);
    });

    it('роли только читают: без входа, без обхода RLS, без записи, без схемы app и права создавать', async () => {
      const [r] = await db.admin.db.execute<Record<string, unknown>>(sql`
        select
          (select count(*)::int from pg_roles where rolname like 'buhuchet_dm_%'
            and (rolcanlogin or rolbypassrls or rolsuper or rolcreaterole or rolcreatedb or rolinherit)) as strong,
          (select count(*)::int from pg_auth_members m join pg_roles r on r.oid = m.member
            where r.rolname like 'buhuchet_dm_%') as member_of,
          (select count(*)::int from pg_auth_members m join pg_roles r on r.oid = m.roleid
            join pg_roles u on u.oid = m.member
            where r.rolname like 'buhuchet_dm_%'
              and u.rolname in ('buhuchet_app', ${decodeURIComponent(new URL(db.appUrl).username)})) as app_member,
          (select count(*)::int from pg_class c, unnest(array['buhuchet_dm_org', 'buhuchet_dm_admin']) role
            where c.relnamespace in ('public'::regnamespace, 'dm'::regnamespace)
              and c.relkind in ('r', 'p', 'v', 'm', 'S')
              and (has_table_privilege(role, c.oid, 'INSERT') or has_table_privilege(role, c.oid, 'UPDATE')
                or has_table_privilege(role, c.oid, 'DELETE') or has_table_privilege(role, c.oid, 'TRUNCATE'))) as writes,
          has_schema_privilege('buhuchet_dm_org', 'app', 'USAGE') or has_schema_privilege('buhuchet_dm_admin', 'app', 'USAGE') as app_schema,
          has_schema_privilege('buhuchet_dm_org', 'public', 'CREATE') or has_schema_privilege('buhuchet_dm_org', 'dm', 'CREATE')
            or has_schema_privilege('buhuchet_dm_admin', 'public', 'CREATE') or has_schema_privilege('buhuchet_dm_admin', 'dm', 'CREATE') as can_create,
          has_function_privilege('buhuchet_dm_org', 'dm.run_org(text, jsonb, integer)', 'EXECUTE')
            or has_function_privilege('buhuchet_dm_org', 'dm.begin_org()', 'EXECUTE')
            or has_function_privilege('buhuchet_dm_admin', 'dm.run_admin(text, jsonb, integer)', 'EXECUTE')
            or has_function_privilege('buhuchet_dm_admin', 'dm.begin_admin()', 'EXECUTE') as call_dm`);
      expect(r).toEqual({
        strong: 0,
        member_of: 0,
        app_member: 0,
        writes: 0,
        app_schema: false,
        can_create: false,
        call_dm: false,
      });
      // Роль приложения не становится ролью Витрины сама — только через функции исполнителя.
      await expect(
        withOrgContext(db.app.db, { orgId: a.orgId }, (tx) =>
          tx.execute(sql`set local role buhuchet_dm_org`),
        ),
      ).rejects.toEqual(pgCode('42501'));
    });
  });

  describe('организация видит только свои строки (блок 8, пункты 4 и 8)', () => {
    it('на каждой таблице организации под ролью организации — ни одной строки организации Б', async () => {
      const own = tables.filter(
        (t) =>
          (t.hasOrg || t.name === 'organizations') &&
          !DM_CLOSED_TABLES.includes(t.name as never) &&
          !DM_ADMIN_ONLY_TABLES.includes(t.name as never),
      );
      const col = (t: string) => (t === 'organizations' ? 'id' : 'org_id');
      const union = own
        .map(
          (t) =>
            `SELECT '${t.name}' AS t, count(*) FILTER (WHERE ${col(t.name)} = $1::uuid)::int AS foreign_rows, count(*)::int AS all_rows FROM (SELECT ${col(t.name)} FROM public.${t.name}) x`,
        )
        .join(' UNION ALL ');
      const seen = await inA(q(union, [b.orgId]));
      expect(seen.objs.filter((r) => r.foreign_rows !== 0)).toEqual([]);
      // Проверка не пустая: у организации Б есть строки во многих из этих таблиц, Админка их видит.
      const adm = await asAdmin(q(union, [b.orgId]));
      const withB = adm.objs.filter((r) => (r.foreign_rows as number) > 0).map((r) => r.t);
      expect(withB.length).toBeGreaterThanOrEqual(5);
      expect(withB).toEqual(expect.arrayContaining(['organizations', 'users', 'employees']));
    });

    it('организация видит одну свою организацию и справочники платформы; Админка — все организации', async () => {
      expect((await inA(q('SELECT id FROM organizations'))).objs).toEqual([{ id: a.orgId }]);
      const adm = await asAdmin(q('SELECT id FROM organizations ORDER BY id'));
      expect(adm.objs.map((r) => r.id).sort()).toEqual([a.orgId, b.orgId].sort());
      const perms = await inA(q('SELECT count(*)::int AS n FROM permissions'));
      expect(perms.objs[0]!.n).toBeGreaterThan(0);
      // Администратор платформы (без организации) роли организации не виден.
      expect(
        (await inA(q('SELECT count(*)::int AS n FROM users WHERE org_id IS NULL'))).objs,
      ).toEqual([{ n: 0 }]);
    });

    it('смена организации изнутри запроса не действует: политики смотрят на запуск, а не на настройки', async () => {
      const r = await inA(
        q(
          `SELECT s.v, (SELECT count(*)::int FROM organizations o WHERE o.id::text = s.v) AS n
           FROM (SELECT set_config('app.org_id', $1, true) AS v OFFSET 0) s`,
          [b.orgId],
        ),
      );
      expect(r.objs).toEqual([{ v: b.orgId, n: 0 }]);
      await expect(inA(q('SELECT app.current_org_id() AS o'))).rejects.toEqual(pgCode('42501'));
    });
  });

  describe('набор вредных запросов — каждый отклоняет роль базы (блок 8, пункт 8)', () => {
    it.each([
      ['секретная таблица', 'SELECT * FROM sessions', '42501'],
      ['хеш токена', 'SELECT token_hash FROM dm_tokens', '42501'],
      ['пароль', 'SELECT password_hash FROM users', '42501'],
      ['«*» с секретным столбцом', 'SELECT * FROM users', '42501'],
      ['ключ хранилища', 'SELECT storage_key FROM files', '42501'],
      ['таблица платформы', 'SELECT * FROM platform_leads', '42501'],
      ['подписки всех организаций', 'SELECT * FROM org_subscriptions', '42501'],
      ['чтение файла сервера', "SELECT pg_read_file('/etc/passwd')", '42501'],
      ['пользователи базы', 'SELECT * FROM pg_authid', '42501'],
      ['запись в CTE', 'WITH d AS (DELETE FROM contractors RETURNING id) SELECT * FROM d', '25006'],
      ['запись с RETURNING', 'DELETE FROM contractors RETURNING id', '25006'],
      [
        'обход предела строк скобками',
        'SELECT g FROM generate_series(1, 100000) g) a) b, (SELECT 1 AS one FROM (SELECT 1',
        '42601',
      ],
      ['одинаковые имена столбцов', 'SELECT 1 AS x, 2 AS x', '42712'],
      ['блокировка строк', 'SELECT id FROM contractors FOR UPDATE', '25006'],
      ['снять «только чтение»', "SELECT set_config('transaction_read_only', 'off', true)", '25001'],
      ['сменить роль', "SELECT set_config('role', 'buhuchet_app', true)", '42501'],
      [
        'сменить пользователя',
        "SELECT set_config('session_authorization', 'postgres', true)",
        '42501',
      ],
      ['начать запуск заново', 'SELECT dm.begin_org()', '42501'],
      ['вызвать исполнителя изнутри', "SELECT dm.run_org('SELECT 1', '[]', 1)", '42501'],
      ['заблокировать запуск', 'SELECT * FROM dm.runs FOR UPDATE', '25006'],
      ['два оператора подряд', 'SELECT 1 AS n; DELETE FROM contractors', '42P11'],
    ] as const)('%s', async (_, text, code) => {
      await expect(inA(q(text))).rejects.toEqual(pgCode(code));
    });

    it('запрос не дольше предела времени: дольше — «Запрос выполнялся слишком долго»', async () => {
      const e = await inA({ ...q('SELECT pg_sleep(5) AS s'), timeoutMs: 200 }).catch((x) => x);
      expect(queryTimedOut(e)).toBe(true);
      // Больше 15 с не попросить.
      const long = await inA({
        ...q("SELECT current_setting('statement_timeout') AS t"),
        timeoutMs: 600_000,
      });
      expect(long.rows).toEqual([['15s']]);
    });

    it('рекомендательная блокировка запроса снимается, строка запуска не остаётся', async () => {
      await inA(q('SELECT pg_advisory_lock(4242) AS l'));
      await expect(
        inA(q('SELECT pg_advisory_lock(4243) AS l, 1 / (random() * 0)::int AS boom')),
      ).rejects.toEqual(pgCode('22012'));
      // Блокировка на время транзакции другого соединения берётся — значит, запрос её не держит.
      const [r] = await db.admin.db.transaction((tx) =>
        tx.execute<{ l1: boolean; l2: boolean; runs: number }>(sql`
          select pg_try_advisory_xact_lock(4242) as l1, pg_try_advisory_xact_lock(4243) as l2,
            (select count(*)::int from dm.runs) as runs`),
      );
      expect(r).toEqual({ l1: true, l2: true, runs: 0 });
    });

    it('запрос идёт от роли Витрины; в шаблоне Админки — от второй роли', async () => {
      expect((await inA(q('SELECT current_user AS u'))).objs).toEqual([{ u: 'buhuchet_dm_org' }]);
      expect((await asAdmin(q('SELECT current_user AS u'))).objs).toEqual([
        { u: 'buhuchet_dm_admin' },
      ]);
    });
  });

  describe('путь запуска: начат, только чтение, свой вид (блок 8, пункты 1 и 5)', () => {
    it('без dm.begin_org и не в «только чтение» исполнитель отказывает', async () => {
      const ro = sql`select set_config('transaction_read_only', 'on', true)`;
      await expect(
        withOrgContext(db.app.db, { orgId: a.orgId }, async (tx) => {
          await tx.execute(sql`select pg_current_xact_id()`);
          await tx.execute(ro);
          return tx.execute(sql`select dm.run_org('SELECT 1', '[]'::jsonb, 1)`);
        }),
      ).rejects.toEqual(pgCode('42501'));
      await expect(
        withOrgContext(db.app.db, { orgId: a.orgId }, async (tx) => {
          await tx.execute(sql`select dm.begin_org()`);
          return tx.execute(sql`select dm.run_org('SELECT 1', '[]'::jsonb, 1)`);
        }),
      ).rejects.toEqual(pgCode('25006'));
      // Запуск организации не открывает шаблон Админки.
      await expect(
        withOrgContext(db.app.db, { orgId: a.orgId }, async (tx) => {
          await tx.execute(sql`select dm.begin_org()`);
          await tx.execute(ro);
          return tx.execute(sql`select dm.run_admin('SELECT 1', '[]'::jsonb, 1)`);
        }),
      ).rejects.toEqual(pgCode('42501'));
    });

    it('шаблон Админки — только администратор платформы; шаблон организации — только в её контексте', async () => {
      await expect(runDmAdmin(db.app.db, a.ownerUserId, q('SELECT 1 AS n'))).rejects.toEqual(
        pgCode('42501'),
      );
      // Администратор платформы в контексте организации шаблон Админки не запускает.
      await expect(
        withOrgContext(db.app.db, { orgId: a.orgId, userId: adminId }, (tx) =>
          tx.execute(sql`select dm.begin_admin()`),
        ),
      ).rejects.toEqual(pgCode('42501'));
      // Предел строк база держит сама, без проверки кода.
      await expect(
        withOrgContext(db.app.db, { orgId: a.orgId }, async (tx) => {
          await tx.execute(sql`select dm.begin_org()`);
          await tx.execute(sql`select set_config('transaction_read_only', 'on', true)`);
          return tx.execute(sql`select dm.run_org('SELECT 1', '[]'::jsonb, 50001)`);
        }),
      ).rejects.toEqual(pgCode('22023'));
      await expect(
        withUserContext(db.app.db, adminId, (tx) => tx.execute(sql`select dm.begin_org()`)),
      ).rejects.toEqual(pgCode('42501'));
    });

    it('параметры $1…$20 текстом, не больше maxRows строк и отметка «строк больше»', async () => {
      const r = await inA(
        q(
          "SELECT $1::date AS d, $2::integer AS n, $3::text IS NULL AS empty, 'x' || $4 AS s, 1 AS dm_s",
          ['2026-11-20', '7', null, "'; drop table x; --"],
        ),
      );
      // Столбцы с любыми именами (`s`, `dm_s`) не мешают: в ответе — строки целиком.
      expect(r.objs).toEqual([
        { d: '2026-11-20', n: 7, empty: true, s: "x'; drop table x; --", dm_s: 1 },
      ]);
      expect(r.more).toBe(false);
      expect(r.ms).toBeGreaterThanOrEqual(0);
      // Строки — в порядке запроса (не по возрастанию сами по себе).
      const many = await inA(q('SELECT g FROM generate_series(1, 5) g ORDER BY g DESC', [], 3));
      expect(many).toMatchObject({ columns: ['g'], rows: [[5], [4], [3]], more: true });
      expect(await inA(q('SELECT g FROM generate_series(1, 3) g', [], 3))).toMatchObject({
        rows: [[1], [2], [3]],
        more: false,
      });
      await expect(inA(q('SELECT 1', [], 0))).rejects.toThrow(RangeError);
      await expect(inA(q('SELECT 1', [], 50_001))).rejects.toThrow(RangeError);
      const tooMany = Array.from({ length: 21 }, () => 'x');
      await expect(inA(q('SELECT 1 AS n', tooMany))).rejects.toEqual(pgCode('22023'));
    });

    it('столбцы — в порядке запроса и у пустого результата; сроки — по Бишкеку', async () => {
      // Имя-число не встаёт первым (как у объекта JavaScript), пустой результат знает свои столбцы.
      expect(await inA(q('SELECT 1 AS b, 2 AS "2026", 3 AS a'))).toMatchObject({
        columns: ['b', '2026', 'a'],
        rows: [[1, 2, 3]],
      });
      expect(await inA(q('SELECT 1 AS n, $1::text AS t WHERE false', ['x']))).toMatchObject({
        columns: ['n', 't'],
        rows: [],
        more: false,
      });
      // 19:00 по UTC 20.11 — уже 21.11 в Бишкеке (UTC+6): current_date и ::date считают по Бишкеку.
      expect(
        (
          await inA(
            q(
              "SELECT current_setting('TimeZone') AS tz, (timestamptz '2026-11-20 19:00:00+00')::date AS d",
            ),
          )
        ).objs,
      ).toEqual([{ tz: 'Asia/Bishkek', d: '2026-11-21' }]);
      // Комментарий в конце запроса не ломает исполнитель.
      expect((await inA(q('SELECT 1 AS n -- конец'))).rows).toEqual([[1]]);
    });

    it('политики ролей Витрины смотрят на строку запуска: одна форма на каждый вид таблицы', async () => {
      const rows = await db.admin.db.execute<{
        policyname: string;
        tablename: string;
        qual: string;
      }>(
        sql`select policyname, tablename, qual from pg_policies
            where schemaname = 'public' and policyname in ('dm_org_read', 'dm_admin_read')`,
      );
      const run =
        /^\(r\.pid = pg_backend_pid\(\)\) AND \(r\.xid = pg_current_xact_id_if_assigned\(\)\)/;
      const kind = (t: string) =>
        t === 'organizations'
          ? 'organizations'
          : DM_PLATFORM_TABLES.includes(t as never)
            ? 'platform'
            : 'org';
      const forms = new Map<string, Set<string>>();
      for (const r of rows) {
        const key = r.policyname === 'dm_admin_read' ? 'admin' : kind(r.tablename);
        forms.set(key, (forms.get(key) ?? new Set()).add(r.qual));
      }
      // У каждого вида — ровно одна форма условия, и в ней — строка запуска этой транзакции.
      expect([...forms.keys()].sort()).toEqual(['admin', 'org', 'organizations', 'platform']);
      const only = (k: string) => [...forms.get(k)!][0]!.replace(/\s+/g, ' ');
      for (const k of forms.keys()) expect(forms.get(k)!.size, k).toBe(1);
      expect(only('admin')).toMatch(
        /^\(EXISTS \( SELECT 1 FROM dm\.runs r WHERE \(.*AND r\.admin\)\)\)$/,
      );
      expect(only('org')).toMatch(
        /^\(org_id = \( SELECT r\.org_id FROM dm\.runs r WHERE \(.*\)\)\)$/,
      );
      expect(only('organizations')).toMatch(/^\(id = \( SELECT r\.org_id FROM dm\.runs r WHERE /);
      expect(only('platform')).toMatch(
        /^\(\( SELECT r\.org_id FROM dm\.runs r WHERE .*\) IS NOT NULL\)$/,
      );
      for (const k of forms.keys()) {
        expect(only(k).replace(/^.*?WHERE \(/, ''), k).toMatch(run);
      }
    });

    it('dmErrorOf отдаёт код и текст базы', async () => {
      const e = await inA(q('SELECT * FROM no_such_table')).catch((x) => x);
      expect(dmErrorOf(e)).toEqual({
        code: '42P01',
        message: expect.stringContaining('no_such_table'),
      });
      expect(dmErrorOf(new Error('x'))).toBeNull();
    });
  });
});
