import { randomUUID } from 'node:crypto';
import { schema, takeRateLimit } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import { DmCatalog, DmRunResult } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { DM_RUN_RATE_LIMIT } from './output';
import { runDmTemplate } from './run';

/*
 * «Витрина данных» → «Вывод» и каталог «Шаблоны» (доработки 20.11.2026: Витрина данных, блоки 3–4;
 * блок 8, пункты 1 и 8; общий план 20.11, этап 2, П3–П4): права, видимость шаблонов, изоляция
 * организаций, область «Свои контрагенты», неверный параметр, сломанный шаблон, «глазами организации»,
 * журнал запросов, один запрос одновременно.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { auditLog, contractors, dmRequests, dmTemplateOrgs, dmTemplates, dmTemplateSql } = schema;
const txt = (key: keyof typeof UI_TEXTS) => UI_TEXTS[key].ru;

const col = (code: string, type = 'text', extra: Record<string, unknown> = {}) => ({
  code,
  name: `Столбец ${code}`,
  type,
  total: false,
  contractor: false,
  ...extra,
});
const cpCol = col('contractor_id', 'cp', { contractor: true });

describe.skipIf(!databaseAvailable())('Витрина данных: «Вывод» и каталог', () => {
  let f: Fixture;
  const cookies: Record<string, string> = {};
  const tpl: Record<string, string> = {};
  const cp: Record<string, string> = {};

  const call = (login: string | null, method: 'GET' | 'POST', path: string, body?: unknown) =>
    apiRequest(f.app, method, path, login ? cookies[login] : undefined, body);
  const ok = async <T>(res: Response, status: number, parse: { parse: (v: unknown) => T }) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return parse.parse(await res.json());
  };
  const fail = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return ((await res.json()) as { error: { code: string; message: string; details?: unknown } })
      .error;
  };
  const run = (login: string, code: string, params: Record<string, string | null> = {}) =>
    call(login, 'POST', '/api/dm/output/run', { code, params });
  const adminRun = (code: string, params: Record<string, string | null> = {}, orgId?: string) =>
    call('platform-admin', 'POST', '/api/admin/dm/output/run', { code, params, orgId });
  const codes = (cat: DmCatalog) => cat.items.map((t) => t.code).sort();

  beforeAll(async () => {
    f = await createStaffFixture();
    for (const login of ['owner-a', 'senior-a', 'acc-a', 'owner-b', 'platform-admin']) {
      cookies[login] = await signIn(f.app, login, TEST_PASSWORD);
    }
    const db = f.t.admin.db;
    await seedAllPlatformDictionaries(db);
    // «Старший» в А: «Просматривать контрагентов» и «Смотреть витрину данных», область — «Свои».
    await db
      .insert(schema.rolePermissions)
      .values({ orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId: 'dmView' });
    const addCp = async (key: string, orgId: string, name: string, responsible: string | null) => {
      const [row] = await db
        .insert(contractors)
        .values({
          orgId,
          name,
          inn: `0${String(Object.keys(cp).length + 1).padStart(13, '7')}`,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-07-01',
          responsibleEmployeeId: responsible,
        })
        .returning({ id: contractors.id });
      cp[key] = row!.id;
    };
    await addCp('mine', f.a.orgId, 'Альфа', f.people['senior-a']!.employeeId);
    await addCp('other', f.a.orgId, 'Бета', f.people['acc-a']!.employeeId);
    await addCp('none', f.a.orgId, 'Вега', null);
    await addCp('b', f.b.orgId, 'Гамма', null);

    const add = async (
      code: string,
      query: string,
      over: Partial<typeof dmTemplates.$inferInsert> = {},
    ) => {
      const [t] = await db
        .insert(dmTemplates)
        .values({
          code,
          name: `Шаблон ${code}`,
          module: 'cps',
          state: 'published',
          columns: [cpCol, col('name')],
          ...over,
        })
        .returning({ id: dmTemplates.id });
      tpl[code] = t!.id;
      await db.insert(dmTemplateSql).values({ templateId: t!.id, query });
    };
    await add(
      'out-cps',
      'select c.id as contractor_id, c.name as name, 125050::bigint as fee from contractors c order by c.name',
      { columns: [col('name'), cpCol, col('fee', 'money', { total: true })] },
    );
    await add('out-total', 'select count(*)::int as n from contractors', {
      columns: [col('n', 'num')],
    });
    await add('out-month', 'select :month as m, :n::int as n', {
      columns: [col('m', 'month'), col('n', 'num')],
      params: [
        { code: 'month', name: 'Месяц', type: 'month', required: true, default: 'month' },
        { code: 'n', name: 'Число', type: 'num', required: false, default: null },
      ],
    });
    await add('out-broken', 'select 1 as name', { state: 'broken', columns: [col('name')] });
    await db
      .update(dmTemplateSql)
      .set({ checkError: 'relation "nope" does not exist' })
      .where(eq(dmTemplateSql.templateId, tpl['out-broken']!));
    await add('out-fail', 'select nope as name from contractors', { columns: [col('name')] });
    await add('out-sel', 'select 1 as name', { access: 'selected', columns: [col('name')] });
    await db.insert(dmTemplateOrgs).values({ templateId: tpl['out-sel']!, orgId: f.b.orgId });
    await add('out-draft', 'select 1 as name', { state: 'draft', columns: [col('name')] });
    await add('out-off', 'select 1 as name', { state: 'off', columns: [col('name')] });
    await add('out-rep', 'select 1 as name', { module: 'reports', columns: [col('name')] });
    await add('out-adm', 'select count(*)::int as n from organizations', {
      audience: 'admin',
      module: null,
      columns: [col('n', 'num')],
    });
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('права: без «Смотреть витрину данных» — 403, без входа — 401; Админка — только администратору платформы', async () => {
    for (const [method, path] of [
      ['GET', '/api/dm/output'],
      ['POST', '/api/dm/output/run'],
    ] as const) {
      const body = method === 'POST' ? { code: 'out-cps', params: {} } : undefined;
      expect((await call('acc-a', method, path, body)).status).toBe(403);
      expect((await call(null, method, path, body)).status).toBe(401);
      expect((await call('platform-admin', method, path, body)).status).toBe(403);
      expect((await call('owner-a', method, `/api/admin${path.slice(4)}`, body)).status).toBe(403);
    }
  });

  it('каталог: опубликованные и сломанные шаблоны «Для организаций» с доступом и по правам; без текста запроса и «Контрагента»', async () => {
    const own = await ok(await call('owner-a', 'GET', '/api/dm/output'), 200, DmCatalog);
    expect(codes(own)).toEqual([
      'out-broken',
      'out-cps',
      'out-fail',
      'out-month',
      'out-rep',
      'out-total',
    ]);
    expect(own).toMatchObject({ canExport: true, canTokens: true });
    const cps = own.items.find((t) => t.code === 'out-cps')!;
    expect(cps.columns.map((c) => c.code)).toEqual(['name', 'fee']);
    expect(JSON.stringify(own)).not.toContain('contractor_id');
    expect(JSON.stringify(own)).not.toContain('select');
    const month = own.items.find((t) => t.code === 'out-month')!;
    expect(month.params[0]).toMatchObject({ code: 'month', required: true, default: 'month' });
    expect(month.params[0]!.value).toMatch(/^\d{4}-\d{2}$/);
    // Чужая организация: шаблон с доступом «Выбранные» — только ей.
    const b = await ok(await call('owner-b', 'GET', '/api/dm/output'), 200, DmCatalog);
    expect(codes(b)).toContain('out-sel');
    // «Старший»: только «Контрагенты» (нет «Просматривать отчёты») и только со столбцом «Контрагент».
    const senior = await ok(await call('senior-a', 'GET', '/api/dm/output'), 200, DmCatalog);
    expect(codes(senior)).toEqual(['out-cps']);
    expect(senior.canTokens).toBe(false);
    // Админка — оба вида, кроме черновиков и отключённых.
    const adm = await ok(
      await call('platform-admin', 'GET', '/api/admin/dm/output'),
      200,
      DmCatalog,
    );
    expect(codes(adm)).toEqual([
      'out-adm',
      'out-broken',
      'out-cps',
      'out-fail',
      'out-month',
      'out-rep',
      'out-sel',
      'out-total',
    ]);
  });

  it('«Показать»: только строки своей организации, столбцы шаблона без «Контрагента», деньги — тыйыны; журнал', async () => {
    const a = await ok(await run('owner-a', 'out-cps'), 200, DmRunResult);
    expect(a.columns.map((c) => c.code)).toEqual(['name', 'fee']);
    expect(a.rows).toEqual([
      ['Альфа', 125050],
      ['Бета', 125050],
      ['Вега', 125050],
    ]);
    expect(a).toMatchObject({ more: false, max: 50_000, orgName: null });
    const b = await ok(await run('owner-b', 'out-cps'), 200, DmRunResult);
    expect(b.rows).toEqual([['Гамма', 125050]]);
    const log = await f.t.admin.db
      .select()
      .from(dmRequests)
      .where(and(eq(dmRequests.templateId, tpl['out-cps']!), eq(dmRequests.orgId, f.a.orgId)));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      via: 'screen',
      outcome: 'ok',
      rowCount: 3,
      tokenId: null,
      userId: f.a.ownerUserId,
    });
  });

  it('область «Свои»: сотруднику — только строки его контрагентов; шаблон без «Контрагента» и чужой модуль — 404', async () => {
    const mine = await ok(await run('senior-a', 'out-cps'), 200, DmRunResult);
    expect(mine.rows).toEqual([['Альфа', 125050]]);
    expect((await fail(await run('senior-a', 'out-total'), 404)).code).toBe(
      'dm_template_not_found',
    );
    expect((await fail(await run('senior-a', 'out-rep'), 404)).code).toBe('dm_template_not_found');
    // Чужой «Выбранные», черновик, отключённый, шаблон Админки — как нет шаблона.
    for (const code of ['out-sel', 'out-draft', 'out-off', 'out-adm', 'no-such']) {
      expect((await fail(await run('owner-a', code), 404)).code).toBe('dm_template_not_found');
    }
  });

  it('параметры: по умолчанию — значение шаблона; неверный и пустой обязательный — 400 с параметром; лишние отбрасываются', async () => {
    const def = await ok(await run('owner-a', 'out-month', { extra: 'x' }), 200, DmRunResult);
    expect(def.rows[0]![0]).toMatch(/^\d{4}-\d{2}$/);
    const given = await ok(
      await run('owner-a', 'out-month', { month: '2026-05', n: '7' }),
      200,
      DmRunResult,
    );
    expect(given.rows).toEqual([['2026-05', 7]]);
    const bad = await fail(await run('owner-a', 'out-month', { month: '2026-13' }), 400);
    expect(bad).toMatchObject({
      code: 'dm_bad_param',
      message: txt('err.dm_bad_param').replace('{param}', 'Месяц'),
      details: { param: 'month', why: 'type' },
    });
    const empty = await fail(await run('owner-a', 'out-month', { month: null }), 400);
    expect(empty.details).toEqual({ param: 'month', why: 'required' });
    const [row] = await f.t.admin.db
      .select()
      .from(dmRequests)
      .where(and(eq(dmRequests.templateId, tpl['out-month']!), eq(dmRequests.outcome, 'bad_param')))
      .limit(1);
    expect(row).toMatchObject({ params: { month: '2026-13' }, rowCount: null });
  });

  it('сломанный и упавший шаблон: «Шаблон временно не работает»; текст базы — только администратору платформы', async () => {
    const broken = await fail(await run('owner-a', 'out-broken'), 409);
    expect(broken).toMatchObject({
      code: 'dm_template_broken',
      message: txt('err.dm_template_broken'),
    });
    expect(broken.details).toBeUndefined();
    const failed = await fail(await run('owner-a', 'out-fail'), 409);
    expect(failed.details).toBeUndefined();
    // Текст базы в журнале организации не остаётся.
    const rows = await f.t.admin.db
      .select()
      .from(dmRequests)
      .where(eq(dmRequests.templateId, tpl['out-fail']!));
    expect(rows.map((r) => [r.outcome, r.error])).toEqual([
      ['error', txt('err.dm_template_broken')],
    ]);
    const adm = await fail(await adminRun('out-broken', {}, f.a.orgId), 409);
    expect(adm.details).toEqual({ error: 'relation "nope" does not exist' });
    const admFail = await fail(await adminRun('out-fail', {}, f.a.orgId), 409);
    expect((admFail.details as { error: string }).error).toContain('42703');
  });

  it('Админка: шаблон администратора — по всем организациям; шаблон организаций — «глазами организации» с записью в её историю', async () => {
    const all = await ok(await adminRun('out-adm'), 200, DmRunResult);
    expect(Number(all.rows[0]![0])).toBeGreaterThanOrEqual(2);
    expect((await fail(await adminRun('out-cps'), 400)).code).toBe('dm_org_required');
    expect((await fail(await adminRun('out-cps', {}, randomUUID()), 404)).code).toBe('not_found');
    const eyes = await ok(await adminRun('out-cps', {}, f.b.orgId), 200, DmRunResult);
    expect(eyes.rows).toEqual([['Гамма', 125050]]);
    expect(eyes.orgName).toBe('Организация Б');
    const history = await f.t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, f.b.orgId), eq(auditLog.action, 'card_view')));
    expect(history.map((h) => h.reason)).toContain(
      txt('dm.out.history_porg').replace('{name}', 'Шаблон out-cps'),
    );
  });

  it('один запрос одновременно: пока идёт прежний — 429 «Предыдущий запрос ещё выполняется»', async () => {
    const slot = await takeRateLimit(f.t.app.db, DM_RUN_RATE_LIMIT, f.a.ownerUserId);
    expect(slot.ok).toBe(true);
    expect((await fail(await run('owner-a', 'out-cps'), 429)).code).toBe('dm_busy');
  });

  it('предел времени: долгий запрос — «Запрос выполнялся слишком долго», в журнале — timeout', async () => {
    const out = await runDmTemplate(f.deps, {
      template: {
        id: tpl['out-total']!,
        code: 'out-total',
        name: 'x',
        description: null,
        audience: 'org',
        module: 'cps',
        needPermission: null,
        state: 'published',
        params: [],
        columns: [{ code: 'n', name: 'n', type: 'text', total: false, contractor: false }],
      },
      query: 'select pg_sleep(2)::text as n',
      input: {},
      who: { kind: 'org', orgId: f.b.orgId, userId: f.b.ownerUserId },
      ownContractorIds: null,
      via: 'screen',
      tokenId: null,
      ip: null,
      maxRows: 10,
      today: '2026-11-21',
      timeoutMs: 100,
    });
    expect(out).toEqual({ ok: false, outcome: 'timeout' });
    const [row] = await f.t.admin.db
      .select()
      .from(dmRequests)
      .where(and(eq(dmRequests.orgId, f.b.orgId), eq(dmRequests.outcome, 'timeout')));
    expect(row).toMatchObject({ error: txt('err.dm_timeout'), userId: f.b.ownerUserId });
  });
});
