import { schema, submitLead, type LeadSubmission } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  AdminLeadCard,
  AdminLeadList,
  AdminLeadSummary,
  ApiError,
  CreatedOrganization,
  ListValues,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Админка → «Организации» → «Заявки» (задача #165)', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;
  let n = 0;

  /** Заявка гостя с уникальным телефоном и адресом. */
  const lead = async (over: Partial<LeadSubmission> = {}) => {
    n += 1;
    const res = await submitLead(f.t.app.db, {
      ipSubject: `ip-${n}`,
      name: 'Айгуль Садыкова',
      firm: `ОсОО «Учёт ${n}»`,
      phone: `+996555${String(200000 + n)}`,
      size: '21–50',
      telegram: '@aigul',
      note: 'Перезвоните после обеда',
      fromStand: false,
      trap: false,
      telegramText: null,
      // Раньше часов приложения в тестах (18.10.2026 09:00 по Бишкеку): смены статуса — после заявки.
      now: new Date(Date.parse('2026-10-18T02:00:00Z') + 60_000 * n),
      ...over,
    });
    return res.leadId!;
  };

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
  const card = async (id: string) =>
    AdminLeadCard.parse(await (await get(`/api/admin/leads/${id}`)).json());
  const status = (id: string, body: unknown) => post(`/api/admin/leads/${id}/status`, body);

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    const id = await lead();
    for (const path of [
      '/api/admin/leads',
      '/api/admin/leads/summary',
      '/api/admin/leads/values?col=status',
      '/api/admin/leads/export?cols=name',
      `/api/admin/leads/${id}`,
    ]) {
      expect((await get(path, owner)).status).toBe(403);
      expect((await get(path, '')).status).toBe(401);
    }
    expect(
      (await post(`/api/admin/leads/${id}/status`, { to: 'in_progress', version: 1 }, owner))
        .status,
    ).toBe(403);
    expect(
      (await post(`/api/admin/leads/${id}/note`, { note: 'x', version: 1 }, owner)).status,
    ).toBe(403);
    expect((await apiRequest(f.app, 'DELETE', `/api/admin/leads/${id}`, owner)).status).toBe(403);
    // «Подключить» заявку созданием организации в обход Админки нельзя.
    const viaOrg = {
      name: 'ОсОО «В обход»',
      inn: '05811201810499',
      ownerFullName: 'Обходов Тест',
      ownerLogin: 'obkhod',
      temporaryPassword: 'Bh-7K4M-Q9TX',
      leadId: id,
    };
    expect((await post('/api/admin/organizations', viaOrg, owner)).status).toBe(403);
    expect((await post('/api/admin/organizations', viaOrg, '')).status).toBe(401);
    expect((await card(id)).status).toBe('new');
  });

  it('список от новых к старым, «Создал» — посетитель сайта; плитка — новых; значения и Excel', async () => {
    const id = await lead({ firm: 'ОсОО «Список»', phone: '+996700987654' });
    const res = await get('/api/admin/leads?size=all');
    expect(res.status).toBe(200);
    const list = AdminLeadList.parse(await res.json());
    const times = list.items.map((x) => x.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(list.items.find((x) => x.id === id)).toMatchObject({
      firm: 'ОсОО «Список»',
      phone: '+996700987654',
      status: 'new',
      org: null,
      lastStatus: { by: 'Посетитель сайта' },
      audit: { createdBy: 'Посетитель сайта', updatedBy: 'Посетитель сайта' },
    });
    const summary = AdminLeadSummary.parse(await (await get('/api/admin/leads/summary')).json());
    expect(summary.fresh).toBe(list.items.filter((x) => x.status === 'new').length);
    const values = ListValues.parse(await (await get('/api/admin/leads/values?col=status')).json());
    expect(values.items).toContainEqual(expect.objectContaining({ value: 'new', label: 'Новая' }));
    const file = await get('/api/admin/leads/export?cols=firm,status&q=Список');
    expect(file.status).toBe(200);
    const texts = Object.values(unzipTexts(new Uint8Array(await file.arrayBuffer()))).join('\n');
    expect(texts).toContain('ОсОО «Список»');
  });

  it('статусы как в прототипе: «В работу», «Отказ» с причиной, «Снять «Отказ»» откатом, «Подключена»; история', async () => {
    const id = await lead();
    let c = await card(id);
    expect(c.statusHistory).toEqual([
      expect.objectContaining({
        from: null,
        to: 'new',
        reason: 'Заявка с сайта',
        actor: 'Посетитель сайта',
      }),
    ]);
    // «Подключена» из «Новая» — шага нет.
    let res = await status(id, { to: 'connected', version: c.version });
    expect(res.status).toBe(409);
    expect(ApiError.parse(await res.json()).error.code).toBe('lead_status_invalid');
    res = await status(id, { to: 'in_progress', version: c.version });
    expect(res.status).toBe(200);
    c = AdminLeadCard.parse(await res.json());
    expect(c).toMatchObject({
      status: 'in_progress',
      audit: { updatedBy: 'Администратор платформы' },
    });
    // Устаревшая версия — «запись изменена другим пользователем».
    res = await status(id, { to: 'rejected', version: c.version - 1, reason: 'дорого' });
    expect(res.status).toBe(409);
    expect(ApiError.parse(await res.json()).error.code).toBe('record_changed');
    // «Отказ» без причины — 400.
    res = await status(id, { to: 'rejected', version: c.version });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.code).toBe('lead_reason_required');
    res = await status(id, { to: 'rejected', version: c.version, reason: ' Нужны проводки ' });
    c = AdminLeadCard.parse(await res.json());
    expect(c).toMatchObject({ status: 'rejected', statusBefore: 'in_progress' });
    // Снять «Отказ» — только откатом с причиной и только в статус до отказа.
    res = await status(id, { to: 'new', version: c.version, reason: 'ошибка' });
    expect(res.status).toBe(409);
    res = await status(id, { to: 'in_progress', version: c.version });
    expect(ApiError.parse(await res.json()).error.code).toBe('status.rollback_reason_required');
    res = await status(id, { to: 'in_progress', version: c.version, reason: 'Передумали' });
    c = AdminLeadCard.parse(await res.json());
    expect(c).toMatchObject({ status: 'in_progress', statusBefore: null });
    res = await status(id, { to: 'connected', version: c.version });
    c = AdminLeadCard.parse(await res.json());
    expect(c.status).toBe('connected');
    // Под компактной шкалой — последняя смена статуса и кто её сделал.
    expect(c.lastStatus).toEqual({ at: c.statusHistory.at(-1)!.at, by: 'Администратор платформы' });
    expect(c.statusHistory.map((e) => [e.from, e.to, e.rollback, e.reason])).toEqual([
      [null, 'new', false, 'Заявка с сайта'],
      ['new', 'in_progress', false, null],
      ['in_progress', 'rejected', false, 'Нужны проводки'],
      ['rejected', 'in_progress', true, 'Передумали'],
      ['in_progress', 'connected', false, null],
    ]);
    expect(c.history.map((e) => [e.kind, e.actor])).toEqual([
      ['created', 'Посетитель сайта'],
      ['status', 'Администратор платформы'],
      ['status', 'Администратор платформы'],
      ['rollback', 'Администратор платформы'],
      ['status', 'Администратор платформы'],
    ]);
  });

  it('«Создать организацию» по заявке: «Подключена» со ссылкой, откатить нельзя; второй раз — 409', async () => {
    const id = await lead({ firm: 'ОсОО «По заявке»' });
    const res = await post('/api/admin/organizations', {
      name: 'ОсОО «По заявке»',
      inn: '05811201810450',
      ownerFullName: 'Садыкова Айгуль',
      ownerLogin: 'sadykova',
      temporaryPassword: 'Bh-7K4M-Q9TX',
      leadId: id,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { organization } = CreatedOrganization.parse(await res.json());
    const c = await card(id);
    expect(c).toMatchObject({
      status: 'connected',
      org: { id: organization.id, name: 'ОсОО «По заявке»' },
    });
    expect(c.statusHistory.at(-1)).toMatchObject({
      from: 'new',
      to: 'connected',
      reason: 'создана организация «ОсОО «По заявке»»',
    });
    expect(c.history.at(-1)).toMatchObject({ kind: 'org', text: 'ОсОО «По заявке»' });
    const back = await status(id, { to: 'in_progress', version: c.version, reason: 'ошибка' });
    expect(back.status).toBe(409);
    expect(ApiError.parse(await back.json()).error.code).toBe('lead_back_locked');
    const again = await post('/api/admin/organizations', {
      name: 'ОсОО «По заявке 2»',
      inn: '05811201810451',
      ownerFullName: 'Садыкова Айгуль',
      ownerLogin: 'sadykova2',
      temporaryPassword: 'Bh-7K4M-Q9TX',
      leadId: id,
    });
    expect(again.status).toBe(409);
    expect(ApiError.parse(await again.json()).error.code).toBe('lead_org_exists');
    const [made] = await f.t.admin.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.inn, '05811201810451'));
    expect(made).toBeUndefined();
    const gone = await post('/api/admin/organizations', {
      name: 'ОсОО «Нет заявки»',
      inn: '05811201810452',
      ownerFullName: 'Садыкова Айгуль',
      ownerLogin: 'sadykova3',
      temporaryPassword: 'Bh-7K4M-Q9TX',
      leadId: '00000000-0000-4000-8000-000000000000',
    });
    expect(gone.status).toBe(404);
  });

  it('заметка администратора: без изменений — без записи в истории; «Удалить» стирает заявку', async () => {
    const id = await lead();
    let c = await card(id);
    let res = await post(`/api/admin/leads/${id}/note`, {
      note: ' Показ в понедельник ',
      version: c.version,
    });
    expect(res.status).toBe(200);
    c = AdminLeadCard.parse(await res.json());
    expect(c.adminNote).toBe('Показ в понедельник');
    // Перевод строки в конце — та же заметка: записи в истории нет.
    res = await post(`/api/admin/leads/${id}/note`, {
      note: 'Показ в понедельник\n',
      version: c.version,
    });
    const same = AdminLeadCard.parse(await res.json());
    expect(same.version).toBe(c.version);
    expect(same.history.map((e) => e.kind)).toEqual(['created', 'note']);
    // NUL и лишние поля — 400.
    expect(
      (await post(`/api/admin/leads/${id}/note`, { note: 'a\u0000', version: c.version })).status,
    ).toBe(400);
    expect((await status(id, { to: 'in_progress', version: c.version, extra: 1 })).status).toBe(
      400,
    );
    expect((await apiRequest(f.app, 'DELETE', `/api/admin/leads/${id}`, admin)).status).toBe(200);
    expect((await get(`/api/admin/leads/${id}`)).status).toBe(404);
    expect((await apiRequest(f.app, 'DELETE', `/api/admin/leads/${id}`, admin)).status).toBe(404);
  });
});
