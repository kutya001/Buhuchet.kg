import { schema } from '@buhuchet/db';
import { DM_BUILTIN_SQL } from '@buhuchet/db/seed';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import { DmConsolePlan, DmConsoleResult, DmConsoleStopped, DmSchemaMap } from '@buhuchet/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { dmTemplateSqlProblem } from './sql-check';

/*
 * Консоль запросов «Витрины данных» (доработки 27.11.2026: консоль запросов, блок 2, пункт 11; этап 0,
 * П2–П3): тесты защиты раньше экрана — секреты, запись, смена роли, ожидание, блокировка, запрос из
 * строки, сигнал другому соединению, «Мои запросы» из консоли, отказ сотруднику и гостю; журнал
 * консоли; «В Excel»; карта базы; готовые шаблоны проходят разборщик; запрос консоли, сохранённый
 * шаблоном для организаций, не видит чужую организацию.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { platformAuditLog, contractors } = schema;
const txt = (key: keyof typeof UI_TEXTS) => UI_TEXTS[key].ru;

describe.skipIf(!databaseAvailable())('Витрина данных: консоль запросов Админки', () => {
  let f: Fixture;
  const cookies: Record<string, string> = {};
  const call = (login: string | null, method: 'GET' | 'POST', path: string, body?: unknown) =>
    apiRequest(
      f.app,
      method,
      `/api/admin/dm/console${path}`,
      login ? cookies[login] : undefined,
      body,
    );
  const run = (query: string, params: Record<string, string | null> = {}) =>
    call('platform-admin', 'POST', '/run', { query, params });
  const fail = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return ((await res.json()) as { error: { code: string; message: string; details?: unknown } })
      .error;
  };
  const ok = async <T>(res: Response, parse: { parse: (v: unknown) => T }) => {
    expect(res.status, await res.clone().text()).toBe(200);
    return parse.parse(await res.json());
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    for (const login of ['owner-a', 'platform-admin']) {
      cookies[login] = await signIn(f.app, login, TEST_PASSWORD);
    }
    const db = f.t.admin.db;
    await seedAllPlatformDictionaries(db);
    await db.insert(contractors).values([
      {
        orgId: f.a.orgId,
        name: 'Консоль А',
        inn: '11111111111111',
        phone: '+996555000001',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
      },
      {
        orgId: f.b.orgId,
        name: 'Консоль Б',
        inn: '22222222222222',
        phone: '+996555000002',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
      },
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  describe('кто может (блок 2, пункт 10)', () => {
    it.each(['/run', '/explain', '/stop', '/export', '/schema'])(
      'сотрудник организации — 403, гость — 401: %s',
      async (path) => {
        const method = path === '/schema' ? 'GET' : 'POST';
        const body = method === 'POST' ? { query: 'select 1', params: {} } : undefined;
        expect((await call('owner-a', method, path, body)).status).toBe(403);
        expect((await call(null, method, path, body)).status).toBe(401);
      },
    );
  });

  describe('«Выполнить»: видит всё, кроме секретов, только читает', () => {
    it('все организации, параметры данными, время и строки в журнале', async () => {
      const res = await ok(
        await run(
          "select name, :m as m from contractors where name like 'Консоль %' order by name",
          {
            m: "2026-11'; drop table users; --",
          },
        ),
        DmConsoleResult,
      );
      expect(res.columns).toEqual(['name', 'm']);
      expect(res.rows).toEqual([
        ['Консоль А', "2026-11'; drop table users; --"],
        ['Консоль Б', "2026-11'; drop table users; --"],
      ]);
      expect(res.params).toEqual(['m']);
      expect(res.max).toBe(1000);
      const [entry] = await f.t.admin.db
        .select()
        .from(platformAuditLog)
        .where(
          and(
            eq(platformAuditLog.entity, 'dm_console'),
            eq(platformAuditLog.action, 'dm_console_run'),
          ),
        )
        .orderBy(sql`${platformAuditLog.id} desc`)
        .limit(1);
      expect(entry!.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'outcome', to: 'ok' }),
          expect.objectContaining({ field: 'rows', to: 2 }),
          expect.objectContaining({
            field: 'query',
            to: expect.stringContaining('from contractors'),
          }),
        ]),
      );
    });

    it('на экран — 1 000 строк и «есть ещё»', async () => {
      const res = await ok(await run('select g from generate_series(1, 1200) g'), DmConsoleResult);
      expect(res.rows).toHaveLength(1000);
      expect(res.more).toBe(true);
    });

    it.each([
      ['хеш пароля', 'select password_hash from users'],
      ['сеансы', 'select * from sessions'],
      ['коды входа', 'select * from admin_login_codes'],
      ['текст шаблона', 'select query from dm_template_sql'],
      ['хеши токенов', 'select * from dm_tokens'],
      ['номер чата', 'select chat_id from telegram_links'],
      ['«Мои запросы»', 'select * from dm_console_queries'],
    ])('секрет закрыт: %s', async (_, query) => {
      const e = await fail(await run(query), 400);
      expect(e.code).toBe('dm_console_error');
      expect(e.message).toContain('42501');
    });

    it.each([
      ['INSERT', 'insert into news (id) values (1)'],
      ['UPDATE', "update users set login = 'x'"],
      ['DELETE', 'delete from contractors'],
      ['DELETE внутри WITH', 'with d as (delete from contractors returning id) select * from d'],
      ['смена роли', 'set role postgres'],
      ['смена роли из функции', "select set_config('role', 'postgres', true)"],
      ['ожидание', 'select pg_sleep(5)'],
      ['ожидание со схемой', 'select pg_catalog.pg_sleep(5)'],
      ['блокировка', 'select pg_advisory_lock(1)'],
      ['блокировка строк', 'select id from contractors for update'],
      ['запрос из строки', "select query_to_xml('select * from users', true, true, '')"],
      ['сигнал другому соединению', 'select pg_terminate_backend(pid) from pg_stat_activity'],
      ['сигнал «Отменить»', 'select pg_cancel_backend(1)'],
      ['файл сервера', "select pg_read_file('postgresql.conf')"],
      ['второй оператор', 'select 1; select 2'],
    ])('отказ: %s', async (_, query) => {
      const e = await fail(await run(query), 400);
      expect(e.code).toMatch(/^dm_(sql_|console_forbidden)/);
    });

    it('отказ разборщика тоже в журнале консоли', async () => {
      await fail(await run('select pg_sleep(30)'), 400);
      const [entry] = await f.t.admin.db
        .select()
        .from(platformAuditLog)
        .where(eq(platformAuditLog.entity, 'dm_console'))
        .orderBy(sql`${platformAuditLog.id} desc`)
        .limit(1);
      expect(entry!.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'outcome', to: 'refused' }),
          expect.objectContaining({ field: 'query', to: 'select pg_sleep(30)' }),
        ]),
      );
    });

    it('ошибка базы — её текстом', async () => {
      const e = await fail(await run('select * from no_such_table'), 400);
      expect(e.code).toBe('dm_console_error');
      expect(e.message).toContain('no_such_table');
    });

    it('сообщения отказа — из словаря', async () => {
      const e = await fail(await run('select pg_sleep(1)'), 400);
      expect(e.message).toBe(txt('err.dm_console_forbidden').replace('{word}', 'pg_sleep'));
    });
  });

  describe('«План запроса» и «Остановить»', () => {
    it('план без выполнения', async () => {
      const started = Date.now();
      const res = await ok(
        await call('platform-admin', 'POST', '/explain', {
          query: 'select count(*) from contractors where name = :n',
          params: { n: 'x' },
        }),
        DmConsolePlan,
      );
      expect(Array.isArray(res.plan)).toBe(true);
      expect(Date.now() - started).toBeLessThan(5000);
      const e = await fail(
        await call('platform-admin', 'POST', '/explain', {
          query: 'select pg_sleep(9)',
          params: {},
        }),
        400,
      );
      expect(e.code).toBe('dm_console_forbidden');
    });

    it('нечего останавливать — 0', async () => {
      const res = await ok(await call('platform-admin', 'POST', '/stop'), DmConsoleStopped);
      expect(res.stopped).toBe(0);
    });
  });

  describe('«В Excel» (блок 2, пункт 3)', () => {
    it('файл .xlsx тем же путём, что «Вывод», запись в журнале', async () => {
      const res = await call('platform-admin', 'POST', '/export', {
        query: 'select g as n from generate_series(1, 3) g',
        params: {},
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(res.headers.get('content-type')).toContain('spreadsheetml');
      const [entry] = await f.t.admin.db
        .select()
        .from(platformAuditLog)
        .where(eq(platformAuditLog.action, 'dm_console_export'))
        .limit(1);
      expect(entry).toBeTruthy();
    });

    it('запрещённое и в Excel — отказ', async () => {
      const e = await fail(
        await call('platform-admin', 'POST', '/export', {
          query: 'select pg_sleep(1)',
          params: {},
        }),
        400,
      );
      expect(e.code).toBe('dm_console_forbidden');
    });
  });

  describe('карта базы для подсказок (П3)', () => {
    it('поля из базы, закрытое не отдаётся, роль организаций отмечена', async () => {
      const map = await ok(await call('platform-admin', 'GET', '/schema'), DmSchemaMap);
      const names = map.tables.map((t) => t.name);
      expect(names).toContain('contractors');
      expect(names).not.toContain('sessions');
      expect(names).not.toContain('dm_console_queries');
      expect(names).not.toContain('dm_template_sql');
      const users = map.tables.find((t) => t.name === 'users')!;
      expect(users.fields.map((x) => x.name)).not.toContain('password_hash');
      const cps = map.tables.find((t) => t.name === 'contractors')!;
      expect(cps.orgVisible).toBe(true);
      expect(cps.fields.find((x) => x.name === 'org_id')?.ref).toEqual({
        table: 'organizations',
        field: 'id',
      });
      expect(map.tables.find((t) => t.name === 'platform_leads')?.orgVisible).toBe(false);
    });
  });

  describe('шаблоны и токены: разборщик (блок 2, пункты 7–8)', () => {
    it('каждый готовый шаблон проходит список разрешённых функций', async () => {
      for (const [code, query] of Object.entries(DM_BUILTIN_SQL)) {
        expect(await dmTemplateSqlProblem(query), code).toBeNull();
      }
    });

    it('запрос консоли, сохранённый шаблоном для организаций, не видит чужую организацию', async () => {
      const query =
        "select c.id as contractor_id, c.name as cp from contractors c where c.name like 'Консоль %'";
      // В консоли — обе организации.
      const all = await ok(await run(query), DmConsoleResult);
      expect(all.rows.map((r) => r[1])).toEqual(expect.arrayContaining(['Консоль А', 'Консоль Б']));
      // «Проверить» шаблоном «Для организаций» на организации А — только её строки.
      const res = await apiRequest(
        f.app,
        'POST',
        '/api/admin/dm/templates/check',
        cookies['platform-admin'],
        {
          audience: 'org',
          query,
          params: [],
          columns: [
            { code: 'contractor_id', name: 'Контрагент (для области)', type: 'cp', total: false },
            { code: 'cp', name: 'Контрагент', type: 'text', total: false },
          ],
          checkOrgId: f.a.orgId,
        },
      );
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as { ok: boolean; rows: unknown[][] };
      expect(body.ok).toBe(true);
      const cells = body.rows.flat();
      expect(cells).toContain('Консоль А');
      expect(cells).not.toContain('Консоль Б');
    });
  });
});
