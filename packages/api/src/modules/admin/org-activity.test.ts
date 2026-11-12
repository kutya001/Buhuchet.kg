import { randomUUID } from 'node:crypto';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ApiError, ListValues, OrgActivityList, OrgActivityOverview } from '@buhuchet/shared';
import { and, eq, notInArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Момент по Бишкеку: «2026-10-14 09:05» → Date. */
const at = (text: string) => new Date(`${text.replace(' ', 'T')}:00+06:00`);

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): текущий месяц — октябрь, неделя — 12–18.10.
describe.skipIf(!databaseAvailable())('Админка → «Организации» → «Активность»', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;
  let n = 0;

  const user = (login: string) => f.people[login]!.userId;
  const call = (path: string, cookie: string | undefined = admin) =>
    apiRequest(f.app, 'GET', path, cookie);
  const expectStatus = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res;
  };
  const overview = async (query = 'k=m&off=0') =>
    OrgActivityOverview.parse(
      await (
        await expectStatus(await call(`/api/admin/org-activity/summary?${query}`), 200)
      ).json(),
    );
  const list = async (query = '', period = 'k=m&off=0') =>
    OrgActivityList.parse(
      await (
        await expectStatus(await call(`/api/admin/org-activity?${period}&size=all${query}`), 200)
      ).json(),
    );

  const session = (
    orgId: string | null,
    userId: string,
    started: string,
    seen: string,
    end?: { at: string; reason: string },
  ) =>
    f.t.admin.db.insert(schema.sessionLog).values({
      id: randomUUID(),
      userId,
      orgId,
      startedAt: at(started),
      lastSeenAt: at(seen),
      expiresAt: at('2027-01-01 00:00'),
      endedAt: end ? at(end.at) : null,
      endReason: end?.reason ?? null,
    });
  const action = (orgId: string, userId: string, when: string) =>
    f.t.admin.db.insert(schema.auditLog).values({
      orgId,
      entity: 'contractor',
      entityId: `x-${++n}`,
      action: 'update',
      changes: [],
      actorUserId: userId,
      at: at(when),
    });
  async function contractor(orgId: string, name: string, inn: string, created: string) {
    const [row] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId,
        name,
        inn,
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
        createdAt: at(created),
      })
      .returning({ id: schema.contractors.id });
    return row!.id;
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // Заведение записей и вход в тесте оставили события с настоящим временем — журнал очищается.
    await f.t.admin.sql`delete from audit_log`;
    await f.t.admin.sql`delete from session_log`;

    // Организация А: бухгалтер 14.10 — вход, два действия, выход; 16.10 — вход и действие;
    // главный бухгалтер — действие 02.10; в сентябре — вход и действие.
    await session(f.a.orgId, user('acc-a'), '2026-10-14 09:05', '2026-10-14 18:00', {
      at: '2026-10-14 18:10',
      reason: 'logout',
    });
    await action(f.a.orgId, user('acc-a'), '2026-10-14 10:00');
    await action(f.a.orgId, user('acc-a'), '2026-10-14 11:00');
    await session(f.a.orgId, user('acc-a'), '2026-10-16 08:30', '2026-10-16 12:00');
    await action(f.a.orgId, user('acc-a'), '2026-10-16 09:00');
    await action(f.a.orgId, user('chief-a'), '2026-10-02 15:45');
    await session(f.a.orgId, user('chief-a'), '2026-09-10 09:00', '2026-09-10 10:00');
    await action(f.a.orgId, user('chief-a'), '2026-09-10 09:30');
    // Контрагенты организации А: новый в октябре и сентябрьский; сданный в октябре отчёт.
    const cp = await contractor(
      f.a.orgId,
      'ОсОО «Ала-Тоо Трейд»',
      '03744097401851',
      '2026-10-05 12:00',
    );
    await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', '2026-09-05 12:00');
    await f.t.admin.db.insert(schema.reports).values({
      orgId: f.a.orgId,
      contractorId: cp,
      responsibleEmployeeId: f.people['acc-a']!.employeeId,
      reportTypeCode: 'nds',
      act: 'both',
      period: 'M',
      periodStart: '2026-09-01',
      dueBase: '2026-10-25',
      dueDate: '2026-10-25',
      status: 'submitted',
      submittedOn: '2026-10-14',
      submittedBy: user('acc-a'),
    });
    // Сеанс администратора платформы (без организации) в счёт не идёт.
    const [adminUser] = await f.t.admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.login, 'platform-admin'));
    await session(null, adminUser!.id, '2026-10-15 09:00', '2026-10-15 10:00');
    // Организация Б за октябрь без активности: вход владельца в сентябре.
    await session(f.b.orgId, f.b.ownerUserId, '2026-09-20 10:00', '2026-09-20 11:00');
    // Вход администратора для запросов теста — после очистки журнала сеансов.
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    await f.t.admin.sql`delete from session_log where started_at > now() - interval '1 hour'`;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('только администратор платформы: сотруднику организации — 403, без входа — 401', async () => {
    for (const path of [
      '/api/admin/org-activity/summary?k=m&off=0',
      '/api/admin/org-activity?k=m&off=0',
      '/api/admin/org-activity/values?k=m&off=0&col=st',
      '/api/admin/org-activity/export?k=m&off=0&cols=name,n',
    ]) {
      expect((await call(path, owner)).status, path).toBe(403);
      expect((await call(path, '')).status, path).toBe(401);
    }
  });

  it('плашки и столбики за месяц: организаций с активностью из стольких, пользователи, входы, действия, сдано, новые контрагенты', async () => {
    const v = await overview();
    expect(v).toMatchObject({
      k: 'm',
      off: 0,
      from: '2026-10-01',
      to: '2026-10-31',
      today: '2026-10-18',
      orgs: 2,
      active: 1,
      users: 2,
      in: 2,
      n: 4,
      sub: 1,
      cps: 1,
    });
    expect(v.buckets).toHaveLength(31);
    expect(v.buckets.filter((b) => b.value > 0)).toEqual([
      { key: '2026-10-02', value: 1 },
      { key: '2026-10-14', value: 2 },
      { key: '2026-10-16', value: 1 },
    ]);
  });

  it('другие периоды: день без столбиков, прошлый месяц, год по месяцам', async () => {
    const day = await overview('k=d&off=-4');
    expect(day).toMatchObject({ from: '2026-10-14', to: '2026-10-14', active: 1, in: 1, n: 2 });
    expect(day.buckets).toEqual([]);
    const september = await overview('k=m&off=-1');
    expect(september).toMatchObject({
      from: '2026-09-01',
      active: 2,
      users: 2,
      in: 2,
      n: 1,
      cps: 1,
    });
    const year = await overview('k=y&off=0');
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets.filter((b) => b.value > 0)).toEqual([
      { key: '2026-09', value: 1 },
      { key: '2026-10', value: 4 },
    ]);
  });

  it('список: все организации, по умолчанию — по «Действий» от больших; в строке только числа', async () => {
    const page = await list();
    expect(page.total).toBe(2);
    expect(page.items.map((r) => r.name)).toEqual(['Организация А', 'Организация Б']);
    const [a, b] = page.items;
    expect(a).toEqual({
      id: f.a.orgId,
      name: 'Организация А',
      active: true,
      last: '2026-10-16 12:00',
      users: 2,
      staff: 5,
      days: 3,
      in: 2,
      n: 4,
      sub: 1,
      cps: 1,
    });
    expect(b).toMatchObject({
      last: null,
      users: 0,
      staff: 2,
      days: 0,
      in: 0,
      n: 0,
      sub: 0,
      cps: 0,
    });
    expect(page.totals).toMatchObject({ users: 2, in: 2, n: 4, sub: 1, cps: 1 });
    // Ни имён сотрудников, ни контрагентов в ответе нет.
    const text = JSON.stringify(page);
    expect(text).not.toContain('Ала-Тоо');
    expect(text).not.toContain('acc-a');
  });

  it('сортировка, поиск, фильтр по статусу и значения столбца', async () => {
    const asc = await list('&sort=n.asc');
    expect(asc.items.map((r) => r.name)).toEqual(['Организация Б', 'Организация А']);
    const found = await list(`&q=${encodeURIComponent('организация б')}`);
    expect(found.items.map((r) => r.name)).toEqual(['Организация Б']);
    const values = ListValues.parse(
      await (await call('/api/admin/org-activity/values?k=m&off=0&col=st')).json(),
    );
    expect(values.items).toEqual([{ value: 'active', label: 'Активна', count: 2 }]);
  });

  it('неверный период и неизвестный столбец — 400', async () => {
    for (const path of [
      '/api/admin/org-activity/summary?k=q&off=0',
      '/api/admin/org-activity/summary?k=m&off=1',
      '/api/admin/org-activity?k=m&off=-401',
      '/api/admin/org-activity/values?k=x&off=0&col=st',
      '/api/admin/org-activity/export?k=m&cols=name',
      '/api/admin/org-activity?k=m&off=0&sort=secret.asc',
      '/api/admin/org-activity/values?k=m&off=0&col=secret',
    ]) {
      const res = await call(path);
      expect(res.status, path).toBe(400);
      expect(ApiError.parse(await res.json()).error.code).toBe('validation_failed');
    }
  });

  it('«В Excel»: все организации под фильтром, видимые столбцы', async () => {
    const file = await expectStatus(
      await call('/api/admin/org-activity/export?k=m&off=0&cols=name,st,last,n,sub'),
      200,
    );
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']!;
    expect((sheet.match(/<row /g) ?? []).length).toBe(1 + 2);
    expect(sheet).toContain('Последняя активность');
    expect(sheet).toContain('16.10.2026 12:00');
    expect(sheet).toContain('Организация Б');
  });

  it('«Работали, пользователей» — не больше действующих сотрудников (прототип `Math.min(umax, o.staff())`)', async () => {
    // Работали двое (бухгалтер и главный бухгалтер); главного бухгалтера потом уволили и всех, кроме
    // владельца и бухгалтера, — тоже: действующих двое, затем остаётся один владелец.
    const keep = (logins: string[]) =>
      f.t.admin.db
        .update(schema.employees)
        .set({ active: false })
        .where(
          and(
            eq(schema.employees.orgId, f.a.orgId),
            notInArray(schema.employees.id, [
              f.a.ownerEmployeeId,
              ...logins.map((l) => f.people[l]!.employeeId),
            ]),
          ),
        );
    await keep(['acc-a']);
    expect((await list()).items[0]).toMatchObject({ users: 2, staff: 2 });
    await keep([]);
    expect((await list()).items[0]).toMatchObject({ users: 1, staff: 1, n: 4, in: 2 });
    expect(await overview()).toMatchObject({ users: 1, n: 4 });
  });

  it('заблокированному администратору платформы методы не отвечают', async () => {
    await f.t.admin.sql`
      insert into users (login, password_hash, is_platform_admin, must_change_password)
      select 'platform-admin-2', password_hash, true, false from users where login = 'platform-admin'`;
    const second = await signIn(f.app, 'platform-admin-2', TEST_PASSWORD);
    expect((await call('/api/admin/org-activity?k=m&off=0', second)).status).toBe(200);
    await f.t.admin.db
      .update(schema.users)
      .set({ blocked: true })
      .where(eq(schema.users.login, 'platform-admin-2'));
    for (const path of [
      '/api/admin/org-activity/summary?k=m&off=0',
      '/api/admin/org-activity?k=m&off=0',
      '/api/admin/org-activity/values?k=m&off=0&col=st',
      '/api/admin/org-activity/export?k=m&off=0&cols=name,n',
    ]) {
      const res = await call(path, second);
      expect([401, 403], path).toContain(res.status);
      expect(await res.text(), path).not.toContain('Организация А');
    }
  });
});
