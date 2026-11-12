import { randomUUID } from 'node:crypto';
import { ADMIN_ORG_VIEW_ROWS, schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { bishkekDate } from '@buhuchet/domain';
import { AdminOrgCard, AdminOrgLookup, ApiError } from '@buhuchet/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { ADMIN_CARD_VIEW_RATE_LIMIT } from './card-guard';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Админка → карточка организации (прототип v83)', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;
  let bankName: string;
  const ACCOUNT_NO = '1090012345678901';
  const today = bishkekDate(new Date());
  const month = today.slice(0, 7);
  const day = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // Срок внутри текущего месяца: вчера, а первого числа — сегодня (тогда просрочки в месяце нет).
  const firstDay = today.endsWith('-01');
  const past = firstDay ? today : day(today, -1);

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    const acc = f.people['acc-a']!;
    const contractor = async (
      orgId: string,
      name: string,
      inn: string,
      values: Partial<typeof schema.contractors.$inferInsert> = {},
    ) => {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          ...values,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    };
    const cp = await contractor(f.a.orgId, 'ОсОО «Ала-Тоо Трейд»', '03744097401851', {
      responsibleEmployeeId: acc.employeeId,
    });
    await contractor(f.a.orgId, 'ИП Разовый', '03744097401854', { kind: 'oneoff' });
    await contractor(f.a.orgId, 'ОсОО «Пауза»', '03744097401852', { serviceStatus: 'paused' });
    await contractor(f.a.orgId, 'ОсОО «Архив»', '03744097401853', { serviceStatus: 'archived' });
    await contractor(f.b.orgId, 'ОсОО «Чужой»', '03744097401855');
    await f.t.admin.db.insert(schema.contractorTariffs).values({
      orgId: f.a.orgId,
      contractorId: cp,
      amount: 500_000,
      validFrom: '2026-01-01',
    });
    const report = (values: Partial<typeof schema.reports.$inferInsert>) =>
      f.t.admin.db.insert(schema.reports).values({
        orgId: f.a.orgId,
        contractorId: cp,
        responsibleEmployeeId: acc.employeeId,
        reportTypeCode: 't1m',
        period: 'M',
        act: 'sub',
        periodStart: '2026-01-01',
        dueBase: today,
        dueDate: today,
        ...values,
      });
    // В этом месяце: «К сдаче» (срок прошёл, если сегодня не первое число), «В работе», сдан с налогом.
    await report({ periodStart: '2026-02-01', dueBase: past, dueDate: past });
    await report({ periodStart: '2026-03-01', status: 'in_progress' });
    await report({
      periodStart: '2026-04-01',
      status: 'submitted',
      submittedOn: today,
      amount: 120_000,
      paid: 20_000,
    });
    // Прежняя версия не считается.
    await report({ periodStart: '2026-05-01', superseded: true, amount: 999_000 });
    await f.t.admin.db.insert(schema.tasks).values([
      {
        orgId: f.a.orgId,
        title: 'Сверка с налоговой',
        categoryCode: 'КАТ-001',
        contractorId: cp,
        executorEmployeeId: acc.employeeId,
        authorEmployeeId: f.people['chief-a']!.employeeId,
        dueDate: today,
        confirm: false,
      },
      {
        orgId: f.a.orgId,
        title: 'Закрытая задача',
        categoryCode: 'КАТ-001',
        executorEmployeeId: acc.employeeId,
        authorEmployeeId: f.people['chief-a']!.employeeId,
        dueDate: today,
        confirm: false,
        status: 'done',
      },
    ]);
    const file = (
      name: string,
      sizeBytes: number,
      state: 'ready' | 'pending',
      sourceKind = 'contractor',
    ) => {
      const id = randomUUID();
      return {
        id,
        orgId: f.a.orgId,
        sourceKind,
        sourceId: cp,
        contractorId: cp,
        name,
        contentType: 'application/pdf',
        sizeBytes,
        storageKey: `org/${f.a.orgId}/files/${id}`,
        state,
        createdBy: acc.userId,
      };
    };
    await f.t.admin.db.insert(schema.files).values([
      file('Устав.pdf', 2_097_152, 'ready'),
      file('Черновик.pdf', 500, 'pending'),
      // Как в «Файловом менеджере»: файл оплаты услуги — вид «Разовая услуга», файлов оплат за
      // обслуживание и финансовых операций в карточке нет.
      file('Платёжка услуги.pdf', 1024, 'ready', 'one_off_service_payment'),
      file('Оплата обслуживания.pdf', 4096, 'ready', 'fee_payment'),
      file('Списание.pdf', 8192, 'ready', 'money_operation'),
    ]);
    const [bank] = await f.t.admin.db
      .select({ code: schema.banks.code, name: schema.banks.name })
      .from(schema.banks)
      .orderBy(asc(schema.banks.code))
      .limit(1);
    bankName = bank!.name;
    await f.t.admin.db.insert(schema.orgAccounts).values({
      orgId: f.a.orgId,
      kind: 'acc',
      bankCode: bank!.code,
      accountNo: ACCOUNT_NO,
      bik: '109001',
      holderName: 'ОсОО «Получатель»',
    });
    await f.t.admin.db
      .insert(schema.telegramLinks)
      .values({ orgId: f.a.orgId, userId: acc.userId, chatId: 700200, username: 'acc_a' });
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
  const card = async (orgId: string, query = '') => {
    const res = await get(`/api/admin/organizations/${orgId}/card${query}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return AdminOrgCard.parse(await res.json());
  };

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    const path = `/api/admin/organizations/${f.a.orgId}/card`;
    expect((await get(path, owner)).status).toBe(403);
    expect((await apiRequest(f.app, 'GET', path)).status).toBe(401);
    expect((await get('/api/admin/organizations/lookup?slug=org-a', owner)).status).toBe(403);
  });

  it('ссылка #orgs/<адрес>: организация по адресу страницы; нет такой — 404', async () => {
    const res = await get('/api/admin/organizations/lookup?slug=ORG-A');
    expect(res.status).toBe(200);
    expect(AdminOrgLookup.parse(await res.json())).toEqual({ id: f.a.orgId });
    expect((await get('/api/admin/organizations/lookup?slug=nobody')).status).toBe(404);
    expect((await get('/api/admin/organizations/lookup')).status).toBe(400);
  });

  it('«Основное», «Сводка» и «Сотрудники»: владелец, числа и состояния', async () => {
    const c = await card(f.a.orgId);
    expect(c.org).toMatchObject({ name: 'Организация А', slug: 'org-a', active: true });
    expect(c.owner).toMatchObject({
      userId: f.a.ownerUserId,
      login: 'owner-a',
      fullName: 'Владелец owner-a',
    });
    expect(c.lead).toBeNull();
    // «Банковские счета» — только названия банков: номера счёта и получателя в ответе нет.
    expect(c.profile).toMatchObject({ hasLogo: false, accounts: [bankName] });
    expect(JSON.stringify(c)).not.toContain(ACCOUNT_NO);
    expect(JSON.stringify(c)).not.toContain('Получатель');
    expect(c.summary).toMatchObject({
      staff: 5,
      staffBlocked: 0,
      contractors: { regular: 1, oneoff: 1, paused: 1, archived: 1 },
      month,
      reports: { todo: 1, inWork: 1, submitted: 1, overdue: firstDay ? 0 : 1 },
      tasks: 1,
      files: { count: 2, bytes: 2_097_152 + 1024 },
      telegram: 1,
    });
    // Входы за 30 дней: владелец вошёл в начале теста.
    expect(c.summary.logins30).toBe(1);
    expect(c.staff.count).toBe(5);
    const acc = c.staff.rows.find((u) => u.login === 'acc-a')!;
    expect(acc).toMatchObject({
      userId: f.people['acc-a']!.userId,
      fullName: 'Сотрудник acc-a',
      telegram: true,
      states: ['active'],
    });
    expect(c.staff.rows.find((u) => u.login === 'owner-a')).toMatchObject({ telegram: false });
    // Чужих сотрудников в списке нет.
    expect(c.staff.rows.map((u) => u.login)).not.toContain('acc-b');
  });

  it('«Контрагенты», «Отчёты», «Деньги», «Настройки», «Файлы»: только данные этой организации', async () => {
    const c = await card(f.a.orgId);
    expect(c.contractors.count).toBe(4);
    expect(c.contractors.rows.map((r) => r.name)).not.toContain('ОсОО «Чужой»');
    expect(c.contractors.rows.find((r) => r.name === 'ОсОО «Ала-Тоо Трейд»')).toMatchObject({
      inn: '03744097401851',
      responsible: 'acc-a',
      kind: 'regular',
      fee: 500_000,
      serviceStatus: 'active',
    });
    expect(c.contractors.rows.find((r) => r.name === 'ИП Разовый')).toMatchObject({
      kind: 'oneoff',
      fee: null,
    });
    const thisMonth = c.reports.byMonth.filter((r) => r.month === month);
    expect(thisMonth).toHaveLength(1);
    expect(thisMonth[0]).toMatchObject({ total: 3, submitted: 1, overdue: firstDay ? 0 : 1 });
    expect(c.reports.overdue.count).toBe(firstDay ? 0 : 1);
    if (!firstDay) {
      expect(c.reports.overdue.rows[0]).toMatchObject({
        contractor: 'ОсОО «Ала-Тоо Трейд»',
        periodStart: '2026-02-01',
        responsible: 'acc-a',
        status: 'todo',
      });
    }
    // Налоги: сумма к уплате и оплачено; прежняя версия отчёта не считается.
    expect(c.money.taxes).toEqual([{ month, sum: 120_000, paid: 20_000 }]);
    expect(c.money.feeMonth).toEqual({ charged: expect.any(Number), paid: 0 });
    const s = c.settings!;
    expect(s.timezone).toBeTruthy();
    expect(Object.keys(s.features).length).toBeGreaterThan(0);
    expect(s.roles.find((r) => r.isOwner)).toMatchObject({ employees: 1 });
    expect(s.roles.find((r) => r.name === 'Старший')).toMatchObject({
      permissions: 2,
      employees: 1,
    });
    expect(c.files.byKind).toEqual([
      { kind: 'contractor', count: 1, bytes: 2_097_152 },
      { kind: 'one_off_service', count: 1, bytes: 1024 },
    ]);
    expect(c.files.recent).toHaveLength(2);
    expect(c.files.recent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Устав.pdf',
          kind: 'contractor',
          contractor: 'ОсОО «Ала-Тоо Трейд»',
          by: 'acc-a',
          bytes: 2_097_152,
        }),
        expect.objectContaining({ name: 'Платёжка услуги.pdf', kind: 'one_off_service' }),
      ]),
    );
    // Ключа хранилища и ссылок на файлы в ответе нет.
    expect(JSON.stringify(c)).not.toContain('/files/');
  });

  it('каждое открытие карточки — в истории организации; перечитывание — без новой записи; блокировка видна', async () => {
    const views = (c: AdminOrgCard) => c.history.filter((h) => h.action === 'card_view').length;
    const before = views(await card(f.b.orgId));
    const second = await card(f.b.orgId);
    expect(views(second)).toBe(before + 1);
    expect(second.history[0]).toMatchObject({
      entity: 'organization',
      action: 'card_view',
      actorAdmin: true,
      reason: 'Открыта карточка организации',
    });
    expect(views(await card(f.b.orgId, '?refresh=1'))).toBe(before + 1);
    expect((await get(`/api/admin/organizations/${f.b.orgId}/card?refresh=yes`)).status).toBe(400);
    // «Организация создана» есть в истории всегда, одна.
    expect(
      second.history.filter((h) => h.entity === 'organization' && h.action === 'create'),
    ).toHaveLength(1);
    // Записи об открытии карточки организации Б — только в её истории.
    const rows = await f.t.admin.db
      .select({ orgId: schema.auditLog.orgId })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entity, 'organization'),
          eq(schema.auditLog.action, 'card_view'),
          eq(schema.auditLog.entityId, f.b.orgId),
        ),
      );
    expect(new Set(rows.map((r) => r.orgId))).toEqual(new Set([f.b.orgId]));

    const blocked = await apiRequest(
      f.app,
      'POST',
      `/api/admin/organizations/${f.b.orgId}/block`,
      admin,
      { version: second.org.version },
    );
    expect(blocked.status, await blocked.clone().text()).toBe(200);
    const c = await card(f.b.orgId, '?refresh=1');
    expect(c.org).toMatchObject({
      active: false,
      blockedReason: 'Заблокирована администратором',
    });
    const entry = c.history.find((h) => h.changes.some((x) => x.field === 'status'))!;
    expect(entry).toMatchObject({
      actorAdmin: true,
      reason: 'Организация заблокирована администратором платформы',
    });
    expect(entry.changes).toContainEqual({ field: 'status', from: 'active', to: 'blocked' });
    // «Блокировки с причинами» — отдельным списком: открытия карточки их не вытесняют.
    expect(c.blocks).toHaveLength(1);
    expect(c.blocks[0]).toMatchObject({ id: entry.id, entity: 'organization', subject: null });
    expect(c.blocks[0]!.changes).toContainEqual({
      field: 'blockedReason',
      from: null,
      to: 'Заблокирована администратором',
    });
    // У записей о ролях — название роли.
    const roleEntry = c.history.find((h) => h.entity === 'role');
    expect(roleEntry?.subject).toEqual(expect.any(String));
  });

  it('открытий карточек одним администратором — не больше предела за час; открытия не вытесняют правки из «Истории»', async () => {
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
      Array.from({ length: ADMIN_CARD_VIEW_RATE_LIMIT.max - taken.n - 1 }, () => ({
        kind: ADMIN_CARD_VIEW_RATE_LIMIT.kind,
        subject: user!.id,
      })),
    );
    const path = `/api/admin/organizations/${f.a.orgId}/card`;
    expect((await get(path)).status).toBe(200);
    const over = await get(path);
    expect(over.status).toBe(429);
    expect(ApiError.parse(await over.json()).error.code).toBe('card_view_limit');
    // Перечитывание открытой карточки в предел не входит; у карточки пользователя предел общий.
    expect((await get(`${path}?refresh=1`)).status).toBe(200);
    const userCard = await get(`/api/admin/users/${f.people['acc-a']!.userId}/card`);
    expect(userCard.status).toBe(429);
    await f.t.admin.db.delete(schema.rateLimits).where(mine);

    // «История» показывает не больше ADMIN_ORG_VIEW_ROWS последних открытий — остальное место за
    // правками организации, учётной политики и ролей.
    await f.t.admin.db.execute(
      sql`insert into audit_log (org_id, entity, entity_id, action, actor_user_id, reason)
          select ${f.a.orgId}::uuid, 'organization', ${f.a.orgId}, 'card_view', ${user!.id}::uuid, 'Открыта карточка организации'
          from generate_series(1, ${ADMIN_ORG_VIEW_ROWS + 5})`,
    );
    const c = await card(f.a.orgId, '?refresh=1');
    expect(c.history.filter((h) => h.action === 'card_view')).toHaveLength(ADMIN_ORG_VIEW_ROWS);
    expect(c.history.some((h) => h.entity === 'organization' && h.action === 'create')).toBe(true);
  });

  it('запрос карточки с чужого сайта не принимается; нет такой организации — 404, неверный id — 400', async () => {
    const res = await f.app.request(`/api/admin/organizations/${f.a.orgId}/card`, {
      headers: { cookie: admin, 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error.code).toBe('origin_mismatch');
    // Соседний поддомен (стенд и рабочий сайт) — тоже не свой сайт; свой сайт и набранный адрес — можно.
    const site = (value: string) =>
      f.app.request(`/api/admin/organizations/${f.a.orgId}/card?refresh=1`, {
        headers: { cookie: admin, 'sec-fetch-site': value },
      });
    expect((await site('same-site')).status).toBe(403);
    expect((await site('same-origin')).status).toBe(200);
    expect((await site('none')).status).toBe(200);
    const none = '00000000-0000-4000-8000-000000000000';
    expect((await get(`/api/admin/organizations/${none}/card`)).status).toBe(404);
    expect((await get('/api/admin/organizations/not-a-uuid/card')).status).toBe(400);
  });
});
