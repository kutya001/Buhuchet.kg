import { randomUUID } from 'node:crypto';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ActivityEmployee,
  ActivityList,
  ActivityOverview,
  ApiError,
  ListValues,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Момент по Бишкеку: «2026-10-14 09:05» → Date. */
const at = (text: string) => new Date(`${text.replace(' ', 'T')}:00+06:00`);

// Сегодня в тестах — 18.10.2026 (воскресенье, `createTestDeps`): текущий месяц — октябрь, неделя — 12–18.10.
describe.skipIf(!databaseAvailable())('Главная: «Активность» (прототип v84)', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let hr: string;
  let ownerB: string;
  let cpAcc = '';
  let cpChief = '';
  let n = 0;

  const employee = (login: string) => f.people[login]!.employeeId;
  const user = (login: string) => f.people[login]!.userId;
  const call = (path: string, cookie?: string) => apiRequest(f.app, 'GET', path, cookie);
  const expectStatus = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res;
  };
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const overview = async (cookie: string, query = 'k=m&off=0') =>
    ActivityOverview.parse(
      await (
        await expectStatus(await call(`/api/home/activity/summary?${query}`, cookie), 200)
      ).json(),
    );
  const list = async (cookie: string, query = '') =>
    ActivityList.parse(
      await (
        await expectStatus(await call(`/api/home/activity?k=m&off=0&size=all${query}`, cookie), 200)
      ).json(),
    );
  const card = async (cookie: string, id: string, query = 'k=m&off=0') =>
    ActivityEmployee.parse(
      await (
        await expectStatus(await call(`/api/home/activity/employees/${id}?${query}`, cookie), 200)
      ).json(),
    );
  const features = (orgId: string, on: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: on })
      .where(eq(schema.orgSettings.orgId, orgId));

  const session = (
    orgId: string,
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
  const action = (
    orgId: string,
    userId: string,
    when: string,
    contractorId: string | null = null,
  ) =>
    f.t.admin.db.insert(schema.auditLog).values({
      orgId,
      entity: 'contractor',
      entityId: `x-${++n}`,
      action: 'update',
      changes: [],
      contractorId,
      actorUserId: userId,
      at: at(when),
    });
  async function contractor(name: string, inn: string, responsible: string) {
    const [row] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name,
        inn,
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
        responsibleEmployeeId: responsible,
      })
      .returning({ id: schema.contractors.id });
    return row!.id;
  }
  const report = (values: Partial<typeof schema.reports.$inferInsert>) =>
    f.t.admin.db.insert(schema.reports).values({
      orgId: f.a.orgId,
      contractorId: cpAcc,
      responsibleEmployeeId: employee('acc-a'),
      reportTypeCode: 'nds',
      act: 'both',
      period: 'M',
      periodStart: `2021-${String((++n % 12) + 1).padStart(2, '0')}-01`,
      dueBase: '2026-10-25',
      dueDate: '2026-10-25',
      ...values,
    });

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features(f.a.orgId, { tasks: true });
    [owner, chief, acc, hr, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'hr-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    cpAcc = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpChief = await contractor('ИП Садыков', '20101199000123', employee('chief-a'));
    // Заведение записей и вход в тесте оставили свои события с настоящим временем — не в октябре 2026;
    // на случай запуска в октябре журнал и история очищаются.
    await f.t.admin.sql`delete from audit_log`;
    await f.t.admin.sql`delete from session_log`;

    // Бухгалтер: 14.10 — вход, два действия по своему контрагенту, выход; 16.10 — вход и действие.
    await session(f.a.orgId, user('acc-a'), '2026-10-14 09:05', '2026-10-14 18:00', {
      at: '2026-10-14 18:10',
      reason: 'logout',
    });
    await action(f.a.orgId, user('acc-a'), '2026-10-14 10:00', cpAcc);
    await action(f.a.orgId, user('acc-a'), '2026-10-14 11:00', cpAcc);
    await session(f.a.orgId, user('acc-a'), '2026-10-16 08:30', '2026-10-16 12:00');
    await action(f.a.orgId, user('acc-a'), '2026-10-16 09:00');
    // Главный бухгалтер: одно действие 02.10; в сентябре — вход и действие.
    await action(f.a.orgId, user('chief-a'), '2026-10-02 15:45', cpChief);
    await session(f.a.orgId, user('chief-a'), '2026-09-10 09:00', '2026-09-10 10:00');
    await action(f.a.orgId, user('chief-a'), '2026-09-10 09:30');
    // Организация Б.
    await session(f.b.orgId, f.b.ownerUserId, '2026-10-14 10:00', '2026-10-14 11:00');
    await action(f.b.orgId, f.b.ownerUserId, '2026-10-14 10:30');

    // Отчёты бухгалтера: сдан 14.10 в срок; сдан 16.10 позже срока; не сдан, срок 25.10; просрочен.
    await report({
      status: 'submitted',
      submittedOn: '2026-10-14',
      submittedBy: user('acc-a'),
      dueDate: '2026-10-20',
    });
    await report({
      status: 'submitted',
      submittedOn: '2026-10-16',
      submittedBy: user('acc-a'),
      dueDate: '2026-10-15',
    });
    await report({ status: 'todo', dueDate: '2026-10-25' });
    await report({ status: 'todo', dueDate: '2026-10-12' });
    // Выполненная бухгалтером задача.
    await f.t.admin.db.insert(schema.tasks).values({
      orgId: f.a.orgId,
      title: 'Собрать первичку',
      categoryCode: 'КАТ-001',
      executorEmployeeId: employee('acc-a'),
      authorEmployeeId: employee('chief-a'),
      dueDate: '2026-10-16',
      confirm: false,
      status: 'done',
      doneAt: at('2026-10-16 11:30'),
    });
  });

  it('плашки и столбики за месяц: работали из стольких, входы и выходы, действия, сдано и позже срока, задачи', async () => {
    const v = await overview(chief);
    expect(v).toMatchObject({
      k: 'm',
      off: 0,
      from: '2026-10-01',
      to: '2026-10-31',
      today: '2026-10-18',
      active: 2,
      in: 2,
      out: 1,
      n: 4,
      sub: 2,
      late: 1,
      tasks: 1,
    });
    // Владелец, главный бухгалтер, бухгалтер, «Кадры» и старший бухгалтер организации А.
    expect(v.staff).toBe(5);
    expect(v.buckets).toHaveLength(31);
    expect(v.buckets.filter((b) => b.value > 0)).toEqual([
      { key: '2026-10-02', value: 1 },
      { key: '2026-10-14', value: 2 },
      { key: '2026-10-16', value: 1 },
    ]);
  });

  it('период: день без столбиков, неделя, прошлый месяц, год по месяцам; «Задачи» выключены — без плашки задач', async () => {
    const day = await overview(chief, 'k=d&off=-4');
    expect(day).toMatchObject({ from: '2026-10-14', to: '2026-10-14', n: 2, in: 1, out: 1 });
    expect(day.buckets).toEqual([]);
    const week = await overview(chief, 'k=w&off=0');
    expect(week).toMatchObject({ from: '2026-10-12', to: '2026-10-18', n: 3, active: 1 });
    expect(week.buckets.map((b) => b.value)).toEqual([0, 0, 2, 0, 1, 0, 0]);
    const september = await overview(chief, 'k=m&off=-1');
    expect(september).toMatchObject({ from: '2026-09-01', to: '2026-09-30', n: 1, in: 1, sub: 0 });
    const year = await overview(chief, 'k=y&off=0');
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets[8]).toEqual({ key: '2026-09', value: 1 });
    expect(year.buckets[9]).toEqual({ key: '2026-10', value: 4 });

    await features(f.a.orgId, { tasks: false });
    expect((await overview(chief)).tasks).toBeNull();
    await features(f.a.orgId, { tasks: true });
  });

  it('список: по умолчанию — по «Действий» от больших; числа сотрудника, поиск, фильтр, значения столбца, итоги', async () => {
    const page = await list(chief);
    expect(page.total).toBe(5);
    expect(page.items[0]).toMatchObject({
      id: employee('acc-a'),
      active: true,
      last: '2026-10-16 12:00',
      in: 2,
      out: 1,
      days: 2,
      n: 3,
      sub: 2,
      late: 1,
      due: 4,
      over: 1,
      cps: 1,
      tasks: 1,
    });
    expect(page.items[1]).toMatchObject({
      id: employee('chief-a'),
      last: '2026-10-02 15:45',
      n: 1,
      days: 1,
      cps: 1,
    });
    expect(page.items[2]).toMatchObject({ last: null, n: 0, days: 0 });
    expect(page.totals).toMatchObject({ n: 4, in: 2, sub: 2 });

    const filtered = await list(
      chief,
      `&filters=${encodeURIComponent(JSON.stringify({ n: { type: 'num', from: 2 } }))}`,
    );
    expect(filtered.items.map((r) => r.id)).toEqual([employee('acc-a')]);
    const sorted = await list(chief, '&sort=cps.desc');
    expect(sorted.items.slice(0, 2).map((r) => r.cps)).toEqual([1, 1]);

    const values = ListValues.parse(
      await (
        await expectStatus(await call('/api/home/activity/values?k=m&off=0&col=role', chief), 200)
      ).json(),
    );
    expect(values.items.map((v) => v.value)).toContain('Главный бухгалтер');
  });

  it('заблокированный сотрудник виден только с активностью или сданными отчётами в периоде', async () => {
    const block = (login: string, active: boolean) =>
      f.t.admin.db
        .update(schema.employees)
        .set({ active })
        .where(eq(schema.employees.id, employee(login)));
    await block('hr-a', false);
    await block('acc-a', false);
    const ids = (await list(chief)).items.map((r) => r.id);
    expect(ids).not.toContain(employee('hr-a'));
    expect(ids).toContain(employee('acc-a'));
    expect((await list(chief)).items.find((r) => r.id === employee('acc-a'))!.active).toBe(false);
    expect((await overview(chief)).staff).toBe(4);
    await block('hr-a', true);
    await block('acc-a', true);
  });

  it('окно сотрудника: дни от последнего к первому со сданными отчётами и его контрагенты', async () => {
    const v = await card(chief, employee('acc-a'));
    expect(v).toMatchObject({
      id: employee('acc-a'),
      active: true,
      from: '2026-10-01',
      to: '2026-10-31',
      last: '2026-10-16 12:00',
      in: 2,
      out: 1,
      n: 3,
      sub: 2,
      due: 4,
      over: 1,
      cps: 1,
    });
    expect(v.days).toEqual([
      { day: '2026-10-16', first: '08:30', last: '12:00', in: 1, out: 0, n: 1, sub: 1 },
      { day: '2026-10-14', first: '09:05', last: '18:10', in: 1, out: 1, n: 2, sub: 1 },
    ]);
    expect(v.contractors).toEqual([
      {
        id: cpAcc,
        name: 'ОсОО «Ала-Тоо Трейд»',
        sub: 2,
        due: 4,
        open: 2,
        over: 1,
        act: 2,
      },
    ]);
    expect(v.others).toBeNull();
    const week = await card(chief, employee('acc-a'), 'k=d&off=-2');
    expect(week.days.map((d) => d.day)).toEqual(['2026-10-16']);
    expect(week).toMatchObject({ n: 1, sub: 1 });
  });

  it('названия контрагентов сотрудника видит только тот, кому они положены: вне области «Свои» и без «Просматривать контрагентов» — одна строка с числами', async () => {
    // «Кадры»: область «Свои контрагенты» — чужой контрагент приходит без названия и номера.
    await f.t.admin.db.insert(schema.rolePermissions).values({
      orgId: f.a.orgId,
      roleId: f.roleIds.hr,
      permissionId: 'staffStats',
    });
    const v = await card(hr, employee('acc-a'));
    const hidden = { count: 1, sub: 2, due: 4, open: 2, over: 1, act: 2 };
    expect(v.contractors).toEqual([]);
    // Числа при этом те же: право открывает аналитику по всем сотрудникам.
    expect(v.others).toEqual(hidden);
    expect(v.cps).toBe(1);
    expect(JSON.stringify(v)).not.toContain('Ала-Тоо');
    expect((await list(hr)).total).toBe(5);
    // Без «Просматривать контрагентов» — то же самое, какой бы ни была область.
    const cpView = and(
      eq(schema.rolePermissions.roleId, f.roleIds.hr),
      eq(schema.rolePermissions.permissionId, 'cpView'),
    );
    await f.t.admin.db.delete(schema.rolePermissions).where(cpView);
    const blind = await card(hr, employee('acc-a'));
    expect(blind.contractors).toEqual([]);
    expect(blind.others).toEqual(hidden);
    await f.t.admin.db.insert(schema.rolePermissions).values({
      orgId: f.a.orgId,
      roleId: f.roleIds.hr,
      permissionId: 'cpView',
    });
    await f.t.admin.db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, f.roleIds.hr),
          eq(schema.rolePermissions.permissionId, 'staffStats'),
        ),
      );
  });

  it('без входа — 401, без права «Смотреть аналитику по сотрудникам» — 403 у всех методов', async () => {
    const paths = [
      '/api/home/activity/summary?k=m&off=0',
      '/api/home/activity?k=m&off=0',
      '/api/home/activity/values?k=m&off=0&col=role',
      '/api/home/activity/export?k=m&off=0&cols=fio',
      `/api/home/activity/employees/${employee('acc-a')}?k=m&off=0`,
    ];
    for (const path of paths) {
      await expectStatus(await call(path), 401);
      // У бухгалтера и «Кадров» права нет; владелец видит всё.
      expect((await failure(await expectStatus(await call(path, acc), 403))).code).toBe(
        'forbidden',
      );
      await expectStatus(await call(path, hr), 403);
      await expectStatus(await call(path, owner), 200);
    }
  });

  it('неверный период и чужой сотрудник', async () => {
    for (const query of ['k=x&off=0', 'k=m&off=1', 'k=m&off=-401', 'k=m&off=1.5', 'off=0', 'k=m']) {
      await expectStatus(await call(`/api/home/activity/summary?${query}`, chief), 400);
      await expectStatus(await call(`/api/home/activity?${query}`, chief), 400);
      await expectStatus(await call(`/api/home/activity/values?${query}&col=role`, chief), 400);
      await expectStatus(await call(`/api/home/activity/export?${query}&cols=fio`, chief), 400);
      await expectStatus(
        await call(`/api/home/activity/employees/${employee('acc-a')}?${query}`, chief),
        400,
      );
    }
    await expectStatus(await call('/api/home/activity/employees/not-a-uuid?k=m&off=0', chief), 400);
    await expectStatus(
      await call(`/api/home/activity/employees/${randomUUID()}?k=m&off=0`, chief),
      404,
    );
    // Сотрудник чужой организации — «не найден».
    await expectStatus(
      await call(`/api/home/activity/employees/${employee('acc-a')}?k=m&off=0`, ownerB),
      404,
    );
    await expectStatus(
      await call(`/api/home/activity/employees/${employee('acc-b')}?k=m&off=0`, chief),
      404,
    );
  });

  it('чужая организация не видна: свои сотрудники, входы и действия', async () => {
    const v = await overview(ownerB);
    expect(v).toMatchObject({ active: 1, in: 1, n: 1, sub: 0 });
    const page = await list(ownerB);
    expect(page.items.map((r) => r.id).sort()).toEqual(
      [f.b.ownerEmployeeId, employee('acc-b')].sort(),
    );
    expect(page.items.find((r) => r.id === f.b.ownerEmployeeId)).toMatchObject({
      n: 1,
      in: 1,
      last: '2026-10-14 11:00',
    });
  });

  it('«В Excel»: только с правом «Выгружать в Excel»; файл — строки под фильтром', async () => {
    const file = await expectStatus(
      await call('/api/home/activity/export?k=m&off=0&cols=fio,role,last,n,sub', chief),
      200,
    );
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']!;
    expect((sheet.match(/<row /g) ?? []).length).toBe(1 + 5);
    expect(sheet).toContain('Последняя активность');
    expect(sheet).toContain('16.10.2026 12:00');
    // Роль с правом аналитики, но без «Выгружать в Excel».
    await f.t.admin.db.insert(schema.rolePermissions).values({
      orgId: f.a.orgId,
      roleId: f.roleIds.hr,
      permissionId: 'staffStats',
    });
    await f.t.admin.db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, f.roleIds.hr),
          eq(schema.rolePermissions.permissionId, 'export'),
        ),
      );
    await expectStatus(await call('/api/home/activity?k=m&off=0', hr), 200);
    await expectStatus(await call('/api/home/activity/export?k=m&off=0&cols=fio', hr), 403);
  });
});
