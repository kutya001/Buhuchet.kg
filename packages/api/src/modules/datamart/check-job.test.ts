import { createFakeTelegram, fixedClock } from '@buhuchet/adapters';
import { dmCheckMark, runDmOrg, schema, withOrgContext, withUserContext } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import { BellPage, DmAdminTemplateCard } from '@buhuchet/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  signIn,
  TEST_PASSWORD,
} from '../../testing';
import { DM_NO_DATA_ORG, dmCheckNightSince, dmCheckTemplatesJob } from './check-job';

/*
 * «Витрина: проверка шаблонов» (доработки 20.11.2026: Витрина данных, блок 8, пункт 7; общий план 20.11,
 * этап 2, П4): после выпуска с миграциями и каждую ночь каждый опубликованный и сломанный шаблон
 * запускается; не выполнился — «Сломан», администраторам платформы — Telegram и колокольчик, организация
 * видит «Шаблон временно не работает»; снова выполняется — «Опубликован»; в истории — «Система».
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { dmTemplateSql, dmTemplates, organizations, users } = schema;
const txt = (key: keyof typeof UI_TEXTS) => UI_TEXTS[key].ru;
// 20.11.2026, 12:00 по Бишкеку; ночная проверка — с 04:00 (22:00 UTC накануне).
const NOW = '2026-11-20T06:00:00Z';
const NEXT_NIGHT = '2026-11-20T22:10:00Z';

describe.skipIf(!databaseAvailable())('Витрина данных: проверка шаблонов системой', () => {
  let f: Fixture;
  let deps: ApiDeps;
  let app: ReturnType<typeof createApp>;
  const clock = fixedClock(NOW);
  const tg = createFakeTelegram();
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const job = dmCheckTemplatesJob();

  const call = (login: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
    apiRequest(app, method, path, cookies[login], body);
  const admin = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
    call('platform-admin', method, `/api/admin/dm/templates${path}`, body);
  const card = async (id: string) => {
    const res = await admin('GET', `/${id}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return DmAdminTemplateCard.parse(await res.json());
  };
  const publish = async (
    code: string,
    audience: 'org' | 'admin',
    query: string,
    cols: string[],
  ) => {
    const res = await admin('POST', '', {
      name: `Проверка ${code}`,
      code,
      description: null,
      audience,
      module: audience === 'org' ? 'cps' : null,
      needPermission: null,
      access: 'all',
      orgIds: [],
      query,
      params: [],
      columns: cols.map((c) => ({ code: c, name: c, type: 'text', total: false })),
      publish: true,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return DmAdminTemplateCard.parse(await res.json()).id;
  };
  const setQuery = (id: string, query: string) =>
    f.t.admin.db.update(dmTemplateSql).set({ query }).where(eq(dmTemplateSql.templateId, id));
  const stateOf = async (id: string) =>
    (await f.t.admin.db.select().from(dmTemplates).where(eq(dmTemplates.id, id)))[0]!;

  beforeAll(async () => {
    f = await createStaffFixture();
    deps = createTestDeps({ db: f.t.app.db, clock, telegram: tg });
    app = createApp(deps);
    for (const login of ['owner-a', 'platform-admin']) {
      cookies[login] = await signIn(app, login, TEST_PASSWORD);
    }
    await linkTelegram(app, cookies['platform-admin']!, 7301, 'platform');
    await f.t.admin.db
      .update(organizations)
      .set({ isDemo: true })
      .where(eq(organizations.id, f.b.orgId));
    ids.org = await publish('chk-org', 'org', 'select c.id as cp_id, c.name from contractors c', [
      'cp_id',
      'name',
    ]);
    ids.adm = await publish('chk-adm', 'admin', 'select 1 as n', ['n']);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('ночь — последние 04:00 по Бишкеку', () => {
    expect(dmCheckNightSince(new Date('2026-11-20T06:00:00Z')).toISOString()).toBe(
      '2026-11-19T22:00:00.000Z',
    );
    expect(dmCheckNightSince(new Date('2026-11-20T21:59:00Z')).toISOString()).toBe(
      '2026-11-19T22:00:00.000Z',
    );
    expect(dmCheckNightSince(new Date('2026-11-20T22:00:00Z')).toISOString()).toBe(
      '2026-11-20T22:00:00.000Z',
    );
  });

  it('новые опубликованные — проверяются сразу (шаблон организаций — на демо); повтор до ночи ничего не делает', async () => {
    expect(await job.run(deps, clock.now())).toBe(2);
    const [row] = await f.t.admin.db
      .select()
      .from(dmTemplateSql)
      .where(eq(dmTemplateSql.templateId, ids.org!));
    expect(row).toMatchObject({ checkedOrgId: f.b.orgId, checkError: null });
    expect(row!.autoCheckedAt?.toISOString()).toBe(new Date(NOW).toISOString());
    expect(row!.autoCheckedSchema).toBeGreaterThan(170);
    expect((await stateOf(ids.org!)).state).toBe('published');
    expect(await job.run(deps, clock.now())).toBe(0);
  });

  it('не выполнился ночью — «Сломан»: история «Система», Telegram и колокольчик администраторам, организации — «Шаблон временно не работает»', async () => {
    await setQuery(ids.org!, 'select c.id as cp_id, c.nope as name from contractors c');
    clock.set(NEXT_NIGHT);
    const before = tg.sent.length;
    expect(await job.run(deps, clock.now())).toBe(2);
    const c = await card(ids.org!);
    expect(c.state).toBe('broken');
    expect(c.checkError).toContain('nope');
    expect(c.history[0]).toMatchObject({
      who: txt('status.system'),
      what: txt('dm.tpl.hist.state')
        .replace('{from}', txt('dm.tpl.state.published'))
        .replace('{to}', txt('dm.tpl.state.broken')),
    });
    expect((await card(ids.adm!)).state).toBe('published');
    const alerts = tg.sent.slice(before);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ chatId: 7301 });
    expect(alerts[0]!.text).toContain('Проверка chk-org');
    // Текст ошибки базы в Telegram не уходит.
    expect(alerts[0]!.text).not.toContain('nope');

    const out = await call('owner-a', 'POST', '/api/dm/output/run', {
      code: 'chk-org',
      params: {},
    });
    expect(out.status).toBe(409);
    expect(((await out.json()) as { error: { code: string } }).error.code).toBe(
      'dm_template_broken',
    );

    const bell = await call('platform-admin', 'GET', '/api/bell?tab=all');
    expect(bell.status, await bell.clone().text()).toBe(200);
    const items = BellPage.parse(await bell.json()).items.filter((i) => i.event === 'dm_broken');
    expect(items).toEqual([
      expect.objectContaining({
        text: txt('bell.line.dm_broken').replace('{name}', 'Проверка chk-org'),
        open: { kind: 'dm_template', id: ids.org },
      }),
    ]);
    // Повтор: ни второй проверки, ни второго сообщения.
    expect(await job.run(deps, clock.now())).toBe(0);
    expect(tg.sent.length).toBe(before + 1);
  });

  it('после выпуска с миграциями — проверяются снова; снова выполняется — «Опубликован»', async () => {
    await setQuery(ids.org!, 'select c.id as cp_id, c.name from contractors c');
    // Выпуск: применилась ещё одна миграция.
    await f.t.admin.db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('test-release', 0)`,
    );
    try {
      clock.advance(60_000);
      expect(await job.run(deps, clock.now())).toBe(2);
      const c = await card(ids.org!);
      expect(c).toMatchObject({ state: 'published', checkError: null });
      expect(c.history[0]).toMatchObject({
        who: txt('status.system'),
        what: txt('dm.tpl.hist.state')
          .replace('{from}', txt('dm.tpl.state.broken'))
          .replace('{to}', txt('dm.tpl.state.published')),
      });
      expect(await job.run(deps, clock.now())).toBe(0);
    } finally {
      await f.t.admin.db.execute(
        sql`delete from drizzle.__drizzle_migrations where hash = 'test-release'`,
      );
    }
  });

  it('пропал столбец шаблона или в тексте запрещённое слово — тоже «Сломан»; исправили — «Опубликован»', async () => {
    // Каждый «выпуск» — ещё одна применённая миграция (число миграций растёт): шаблоны проверяются снова
    // в ту же ночь. Предыдущий тест проверял при числе на одну больше — поэтому начинаем с двух.
    const hashes: string[] = [];
    const release = async (n: number) => {
      for (let i = 0; i < n; i += 1) {
        const hash = `test-release-${hashes.length}`;
        hashes.push(hash);
        await f.t.admin.db.execute(
          sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, 0)`,
        );
      }
      clock.advance(60_000);
      expect(await job.run(deps, clock.now())).toBe(2);
    };
    try {
      // Запрос больше не отдаёт опубликованный столбец «name».
      await setQuery(ids.org!, 'select c.id as cp_id from contractors c');
      await release(2);
      let c = await card(ids.org!);
      expect(c.state).toBe('broken');
      expect(c.checkError).toBe(txt('err.dm_check_removed').replace('{column}', 'name'));

      await setQuery(ids.org!, 'select c.id as cp_id, c.name, pg_sleep(0) as z from contractors c');
      await release(1);
      c = await card(ids.org!);
      expect(c.state).toBe('broken');
      expect(c.checkError).toBe(txt('err.dm_sql_forbidden').replace('{word}', 'pg_sleep'));

      await setQuery(ids.org!, 'select c.id as cp_id, c.name from contractors c');
      await release(1);
      expect(await card(ids.org!)).toMatchObject({ state: 'published', checkError: null });
    } finally {
      for (const hash of hashes) {
        await f.t.admin.db.execute(
          sql`delete from drizzle.__drizzle_migrations where hash = ${hash}`,
        );
      }
    }
  });

  it('шаблон Админки не выполнился — «Сломан»; отключённый не проверяется', async () => {
    await setQuery(ids.adm!, 'select 1 / 0 as n');
    clock.set('2026-11-21T22:05:00Z');
    expect(await job.run(deps, clock.now())).toBe(2);
    const c = await card(ids.adm!);
    expect(c.state).toBe('broken');
    expect(c.checkError).toContain('22012');

    const off = await admin('POST', `/${ids.org}/state`, {
      to: 'off',
      reason: 'Проверка',
      version: (await card(ids.org!)).version,
    });
    expect(off.status, await off.clone().text()).toBe(200);
    clock.set('2026-11-22T22:05:00Z');
    expect(await job.run(deps, clock.now())).toBe(1);
    expect((await stateOf(ids.org!)).state).toBe('off');
  });

  it('итог по устаревшей версии не пишется; функции проверки — только задаче: не вошедшему и не организации', async () => {
    const t = await stateOf(ids.adm!);
    expect(
      await dmCheckMark(f.t.app.db, {
        id: ids.adm!,
        version: t.version - 1,
        ok: true,
        error: null,
        orgId: null,
        schema: 0,
        now: clock.now(),
      }),
    ).toBe('skip');
    expect((await stateOf(ids.adm!)).state).toBe('broken');
    const [adminUser] = await f.t.admin.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.login, 'platform-admin'));
    await expect(
      withUserContext(f.t.app.db, adminUser!.id, (tx) =>
        tx.execute(sql`select app.dm_check_due(now(), 10)`),
      ),
    ).rejects.toThrow();
    await expect(
      withUserContext(f.t.app.db, adminUser!.id, (tx) =>
        tx.execute(
          sql`select app.dm_check_mark(${ids.adm!}::uuid, ${t.version}, true, null, null, 0, now())`,
        ),
      ),
    ).rejects.toThrow();
    for (const q of [
      sql`select app.dm_check_due(now(), 10)`,
      sql`select app.dm_check_mark(${ids.adm!}::uuid, ${t.version}, true, null, null, 0, now())`,
    ]) {
      await expect(
        withOrgContext(f.t.app.db, { orgId: f.a.orgId, userId: null }, (tx) => tx.execute(q)),
      ).rejects.toThrow();
    }
    expect((await stateOf(ids.adm!)).state).toBe('broken');
  });

  it('строку истории платформы без автора («Система») или от чужого имени пишет только функция задачи: роль приложения — нет', async () => {
    const [adminUser] = await f.t.admin.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.login, 'platform-admin'));
    const [other] = await f.t.admin.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.login, 'owner-a'));
    const insert = (actor: string | null) =>
      sql`insert into platform_audit_log (entity, entity_id, action, changes, actor_user_id)
        values ('dm_template', ${ids.adm!}, 'dm_state', '[]'::jsonb, ${actor}::uuid)`;
    for (const actor of [null, other!.id]) {
      // Администратор платформы — ни без автора, ни от чужого имени.
      await expect(
        withUserContext(f.t.app.db, adminUser!.id, (tx) => tx.execute(insert(actor))),
      ).rejects.toThrow();
      // Без вошедшего (задача, внешний вызов) — тоже.
      await expect(f.t.app.db.execute(insert(actor))).rejects.toThrow();
    }
    // От своего имени администратор пишет, как и прежде.
    await withUserContext(f.t.app.db, adminUser!.id, (tx) => tx.execute(insert(adminUser!.id)));
  });

  it('без демо-организации (рабочий сайт) шаблон организаций проверяется в пустом контексте: строк организаций не видно, поломка ловится', async () => {
    await f.t.admin.db
      .update(organizations)
      .set({ isDemo: false })
      .where(eq(organizations.id, f.b.orgId));
    const on = await admin('POST', `/${ids.org}/state`, {
      to: 'published',
      reason: 'Проверка',
      version: (await card(ids.org!)).version,
    });
    expect(on.status, await on.clone().text()).toBe(200);
    await setQuery(ids.org!, 'select c.id as cp_id, c.nope as name from contractors c');
    clock.set('2026-11-23T22:05:00Z');
    // Оба шаблона: организаций — в пустом контексте, Админки — от администратора.
    expect(await job.run(deps, clock.now())).toBe(2);
    const c = await card(ids.org!);
    expect(c.state).toBe('broken');
    expect(c.checkError).toContain('nope');
    const [row] = await f.t.admin.db
      .select()
      .from(dmTemplateSql)
      .where(eq(dmTemplateSql.templateId, ids.org!));
    expect(row!.checkedOrgId).toBeNull();
    // Пустой контекст не видит ни одной строки организаций — данные настоящих организаций не читаются.
    const count = {
      text: 'select (select count(*) from organizations)::int as orgs, (select count(*) from ownership_forms)::int as forms',
      params: [],
      maxRows: 1,
    };
    const own = await runDmOrg(f.t.app.db, { orgId: f.a.orgId }, count);
    expect(own.rows[0]![0]).toBe(1);
    const seen = await runDmOrg(f.t.app.db, { orgId: DM_NO_DATA_ORG }, count);
    // Своей организации нет, справочники платформы — как у любой организации.
    expect(seen.rows).toEqual([[0, own.rows[0]![1]]]);
  });
});
