import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { homePlateTarget, reportWeek, type HomePlate } from '@buhuchet/domain';
import {
  ApiError,
  HomeSummary,
  ListValues,
  ReportList,
  RevenueList,
  RevenueOverview,
  Task,
  TaskList,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

/** Сомы в тыйынах. */
const som = (n: number) => n * 100;

// Сегодня в тестах — 18.10.2026 (воскресенье, `createTestDeps`): «На неделе» — 19–25.10.
describe.skipIf(!databaseAvailable())('Главная: «Сводка» и «Аналитика» (задача 2.34)', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let hr: string;
  let ownerB: string;
  let cpA = '';
  let cpChief = '';
  let cpOne = '';
  const ids: Record<string, string> = {};
  const ctx = { week: reportWeek('2026-10-18'), today: '2026-10-18', tasksAll: true };

  const employee = (login: string) => f.people[login]!.employeeId;
  const user = (login: string) => f.people[login]!.userId;
  const call = (method: 'GET' | 'POST', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const expectStatus = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res;
  };
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const summary = async (cookie: string) =>
    HomeSummary.parse(
      await (await expectStatus(await call('GET', '/api/home/summary', cookie), 200)).json(),
    );
  const filters = (plate: HomePlate, tasksAll = true) =>
    encodeURIComponent(JSON.stringify(homePlateTarget(plate, { ...ctx, tasksAll }).filters));
  /** Список, который открывает плашка: вкладка и фильтр плашки. */
  const plateList = async (cookie: string, plate: HomePlate, tasksAll = true) => {
    const target = homePlateTarget(plate, { ...ctx, tasksAll });
    const path = `/api/${target.module}?size=all&tab=${target.tab}&filters=${filters(plate, tasksAll)}`;
    const res = await expectStatus(await call('GET', path, cookie), 200);
    return target.module === 'reports'
      ? ReportList.parse(await res.json())
      : TaskList.parse(await res.json());
  };
  const overview = async (cookie: string, year = 2026) =>
    RevenueOverview.parse(
      await (
        await expectStatus(
          await call('GET', `/api/home/analytics/summary?year=${year}`, cookie),
          200,
        )
      ).json(),
    );
  const revenue = async (cookie: string, query = '') =>
    RevenueList.parse(
      await (
        await expectStatus(
          await call('GET', `/api/home/analytics?year=2026&size=all${query}`, cookie),
          200,
        )
      ).json(),
    );
  const features = (orgId: string, on: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: on })
      .where(eq(schema.orgSettings.orgId, orgId));
  const ALL_ON = { fee: true, taxpay: true, tasks: true };

  async function contractor(
    orgId: string,
    name: string,
    inn: string,
    patch: Partial<typeof schema.contractors.$inferInsert> = {},
    tariff = true,
  ) {
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
        feeDay: 15,
        paysTo: 'org',
        createdAt: new Date('2026-06-20T10:00:00+06:00'),
        ...patch,
      })
      .returning({ id: schema.contractors.id });
    if (tariff) {
      await f.t.admin.db.insert(schema.contractorTariffs).values({
        orgId,
        contractorId: row!.id,
        amount: som(30_000),
        period: 'M',
        validFrom: '2026-07-01',
      });
    }
    return row!.id;
  }

  async function report(key: string, values: Omit<Report, 'orgId'>, orgId = f.a.orgId) {
    const [row] = await f.t.admin.db
      .insert(schema.reports)
      .values({ orgId, ...values })
      .returning({ id: schema.reports.id });
    ids[key] = row!.id;
  }

  async function project(
    orgId: string,
    contractorId: string,
    lead: string,
    pays: [string, number][],
  ) {
    const [p] = await f.t.admin.db
      .insert(schema.projects)
      .values({
        orgId,
        contractorId,
        name: 'Восстановление учёта',
        startsOn: '2025-03-01',
        endsOn: '2026-12-31',
        leadEmployeeId: lead,
      })
      .returning({ id: schema.projects.id });
    await f.t.admin.db
      .insert(schema.projectPayments)
      .values(pays.map(([paidOn, amount]) => ({ orgId, projectId: p!.id, paidOn, amount })));
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features(f.a.orgId, ALL_ON);
    [owner, chief, acc, hr, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'hr-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    await expectStatus(
      await call('POST', '/api/org-report-types/connect', owner, {
        connect: ['nds', 't1m', 'pat'],
        disconnect: [],
      }),
      200,
    );
    cpA = await contractor(f.a.orgId, 'ОсОО «Ала-Тоо Трейд»', '03744097401851', {
      responsibleEmployeeId: employee('acc-a'),
    });
    cpChief = await contractor(
      f.a.orgId,
      'ИП Садыков',
      '20101199000123',
      { responsibleEmployeeId: employee('chief-a') },
      false,
    );
    cpOne = await contractor(
      f.a.orgId,
      'ИП Разовый',
      '21503198700023',
      { kind: 'oneoff', responsibleEmployeeId: employee('hr-a') },
      false,
    );

    const mine = { contractorId: cpA, responsibleEmployeeId: employee('acc-a') };
    // 1-Т за сентябрь: только сдача, просрочена.
    await report('ovrSub', {
      ...mine,
      reportTypeCode: 't1m',
      period: 'M',
      periodStart: '2026-09-01',
      act: 'sub',
      dueBase: '2026-10-15',
      dueDate: '2026-10-15',
    });
    // НДС за август у контрагента главного бухгалтера: просрочены сдача и оплата 1 000 сом.
    await report('ovrBoth', {
      contractorId: cpChief,
      responsibleEmployeeId: employee('chief-a'),
      reportTypeCode: 'nds',
      period: 'M',
      periodStart: '2026-08-01',
      act: 'both',
      dueBase: '2026-10-10',
      dueDate: '2026-10-10',
      payDue: '2026-10-12',
      amount: som(1_000),
    });
    // НДС за сентябрь: сдать и оплатить 3 000 сом на неделе.
    await report('week', {
      ...mine,
      reportTypeCode: 'nds',
      period: 'M',
      periodStart: '2026-09-01',
      act: 'both',
      dueBase: '2026-10-20',
      dueDate: '2026-10-20',
      payDue: '2026-10-20',
      amount: som(3_000),
    });
    // Патент за октябрь: только оплатить 5 000 сом на неделе — сдавать нечего.
    await report('patWeek', {
      ...mine,
      reportTypeCode: 'pat',
      period: 'M',
      periodStart: '2026-10-01',
      act: 'pay',
      dueBase: '2026-10-21',
      dueDate: '2026-10-21',
      payDue: '2026-10-21',
      amount: som(5_000),
    });
    // 1-Т за август: сдан бухгалтером, ждёт подтверждения.
    await report('waiting', {
      ...mine,
      reportTypeCode: 't1m',
      period: 'M',
      periodStart: '2026-08-01',
      act: 'sub',
      dueBase: '2026-09-15',
      dueDate: '2026-09-15',
      status: 'submitted',
      submittedOn: '2026-09-14',
      submittedAt: new Date('2026-09-14T05:00:00Z'),
      submittedBy: user('acc-a'),
    });
    // 1-Т за октябрь: сдать 16.11 — ближайший срок после недели.
    await report('nov', {
      ...mine,
      reportTypeCode: 't1m',
      period: 'M',
      periodStart: '2026-10-01',
      act: 'sub',
      dueBase: '2026-11-16',
      dueDate: '2026-11-16',
    });

    // Выручка: обслуживание (ИП Ала-Тоо), проект (ИП Садыков, и в прошлом году), разовая услуга.
    await f.t.admin.db.insert(schema.feePayments).values({
      orgId: f.a.orgId,
      contractorId: cpA,
      amount: som(60_000),
      paidOn: '2026-08-10',
      toKind: 'owner',
    });
    await project(f.a.orgId, cpChief, employee('chief-a'), [
      ['2025-05-01', som(20_000)],
      ['2026-09-05', som(50_000)],
    ]);
    const [service] = await f.t.admin.db
      .insert(schema.oneOffServices)
      .values({
        orgId: f.a.orgId,
        contractorId: cpOne,
        name: 'Регистрация ИП',
        serviceDate: '2026-10-01',
        amount: som(10_000),
      })
      .returning({ id: schema.oneOffServices.id });
    await f.t.admin.db.insert(schema.oneOffServicePayments).values({
      orgId: f.a.orgId,
      serviceId: service!.id,
      amount: som(4_000),
      paidOn: '2026-10-02',
    });
  }, 120_000);

  it('без входа — 401; организация без контрагентов видит нули и подсказку', async () => {
    expect((await call('GET', '/api/home/summary')).status).toBe(401);
    expect((await call('GET', '/api/home/analytics/summary?year=2026')).status).toBe(401);
    expect((await call('GET', '/api/home/analytics?year=2026')).status).toBe(401);

    const empty = await summary(ownerB);
    expect(empty.noContractors).toBe(true);
    expect(empty.seeAll).toBe(true);
    expect(empty.weekend).toBe(true);
    expect([empty.weekFrom, empty.weekTo]).toEqual(['2026-10-19', '2026-10-25']);
    expect(empty.plates.ovr).toEqual({ count: 0 });
    expect(empty.plates.wks).toEqual({ count: 0 });
    expect(empty.plates.wait).toEqual({ count: 0 });
    expect(empty.plates.tsk).toEqual({ count: 0, overdue: 0 });
    expect(empty.plates.tpend).toEqual({ count: 0 });
    expect(empty.tasks).toEqual([]);
    expect(empty.upcoming).toEqual([]);
    expect(empty.progress).toEqual([]);
    // «Учёт оплаты налогов», «Показатели», «Плата за обслуживание» выключены — их частей нет.
    expect(empty.plates.ovp).toBeNull();
    expect(empty.plates.wkp).toBeNull();
    expect(empty.plates.kmiss).toBeNull();
    expect(empty.debtors).toBeNull();
  });

  it('плашки «Отчетов для сдачи»: число равно числу строк в списке, который открывает плашка', async () => {
    const all = await summary(owner);
    expect(all.noContractors).toBe(false);
    expect(all.plates).toMatchObject({
      ovr: { count: 2 },
      ovp: { count: 1, left: som(1_000) },
      wks: { count: 1 },
      wkp: { count: 2, left: som(8_000) },
      wait: { count: 1 },
    });
    for (const plate of ['ovr', 'ovp', 'wks', 'wkp', 'wait'] as const) {
      const list = await plateList(owner, plate);
      expect(list.total, plate).toBe(all.plates[plate]!.count);
    }
    // Патент «только уплата» не попадает в «Сдать на этой неделе», но есть в «Оплатить».
    expect((await plateList(owner, 'wks')).items.map((r) => r.id)).toEqual([ids.week]);
    expect((await plateList(owner, 'wkp')).items.map((r) => r.id).sort()).toEqual(
      [ids.week, ids.patWeek].sort(),
    );

    // Область «Свои»: только отчёты бухгалтера, и в открытом списке — столько же.
    const own = await summary(acc);
    expect(own.seeAll).toBe(false);
    expect(own.plates).toMatchObject({
      ovr: { count: 1 },
      ovp: { count: 0, left: 0 },
      wks: { count: 1 },
      wkp: { count: 2 },
      wait: { count: 1 },
    });
    for (const plate of ['ovr', 'ovp', 'wks', 'wkp', 'wait'] as const) {
      expect((await plateList(acc, plate)).total, plate).toBe(own.plates[plate]!.count);
    }
  });

  it('«Ближайшие сроки сдачи» и «Сдано за месяц» — в области сотрудника', async () => {
    const all = await summary(owner);
    // Несданные со сдачей, срок с сегодня: НДС 20.10, 1-Т 16.11; патент «только уплата» — нет.
    expect(all.upcoming!.map((r) => r.id)).toEqual([ids.week, ids.nov]);
    const names = all.progress!.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['acc-a', 'chief-a']));
    expect(all.progress!.find((p) => p.name === 'chief-a')).toMatchObject({ done: 0, all: 1 });

    const own = await summary(acc);
    expect(own.progress!.map((p) => p.employeeId)).toEqual([employee('acc-a')]);
    expect(own.upcoming!.every((r) => r.contractor.id === cpA)).toBe(true);
  });

  it('без права «Видеть отчёты» частей отчётов нет; «Задачи» выключены — задач нет', async () => {
    // У «Старшего» только «Видеть контрагентов» и «Откатывать».
    const senior = await signIn(f.app, 'senior-a', TEST_PASSWORD);
    const s = await summary(senior);
    expect(s.plates.ovr).toBeNull();
    expect(s.plates.wait).toBeNull();
    expect(s.upcoming).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.debtors).toBeNull();
    expect(s.plates.tsk).toEqual({ count: 0, overdue: 0 });

    await features(f.a.orgId, { ...ALL_ON, tasks: false });
    try {
      const off = await summary(owner);
      expect(off.plates.tsk).toBeNull();
      expect(off.plates.tpend).toBeNull();
      expect(off.tasks).toBeNull();
    } finally {
      await features(f.a.orgId, ALL_ON);
    }
  });

  it('«Мои задачи на сегодня» и «Ждут подтверждения»: число равно строкам открытого списка', async () => {
    const create = async (title: string, dueDate: string) => {
      const res = await expectStatus(
        await call('POST', '/api/tasks', owner, {
          title,
          description: '',
          categoryCode: 'КАТ-001',
          contractorId: null,
          executorEmployeeId: employee('acc-a'),
          term: 'day',
          dueDate: '2026-10-25',
          needFile: false,
          confirm: true,
        }),
        201,
      );
      const task = Task.parse(await res.json());
      await f.t.admin.db.update(schema.tasks).set({ dueDate }).where(eq(schema.tasks.id, task.id));
      return task.id;
    };
    const today = await create('Собрать первичку', '2026-10-18');
    const late = await create('Сверка с Соцфондом', '2026-10-16');
    await create('Акт сверки', '2026-10-25');

    const s = await summary(acc);
    // И задачи по отчётам: «Сдать 1-Т за Сентябрь 2026» со сроком 15.10 (как «Мои задачи» в прототипе).
    expect(s.plates.tsk).toEqual({ count: 3, overdue: 2 });
    // Блок — по сроку: сначала просроченные.
    expect(s.tasks!.map((t) => t.dueDate)).toEqual(['2026-10-15', '2026-10-16', '2026-10-18']);
    expect(s.tasks!.slice(1).map((t) => t.id)).toEqual([late, today]);
    const opened = await plateList(acc, 'tsk', false);
    expect(opened.total).toBe(3);
    expect(opened.items.map((t) => t.id).sort()).toEqual(s.tasks!.map((t) => t.id).sort());
    // Бухгалтер не подтверждает задачи — плашки «Ждут подтверждения» у него нет.
    expect(s.plates.tpend).toBeNull();

    await expectStatus(await call('POST', `/api/tasks/${today}/start`, acc, {}), 200);
    await expectStatus(await call('POST', `/api/tasks/${today}/done`, acc, {}), 200);
    const o = await summary(owner);
    expect(o.plates.tpend).toEqual({ count: 1 });
    expect((await plateList(owner, 'tpend')).total).toBe(1);
    const c = await summary(chief);
    expect(c.plates.tpend).toEqual({ count: 1 });
  });

  it('«Должники по обслуживанию» и «Не заполнены показатели» — по правам и функциям', async () => {
    const o = await summary(owner);
    // Июль–октябрь по 30 000 сом, оплачено 60 000 сом.
    expect(o.debtors).toEqual({ count: 1, sum: som(60_000) });
    // «Показатели» выключены.
    expect(o.plates.kmiss).toBeNull();
    // Без права «Видеть плату за обслуживание» должников не видно.
    expect((await summary(acc)).debtors).toBeNull();

    await features(f.a.orgId, { ...ALL_ON, indicators: true });
    try {
      expect((await summary(owner)).plates.kmiss).toEqual({ count: 0, overdue: false });
      // У «Старшего» нет права «Видеть показатели».
      const senior = await signIn(f.app, 'senior-a', TEST_PASSWORD);
      expect((await summary(senior)).plates.kmiss).toBeNull();
    } finally {
      await features(f.a.orgId, ALL_ON);
    }
  });

  it('«Аналитика»: выручка по видам и месяцам, сравнение с прошлым годом, «Топ-10»', async () => {
    const v = await overview(owner);
    expect(v).toMatchObject({
      year: 2026,
      years: [2026, 2025],
      empty: false,
      current: true,
      lastMonth: 9,
      feeCh: som(120_000),
      fee: som(60_000),
      proj: som(50_000),
      svc: som(4_000),
      total: som(114_000),
      // Долг: обслуживание 60 000 и недоплата разовой услуги 6 000.
      debt: som(66_000),
      feePaidPercent: 50,
      shares: { fee: 53, proj: 44, svc: 4 },
      // Тот же период прошлого года: 20 000 сом.
      change: 470,
      paid: 3,
      average: som(38_000),
      feeDebt: som(60_000),
    });
    expect(v.months[7]).toEqual([som(60_000), 0, 0]);
    expect(v.months[8]).toEqual([0, som(50_000), 0]);
    expect(v.months[9]).toEqual([0, 0, som(4_000)]);
    expect(v.prevMonths[4]).toBe(som(20_000));
    expect(v.top.map((t) => t.id)).toEqual([cpA, cpChief, cpOne]);

    const prev = await overview(owner, 2025);
    expect(prev).toMatchObject({ current: false, lastMonth: 11, total: som(20_000) });
    expect(prev.change).toBeNull();
  });

  it('«Аналитика»: список с итогами, доля, прошлый год, значения фильтра и выгрузка', async () => {
    const list = await revenue(owner);
    expect(list.items.map((r) => r.id)).toEqual([cpA, cpChief, cpOne]);
    expect(list.totals.total).toBe(som(114_000));
    expect(list.items[0]).toMatchObject({
      responsible: 'acc-a',
      share: 52.6,
      prev: 0,
      change: null,
    });
    expect(list.items[1]).toMatchObject({ prev: som(20_000), change: 150, oneOff: false });
    expect(list.items[2]).toMatchObject({ oneOff: true, feeCh: 0, debt: som(6_000) });

    const only = encodeURIComponent(JSON.stringify({ kind: { type: 'enum', vals: ['oneoff'] } }));
    expect((await revenue(owner, `&filters=${only}`)).items.map((r) => r.id)).toEqual([cpOne]);
    const sorted = await revenue(owner, '&sort=change.desc');
    expect(sorted.items[0]!.id).toBe(cpChief);

    const values = ListValues.parse(
      await (
        await expectStatus(
          await call('GET', '/api/home/analytics/values?col=kind&year=2026', owner),
          200,
        )
      ).json(),
    );
    expect(values.items.map((i) => [i.value, i.count]).sort()).toEqual([
      ['oneoff', 1],
      ['regular', 2],
    ]);

    const file = await expectStatus(
      await call('GET', '/api/home/analytics/export?year=2026&cols=cp,total,prev', owner),
      200,
    );
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']!;
    expect((sheet.match(/<row /g) ?? []).length).toBe(1 + 3);
    expect(sheet).toContain('Ала-Тоо Трейд');
    expect(sheet).toContain('2025 год');
  });

  it('«Аналитика»: право «Видеть плату за обслуживание», функция, область «Свои», неверный год', async () => {
    // У «Бухгалтера» права нет — ни сводки, ни списка, ни выгрузки.
    for (const path of [
      '/api/home/analytics/summary?year=2026',
      '/api/home/analytics?year=2026',
      '/api/home/analytics/values?col=kind&year=2026',
      '/api/home/analytics/export?year=2026&cols=cp',
    ]) {
      expect((await call('GET', path, acc)).status, path).toBe(403);
    }
    expect((await call('GET', '/api/home/analytics/summary?year=1999', owner)).status).toBe(400);
    expect((await call('GET', '/api/home/analytics/summary?year=abc', owner)).status).toBe(400);
    expect((await call('GET', '/api/home/analytics?year=2026&sort=nope.asc', owner)).status).toBe(
      400,
    );

    // «Кадры» с правом на плату и областью «Свои» видят только своего контрагента.
    await f.t.admin.db
      .insert(schema.rolePermissions)
      .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'fee' });
    const own = await overview(hr);
    expect(own.total).toBe(som(4_000));
    expect(own.top.map((t) => t.id)).toEqual([cpOne]);
    expect((await revenue(hr)).items.map((r) => r.id)).toEqual([cpOne]);

    await features(f.a.orgId, { ...ALL_ON, fee: false });
    try {
      const res = await call('GET', '/api/home/analytics/summary?year=2026', owner);
      expect(res.status).toBe(403);
      expect((await failure(res)).code).toBe('fee_off');
      expect((await call('GET', '/api/home/analytics?year=2026', owner)).status).toBe(403);
      expect((await summary(owner)).debtors).toBeNull();
    } finally {
      await features(f.a.orgId, ALL_ON);
    }
  });

  it('чужая организация не видна: ни отчётов, ни выручки организации А', async () => {
    await features(f.b.orgId, ALL_ON);
    const cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', '03744097401852', {
      responsibleEmployeeId: employee('acc-b'),
    });
    await f.t.admin.db.insert(schema.feePayments).values({
      orgId: f.b.orgId,
      contractorId: cpB,
      amount: som(999),
      paidOn: '2026-08-01',
      toKind: 'owner',
    });
    await report(
      'b',
      {
        contractorId: cpB,
        responsibleEmployeeId: employee('acc-b'),
        reportTypeCode: 't1m',
        period: 'M',
        periodStart: '2026-09-01',
        act: 'sub',
        dueBase: '2026-10-15',
        dueDate: '2026-10-15',
      },
      f.b.orgId,
    );
    const b = await summary(ownerB);
    expect(b.plates.ovr).toEqual({ count: 1 });
    expect(b.upcoming).toEqual([]);
    const v = await overview(ownerB);
    expect(v.total).toBe(som(999));
    expect(v.top.map((t) => t.id)).toEqual([cpB]);
    expect((await revenue(ownerB)).items.map((r) => r.id)).toEqual([cpB]);
    // А не видит Б.
    expect((await summary(owner)).plates.ovr).toEqual({ count: 2 });
    expect((await overview(owner)).total).toBe(som(114_000));
  });
});
