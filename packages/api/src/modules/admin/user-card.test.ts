import { kbArticles, schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { addMonths, bishkekDate } from '@buhuchet/domain';
import { AdminSessionsEnded, AdminUserCard, AdminUserLookup, ApiError } from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe.skipIf(!databaseAvailable())('Админка → карточка пользователя (прототип v83)', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;
  const today = bishkekDate(new Date());
  const month = today.slice(0, 7);
  const day = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    const acc = f.people['acc-a']!;
    const contractor = async (
      name: string,
      inn: string,
      values: Partial<typeof schema.contractors.$inferInsert> = {},
    ) => {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId: f.a.orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          responsibleEmployeeId: acc.employeeId,
          ...values,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    };
    const cp = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851');
    await contractor('ОсОО «Архив»', '03744097401853', { serviceStatus: 'archived' });
    const paused = await contractor('ОсОО «Пауза»', '03744097401852', { serviceStatus: 'paused' });
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
    // «К сдаче» и просрочен; «К сдаче», срок впереди; «В работе»; сдан в этом месяце; сдан раньше.
    await report({ periodStart: '2026-02-01', dueBase: day(today, -5), dueDate: day(today, -5) });
    await report({ periodStart: '2026-03-01', dueBase: day(today, 5), dueDate: day(today, 5) });
    await report({ periodStart: '2026-04-01', status: 'in_progress', dueDate: day(today, 3) });
    await report({ periodStart: '2026-05-01', status: 'submitted', submittedOn: today });
    await report({ periodStart: '2026-06-01', status: 'submitted', submittedOn: '2026-01-10' });
    // Прежняя версия отчёта и просрочка у приостановленного контрагента не считаются.
    await report({ periodStart: '2026-07-01', superseded: true, dueDate: day(today, -9) });
    await report({ contractorId: paused, periodStart: '2026-02-01', dueDate: day(today, -9) });
    await f.t.admin.db.insert(schema.tasks).values([
      {
        orgId: f.a.orgId,
        title: 'Сверка с налоговой',
        categoryCode: 'КАТ-001',
        contractorId: cp,
        executorEmployeeId: acc.employeeId,
        authorEmployeeId: f.people['chief-a']!.employeeId,
        dueDate: day(today, 2),
        confirm: false,
      },
      {
        orgId: f.a.orgId,
        title: 'Закрытая задача',
        categoryCode: 'КАТ-001',
        executorEmployeeId: acc.employeeId,
        authorEmployeeId: f.people['chief-a']!.employeeId,
        dueDate: day(today, 2),
        confirm: false,
        status: 'done',
      },
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
  const post = (path: string, cookie = admin) => apiRequest(f.app, 'POST', path, cookie, {});
  const card = async (login: string) => {
    const res = await get(`/api/admin/users/${f.people[login]!.userId}/card`);
    expect(res.status, await res.clone().text()).toBe(200);
    return AdminUserCard.parse(await res.json());
  };
  const loginWith = (login: string, userAgent?: string) =>
    f.app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(userAgent ? { 'user-agent': userAgent } : {}),
      },
      body: JSON.stringify({ login, password: TEST_PASSWORD }),
    });

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    const id = f.people['acc-a']!.userId;
    for (const path of [`/api/admin/users/${id}/card`, '/api/admin/users/lookup?login=acc-a']) {
      expect((await get(path, owner)).status).toBe(403);
      expect((await get(path, '')).status).toBe(401);
    }
    expect((await post(`/api/admin/users/${id}/sessions/end`, owner)).status).toBe(403);
    expect((await post(`/api/admin/users/${id}/sessions/end`, '')).status).toBe(401);
  });

  it('ссылка #accounts/<логин>: учётная запись по логину без учёта регистра; нет такой — 404', async () => {
    const res = await get('/api/admin/users/lookup?login=ACC-A');
    expect(res.status).toBe(200);
    expect(AdminUserLookup.parse(await res.json()).id).toBe(f.people['acc-a']!.userId);
    expect((await get('/api/admin/users/lookup?login=nobody')).status).toBe(404);
    expect((await get('/api/admin/users/lookup')).status).toBe(400);
  });

  it('«Основное» и «Работа»: роль с правами и областью, закреплённые контрагенты, отчёты, задачи', async () => {
    const c = await card('acc-a');
    expect(c.user).toMatchObject({ login: 'acc-a', orgName: 'Организация А' });
    expect(c.states).toEqual(['active']);
    expect(c.employee).toMatchObject({
      shortName: 'acc-a',
      isOwner: false,
      loginFailures: 0,
      loginFailuresMax: 10,
      telegram: null,
    });
    const groups = c.employee!.roleGroups;
    expect(groups.length).toBeGreaterThan(0);
    // Шаблон «Бухгалтер»: группы с областью — «только свои»; названия прав — словами.
    expect(groups.find((g) => g.group === 'cps')).toMatchObject({ scope: 'own' });
    expect(groups.every((g) => g.permissions.every((p) => /[А-Яа-я]/.test(p)))).toBe(true);

    const w = c.work!;
    // Архивный контрагент не в ответственности; приостановленный — остаётся.
    expect(w.contractors.rows.map((r) => r.name)).toEqual(['ОсОО «Ала-Тоо Трейд»', 'ОсОО «Пауза»']);
    expect(w.contractors.rows[0]).toMatchObject({ inn: '03744097401851', serviceStatus: 'active' });
    expect(w.contractors.rows[0]!.regime).toBeTruthy();
    expect(w.due.count).toBe(3);
    expect(w.inWork.count).toBe(1);
    expect(w.overdue.count).toBe(1);
    expect(w.overdue.rows[0]).toMatchObject({
      contractor: 'ОсОО «Ала-Тоо Трейд»',
      period: 'M',
      periodStart: '2026-02-01',
      status: 'todo',
    });
    expect(w.done.count).toBe(1);
    expect(w.done.rows[0]).toMatchObject({ periodStart: '2026-05-01', status: 'submitted' });
    expect(w.tasks.rows.map((t) => t.title)).toEqual(['Сверка с налоговой']);
    expect(w.kpi).toEqual({ count: 0, rows: [] });
    expect(w.kpiMonth).toBe(addMonths(month, -1));
    expect(c.kb).toMatchObject({ articles: { count: 0 }, videos: { count: 0 } });
    expect(c.kb?.progress).toMatchObject({ done: 0, level: 0 });
    expect(c.kb?.progress?.groups.length).toBeGreaterThan(0);
    expect(c.telegram).toEqual({ count: 0, rows: [] });
  });

  it('«Сеансы»: устройство по заголовку браузера, «Завершить все сеансы» выводит пользователя и пишет в историю', async () => {
    const login = await loginWith('acc-a', CHROME);
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    expect((await apiRequest(f.app, 'GET', '/api/auth/me', cookie)).status).toBe(200);

    let c = await card('acc-a');
    expect(c.sessions).toMatchObject({ open: 1, total: 1, self: false });
    expect(c.sessions.rows[0]).toMatchObject({
      device: 'Chrome 130 · Windows 10 или 11',
      open: true,
      endReason: null,
    });
    expect(JSON.stringify(c)).not.toContain(cookie.split('=')[1]);
    // В строке сеанса — только это: ни адреса IP, ни заголовка браузера, ни токена.
    expect(Object.keys(c.sessions.rows[0]!).sort()).toEqual([
      'device',
      'endReason',
      'id',
      'lastAt',
      'open',
      'startedAt',
      'till',
    ]);

    const id = f.people['acc-a']!.userId;
    const ended = await post(`/api/admin/users/${id}/sessions/end`);
    expect(ended.status).toBe(200);
    expect(AdminSessionsEnded.parse(await ended.json())).toEqual({ ended: 1 });
    expect((await apiRequest(f.app, 'GET', '/api/auth/me', cookie)).status).toBe(401);

    c = await card('acc-a');
    expect(c.sessions).toMatchObject({ open: 0, total: 1 });
    expect(c.sessions.rows[0]).toMatchObject({ open: false, endReason: 'admin', till: null });
    const entry = c.history.find((h) => h.action === 'sessions_end')!;
    expect(entry).toMatchObject({
      actorAdmin: true,
      reason: 'Завершены все сеансы администратором платформы: 1',
    });
    // Войти снова пользователь может со своим паролем.
    expect((await loginWith('acc-a')).status).toBe(200);
  });

  it('каждое открытие карточки — в истории учётной записи; блокировка и сброс пароля завершают сеансы', async () => {
    const id = f.people['chief-a']!.userId;
    await loginWith('chief-a', CHROME);
    const first = await card('chief-a');
    const views = (c: AdminUserCard) => c.history.filter((h) => h.action === 'card_view').length;
    expect(views(first)).toBe(1);
    expect(first.history[0]).toMatchObject({
      action: 'card_view',
      actorAdmin: true,
      reason: 'Открыта карточка пользователя',
    });
    // «Учётная запись создана» есть в истории всегда, одна.
    expect(first.history.filter((h) => h.entity === 'user' && h.action === 'create')).toHaveLength(
      1,
    );
    expect(views(await card('chief-a'))).toBe(2);
    // Перечитывание открытой карточки — не новое открытие; у администратора, который карточку
    // ещё не открывал, запись появляется и при перечитывании.
    const again = await get(`/api/admin/users/${id}/card?refresh=1`);
    expect(views(AdminUserCard.parse(await again.json()))).toBe(2);
    expect((await get(`/api/admin/users/${id}/card?refresh=yes`)).status).toBe(400);
    const fresh = f.people['acc-b']!.userId;
    const unseen = await get(`/api/admin/users/${fresh}/card?refresh=1`);
    expect(views(AdminUserCard.parse(await unseen.json()))).toBe(1);
    expect(first.history.find((h) => h.reason?.includes('заблокирована'))).toBeUndefined();

    const blocked = await apiRequest(f.app, 'POST', `/api/admin/users/${id}/block`, admin, {
      version: first.user.version,
    });
    expect(blocked.status).toBe(200);
    let c = await card('chief-a');
    expect(c.states).toEqual(['blocked_admin']);
    expect(c.history.map((h) => h.reason)).toContain(
      'Учётная запись заблокирована администратором платформы, завершено сеансов: 1',
    );
    expect(c.sessions.rows[0]).toMatchObject({ open: false, endReason: 'blocked' });

    await apiRequest(f.app, 'POST', `/api/admin/users/${id}/unblock`, admin, {
      version: c.user.version,
    });
    await loginWith('chief-a', CHROME);
    expect((await post(`/api/admin/users/${id}/password-reset`)).status).toBe(200);
    c = await card('chief-a');
    expect(c.states).toEqual(['temp_password']);
    expect(c.sessions.rows[0]).toMatchObject({ open: false, endReason: 'reset' });
    expect(c.history.map((h) => h.reason)).toContain(
      'Пароль сброшен администратором платформы: выдан временный пароль, завершено сеансов: 1',
    );
    // Блокировка владельцем — отдельное состояние.
    await f.t.admin.db
      .update(schema.employees)
      .set({ active: false })
      .where(eq(schema.employees.userId, id));
    expect((await card('chief-a')).states).toEqual(['blocked_owner', 'temp_password']);
  });

  it('администратор платформы: только «Основное», «Сеансы» и «История»; его сеансы и чужие организации не завершаются', async () => {
    const list = await get('/api/admin/users?size=all');
    const me = ((await list.json()) as { items: { id: string; login: string }[] }).items.find(
      (u) => u.login === 'platform-admin',
    )!;
    const res = await get(`/api/admin/users/${me.id}/card`);
    expect(res.status).toBe(200);
    const c = AdminUserCard.parse(await res.json());
    expect(c).toMatchObject({ employee: null, work: null, kb: null, telegram: null });
    expect(c.sessions.self).toBe(true);
    expect(c.sessions.open).toBeGreaterThan(0);
    expect(c.history[0]).toMatchObject({ action: 'card_view', actorAdmin: true });

    const refused = await post(`/api/admin/users/${me.id}/sessions/end`);
    expect(refused.status).toBe(400);
    expect(ApiError.parse(await refused.json()).error.code).toBe('account_self');
    expect((await get('/api/auth/me')).status).toBe(200);

    // Сеансы другого администратора платформы завершить нельзя; его карточка открывается.
    const [other] = await f.t.admin.db
      .insert(schema.users)
      .values({ login: 'platform-admin-2', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: schema.users.id });
    const foreign = await post(`/api/admin/users/${other!.id}/sessions/end`);
    expect(foreign.status).toBe(400);
    expect(ApiError.parse(await foreign.json()).error.code).toBe('account_platform_admin');
    const otherCard = AdminUserCard.parse(
      await (await get(`/api/admin/users/${other!.id}/card`)).json(),
    );
    expect(otherCard.sessions.self).toBe(false);
    expect(otherCard).toMatchObject({ employee: null, work: null });

    const none = '00000000-0000-4000-8000-000000000000';
    expect((await get(`/api/admin/users/${none}/card`)).status).toBe(404);
    expect((await post(`/api/admin/users/${none}/sessions/end`)).status).toBe(404);
    expect((await get('/api/admin/users/not-a-uuid/card')).status).toBe(400);
  });

  it('«Обучение и видео», «Telegram», «История»: строки без текста сообщений; «было → стало» — только у показываемых полей', async () => {
    const acc = f.people['acc-a']!;
    const [article] = await kbArticles(f.t.admin.db);
    await f.t.admin.db
      .insert(schema.kbArticleReads)
      .values({ orgId: f.a.orgId, userId: acc.userId, articleId: article!.id });
    await f.t.admin.db.insert(schema.telegramOutbox).values([
      {
        orgId: f.a.orgId,
        userId: acc.userId,
        chatId: 700100,
        kind: 'task_new',
        text: 'Текст сообщения бота',
        status: 'sent',
        sentAt: new Date(),
      },
      {
        orgId: f.a.orgId,
        userId: acc.userId,
        chatId: 700100,
        kind: 'reminders',
        text: 'Текст напоминания',
        status: 'error',
        lastError: 'recipient_unlinked',
      },
    ]);
    await f.t.admin.db.insert(schema.auditLog).values({
      orgId: f.a.orgId,
      entity: 'employee',
      entityId: acc.employeeId,
      action: 'update',
      actorUserId: f.a.ownerUserId,
      changes: [
        { field: 'roleId', from: 'role-1', to: 'role-2' },
        { field: 'roleName', from: 'Бухгалтер', to: 'Главный бухгалтер' },
        { field: 'passwordHash', from: 'hash-before', to: 'hash-after' },
        { field: 'telegram', from: null, to: '@acc_a' },
      ],
    });

    const c = await card('acc-a');
    expect(c.kb!.articles).toMatchObject({
      count: 1,
      rows: [{ id: article!.id, title: article!.t }],
    });
    expect(c.telegram!.count).toBe(2);
    expect(c.telegram!.rows.map((m) => [m.kind, m.status, m.error]).sort()).toEqual([
      ['reminders', 'error', 'recipient_unlinked'],
      ['task_new', 'sent', null],
    ]);
    const text = JSON.stringify(c);
    expect(text).not.toContain('Текст сообщения бота');
    expect(text).not.toContain('Текст напоминания');
    expect(text).not.toContain('700100');
    // «История»: значения — у роли и Telegram; у пароля и id роли — только название поля.
    const entry = c.history.find((h) => h.changes.some((x) => x.field === 'roleName'))!;
    expect(entry.changes).toEqual([
      { field: 'roleId', from: null, to: null },
      { field: 'roleName', from: 'Бухгалтер', to: 'Главный бухгалтер' },
      { field: 'passwordHash', from: null, to: null },
      { field: 'telegram', from: null, to: '@acc_a' },
    ]);
    expect(text).not.toContain('hash-after');
    expect(text).not.toContain('role-2');
  });

  it('запрос карточки с чужого сайта не принимается и записи об открытии не оставляет', async () => {
    const id = f.people['acc-b']!.userId;
    const views = async () =>
      (await card('acc-b')).history.filter((h) => h.action === 'card_view').length;
    const before = await views();
    const res = await f.app.request(`/api/admin/users/${id}/card`, {
      headers: { cookie: admin, 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error.code).toBe('origin_mismatch');
    // Сам сайт (same-origin) карточку читает; запись добавил только он.
    const own = await f.app.request(`/api/admin/users/${id}/card`, {
      headers: { cookie: admin, 'sec-fetch-site': 'same-origin' },
    });
    expect(own.status).toBe(200);
    expect(await views()).toBe(before + 2);
  });

  it('карточка сотрудника другой организации читается в её контексте: данные организаций не смешиваются', async () => {
    const c = await card('acc-b');
    expect(c.user.orgName).toBe('Организация Б');
    expect(c.work!.contractors.count).toBe(0);
    expect(c.work!.due.count).toBe(0);
    // Владелец организации А не видит открытий карточки сотрудника организации Б.
    const rows = await f.t.admin.db
      .select({ orgId: schema.auditLog.orgId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, f.people['acc-b']!.userId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === f.b.orgId)).toBe(true);
  });
});
