import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  AdminOrganization,
  AdminOrganizationList,
  AdminOrgSummary,
  ApiError,
  CreatedOrganization,
  ListValues,
  MeResponse,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Админка → «Организации»', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;

  beforeAll(async () => {
    f = await createStaffFixture();
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
  const post = (path: string, body: unknown, cookie = admin) =>
    apiRequest(f.app, 'POST', path, cookie, body);

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    for (const path of [
      '/api/admin/organizations',
      '/api/admin/organizations/summary',
      '/api/admin/organizations/values?col=active',
    ]) {
      expect((await get(path, owner)).status).toBe(403);
      expect((await get(path, '')).status).toBe(401);
    }
    const create = await post('/api/admin/organizations', {}, owner);
    expect(create.status).toBe(403);
    const block = await post(`/api/admin/organizations/${f.b.orgId}/block`, { version: 1 }, owner);
    expect(block.status).toBe(403);
  });

  it('список всех организаций с владельцем и сотрудниками, плашки, значения фильтра', async () => {
    const res = await get('/api/admin/organizations?sort=name.asc');
    expect(res.status).toBe(200);
    const list = AdminOrganizationList.parse(await res.json());
    expect(list.items.map((o) => [o.name, o.ownerLogin, o.employees, o.active])).toEqual([
      ['Организация А', 'owner-a', 5, true],
      ['Организация Б', 'owner-b', 2, true],
    ]);
    const summary = AdminOrgSummary.parse(
      await (await get('/api/admin/organizations/summary')).json(),
    );
    expect(summary).toEqual({ active: 2, contractors: 0, users: 7, requests: 0 });
    const values = ListValues.parse(
      await (await get('/api/admin/organizations/values?col=active')).json(),
    );
    expect(values.items).toEqual([{ value: 'active', label: 'Активна', count: 2 }]);
  });

  it('создание организации с владельцем: адрес по названию, владелец входит временным паролем', async () => {
    const res = await post('/api/admin/organizations', {
      name: 'ОсОО «Новая бухгалтерия»',
      inn: '03811201810458',
      ownerFullName: 'Новикова Нурзат',
      ownerLogin: ' N.Novikova ',
      temporaryPassword: 'Bh-7K4M-Q9TX',
    });
    expect(res.status).toBe(201);
    const { organization } = CreatedOrganization.parse(await res.json());
    expect(organization).toMatchObject({
      name: 'ОсОО «Новая бухгалтерия»',
      inn: '03811201810458',
      ownerLogin: 'n.novikova',
      employees: 1,
      active: true,
      isDemo: false,
    });
    expect(organization.slug).toBe('novaya-buhgalteriya');
    expect(organization.audit.createdBy).toBe('Администратор платформы');

    const login = await apiRequest(f.app, 'POST', '/api/auth/login', undefined, {
      login: 'n.novikova',
      password: 'Bh-7K4M-Q9TX',
    });
    expect(login.status).toBe(200);
    expect(MeResponse.parse(await login.json()).user.mustChangePassword).toBe(true);
  });

  it('ошибки создания: ИНН, занятый ИНН, логин, занятый логин, ФИО, короткий пароль', async () => {
    const base = {
      name: 'ОсОО «Ещё одна»',
      inn: '04811201810459',
      ownerFullName: 'Ещёва Эльмира',
      ownerLogin: 'esheva',
      temporaryPassword: 'Bh-7K4M-Q9TX',
    };
    const codeOf = async (body: object) => {
      const res = await post('/api/admin/organizations', { ...base, ...body });
      return [res.status, ApiError.safeParse(await res.json()).data?.error.code];
    };
    expect(await codeOf({ inn: '123' })).toEqual([400, 'inn_invalid']);
    expect(await codeOf({ inn: '01811201810456' })).toEqual([400, 'inn_taken']);
    expect(await codeOf({ ownerLogin: 'а б' })).toEqual([400, 'invalid_login']);
    expect(await codeOf({ ownerLogin: 'owner-a' })).toEqual([400, 'login_taken']);
    expect(await codeOf({ ownerFullName: '   ' })).toEqual([400, 'validation_failed']);
    expect(await codeOf({ temporaryPassword: '1234567' })).toEqual([400, 'validation_failed']);
  });

  // Доработки 20.11.2026, блок 6, пункт 4 (прототип subNewOrgHtml, subEditRead, subNewOrgSave).
  it('блок «Подписка»: без него — «Нет подписки», с ним — подписка от администратора; неверное поле — 400 с полем', async () => {
    const base = {
      ownerFullName: 'Подпискова Айгуль',
      temporaryPassword: 'Bh-7K4M-Q9TX',
    };
    const subscriptionOf = async (orgId: string) =>
      (
        await f.t.admin.db
          .select()
          .from(schema.orgSubscriptions)
          .where(eq(schema.orgSubscriptions.orgId, orgId))
      )[0];
    const create = async (n: number, subscription?: object) => {
      const res = await post('/api/admin/organizations', {
        ...base,
        name: `ОсОО «Подписка ${n}»`,
        inn: `0581120181046${n}`,
        ownerLogin: `subs-owner-${n}`,
        ...(subscription ? { subscription } : {}),
      });
      return res;
    };

    // Без блока — «Нет подписки»: владелец входит, но видит только «Моя организация».
    const none = await create(1);
    expect(none.status).toBe(201);
    const noneOrg = CreatedOrganization.parse(await none.json()).organization;
    expect(await subscriptionOf(noneOrg.id)).toBeUndefined();
    const login = await apiRequest(f.app, 'POST', '/api/auth/login', undefined, {
      login: 'subs-owner-1',
      password: 'Bh-7K4M-Q9TX',
    });
    expect(login.status).toBe(200);
    expect(MeResponse.parse(await login.json())).toMatchObject({
      subClosed: true,
      modules: ['org'],
    });

    // С блоком: пакет 160 — больше порога, дополнительная скидка сохраняется; бесплатный период — по
    // умолчанию, со строкой «Истории оплат» от администратора.
    const sub = {
      planId: 'm12',
      seats: 160,
      extraGb: 2,
      paidUntil: '2027-10-18',
      extraDiscountPct: 5,
    };
    const paid = await create(2, sub);
    expect(paid.status, await paid.clone().text()).toBe(201);
    const paidOrg = CreatedOrganization.parse(await paid.json()).organization;
    const [admin] = await f.t.admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.login, 'platform-admin'));
    expect(await subscriptionOf(paidOrg.id)).toMatchObject({
      ...sub,
      free: true,
      updatedBy: admin!.id,
    });
    const pays = await f.t.admin.db
      .select()
      .from(schema.subscriptionPayments)
      .where(eq(schema.subscriptionPayments.orgId, paidOrg.id));
    expect(pays).toEqual([
      expect.objectContaining({
        kind: 'free',
        reason: 'Бесплатный период при создании организации',
        createdBy: admin!.id,
      }),
    ]);
    const login2 = await apiRequest(f.app, 'POST', '/api/auth/login', undefined, {
      login: 'subs-owner-2',
      password: 'Bh-7K4M-Q9TX',
    });
    expect(MeResponse.parse(await login2.json()).subClosed).toBe(false);

    // Без бесплатного периода — без строки «Истории оплат»; пакет не больше порога — скидка 0.
    const small = await create(3, { ...sub, seats: 150, extraDiscountPct: 30, free: false });
    expect(small.status).toBe(201);
    const smallOrg = CreatedOrganization.parse(await small.json()).organization;
    expect(await subscriptionOf(smallOrg.id)).toMatchObject({
      seats: 150,
      extraDiscountPct: 0,
      free: false,
    });
    const history = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, smallOrg.id));
    expect(history.find((h) => h.entity === 'subscription')).toMatchObject({
      action: 'create',
      reason: 'Подписка при создании организации',
      actorUserId: admin!.id,
    });

    // Неверные поля — 400 с кодом словаря и полем; организация не создаётся.
    await f.t.admin.db
      .update(schema.subscriptionPlans)
      .set({ active: false })
      .where(eq(schema.subscriptionPlans.id, 'm9'));
    const fail = async (patch: object) => {
      const res = await create(4, { ...sub, ...patch });
      expect(res.status).toBe(400);
      return ApiError.parse(await res.json()).error;
    };
    expect(await fail({ seats: 15 })).toEqual({
      code: 'sub_seats',
      message: 'Пакет — число мест с шагом 10: 10, 20, 30…',
      details: { field: 'seats', step: 10, step2: 20, step3: 30 },
    });
    expect((await fail({ planId: 'm9' })).code).toBe('sub_plan');
    expect((await fail({ planId: 'nope' })).details).toEqual({ field: 'planId' });
    expect((await fail({ extraDiscountPct: 81 })).code).toBe('sub_discount');
    expect((await fail({ paidUntil: '2027-02-30' })).code).toBe('validation_failed');
    const orgs = AdminOrganizationList.parse(
      await (await get('/api/admin/organizations?size=all')).json(),
    );
    expect(orgs.items.some((o) => o.name === 'ОсОО «Подписка 4»')).toBe(false);
  });

  it('блокировка: сотрудники не входят и открытые сеансы отказывают; разблокировка возвращает вход', async () => {
    const accB = await signIn(f.app, 'acc-b', TEST_PASSWORD);
    const list = AdminOrganizationList.parse(
      await (await get('/api/admin/organizations?sort=name.asc')).json(),
    );
    const b = list.items.find((o) => o.name === 'Организация Б')!;

    const blocked = await post(`/api/admin/organizations/${b.id}/block`, { version: b.version });
    expect(blocked.status).toBe(200);
    const after = AdminOrganization.parse(await blocked.json());
    expect(after).toMatchObject({ active: false, blockedReason: 'Заблокирована администратором' });

    const me = await get('/api/auth/me', accB);
    expect(me.status).toBe(403);
    const login = await apiRequest(f.app, 'POST', '/api/auth/login', undefined, {
      login: 'acc-b',
      password: TEST_PASSWORD,
    });
    expect(ApiError.parse(await login.json()).error.code).toBe('org_blocked');

    const stale = await post(`/api/admin/organizations/${b.id}/unblock`, { version: b.version });
    expect(stale.status).toBe(409);
    const unblocked = await post(`/api/admin/organizations/${b.id}/unblock`, {
      version: after.version,
    });
    expect(unblocked.status).toBe(200);
    expect(AdminOrganization.parse(await unblocked.json()).active).toBe(true);
    expect((await signIn(f.app, 'acc-b', TEST_PASSWORD)).length).toBeGreaterThan(0);

    const missing = await post(
      '/api/admin/organizations/00000000-0000-4000-8000-00000000abcd/block',
      {
        version: 1,
      },
    );
    expect(missing.status).toBe(404);
  });

  it('выгрузка в Excel: видимые столбцы и все организации', async () => {
    const res = await get(
      '/api/admin/organizations/export?cols=name,inn,owner,active&sort=name.asc',
    );
    expect(res.status).toBe(200);
    const files = unzipTexts(new Uint8Array(await res.arrayBuffer()));
    const sheet = Object.entries(files).find(([name]) => name.includes('sheet1'))?.[1] ?? '';
    expect(sheet).toContain('Организация А');
    expect(sheet).toContain('owner-b');

    // Выгрузки администратора считаются так же, как у сотрудника: пока идёт прежняя — 429.
    const [user] = await f.t.admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.login, 'platform-admin'));
    await f.t.admin.db.insert(schema.rateLimits).values({
      kind: 'export',
      subject: user!.id,
      busyUntil: new Date(Date.now() + 60_000),
    });
    const busy = await get('/api/admin/organizations/export?cols=name');
    expect(busy.status).toBe(429);
    expect(ApiError.parse(await busy.json()).error.code).toBe('export_busy');
  });
});
