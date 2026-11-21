import { createHash } from 'node:crypto';
import { hashPassword } from '@buhuchet/adapters/password';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { DM_TOKEN_RE, DM_TOKENS_LIVE_MAX, UI_TEXTS } from '@buhuchet/domain';
import { DmTokenCard, DmTokenForm, DmTokenIssued, DmTokenList } from '@buhuchet/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  signIn,
  TEST_PASSWORD,
  withRoleScopes,
} from '../../testing';
import { DM_TOKEN_ISSUE_RATE_LIMIT } from './tokens';

/*
 * «Витрина данных» → «API Токены» (доработки 20.11.2026: Витрина данных, блок 5; поток Т, этап 1, П14;
 * прототип v153–v155 `modules/vitrina.js`): выпуск, хранение хешем, отзыв и перевыпуск — у организации
 * и в Админке; права, изоляция организаций, демо, «Внешний доступ по API», подписка, предел 20.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { auditLog, dmTemplates, dmTemplateOrgs, dmTokens, organizations, orgSettings } = schema;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const txt = (key: keyof typeof UI_TEXTS) => UI_TEXTS[key].ru;

describe.skipIf(!databaseAvailable())('Витрина данных: API-токены', () => {
  let f: Fixture;
  const cookies: Record<string, string> = {};
  const tpl = { rep: '', cpsAll: '', cpsOwn: '', sel: '', adm: '' };

  const call = (login: string | null, method: 'GET' | 'POST', path: string, body?: unknown) =>
    apiRequest(f.app, method, path, login ? cookies[login] : undefined, body);
  const ok = async <T>(res: Response, status: number, parse: { parse: (v: unknown) => T }) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return parse.parse(await res.json());
  };
  const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error;
  const issue = (login: string, templateId: string, name: string, term = 30, base = '/api/dm') =>
    call(login, 'POST', `${base}/tokens`, { templateId, name, term });
  // Все строки одной страницей: токенов за файл набирается больше 25.
  const listOf = async (login: string, base = '/api/dm') =>
    (await ok(await call(login, 'GET', `${base}/tokens?size=all`), 200, DmTokenList)).items;
  const cardOf = async (login: string, id: string, base = '/api/dm') =>
    ok(await call(login, 'GET', `${base}/tokens/${id}`), 200, DmTokenCard);

  beforeAll(async () => {
    f = await createStaffFixture();
    for (const login of ['owner-a', 'acc-a', 'senior-a', 'owner-b', 'platform-admin']) {
      cookies[login] = await signIn(f.app, login, TEST_PASSWORD);
    }
    const db = f.t.admin.db;
    // Обе организации оплачены надолго (подписка фикстуры `TEST_SUBSCRIPTION`); «Внешний доступ по
    // API» включён у А.
    await db.update(orgSettings).set({ extApi: true }).where(eq(orgSettings.orgId, f.a.orgId));
    // «Старшему» в А — витрина с правом на токены; его область «Контрагентов» — «Все» (с «Свои» токен
    // к шаблону контрагентов не выпустить, п. Т-26 — свой тест ниже).
    await db.insert(schema.rolePermissions).values(
      ['dmView', 'dmTokens'].map((permissionId) => ({
        orgId: f.a.orgId,
        roleId: f.roleIds.senior,
        permissionId,
      })),
    );
    await db
      .update(schema.roleScopes)
      .set({ scope: 'all' })
      .where(
        and(eq(schema.roleScopes.roleId, f.roleIds.senior), eq(schema.roleScopes.permGroup, 'cps')),
      );
    const add = async (code: string, over: Partial<typeof dmTemplates.$inferInsert>) => {
      const [t] = await db
        .insert(dmTemplates)
        .values({ code, name: `Шаблон ${code}`, module: 'reports', state: 'published', ...over })
        .returning({ id: dmTemplates.id });
      return t!.id;
    };
    tpl.rep = await add('tok-rep', {});
    tpl.cpsAll = await add('tok-cps-all', { module: 'cps', columns: [{ k: 'n', type: 'int' }] });
    tpl.cpsOwn = await add('tok-cps-own', {
      module: 'cps',
      columns: [{ k: 'cp', type: 'cp', label: 'Контрагент' }],
    });
    tpl.sel = await add('tok-sel', { access: 'selected' });
    tpl.adm = await add('tok-adm', { audience: 'admin', module: null });
    await db.insert(dmTemplateOrgs).values({ templateId: tpl.sel, orgId: f.b.orgId });
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('права: без «Управлять API-токенами» — 403, без входа — 401; Админка — только администратору платформы', async () => {
    for (const [method, path] of [
      ['GET', '/api/dm/tokens'],
      ['GET', '/api/dm/tokens/form'],
      ['POST', '/api/dm/tokens'],
    ] as const) {
      const body = method === 'POST' ? { templateId: tpl.rep, name: 'x', term: 30 } : undefined;
      expect((await call('acc-a', method, path, body)).status).toBe(403);
      expect((await call(null, method, path, body)).status).toBe(401);
      expect((await call('platform-admin', method, path, body)).status).toBe(403);
      expect((await call('owner-a', method, `/api/admin${path.slice(4)}`, body)).status).toBe(403);
    }
  });

  it('окно «Новый API-токен»: шаблоны по правам сотрудника и доступу организации, сроки 7–180 дней', async () => {
    const own = await ok(await call('owner-a', 'GET', '/api/dm/tokens/form'), 200, DmTokenForm);
    expect(own).toMatchObject({
      refusal: null,
      demo: false,
      apiOff: false,
      owner: true,
      max: DM_TOKENS_LIVE_MAX,
      terms: [7, 30, 90, 180],
      defaultTerm: 30,
    });
    expect(own.templates.map((t) => t.code).sort()).toEqual([
      'tok-cps-all',
      'tok-cps-own',
      'tok-rep',
    ]);
    // «Старший»: нет «Просматривать отчёты» — только шаблоны контрагентов.
    const senior = await ok(await call('senior-a', 'GET', '/api/dm/tokens/form'), 200, DmTokenForm);
    expect(senior.templates.map((t) => t.code).sort()).toEqual(['tok-cps-all', 'tok-cps-own']);
    expect(senior.owner).toBe(false);
    // У Б выключен «Внешний доступ по API».
    const b = await ok(await call('owner-b', 'GET', '/api/dm/tokens/form'), 200, DmTokenForm);
    expect(b).toMatchObject({ refusal: 'dm_token_api_off', apiOff: true });
    expect(b.templates.map((t) => t.code).sort()).toEqual([
      'tok-cps-all',
      'tok-cps-own',
      'tok-rep',
      'tok-sel',
    ]);
  });

  it('выпуск: токен — один раз, в базе — только хеш и начало; история без токена; чужой организации не виден', async () => {
    const res = await ok(
      await issue('owner-a', tpl.rep, ' Power BI директора ', 7),
      201,
      DmTokenIssued,
    );
    expect(res.token).toMatch(DM_TOKEN_RE);
    expect(res.item).toMatchObject({
      name: 'Power BI директора',
      prefix: res.token.slice(0, 9),
      state: 'active',
      note: '',
      tplName: 'Шаблон tok-rep',
      n30: 0,
      canReissue: true,
      canRevoke: true,
      mine: true,
      prevPrefix: null,
      log: { total: 0, items: [] },
    });
    expect(new Date(res.item.till).getTime() - new Date(res.item.createdAt).getTime()).toBe(
      7 * 86_400_000,
    );
    const [row] = await f.t.admin.db.select().from(dmTokens).where(eq(dmTokens.id, res.item.id));
    expect(row).toMatchObject({
      orgId: f.a.orgId,
      tokenHash: sha(res.token),
      createdBy: f.a.ownerUserId,
    });
    expect(JSON.stringify(row)).not.toContain(res.token.slice(9));
    const hist = await f.t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'dm_token'), eq(auditLog.entityId, res.item.id)));
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ action: 'create', orgId: f.a.orgId });
    expect(JSON.stringify(hist[0]!.changes)).not.toContain(res.token.slice(9));
    // Карточка и список — без токена целиком.
    const card = await cardOf('owner-a', res.item.id);
    expect(JSON.stringify(card)).not.toContain(res.token);
    expect((await listOf('owner-a')).map((k) => k.id)).toContain(res.item.id);
    // Б не видит токен А ни в списке, ни по номеру, и не отзывает его.
    expect((await listOf('owner-b')).map((k) => k.id)).not.toContain(res.item.id);
    expect((await call('owner-b', 'GET', `/api/dm/tokens/${res.item.id}`)).status).toBe(404);
    expect((await call('owner-b', 'POST', `/api/dm/tokens/${res.item.id}/revoke`)).status).toBe(
      404,
    );
    expect((await call('owner-b', 'POST', `/api/dm/tokens/${res.item.id}/reissue`)).status).toBe(
      404,
    );
  });

  it('отказы выпуска: название, срок, шаблон не по правам или чужого вида, демо, подписка, внешний доступ', async () => {
    const fail = async (res: Response, status: number, c: string) => {
      expect(res.status, await res.clone().text()).toBe(status);
      expect((await code(res)).code).toBe(c);
    };
    await fail(await issue('owner-a', tpl.rep, '   '), 400, 'dm_token_name_required');
    await fail(await issue('owner-a', tpl.rep, 'Д'.repeat(101)), 400, 'dm_token_name_long');
    await fail(await issue('owner-a', tpl.rep, 'Power BI директора'), 409, 'dm_token_name_taken');
    await fail(await issue('owner-a', tpl.rep, 'Срок', 15), 400, 'dm_token_term');
    await fail(await issue('senior-a', tpl.rep, 'Не по правам'), 400, 'dm_token_template');
    await fail(await issue('owner-a', tpl.adm, 'Шаблон Админки'), 400, 'dm_token_template');
    await fail(await issue('owner-a', tpl.sel, 'Без доступа'), 400, 'dm_token_template');
    await fail(await issue('owner-b', tpl.rep, 'Выключен'), 403, 'dm_token_api_off');
    const db = f.t.admin.db;
    await db.update(orgSettings).set({ extApi: true }).where(eq(orgSettings.orgId, f.b.orgId));
    await db
      .update(schema.orgSubscriptions)
      .set({ paidUntil: '2020-01-31' })
      .where(eq(schema.orgSubscriptions.orgId, f.b.orgId));
    // Закрытый доступ: владельцу открыта только «Подписка» — слой входа отказывает раньше выпуска
    // (общая сборка этапа 1, п. О-89); свой отказ выпуска `dm_token_sub_closed` остаётся второй
    // проверкой (тест домена).
    await fail(await issue('owner-b', tpl.rep, 'Закрыт'), 403, 'sub_closed_owner');
    await db.update(organizations).set({ isDemo: true }).where(eq(organizations.id, f.b.orgId));
    await fail(await issue('owner-b', tpl.rep, 'Демо'), 403, 'dm_token_demo');
    const demo = await ok(await call('owner-b', 'GET', '/api/dm/tokens/form'), 200, DmTokenForm);
    expect(demo).toMatchObject({ demo: true, refusal: 'dm_token_demo' });
    await db.update(organizations).set({ isDemo: false }).where(eq(organizations.id, f.b.orgId));
    await db
      .update(schema.orgSubscriptions)
      .set({ paidUntil: '2099-12-31' })
      .where(eq(schema.orgSubscriptions.orgId, f.b.orgId));
    // «Старший» выпускает к шаблону, видимому ему.
    await ok(await issue('senior-a', tpl.cpsOwn, 'Свои контрагенты'), 201, DmTokenIssued);
  });

  it('область «Свои контрагенты»: токен к шаблону контрагентов не выпустить и не перевыпустить (п. Т-26)', async () => {
    // Токен отдаёт строки всей организации — сотрудник со «Свои» вынес бы через него чужих контрагентов.
    const made = await ok(
      await issue('senior-a', tpl.cpsOwn, 'До смены области'),
      201,
      DmTokenIssued,
    );
    const senior = f.people['senior-a']!;
    await withRoleScopes(f.t.admin.db, senior.employeeId, { cps: 'own' }, async () => {
      const form = await ok(await call('senior-a', 'GET', '/api/dm/tokens/form'), 200, DmTokenForm);
      expect(form.templates).toEqual([]);
      expect(form.refusal).toBe('dm_token_no_templates');
      const res = await issue('senior-a', tpl.cpsOwn, 'Свои');
      expect(res.status).toBe(400);
      expect((await code(res)).code).toBe('dm_token_template');
      const re = await call('senior-a', 'POST', `/api/dm/tokens/${made.item.id}/reissue`);
      expect(re.status).toBe(409);
      expect((await code(re)).code).toBe('dm_token_template');
      // Отозвать свой токен — можно.
      const done = await call('senior-a', 'POST', `/api/dm/tokens/${made.item.id}/revoke`);
      expect(done.status).toBe(200);
    });
  });

  it('отзыв: сразу и один раз, пояснение — когда и кто; история', async () => {
    const made = await ok(await issue('owner-a', tpl.cpsAll, 'Отозвать'), 201, DmTokenIssued);
    const done = await ok(
      await call('owner-a', 'POST', `/api/dm/tokens/${made.item.id}/revoke`),
      200,
      DmTokenCard,
    );
    expect(done).toMatchObject({ state: 'revoked', canRevoke: false, canReissue: false });
    expect(done.note).toMatch(/^\d\d\.\d\d\.\d{4} \d\d:\d\d, /);
    const again = await call('owner-a', 'POST', `/api/dm/tokens/${made.item.id}/revoke`);
    expect(again.status).toBe(409);
    expect((await code(again)).code).toBe('dm_token_dead');
    const reissue = await call('owner-a', 'POST', `/api/dm/tokens/${made.item.id}/reissue`);
    expect(reissue.status).toBe(409);
    const [h] = await f.t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, made.item.id), eq(auditLog.action, 'dm_revoke')));
    expect(h).toBeTruthy();
    // Отозванный не мешает выпустить токен с тем же названием.
    await ok(await issue('owner-a', tpl.cpsAll, 'Отозвать'), 201, DmTokenIssued);
  });

  it('перевыпуск: новый токен с тем же шаблоном, названием и сроком; прежний работает ещё сутки; дважды — нельзя', async () => {
    const old = await ok(
      await issue('owner-a', tpl.rep, 'Excel бухгалтерии', 90),
      201,
      DmTokenIssued,
    );
    const next = await ok(
      await call('owner-a', 'POST', `/api/dm/tokens/${old.item.id}/reissue`),
      201,
      DmTokenIssued,
    );
    expect(next.token).toMatch(DM_TOKEN_RE);
    expect(next.token).not.toBe(old.token);
    expect(next.item).toMatchObject({
      name: 'Excel бухгалтерии',
      tplName: 'Шаблон tok-rep',
      prevPrefix: old.item.prefix,
      state: 'active',
    });
    expect(new Date(next.item.till).getTime() - new Date(next.item.createdAt).getTime()).toBe(
      90 * 86_400_000,
    );
    const was = await cardOf('owner-a', old.item.id);
    expect(was).toMatchObject({ state: 'active', canReissue: false, canRevoke: true });
    expect(was.note.startsWith(txt('dm.tok.reissued_note').split('{')[0]!)).toBe(true);
    expect(new Date(was.till).getTime() - new Date(next.item.createdAt).getTime()).toBe(86_400_000);
    const twice = await call('owner-a', 'POST', `/api/dm/tokens/${old.item.id}/reissue`);
    expect(twice.status).toBe(409);
    expect((await code(twice)).code).toBe('dm_token_reissued');
    const [h] = await f.t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, next.item.id), eq(auditLog.action, 'dm_reissue')));
    expect(JSON.stringify(h!.changes)).toContain(old.item.prefix);
  });

  it('остановлен: шаблон выключили — токен «Остановлен» с причиной, перевыпуска нет; включили — снова действует', async () => {
    const made = await ok(await issue('owner-a', tpl.cpsAll, 'Остановка'), 201, DmTokenIssued);
    const db = f.t.admin.db;
    await db.update(dmTemplates).set({ state: 'off' }).where(eq(dmTemplates.id, tpl.cpsAll));
    const stopped = await cardOf('owner-a', made.item.id);
    expect(stopped).toMatchObject({
      state: 'stopped',
      stop: 'tpl_off',
      note: txt('dm.tok.stop.tpl_off'),
      tplName: 'Шаблон tok-cps-all',
      canRevoke: true,
    });
    const re = await call('owner-a', 'POST', `/api/dm/tokens/${made.item.id}/reissue`);
    expect(re.status).toBe(409);
    expect((await code(re)).code).toBe('dm_token_template');
    await db.update(dmTemplates).set({ state: 'published' }).where(eq(dmTemplates.id, tpl.cpsAll));
    await db.update(orgSettings).set({ extApi: false }).where(eq(orgSettings.orgId, f.a.orgId));
    expect((await cardOf('owner-a', made.item.id)).stop).toBe('api_off');
    // Перевыпуск — с теми же отказами, что выпуск: внешний доступ выключен — 403.
    const off = await call('owner-a', 'POST', `/api/dm/tokens/${made.item.id}/reissue`);
    expect(off.status).toBe(403);
    expect((await code(off)).code).toBe('dm_token_api_off');
    await db.update(orgSettings).set({ extApi: true }).where(eq(orgSettings.orgId, f.a.orgId));
    expect((await cardOf('owner-a', made.item.id)).state).toBe('active');
  });

  it('уволенный сотрудник: его токен работает, автор — «(уволен)»; владелец отзывает', async () => {
    const made = await ok(
      await issue('senior-a', tpl.cpsOwn, 'Токен уволенного'),
      201,
      DmTokenIssued,
    );
    const db = f.t.admin.db;
    const senior = f.people['senior-a']!;
    await db
      .update(schema.employees)
      .set({ active: false })
      .where(eq(schema.employees.id, senior.employeeId));
    try {
      const row = (await listOf('owner-a')).find((k) => k.id === made.item.id)!;
      expect(row.state).toBe('active');
      expect(row.byName.endsWith(txt('dm.tok.who_left').replace('{name}', ''))).toBe(true);
      const done = await ok(
        await call('owner-a', 'POST', `/api/dm/tokens/${made.item.id}/revoke`),
        200,
        DmTokenCard,
      );
      expect(done.state).toBe('revoked');
    } finally {
      await db
        .update(schema.employees)
        .set({ active: true })
        .where(eq(schema.employees.id, senior.employeeId));
    }
  });

  it('Админка: свои токены к шаблонам администратора и токены всех организаций; токен организации — только отозвать', async () => {
    const form = await ok(
      await call('platform-admin', 'GET', '/api/admin/dm/tokens/form'),
      200,
      DmTokenForm,
    );
    expect(form.templates.map((t) => t.code)).toEqual(['tok-adm']);
    expect(form.refusal).toBeNull();
    const fail = await issue('platform-admin', tpl.rep, 'Для организации', 30, '/api/admin/dm');
    expect(fail.status).toBe(400);
    expect((await code(fail)).code).toBe('dm_token_template');
    const own = await ok(
      await issue('platform-admin', tpl.adm, 'Сводка платформы', 180, '/api/admin/dm'),
      201,
      DmTokenIssued,
    );
    expect(own.item).toMatchObject({
      orgName: txt('dm.tok.who_admin'),
      byName: txt('dm.tok.who_admin'),
      mine: true,
    });
    // Токен Админки организациям не виден.
    expect((await listOf('owner-a')).map((k) => k.id)).not.toContain(own.item.id);
    const all = await listOf('platform-admin', '/api/admin/dm');
    const ofB = await ok(await issue('senior-a', tpl.cpsOwn, 'Б-шка'), 201, DmTokenIssued);
    const allNow = await listOf('platform-admin', '/api/admin/dm');
    expect(allNow.length).toBe(all.length + 1);
    const orgRow = allNow.find((k) => k.id === ofB.item.id)!;
    expect(orgRow).toMatchObject({ orgName: 'Организация А', canReissue: false, canRevoke: true });
    const re = await call('platform-admin', 'POST', `/api/admin/dm/tokens/${ofB.item.id}/reissue`);
    expect(re.status).toBe(403);
    expect((await code(re)).code).toBe('dm_token_not_mine');
    await ok(
      await call('platform-admin', 'POST', `/api/admin/dm/tokens/${ofB.item.id}/revoke`),
      200,
      DmTokenCard,
    );
    // Организация видит, что отозвал администратор платформы, — без его имени.
    const seen = await cardOf('owner-a', ofB.item.id);
    expect(seen.state).toBe('revoked');
    expect(seen.note.endsWith(`, ${txt('dm.tok.who_admin')}`)).toBe(true);
    const plat = await f.t.admin.db
      .select()
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.entityId, ofB.item.id));
    expect(plat.map((h) => h.action)).toEqual(['dm_revoke']);
    // И в истории организации — от имени администратора.
    const inOrg = await f.t.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, ofB.item.id), eq(auditLog.action, 'dm_revoke')));
    expect(inOrg).toEqual([
      expect.objectContaining({ orgId: f.a.orgId, actorUserId: expect.any(String) }),
    ]);
    expect(inOrg[0]!.actorUserId).not.toBe(f.a.ownerUserId);
    // Перевыпуск своего — можно.
    await ok(
      await call('platform-admin', 'POST', `/api/admin/dm/tokens/${own.item.id}/reissue`),
      201,
      DmTokenIssued,
    );
  });

  it('список: значения фильтра «Состояние» и выгрузка в Excel', async () => {
    const values = await call('owner-a', 'GET', '/api/dm/tokens/values?col=st');
    expect(values.status).toBe(200);
    const body = (await values.json()) as { items: { value: string; label: string }[] };
    expect(body.items.map((v) => v.label)).toEqual(
      expect.arrayContaining([txt('dm.tok.state.active'), txt('dm.tok.state.revoked')]),
    );
    const xlsx = await call('owner-a', 'GET', '/api/dm/tokens/export?cols=name,st,tpl,at');
    expect(xlsx.status, await xlsx.clone().text()).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    // «Старшему» без «Выгружать в Excel» выгрузка закрыта.
    expect((await call('senior-a', 'GET', '/api/dm/tokens/export?cols=name')).status).toBe(403);
  });

  it('предел: действующих и остановленных — не больше 20; отозвали один — можно снова', async () => {
    const active = async () =>
      (await listOf('owner-a')).filter((k) => k.state === 'active' || k.state === 'stopped').length;
    let n = await active();
    while (n < DM_TOKENS_LIVE_MAX) {
      await ok(await issue('owner-a', tpl.rep, `Предел ${n}`), 201, DmTokenIssued);
      n += 1;
    }
    const over = await issue('owner-a', tpl.rep, 'Лишний');
    expect(over.status).toBe(409);
    expect(await code(over)).toMatchObject({ code: 'dm_token_limit', details: { max: 20 } });
    const form = await ok(await call('owner-a', 'GET', '/api/dm/tokens/form'), 200, DmTokenForm);
    expect(form.refusal).toBe('dm_token_limit');
    // Остановленные тоже в пределе: они оживут сами, когда шаблон включат.
    const db = f.t.admin.db;
    await db.update(dmTemplates).set({ state: 'off' }).where(eq(dmTemplates.id, tpl.rep));
    const stopped = await issue('owner-a', tpl.cpsAll, 'Лишний');
    expect(stopped.status).toBe(409);
    expect((await code(stopped)).code).toBe('dm_token_limit');
    await db.update(dmTemplates).set({ state: 'published' }).where(eq(dmTemplates.id, tpl.rep));
    const one = (await listOf('owner-a')).find((k) => k.state === 'active')!;
    await call('owner-a', 'POST', `/api/dm/tokens/${one.id}/revoke`);
    await ok(await issue('owner-a', tpl.rep, 'Лишний'), 201, DmTokenIssued);
    // Два выпуска сразу на последнее место не обходят предел: выпуски одной организации идут по одному.
    const two = (await listOf('owner-a')).find((k) => k.state === 'active' && k.canRevoke)!;
    await call('owner-a', 'POST', `/api/dm/tokens/${two.id}/revoke`);
    expect(await active()).toBe(DM_TOKENS_LIVE_MAX - 1);
    const race = await Promise.all([
      issue('owner-a', tpl.rep, 'Гонка 1'),
      issue('owner-a', tpl.rep, 'Гонка 2'),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await active()).toBe(DM_TOKENS_LIVE_MAX);
  });

  it('Админка: предел 20 действующих и названия — общие для всех администраторов', async () => {
    const db = f.t.admin.db;
    await db.insert(schema.users).values({
      login: 'platform-admin-2',
      passwordHash: await hashPassword(TEST_PASSWORD),
      isPlatformAdmin: true,
    });
    cookies['platform-admin-2'] = await signIn(f.app, 'platform-admin-2', TEST_PASSWORD);
    const base = '/api/admin/dm';
    const live = async () =>
      (await listOf('platform-admin', base)).filter(
        (k) => k.mine && (k.state === 'active' || k.state === 'stopped'),
      );
    await ok(await issue('platform-admin', tpl.adm, 'Общий отчёт', 30, base), 201, DmTokenIssued);
    const same = await issue('platform-admin-2', tpl.adm, 'Общий отчёт', 30, base);
    expect(same.status).toBe(409);
    expect((await code(same)).code).toBe('dm_token_name_taken');
    let n = (await live()).length;
    while (n < DM_TOKENS_LIVE_MAX) {
      await ok(await issue('platform-admin', tpl.adm, `Админ ${n}`, 30, base), 201, DmTokenIssued);
      n += 1;
    }
    const over = await issue('platform-admin-2', tpl.adm, 'Второй администратор', 30, base);
    expect(over.status).toBe(409);
    expect((await code(over)).code).toBe('dm_token_limit');
    // Токены организаций в предел Админки не входят: у А их тоже 20, а Админка своё место получает.
    const freed = (await live())[0]!;
    await call('platform-admin-2', 'POST', `${base}/tokens/${freed.id}/revoke`);
    await ok(
      await issue('platform-admin-2', tpl.adm, 'Второй администратор', 30, base),
      201,
      DmTokenIssued,
    );
  });

  it('частота: выпусков и перевыпусков одним человеком — не больше 60 за час, дальше 429', async () => {
    const db = f.t.admin.db;
    const userId = f.a.ownerUserId;
    const mine = and(
      eq(schema.rateLimits.kind, DM_TOKEN_ISSUE_RATE_LIMIT.kind),
      eq(schema.rateLimits.subject, userId),
    );
    const [taken = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.rateLimits)
      .where(mine);
    await db.insert(schema.rateLimits).values(
      Array.from({ length: Math.max(DM_TOKEN_ISSUE_RATE_LIMIT.max - taken.n, 0) }, () => ({
        kind: DM_TOKEN_ISSUE_RATE_LIMIT.kind,
        subject: userId,
      })),
    );
    try {
      const over = await issue('owner-a', tpl.rep, 'Частота');
      expect(over.status).toBe(429);
      expect((await code(over)).code).toBe('dm_token_rate');
      const live = (await listOf('owner-a')).find((k) => k.canReissue)!;
      const again = await call('owner-a', 'POST', `/api/dm/tokens/${live.id}/reissue`);
      expect(again.status).toBe(429);
      // Предел — у каждого свой: другой человек выпускает как обычно (у Б предела действующих нет).
      await ok(await issue('owner-b', tpl.rep, 'Частота Б'), 201, DmTokenIssued);
    } finally {
      await db.delete(schema.rateLimits).where(mine);
    }
  });
});
