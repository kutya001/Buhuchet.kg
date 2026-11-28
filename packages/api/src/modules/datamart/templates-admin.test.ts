import { randomUUID } from 'node:crypto';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import {
  DmAdminTemplateCard,
  DmAdminTemplateList,
  DmCatalog,
  DmTemplateCheckResult,
  DmTemplateEditorForm,
  ListValues,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

/*
 * Админка → «Витрина данных» → «Шаблоны» (доработки 20.11.2026: Витрина данных, блок 2, пункты 2–7;
 * блок 3, пункт 1; общий план 20.11, этап 2, П3): только администратор платформы; «Проверить» на
 * выбранной организации (строки только её) и по умолчанию на демо; «Опубликовать» — только после
 * проверки сервером; у опубликованного код не меняется и столбцы только добавляются; «Копировать»,
 * «Отключить» и «Включить» с причиной; готовый шаблон — только копией; история платформы; список с
 * токенами и организациями.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const {
  auditLog,
  contractors,
  dmRequests,
  dmTemplates,
  dmTemplateSql,
  organizations,
  orgSettings,
} = schema;
const txt = (key: keyof typeof UI_TEXTS) => UI_TEXTS[key].ru;

const CP_QUERY =
  'select c.id as contractor_id, c.name as cp, :month as m\nfrom contractors c\norder by c.name';
const param = { code: 'month', name: 'Месяц', type: 'month', required: true, default: 'month' };
const columns = [
  { code: 'contractor_id', name: 'Контрагент (для области)', type: 'cp', total: false },
  { code: 'cp', name: 'Контрагент', type: 'text', total: false },
  { code: 'm', name: 'Месяц', type: 'month', total: false },
];

describe.skipIf(!databaseAvailable())('Витрина данных: шаблоны Админки', () => {
  let f: Fixture;
  const cookies: Record<string, string> = {};

  const call = (
    login: string | null,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, login ? cookies[login] : undefined, body);
  const admin = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
    call('platform-admin', method, `/api/admin/dm/templates${path}`, body);
  const ok = async <T>(res: Response, status: number, parse: { parse: (v: unknown) => T }) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return parse.parse(await res.json());
  };
  const fail = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return ((await res.json()) as { error: { code: string; message: string; details?: unknown } })
      .error;
  };
  const form = (code: string, over: Record<string, unknown> = {}) => ({
    name: `Шаблон ${code}`,
    code,
    description: 'Контрагенты организации',
    audience: 'org',
    module: 'cps',
    needPermission: null,
    access: 'all',
    orgIds: [],
    query: CP_QUERY,
    params: [param],
    columns,
    ...over,
  });
  const create = (code: string, over: Record<string, unknown> = {}) =>
    admin('POST', '', form(code, over));

  beforeAll(async () => {
    f = await createStaffFixture();
    for (const login of ['owner-a', 'owner-b', 'platform-admin']) {
      cookies[login] = await signIn(f.app, login, TEST_PASSWORD);
    }
    const db = f.t.admin.db;
    await seedAllPlatformDictionaries(db);
    let n = 0;
    for (const [orgId, name] of [
      [f.a.orgId, 'Альфа'],
      [f.a.orgId, 'Бета'],
      [f.b.orgId, 'Гамма'],
    ] as const) {
      n += 1;
      await db.insert(contractors).values({
        orgId,
        name,
        inn: `0${String(n).padStart(13, '5')}`,
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
      });
    }
    // Организация Б — демо: «Проверить» без выбора идёт на ней.
    await db.update(organizations).set({ isDemo: true }).where(eq(organizations.id, f.b.orgId));
    await db.update(orgSettings).set({ extApi: true }).where(eq(orgSettings.orgId, f.a.orgId));
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('только администратору платформы: сотруднику — 403, без входа — 401 (все методы)', async () => {
    const id = randomUUID();
    for (const [method, path, body] of [
      ['GET', '', undefined],
      ['GET', '/values?col=state', undefined],
      ['GET', '/export', undefined],
      ['GET', '/form', undefined],
      ['POST', '/check', { audience: 'org', query: 'select 1 as n' }],
      ['POST', '', form('x-forbidden')],
      ['GET', `/${id}`, undefined],
      ['PUT', `/${id}`, { ...form('x-forbidden'), version: 1 }],
      ['POST', `/${id}/copy`, {}],
      ['POST', `/${id}/state`, { to: 'off', reason: 'Проверка', version: 1 }],
    ] as const) {
      const url = `/api/admin/dm/templates${path}`;
      expect((await call('owner-a', method, url, body)).status).toBe(403);
      expect((await call(null, method, url, body)).status).toBe(401);
    }
  });

  it('окно: организации — демо первой', async () => {
    const res = await ok(await admin('GET', '/form'), 200, DmTemplateEditorForm);
    expect(res.orgs[0]).toMatchObject({ id: f.b.orgId, demo: true });
    expect(res.orgs.map((o) => o.id)).toContain(f.a.orgId);
  });

  it('«Проверить»: на выбранной организации — только её строки, параметры и столбцы из запроса, запись в её историю', async () => {
    const res = await ok(
      await admin('POST', '/check', {
        audience: 'org',
        query: CP_QUERY,
        params: [],
        columns: [],
        checkOrgId: f.a.orgId,
      }),
      200,
      DmTemplateCheckResult,
    );
    if (!res.ok) throw new Error(res.message);
    expect(res.n).toBe(2);
    expect(res.orgName).toBeTruthy();
    expect(res.rows.map((r) => r[1])).toEqual(['Альфа', 'Бета']);
    // Обязательный параметр без значения по умолчанию при проверке — пустой.
    expect(res.rows[0]![2]).toBeNull();
    expect(res.params).toEqual([
      { code: 'month', name: 'month', type: 'month', required: true, default: null },
    ]);
    expect(res.columns.map((c) => [c.code, c.type])).toEqual([
      ['contractor_id', 'cp'],
      ['cp', 'text'],
      ['m', 'text'],
    ]);
    const views = await f.t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, f.a.orgId), eq(auditLog.action, 'card_view')));
    // Новый шаблон — запись без названия (п. О-96).
    expect(views.map((v) => v.reason)).toContain(txt('dm.tpl.history_check_new'));
  });

  it('«Проверить»: в истории организации — название только шаблона «Для организаций», доступного ей', async () => {
    const saved = async (code: string, over: Record<string, unknown>) =>
      (await ok(await create(code, over), 201, DmAdminTemplateCard)).id;
    const forAll = await saved('hist-all', {});
    const forB = await saved('hist-b', { access: 'selected', orgIds: [f.b.orgId] });
    const forAdmin = await saved('hist-adm', {
      audience: 'admin',
      module: null,
      query: 'select 1 as n',
      params: [],
      columns: [{ code: 'n', name: 'n', type: 'num', total: false }],
    });
    const reasons = async () =>
      (
        await f.t.admin.db
          .select({ reason: auditLog.reason })
          .from(auditLog)
          .where(and(eq(auditLog.orgId, f.a.orgId), eq(auditLog.action, 'card_view')))
          .orderBy(auditLog.id)
      ).map((r) => r.reason);
    const before = (await reasons()).length;
    for (const templateId of [forAll, forB, forAdmin]) {
      const res = await ok(
        await admin('POST', '/check', {
          templateId,
          audience: 'org',
          query: CP_QUERY,
          params: [],
          columns: [],
          checkOrgId: f.a.orgId,
        }),
        200,
        DmTemplateCheckResult,
      );
      expect(res.ok).toBe(true);
    }
    expect((await reasons()).slice(before)).toEqual([
      txt('dm.tpl.history_check').replace('{name}', 'Шаблон hist-all'),
      txt('dm.tpl.history_check_new'),
      txt('dm.tpl.history_check_new'),
    ]);
  });

  it('«Проверить»: по умолчанию — демо-организация; ошибка — текстом базы; столбцы без имени и лишние слова — отказ', async () => {
    const demo = await ok(
      await admin('POST', '/check', {
        audience: 'org',
        query: 'select c.name as cp from contractors c',
      }),
      200,
      DmTemplateCheckResult,
    );
    expect(demo).toMatchObject({ ok: true, n: 1, rows: [['Гамма']] });
    const db = await ok(
      await admin('POST', '/check', {
        audience: 'org',
        query: 'select nope as cp from contractors',
      }),
      200,
      DmTemplateCheckResult,
    );
    expect(db).toMatchObject({ ok: false, problem: 'failed' });
    if (!db.ok) expect(db.message).toContain('nope');
    // Таблица платформы у шаблона «Для организаций» — словами (этап 2 консоли, П7; прототип v167).
    const closed = await ok(
      await admin('POST', '/check', {
        audience: 'org',
        query: 'select id as n from platform_leads',
      }),
      200,
      DmTemplateCheckResult,
    );
    expect(closed).toMatchObject({
      ok: false,
      problem: 'failed',
      message: txt('err.dm_console_closed').replace('{table}', 'platform_leads'),
    });
    const noName = await ok(
      await admin('POST', '/check', { audience: 'admin', query: 'select 1' }),
      200,
      DmTemplateCheckResult,
    );
    expect(noName).toMatchObject({ ok: false, problem: 'bad_name' });
    const bad = await ok(
      await admin('POST', '/check', { audience: 'admin', query: 'select pg_sleep(1) as n' }),
      200,
      DmTemplateCheckResult,
    );
    expect(bad).toMatchObject({ ok: false, problem: 'sql' });
    if (!bad.ok)
      expect(bad.message).toBe(txt('err.dm_sql_forbidden').replace('{word}', 'pg_sleep'));
    // Ошибка разбора — текстом самого PostgreSQL, «FOR UPDATE» — своей причиной (разборщик, этап 0, П2).
    const syntax = await ok(
      await admin('POST', '/check', { audience: 'admin', query: 'select 1 as n from' }),
      200,
      DmTemplateCheckResult,
    );
    expect(syntax).toMatchObject({ ok: false, problem: 'sql' });
    if (!syntax.ok) {
      expect(syntax.message.startsWith(txt('err.dm_sql_syntax').split('{error}')[0]!)).toBe(true);
      expect(syntax.message).toContain('syntax error');
    }
    const lock = await ok(
      await admin('POST', '/check', { audience: 'admin', query: 'select 1 as n for update' }),
      200,
      DmTemplateCheckResult,
    );
    if (!lock.ok) expect(lock.message).toBe(txt('err.dm_sql_lock'));
    expect(lock.ok).toBe(false);
    const adm = await ok(
      await admin('POST', '/check', { audience: 'admin', query: 'select 7 as n' }),
      200,
      DmTemplateCheckResult,
    );
    expect(adm).toMatchObject({ ok: true, orgName: null, rows: [[7]] });
    expect(
      (
        await admin('POST', '/check', {
          audience: 'org',
          query: 'select 1 as n',
          checkOrgId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(404);
  });

  it('черновик: сохранить без проверки; неверный запрос, неописанный параметр, пустой доступ, занятый код — отказ', async () => {
    const draft = await ok(await create('cps-draft'), 201, DmAdminTemplateCard);
    expect(draft).toMatchObject({
      state: 'draft',
      locked: false,
      builtin: false,
      checkedAt: null,
      version: 1,
      toks: 0,
    });
    expect(draft.history.map((h) => h.what)).toEqual([
      txt('dm.tpl.hist.create').replace('{state}', txt('dm.tpl.state.draft')),
    ]);
    expect((await fail(await create('cps-draft'), 400)).code).toBe('dm_code_taken');
    expect(
      (await fail(await create('cps-bad', { query: 'delete from contractors' }), 400)).code,
    ).toBe('dm_sql_not_select');
    expect((await fail(await create('cps-par', { params: [] }), 400)).code).toBe(
      'dm_param_missing',
    );
    expect(
      (await fail(await create('cps-sel', { access: 'selected', orgIds: [] }), 400)).code,
    ).toBe('dm_orgs_required');
    expect((await fail(await create('cps-mod', { module: null }), 400)).code).toBe(
      'dm_module_required',
    );
    expect(
      (
        await fail(
          await create('cps-two', { columns: [columns[0], { ...columns[1], type: 'cp' }] }),
          400,
        )
      ).code,
    ).toBe('dm_check_two_cp');
  });

  it('«Опубликовать»: сервер проверяет сам; не прошла — шаблон остаётся черновиком; потом код не меняется, столбцы только добавляются', async () => {
    const draft = await ok(await create('cps-pub'), 201, DmAdminTemplateCard);
    const save = (over: Record<string, unknown>, version: number) =>
      admin('PUT', `/${draft.id}`, { ...form('cps-pub'), version, ...over });
    // Столбца нет в ответе базы — окно не проверяли.
    expect(
      (
        await fail(
          await save(
            {
              publish: true,
              columns: [...columns, { code: 'x', name: 'Х', type: 'text', total: false }],
            },
            1,
          ),
          409,
        )
      ).code,
    ).toBe('dm_check_required');
    expect(
      (
        await fail(
          await save({ publish: true, query: 'select nope as cp from contractors', params: [] }, 1),
          409,
        )
      ).code,
    ).toBe('dm_check_failed');
    const pub = await ok(
      await save({ publish: true, checkOrgId: f.a.orgId }, 1),
      200,
      DmAdminTemplateCard,
    );
    expect(pub).toMatchObject({ state: 'published', locked: true, version: 2 });
    expect(pub.checkedAt).not.toBeNull();
    expect(pub.history[0]!.what).toBe(
      txt('dm.tpl.hist.state')
        .replace('{from}', txt('dm.tpl.state.draft'))
        .replace('{to}', txt('dm.tpl.state.published')),
    );
    // Организация видит опубликованный шаблон в каталоге.
    const cat = await ok(await call('owner-a', 'GET', '/api/dm/output'), 200, DmCatalog);
    expect(cat.items.map((t) => t.code)).toContain('cps-pub');

    expect((await fail(await save({ code: 'cps-pub2' }, 2), 400)).code).toBe('dm_code_locked');
    expect((await fail(await save({ audience: 'admin', module: null }, 2), 400)).code).toBe(
      'dm_kind_locked',
    );
    expect((await fail(await save({ columns: columns.slice(0, 2) }, 2), 400)).code).toBe(
      'dm_check_removed',
    );
    expect((await fail(await save({ name: 'Старая версия' }, 1), 409)).code).toBe('record_changed');
    // Новое название без правки запроса — без проверки; в истории — что изменилось.
    const renamed = await ok(
      await save({ name: 'Контрагенты и месяц' }, 2),
      200,
      DmAdminTemplateCard,
    );
    expect(renamed.history[0]!.what).toBe(
      txt('dm.tpl.hist.update').replace('{fields}', txt('dm.tpl.field.name')),
    );
    // Добавить столбец можно — после проверки сервером.
    const added = await ok(
      await save(
        {
          name: 'Контрагенты и месяц',
          query:
            'select c.id as contractor_id, c.name as cp, :month as m, c.inn as inn\nfrom contractors c',
          columns: [...columns, { code: 'inn', name: 'ИНН', type: 'text', total: false }],
          checkOrgId: f.a.orgId,
        },
        3,
      ),
      200,
      DmAdminTemplateCard,
    );
    expect(added.columns.map((c) => c.code)).toEqual(['contractor_id', 'cp', 'm', 'inn']);
    expect(added.state).toBe('published');
    const [sqlRow] = await f.t.admin.db
      .select()
      .from(dmTemplateSql)
      .where(eq(dmTemplateSql.templateId, draft.id));
    expect(sqlRow).toMatchObject({ checkedOrgId: f.a.orgId, checkError: null });
  });

  it('«Отключить» и «Включить» с причиной; сломанный после «Опубликовать» с успешной проверкой — снова «Опубликован»', async () => {
    const t0 = await ok(await create('cps-state', { publish: true }), 201, DmAdminTemplateCard);
    expect(t0.state).toBe('published');
    const state = (to: string, version: number, reason = 'Проверка') =>
      admin('POST', `/${t0.id}/state`, { to, reason, version });
    expect((await state('off', 1, '  ')).status).toBe(400);
    const off = await ok(await state('off', 1, 'Нашли ошибку в итогах'), 200, DmAdminTemplateCard);
    expect(off).toMatchObject({ state: 'off', canOff: false, canOn: true });
    expect(off.history[0]!.what).toBe(
      txt('dm.tpl.hist.state_reason')
        .replace('{from}', txt('dm.tpl.state.published'))
        .replace('{to}', txt('dm.tpl.state.off'))
        .replace('{reason}', 'Нашли ошибку в итогах'),
    );
    expect((await fail(await state('off', 2), 409)).code).toBe('dm_state_bad');
    const on = await ok(await state('published', 2), 200, DmAdminTemplateCard);
    expect(on.state).toBe('published');
    const draft = await ok(await create('cps-state-d'), 201, DmAdminTemplateCard);
    expect(
      (
        await fail(
          await admin('POST', `/${draft.id}/state`, { to: 'off', reason: 'х', version: 1 }),
          409,
        )
      ).code,
    ).toBe('dm_state_bad');

    await f.t.admin.db
      .update(dmTemplates)
      .set({ state: 'broken' })
      .where(eq(dmTemplates.id, t0.id));
    const fixed = await ok(
      await admin('PUT', `/${t0.id}`, { ...form('cps-state'), version: 3, publish: true }),
      200,
      DmAdminTemplateCard,
    );
    expect(fixed.state).toBe('published');
  });

  it('«Копировать»: новый черновик с кодом -copy, -copy2; готовый шаблон — только копией', async () => {
    const [b] = await f.t.admin.db
      .insert(dmTemplates)
      .values({
        code: 'ready-made',
        name: 'Готовый',
        module: 'cps',
        state: 'published',
        builtin: true,
        columns: [
          { code: 'cp', name: 'Контрагент', type: 'text', total: false, contractor: false },
        ],
      })
      .returning({ id: dmTemplates.id });
    await f.t.admin.db
      .insert(dmTemplateSql)
      .values({ templateId: b!.id, query: 'select c.name as cp from contractors c' });
    expect(
      (await fail(await admin('PUT', `/${b!.id}`, { ...form('ready-made'), version: 1 }), 409))
        .code,
    ).toBe('dm_builtin');
    const c1 = await ok(await admin('POST', `/${b!.id}/copy`), 201, DmAdminTemplateCard);
    expect(c1).toMatchObject({
      code: 'ready-made-copy',
      name: txt('dm.tpl.copy_name').replace('{name}', 'Готовый'),
      state: 'draft',
      builtin: false,
      checkedAt: null,
      copiedFromName: 'Готовый',
      query: 'select c.name as cp from contractors c',
    });
    expect(c1.history[0]!.what).toBe(
      txt('dm.tpl.hist.copy')
        .replace('{name}', 'Готовый')
        .replace('{state}', txt('dm.tpl.state.draft')),
    );
    const c2 = await ok(await admin('POST', `/${b!.id}/copy`), 201, DmAdminTemplateCard);
    expect(c2.code).toBe('ready-made-copy2');
    // Готовый можно отключить.
    const off = await ok(
      await admin('POST', `/${b!.id}/state`, { to: 'off', reason: 'Свой лучше', version: 1 }),
      200,
      DmAdminTemplateCard,
    );
    expect(off.state).toBe('off');
    expect((await admin('POST', '/00000000-0000-4000-8000-000000000000/copy')).status).toBe(404);
  });

  it('доступ «Выбранные»: шаблон видит только выбранная организация', async () => {
    const sel = await ok(
      await create('cps-sel-a', {
        access: 'selected',
        orgIds: [f.a.orgId],
        publish: true,
        checkOrgId: f.a.orgId,
      }),
      201,
      DmAdminTemplateCard,
    );
    expect(sel.orgIds).toEqual([f.a.orgId]);
    const a = await ok(await call('owner-a', 'GET', '/api/dm/output'), 200, DmCatalog);
    const b = await ok(await call('owner-b', 'GET', '/api/dm/output'), 200, DmCatalog);
    expect(a.items.map((t) => t.code)).toContain('cps-sel-a');
    expect(b.items.map((t) => t.code)).not.toContain('cps-sel-a');
  });

  it('список: по названию, «Токенов» — действующих, «Организаций пользуется» — токены и запросы по токенам за 30 дней; значения и Excel', async () => {
    const t0 = await ok(
      await create('cps-list', { publish: true, name: 'Аааа список' }),
      201,
      DmAdminTemplateCard,
    );
    const tok = await call('owner-a', 'POST', '/api/dm/tokens', {
      templateId: t0.id,
      name: 'Power BI',
      term: 30,
    });
    expect(tok.status, await tok.clone().text()).toBe(201);
    // «Показать» с экрана не считается (прототип `dmUse`: токены и их журнал), запрос по токену — да;
    // «за 30 дней» — по часам приложения: запрос 31 день назад не считается.
    const now = f.deps.clock.now().getTime();
    await f.t.admin.db.insert(dmRequests).values([
      {
        orgId: f.b.orgId,
        templateId: t0.id,
        via: 'screen',
        outcome: 'ok',
        at: new Date(now - 60_000),
      },
      {
        orgId: f.b.orgId,
        templateId: t0.id,
        via: 'api',
        outcome: 'ok',
        at: new Date(now - 31 * 86_400_000),
      },
    ]);
    const screenOnly = await ok(await admin('GET', `/${t0.id}`), 200, DmAdminTemplateCard);
    expect(screenOnly).toMatchObject({ toks: 1, tokOrgs: 1, orgs: 1 });
    await f.t.admin.db.insert(dmRequests).values({
      orgId: f.b.orgId,
      templateId: t0.id,
      via: 'api',
      outcome: 'ok',
      at: new Date(now - 29 * 86_400_000),
    });
    const page = await ok(await admin('GET', '?size=100'), 200, DmAdminTemplateList);
    expect(page.items[0]!.name).toBe('Аааа список');
    const names = page.items.map((r) => r.name);
    expect([...names].sort((x, y) => x.localeCompare(y, 'ru'))).toEqual(names);
    expect(page.items[0]).toMatchObject({ toks: 1, orgs: 2, state: 'published', canOff: true });
    const card = await ok(await admin('GET', `/${t0.id}`), 200, DmAdminTemplateCard);
    expect(card).toMatchObject({ toks: 1, tokOrgs: 1, orgs: 2 });

    const vals = await ok(await admin('GET', '/values?col=state'), 200, ListValues);
    expect(JSON.stringify(vals)).toContain(txt('dm.tpl.state.published'));
    const filtered = await ok(
      await admin(
        'GET',
        `?filters=${encodeURIComponent(JSON.stringify({ state: { type: 'enum', vals: ['draft'] } }))}&size=100`,
      ),
      200,
      DmAdminTemplateList,
    );
    expect(filtered.items.every((r) => r.state === 'draft')).toBe(true);
    const xlsx = await admin('GET', '/export?cols=name,code,state,toks');
    expect(xlsx.status, await xlsx.clone().text()).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheet');
  });
});
