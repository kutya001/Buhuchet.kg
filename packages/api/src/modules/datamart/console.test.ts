import { readFileSync } from 'node:fs';
import { releaseRateLimit, schema, takeRateLimit } from '@buhuchet/db';
import { DM_BUILTIN_SQL } from '@buhuchet/db/seed';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { DM_CONSOLE_PRESETS, UI_TEXTS } from '@buhuchet/domain';
import { DmConsolePlan, DmConsoleResult, DmConsoleStopped, DmSchemaMap } from '@buhuchet/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { ADMIN_CARD_VIEW_RATE_LIMIT } from '../admin/card-guard';
import { parseTechDocs } from '../admin/techdocs-source';
import {
  apiRequest,
  createRaceApp,
  createStaffFixture,
  signIn,
  TEST_PASSWORD,
} from '../../testing';
import { DM_CONSOLE_SLOT } from './console';
import { DM_RUN_ALL_LIMIT } from './run';
import { dmTemplateSqlProblem } from './sql-check';

/*
 * Консоль запросов «Витрины данных» (доработки 27.11.2026: консоль запросов, блок 2, пункт 11; этап 0,
 * П2–П3): тесты защиты раньше экрана — секреты, запись, смена роли, ожидание, блокировка, запрос из
 * строки, сигнал другому соединению, «Мои запросы» из консоли, отказ сотруднику и гостю; журнал
 * консоли; «В Excel»; карта базы; готовые шаблоны проходят разборщик; запрос консоли, сохранённый
 * шаблоном для организаций, не видит чужую организацию.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { platformAuditLog, contractors, auditLog, organizations } = schema;
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
      ['INSERT', 'insert into news (id) values (1)', 'dm_sql_not_select'],
      ['UPDATE', "update users set login = 'x'", 'dm_sql_not_select'],
      ['DELETE', 'delete from contractors', 'dm_sql_not_select'],
      [
        'DELETE внутри WITH',
        'with d as (delete from contractors returning id) select * from d',
        'dm_sql_not_select',
      ],
      ['смена роли', 'set role postgres', 'dm_sql_not_select'],
      [
        'смена роли из функции',
        "select set_config('role', 'postgres', true)",
        'dm_console_forbidden',
      ],
      ['ожидание', 'select pg_sleep(5)', 'dm_console_forbidden'],
      ['ожидание со схемой', 'select pg_catalog.pg_sleep(5)', 'dm_console_forbidden'],
      ['блокировка', 'select pg_advisory_lock(1)', 'dm_console_forbidden'],
      ['блокировка строк', 'select id from contractors for update', 'dm_sql_lock'],
      [
        'запрос из строки',
        "select query_to_xml('select * from users', true, true, '')",
        'dm_console_forbidden',
      ],
      [
        'запрос из строки (ts_rewrite)',
        "select ts_rewrite('a'::tsquery, 'select ''a''::tsquery, ''b''::tsquery from pg_'||'sleep(2)')",
        'dm_console_forbidden',
      ],
      [
        'сигнал другому соединению',
        'select pg_terminate_backend(pid) from pg_stat_activity',
        'dm_console_forbidden',
      ],
      ['сигнал «Отменить»', 'select pg_cancel_backend(1)', 'dm_console_forbidden'],
      ['файл сервера', "select pg_read_file('postgresql.conf')", 'dm_console_forbidden'],
      ['второй оператор', 'select 1; select 2', 'dm_sql_two_statements'],
    ])('отказ: %s', async (_, query, code) => {
      expect((await fail(await run(query), 400)).code).toBe(code);
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

    it('больше 20 параметров — 400 до базы', async () => {
      const params = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, 'x']));
      expect((await fail(await run('select 1 as n', params), 400)).code).toBe('validation_failed');
    });

    it('неверный параметр — 400 до базы, в журнале — отказ', async () => {
      const e = await fail(
        await run('select :date_from as a, :date_to as b', {
          date_from: '2026-12-01',
          date_to: '2026-11-01',
        }),
        400,
      );
      expect(e.code).toBe('dm_bad_param');
      const [entry] = await f.t.admin.db
        .select()
        .from(platformAuditLog)
        .where(eq(platformAuditLog.entity, 'dm_console'))
        .orderBy(sql`${platformAuditLog.id} desc`)
        .limit(1);
      expect(entry!.changes).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'outcome', to: 'refused' })]),
      );
    });

    it('готовые шаблоны выполняются в консоли: тип параметра — по имени (:date_from, :year, :month)', async () => {
      // «Открыть в консоли» (блок 1, пункт 4): параметр без типа шаблона уходит по имени — датой, годом.
      for (const [code, query] of Object.entries(DM_BUILTIN_SQL)) {
        const res = await run(query);
        expect(res.status, `${code}: ${await res.clone().text()}`).toBe(200);
      }
      const due = await run(DM_BUILTIN_SQL['service-fee']!, { year: '2026' });
      expect(due.status, await due.clone().text()).toBe(200);
    });

    it('типы параметров шаблона уходят с запросом: контрагент — номером', async () => {
      const query = 'select c.name from contractors c where c.id = :contractor';
      const id = '00000000-0000-4000-8000-000000000001';
      const typed = await call('platform-admin', 'POST', '/run', {
        query,
        params: { contractor: id },
        types: { contractor: 'list:cp' },
      });
      expect(typed.status, await typed.clone().text()).toBe(200);
      // Без типа — текстом: база отвечает своей ошибкой.
      expect((await fail(await run(query, { contractor: id }), 400)).code).toBe('dm_console_error');
      // Неизвестный тип — 400 до базы.
      const bad = await call('platform-admin', 'POST', '/run', {
        query,
        params: { contractor: id },
        types: { contractor: 'uuid' },
      });
      expect((await fail(bad, 400)).code).toBe('validation_failed');
      // Значение не по типу — отказ «неверный параметр».
      const wrong = await call('platform-admin', 'POST', '/run', {
        query,
        params: { contractor: 'не номер' },
        types: { contractor: 'list:cp' },
      });
      expect((await fail(wrong, 400)).code).toBe('dm_bad_param');
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
      const res = await ok(
        await call('platform-admin', 'POST', '/explain', {
          query: 'select count(*) from contractors where name = :n',
          params: { n: 'x' },
        }),
        DmConsolePlan,
      );
      expect(Array.isArray(res.plan)).toBe(true);
      expect(JSON.stringify(res.plan)).not.toContain('Actual Total Time');
      const missing = await fail(
        await call('platform-admin', 'POST', '/explain', {
          query: 'select * from no_such_table',
          params: {},
        }),
        400,
      );
      expect(missing.code).toBe('dm_console_error');
      expect(missing.message).toContain('no_such_table');
      const e = await fail(
        await call('platform-admin', 'POST', '/explain', {
          query: 'select pg_sleep(9)',
          params: {},
        }),
        400,
      );
      expect(e.code).toBe('dm_console_forbidden');
    });

    // Долгий запрос, который разборщик пускает: «Остановить» и предел 60 с ловят его на середине.
    const LONG = 'select count(*) from generate_series(1, 4000000000) g';
    const lastOutcome = async () => {
      const [entry] = await f.t.admin.db
        .select()
        .from(platformAuditLog)
        .where(eq(platformAuditLog.entity, 'dm_console'))
        .orderBy(sql`${platformAuditLog.id} desc`)
        .limit(1);
      return (entry!.changes as { field: string; to: unknown }[]).find((c) => c.field === 'outcome')
        ?.to;
    };
    /** Запрос консоли на своём пуле (в CI основной — одно соединение) и ожидание, пока он в базе. */
    const startLong = async (orgId?: string) => {
      const race = createRaceApp(f.t.appUrl, f.deps);
      const res = apiRequest(
        race.app,
        'POST',
        '/api/admin/dm/console/run',
        cookies['platform-admin'],
        {
          query: LONG,
          params: {},
          ...(orgId ? { orgId } : {}),
        },
      );
      await expect
        .poll(
          async () =>
            (
              await f.t.admin.db.execute<{ n: number }>(
                sql`select count(*)::int as n from pg_stat_activity where application_name like 'buhuchet_dm_console:%' and state = 'active'`,
              )
            )[0]!.n,
          { timeout: 10_000 },
        )
        .toBe(1);
      return { race, res };
    };

    it('«Остановить» прерывает свой запрос: 409 и «stopped» в журнале', async () => {
      const { race, res } = await startLong();
      try {
        const stop = await ok(
          await apiRequest(
            race.app,
            'POST',
            '/api/admin/dm/console/stop',
            cookies['platform-admin'],
          ),
          DmConsoleStopped,
        );
        expect(stop.stopped).toBe(1);
        expect((await fail(await res, 409)).code).toBe('dm_console_stopped');
        expect(await lastOutcome()).toBe('stopped');
      } finally {
        await race.close();
      }
    });

    it('«Остановить» прерывает и запрос «как организация» (место «Показать» освобождается)', async () => {
      const { race, res } = await startLong(f.a.orgId);
      try {
        const stop = await ok(
          await apiRequest(
            race.app,
            'POST',
            '/api/admin/dm/console/stop',
            cookies['platform-admin'],
          ),
          DmConsoleStopped,
        );
        expect(stop.stopped).toBe(1);
        expect((await fail(await res, 409)).code).toBe('dm_console_stopped');
        expect(await lastOutcome()).toBe('stopped');
      } finally {
        await race.close();
      }
      // Место «Показать» отпущено: следующий запрос как организация идёт сразу.
      await ok(
        await call('platform-admin', 'POST', '/run', {
          query: 'select 1 as n',
          params: {},
          orgId: f.a.orgId,
        }),
        DmConsoleResult,
      );
    });

    it('отмена после 60 с — «дольше предела»: 503 и «timeout» в журнале', async () => {
      // Отмену по пределу и по «Остановить» сервер различает временем: часы сдвигаются на минуту.
      const real = Date.now.bind(Date);
      let shift = 0;
      const now = vi.spyOn(Date, 'now').mockImplementation(() => real() + shift);
      const { race, res } = await startLong();
      try {
        shift = 61_000;
        await apiRequest(race.app, 'POST', '/api/admin/dm/console/stop', cookies['platform-admin']);
        expect((await fail(await res, 503)).code).toBe('dm_console_timeout');
        expect(await lastOutcome()).toBe('timeout');
      } finally {
        now.mockRestore();
        await race.close();
      }
    });

    it('«как организация» — предел 15 с, как у «Показать»: 503 и свой текст, «timeout» в журнале', async () => {
      const real = Date.now.bind(Date);
      let shift = 0;
      const now = vi.spyOn(Date, 'now').mockImplementation(() => real() + shift);
      const { race, res } = await startLong(f.a.orgId);
      try {
        // 16 с — больше предела организации, но меньше предела консоли (60 с).
        shift = 16_000;
        await apiRequest(race.app, 'POST', '/api/admin/dm/console/stop', cookies['platform-admin']);
        const e = await fail(await res, 503);
        expect(e.code).toBe('dm_console_timeout');
        expect(e.message).toBe(txt('err.dm_console_timeout_org'));
        expect(await lastOutcome()).toBe('timeout');
      } finally {
        now.mockRestore();
        await race.close();
      }
    });

    it('место консоли одно на сайт: занято — 429, места «Показать» не трогает', async () => {
      const db = f.deps.db;
      const slot = await takeRateLimit(db, DM_CONSOLE_SLOT, 'site');
      expect(slot.ok).toBe(true);
      try {
        expect((await fail(await run('select 1 as n'), 429)).code).toBe('dm_console_busy');
        // Места «Показать» свободны: консоль их не заняла.
        for (const subject of ['slot:0', 'slot:1']) {
          const show = await takeRateLimit(db, DM_RUN_ALL_LIMIT, subject);
          expect(show.ok, subject).toBe(true);
          if (show.ok) await releaseRateLimit(db, DM_RUN_ALL_LIMIT, subject, show.ticket);
        }
      } finally {
        if (slot.ok) await releaseRateLimit(db, DM_CONSOLE_SLOT, 'site', slot.ticket);
      }
      await ok(await run('select 1 as n'), DmConsoleResult);
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

  describe('«Выполнять как: Организация …» (этап 2, П7; п. О-70)', () => {
    const asOrg = (query: string, orgId: string, path = '/run') =>
      call('platform-admin', 'POST', path, { query, params: {}, orgId });
    const lastConsole = async (action = 'dm_console_run') => {
      const [entry] = await f.t.admin.db
        .select()
        .from(platformAuditLog)
        .where(and(eq(platformAuditLog.entity, 'dm_console'), eq(platformAuditLog.action, action)))
        .orderBy(sql`${platformAuditLog.id} desc`)
        .limit(1);
      return entry!;
    };

    it('видно ровно то, что видит организация; журнал называет её, история организации — открытие', async () => {
      const [org] = await f.t.admin.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, f.a.orgId));
      const res = await ok(
        await asOrg(
          "select name from contractors where name like 'Консоль %' order by name",
          f.a.orgId,
        ),
        DmConsoleResult,
      );
      expect(res.rows).toEqual([['Консоль А']]);
      expect(res.max).toBe(1000);
      expect((await lastConsole()).changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'org', to: { id: f.a.orgId, name: org!.name } }),
          expect.objectContaining({ field: 'outcome', to: 'ok' }),
        ]),
      );
      const views = await f.t.admin.db
        .select({ reason: auditLog.reason })
        .from(auditLog)
        .where(and(eq(auditLog.orgId, f.a.orgId), eq(auditLog.action, 'card_view')));
      expect(views.map((v) => v.reason)).toContain(txt('dm.con.history_porg'));
      // «История» консоли — с организацией.
      const hist = (await (await call('platform-admin', 'GET', '/history')).json()) as {
        items: { org: { id: string; name: string } | null }[];
      };
      expect(hist.items[0]!.org).toEqual({ id: f.a.orgId, name: org!.name });
    });

    it('это открытие данных организации: чужой сайт — 403, предел открытий — 429 без запуска и без записи, неверный номер — 400', async () => {
      const cross = await f.app.request('/api/admin/dm/console/run', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          cookie: cookies['platform-admin']!,
          'content-type': 'application/json',
          'sec-fetch-site': 'cross-site',
        },
        body: JSON.stringify({ query: 'select 1 as n', params: {}, orgId: f.a.orgId }),
      });
      expect(cross.status).toBe(403);
      expect(((await cross.json()) as { error: { code: string } }).error.code).toBe(
        'origin_mismatch',
      );
      expect((await fail(await asOrg('select 1 as n', 'not-a-uuid'), 400)).code).toBe(
        'validation_failed',
      );

      const [user] = await f.t.admin.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.login, 'platform-admin'));
      const mine = and(
        eq(schema.rateLimits.kind, ADMIN_CARD_VIEW_RATE_LIMIT.kind),
        eq(schema.rateLimits.subject, user!.id),
      );
      const [taken = { n: 0 }] = await f.t.admin.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.rateLimits)
        .where(mine);
      await f.t.admin.db.insert(schema.rateLimits).values(
        Array.from({ length: ADMIN_CARD_VIEW_RATE_LIMIT.max - taken.n }, () => ({
          kind: ADMIN_CARD_VIEW_RATE_LIMIT.kind,
          subject: user!.id,
        })),
      );
      try {
        const views = async () =>
          (
            await f.t.admin.db
              .select({ n: sql<number>`count(*)::int` })
              .from(auditLog)
              .where(and(eq(auditLog.orgId, f.a.orgId), eq(auditLog.action, 'card_view')))
          )[0]!.n;
        const before = await views();
        const runs = async () =>
          (
            await f.t.admin.db
              .select({ n: sql<number>`count(*)::int` })
              .from(platformAuditLog)
              .where(eq(platformAuditLog.entity, 'dm_console'))
          )[0]!.n;
        const ran = await runs();
        expect((await fail(await asOrg('select 1 as n', f.a.orgId), 429)).code).toBe(
          'card_view_limit',
        );
        expect(await views()).toBe(before);
        expect(await runs()).toBe(ran);
      } finally {
        await f.t.admin.db.delete(schema.rateLimits).where(mine);
      }
    });

    it('таблица платформы — «данные платформы, организациям закрыта», чужая организация не видна', async () => {
      const e = await fail(await asOrg('select id from platform_leads', f.a.orgId), 400);
      expect(e.code).toBe('dm_console_closed');
      expect(e.message).toBe(txt('err.dm_console_closed').replace('{table}', 'platform_leads'));
      expect(e.details).toEqual({ table: 'platform_leads' });
      const other = await ok(
        await asOrg(
          `select count(*)::int as n from contractors where org_id = '${f.b.orgId}'`,
          f.a.orgId,
        ),
        DmConsoleResult,
      );
      expect(other.rows).toEqual([[0]]);
      expect((await lastConsole()).changes).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'outcome', to: 'ok' })]),
      );
    });

    it('нет такой организации — 404; сотруднику организации — 403', async () => {
      await fail(await asOrg('select 1', '00000000-0000-4000-8000-000000000000'), 404);
      const res = await call('owner-a', 'POST', '/run', {
        query: 'select 1',
        params: {},
        orgId: f.a.orgId,
      });
      expect(res.status).toBe(403);
    });

    it('«В Excel» как организация — тем же путём, запись в журнале с организацией', async () => {
      const res = await asOrg('select name from contractors', f.b.orgId, '/export');
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await lastConsole('dm_console_export')).changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'org', to: expect.objectContaining({ id: f.b.orgId }) }),
        ]),
      );
      // В истории организации — открытие с причиной «выгрузка», не «запуск».
      const views = await f.t.admin.db
        .select({ reason: auditLog.reason })
        .from(auditLog)
        .where(and(eq(auditLog.orgId, f.b.orgId), eq(auditLog.action, 'card_view')));
      expect(views.map((v) => v.reason)).toContain(txt('dm.con.history_porg_export'));
    });

    it('места «Показать» заняты — 429 `dm_busy_all`, место консоли не нужно', async () => {
      const held: { subject: string; ticket: number }[] = [];
      for (const subject of ['slot:0', 'slot:1']) {
        const s = await takeRateLimit(f.t.admin.db, DM_RUN_ALL_LIMIT, subject);
        if (s.ok) held.push({ subject, ticket: s.ticket });
      }
      try {
        expect((await fail(await asOrg('select 1', f.a.orgId), 429)).code).toBe('dm_busy_all');
      } finally {
        for (const h of held)
          await releaseRateLimit(f.t.admin.db, DM_RUN_ALL_LIMIT, h.subject, h.ticket);
      }
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
      // Поле — своей отметкой (этап 2, П7): открытая таблица — открытые поля.
      expect(cps.fields.find((x) => x.name === 'name')?.orgVisible).toBe(true);
      // Составной ключ «поле + org_id» — тоже связь (сборщик запроса, этап 2, П9); сам `org_id`
      // такого ключа — связь с организацией, а не с контрагентом.
      const reports = map.tables.find((t) => t.name === 'reports')!;
      expect(reports.fields.find((x) => x.name === 'contractor_id')?.ref).toEqual({
        table: 'contractors',
        field: 'id',
      });
      expect(reports.fields.find((x) => x.name === 'org_id')?.ref).toEqual({
        table: 'organizations',
        field: 'id',
      });
    });

    it('названия, группы и описания — из схемы прототипа; поля без описания — пусто', async () => {
      const api = readFileSync(
        new URL('../../../../../spec/data/apiDocs.json', import.meta.url),
        'utf8',
      );
      const schemaDoc = {
        meta: { schemaVersion: 81, updated: '2026-11-21' },
        groups: [{ id: 'org', ru: 'Организации и люди' }],
        tables: [
          {
            name: 'organizations',
            ru: 'Организации',
            group: 'org',
            desc: 'Фирмы на платформе',
            columns: [{ name: 'name', ru: 'Название', desc: 'Как в документах' }],
          },
        ],
      };
      const docs = parseTechDocs({ api, schema: JSON.stringify(schemaDoc), page: '<html></html>' });
      const app = createApp({ ...f.deps, techDocs: { load: async () => docs } });
      const map = await ok(
        await apiRequest(app, 'GET', '/api/admin/dm/console/schema', cookies['platform-admin']),
        DmSchemaMap,
      );
      expect(map.described).toBe('81 2026-11-21');
      const orgs = map.tables.find((t) => t.name === 'organizations')!;
      expect(orgs).toMatchObject({
        group: 'Организации и люди',
        title: 'Организации',
        description: 'Фирмы на платформе',
      });
      expect(orgs.fields.find((x) => x.name === 'name')).toMatchObject({
        title: 'Название',
        description: 'Как в документах',
      });
      expect(orgs.fields.find((x) => x.name === 'inn')).toMatchObject({
        title: null,
        description: null,
      });
      expect(map.tables.find((t) => t.name === 'contractors')).toMatchObject({
        title: null,
        group: null,
      });
    });
  });

  describe('«Заготовки» (этап 2, П8; прототип v167 DMC_PRE)', () => {
    it.each(DM_CONSOLE_PRESETS.map((p) => [p.id, p.sql] as const))(
      'заготовка %s проходит разборщик и выполняется',
      async (_id, query) => {
        const params = Object.fromEntries(
          [...new Set([...query.matchAll(/(?<!:):([a-z_][a-z0-9_]*)/g)].map((m) => m[1]!))].map(
            (k) => [k, k.includes('month') ? '2026-11' : '2026-11-01'],
          ),
        );
        const res = await ok(await run(query, params), DmConsoleResult);
        expect(res.columns.length).toBeGreaterThan(0);
        expect(res.params.sort()).toEqual(Object.keys(params).sort());
      },
    );
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
