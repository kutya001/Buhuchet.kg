import { randomUUID } from 'node:crypto';
import { ADMIN_ORG_VIEW_ROWS, schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  AdminOrgCard,
  AdminOrgContractorList,
  AdminOrgLookup,
  AdminOrgRepMonthList,
  AdminOrgReport,
  AdminOrgStaffList,
  ApiError,
  ListValues,
  ReportList,
  ReportTabCounts,
} from '@buhuchet/shared';
import { monthLabel, type YearMonth } from '@buhuchet/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { ADMIN_CARD_VIEW_RATE_LIMIT } from './card-guard';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Админка → карточка организации (прототип v83)', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;
  let bankName: string;
  const ACCOUNT_NO = '1090012345678901';
  // «Сегодня» — по часам тестов API (fixedClock в src/testing.ts): по ним считают и карточка, и списки
  // под её плитками, и вкладки отчётов самой фирмы.
  const today = '2026-10-18';
  const month = today.slice(0, 7);
  const day = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // Срок внутри текущего месяца: вчера, а первого числа — сегодня (тогда просрочки в месяце нет).
  const firstDay = today.endsWith('-01');
  const past = firstDay ? today : day(today, -1);
  // Срок в следующем месяце: «позже» в плитке «Отчёты» «Сводки».
  const [yy, mm] = month.split('-').map(Number) as [number, number];
  const nextMonth = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, '0')}`;
  const reportIds: Record<'over' | 'work' | 'done' | 'later' | 'old' | 'foreign', string> = {
    over: '',
    work: '',
    done: '',
    later: '',
    old: '',
    foreign: '',
  };
  let cpId = '';

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
    cpId = cp;
    const oneoff = await contractor(f.a.orgId, 'ИП Разовый', '03744097401854', { kind: 'oneoff' });
    await contractor(f.a.orgId, 'ОсОО «Пауза»', '03744097401852', { serviceStatus: 'paused' });
    const archived = await contractor(f.a.orgId, 'ОсОО «Архив»', '03744097401853', {
      serviceStatus: 'archived',
    });
    const foreign = await contractor(f.b.orgId, 'ОсОО «Чужой»', '03744097401855');
    // Назначения: действующее, снятое и у архивного — «отчёты назначены у 1»; у чужой организации — своё.
    await f.t.admin.db.insert(schema.assignments).values([
      { orgId: f.a.orgId, contractorId: cp, reportTypeCode: 't1m', fromMonth: '2026-01-01' },
      {
        orgId: f.a.orgId,
        contractorId: oneoff,
        reportTypeCode: 't1m',
        fromMonth: '2026-01-01',
        endedOn: '2026-06-01',
      },
      { orgId: f.a.orgId, contractorId: archived, reportTypeCode: 't1m', fromMonth: '2026-01-01' },
      { orgId: f.b.orgId, contractorId: foreign, reportTypeCode: 't1m', fromMonth: '2026-01-01' },
    ]);
    await f.t.admin.db.insert(schema.contractorTariffs).values({
      orgId: f.a.orgId,
      contractorId: cp,
      amount: 500_000,
      validFrom: '2026-01-01',
    });
    const report = async (values: Partial<typeof schema.reports.$inferInsert>) => {
      const [row] = await f.t.admin.db
        .insert(schema.reports)
        .values({
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
        })
        .returning({ id: schema.reports.id });
      return row!.id;
    };
    // В этом месяце: «К сдаче» (срок прошёл, если сегодня не первое число), «В работе», сдан с налогом.
    reportIds.over = await report({ periodStart: '2026-02-01', dueBase: past, dueDate: past });
    reportIds.work = await report({ periodStart: '2026-03-01', status: 'in_progress' });
    reportIds.done = await report({
      periodStart: '2026-04-01',
      status: 'submitted',
      submittedOn: today,
      amount: 120_000,
      paid: 20_000,
    });
    // Прежняя версия не считается.
    await report({ periodStart: '2026-05-01', superseded: true, amount: 999_000 });
    // Следующий месяц — «позже».
    reportIds.later = await report({
      periodStart: '2026-06-01',
      dueBase: `${nextMonth}-15`,
      dueDate: `${nextMonth}-15`,
    });
    // Давно просроченный: срок в начале месяца.
    reportIds.old = await report({
      periodStart: '2025-12-01',
      dueBase: '2026-10-01',
      dueDate: '2026-10-01',
    });
    // Отчёт чужой организации — просрочен: ни в числах, ни в списках организации А его нет.
    reportIds.foreign = await report({
      orgId: f.b.orgId,
      contractorId: foreign,
      responsibleEmployeeId: f.people['acc-b']!.employeeId,
      periodStart: '2026-07-01',
      dueBase: past,
      dueDate: past,
    });
    await f.t.admin.db.insert(schema.statusHistory).values({
      orgId: f.a.orgId,
      scale: 'report',
      entityId: reportIds.work,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      actorUserId: acc.userId,
    });
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
    const charter = file('Устав.pdf', 2_097_152, 'ready');
    await f.t.admin.db.insert(schema.files).values([
      charter,
      file('Черновик.pdf', 500, 'pending'),
      // Как в «Файловом менеджере»: файл оплаты услуги — вид «Разовая услуга», файлов оплат за
      // обслуживание и финансовых операций в карточке нет.
      file('Платёжка услуги.pdf', 1024, 'ready', 'one_off_service_payment'),
      file('Оплата обслуживания.pdf', 4096, 'ready', 'fee_payment'),
      file('Списание.pdf', 8192, 'ready', 'money_operation'),
    ]);
    // Файл контрагента, прикреплённый к сданному отчёту ссылкой: виден в окне «Отчёт».
    await f.t.admin.db.insert(schema.fileLinks).values({
      orgId: f.a.orgId,
      fileId: charter.id,
      sourceKind: 'report',
      sourceId: reportIds.done,
      createdBy: acc.userId,
    });
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

  it('«Основное» и «Сводка»: владелец и числа; плитка «Отчёты» — несданные в этом месяце и позже', async () => {
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
      // Прототип v150 orgSum: все несданные (прежняя версия не считается), срок до конца месяца (и
      // просроченные прошлых месяцев) — «в этом месяце», остальные — «позже»; «Просрочено» — на сегодня.
      reports: { open: 4, month: 3, later: 1, overdue: (firstDay ? 0 : 1) + 1 },
      tasks: 1,
      files: { count: 2, bytes: 2_097_152 + 1024 },
      telegram: 1,
    });
    // Входы за 30 дней: владелец вошёл в начале теста.
    expect(c.summary.logins30).toBe(1);
    // Списков сотрудников, контрагентов и отчётов в карточке нет — у них свои методы страницами.
    expect(c).not.toHaveProperty('staff');
    expect(c).not.toHaveProperty('contractors');
  });

  it('«Сотрудники»: страница с сервера, все состояния учётной записи, фильтр по состоянию; чужих нет', async () => {
    const base = `/api/admin/organizations/${f.a.orgId}/staff`;
    const res = await get(`${base}?size=all`);
    expect(res.status, await res.clone().text()).toBe(200);
    const list = AdminOrgStaffList.parse(await res.json());
    expect(list.total).toBe(5);
    // По умолчанию — по ФИО (прототип: sort fio).
    const names = list.items.map((u) => u.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ru')));
    expect(list.items.find((u) => u.login === 'acc-a')).toMatchObject({
      userId: f.people['acc-a']!.userId,
      fullName: 'Сотрудник acc-a',
      telegram: true,
      states: ['active'],
    });
    expect(list.items.find((u) => u.login === 'owner-a')).toMatchObject({ telegram: false });
    expect(list.items.map((u) => u.login)).not.toContain('acc-b');
    // Временный пароль у одного сотрудника: фильтр «Состояние» и столбец Telegram.
    await f.t.admin.db
      .update(schema.users)
      .set({ mustChangePassword: true })
      .where(eq(schema.users.login, 'chief-a'));
    onTestFinished(async () => {
      await f.t.admin.db
        .update(schema.users)
        .set({ mustChangePassword: false })
        .where(eq(schema.users.login, 'chief-a'));
    });
    const filter = (x: object) => `filters=${encodeURIComponent(JSON.stringify(x))}`;
    const temp = AdminOrgStaffList.parse(
      await (
        await get(`${base}?${filter({ state: { type: 'enum', vals: ['temp_password'] } })}`)
      ).json(),
    );
    expect(temp.items.map((u) => u.login)).toEqual(['chief-a']);
    expect(temp.items[0]!.states).toEqual(['temp_password']);
    const tg = AdminOrgStaffList.parse(
      await (await get(`${base}?${filter({ tg: { type: 'enum', vals: ['on'] } })}`)).json(),
    );
    expect(tg.items.map((u) => u.login)).toEqual(['acc-a']);
    const values = ListValues.parse(await (await get(`${base}/values?col=state`)).json());
    expect(values.items.map((v) => v.value)).toEqual(
      expect.arrayContaining(['active', 'temp_password']),
    );
    const xlsx = await get(`${base}/export?cols=fullName,login,state`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
  });

  it('«Контрагенты»: все контрагенты организации вместе с архивом и стоимостью; чужих нет', async () => {
    const base = `/api/admin/organizations/${f.a.orgId}/contractors`;
    const res = await get(`${base}?size=all`);
    expect(res.status, await res.clone().text()).toBe(200);
    const list = AdminOrgContractorList.parse(await res.json());
    expect(list.total).toBe(4);
    // Только поля столбцов карточки: телефона, договора и контактных лиц клиентов фирмы в ответе нет.
    expect(Object.keys(list.items[0]!).sort()).toEqual(
      [
        'id',
        'name',
        'inn',
        'form',
        'regime',
        'responsible',
        'kind',
        'tariff',
        'serviceStatus',
        'serviceSince',
      ].sort(),
    );
    expect(JSON.stringify(list)).not.toContain('+996505890076');
    expect(list.items.map((r) => r.name)).not.toContain('ОсОО «Чужой»');
    expect(list.items.find((r) => r.name === 'ОсОО «Ала-Тоо Трейд»')).toMatchObject({
      inn: '03744097401851',
      kind: 'regular',
      serviceStatus: 'active',
      tariff: expect.objectContaining({ amount: 500_000 }),
    });
    expect(list.items.find((r) => r.name === 'ОсОО «Архив»')).toMatchObject({
      serviceStatus: 'archived',
    });
    const values = ListValues.parse(await (await get(`${base}/values?col=service`)).json());
    expect(values.items.map((v) => v.value)).toEqual(expect.arrayContaining(['archived']));
    expect((await get(`${base}/export?cols=name,inn`)).status).toBe(200);
    // Столбцы общего списка контрагентов вне карточки — 400: ни фильтр, ни поиск, ни выгрузка.
    const phone = encodeURIComponent(JSON.stringify({ phone: { type: 'text', q: '996' } }));
    for (const tail of [
      `?filters=${phone}`,
      '?sort=phone.asc',
      '?q=996&qcols=phone',
      '?group=head',
      '/values?col=phone',
      '/export?cols=name,phone,head,contact',
    ]) {
      expect((await get(`${base}${tail}`)).status, tail).toBe(400);
    }
  });

  it('«Отчёты»: плитки-фильтры, числа плиток, окно «Отчёт» только для просмотра; «Деньги», «Настройки», «Файлы»', async () => {
    const c = await card(f.a.orgId);
    expect(c.reports.plates).toEqual({
      due: 4,
      work: 1,
      done: 1,
      over: (firstDay ? 0 : 1) + 1,
      all: 5,
    });
    // Пустая вкладка: контрагентов без архива и у скольких есть действующее назначение.
    expect(c.reports).toMatchObject({ contractors: 3, assigned: 1 });

    const base = `/api/admin/organizations/${f.a.orgId}/reports`;
    const page = async (query: string) => {
      const res = await get(`${base}?size=all${query}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ReportList.parse(await res.json());
    };
    const ids = async (query: string) => (await page(query)).items.map((r) => r.id);
    // Число на каждой плитке — столько же строк в списке под ней (одни часы у карточки и списка).
    for (const plate of ['due', 'work', 'done', 'over', 'all'] as const) {
      expect(await ids(`&plate=${plate}`), plate).toHaveLength(c.reports.plates[plate]);
    }
    // По умолчанию — «К сдаче»: все несданные.
    expect(new Set(await ids(''))).toEqual(
      new Set([reportIds.over, reportIds.work, reportIds.later, reportIds.old]),
    );
    expect(await ids('&plate=work')).toEqual([reportIds.work]);
    expect(await ids('&plate=done')).toEqual([reportIds.done]);
    expect(new Set(await ids('&plate=over'))).toEqual(new Set([reportIds.over, reportIds.old]));
    expect(await ids('&plate=all')).not.toContain(reportIds.foreign);
    expect((await get(`${base}?plate=nope`)).status).toBe(400);

    // Числа — как видит сама фирма: «Просрочено» = вкладка «Просроченные» владельца.
    const counts = ReportTabCounts.parse(
      await (await get('/api/reports/tab-counts', owner)).json(),
    );
    expect(c.summary.reports.overdue).toBe(counts.overdue);
    expect(c.reports.plates.over).toBe(counts.overdue);
    const firm = ReportList.parse(
      await (await get('/api/reports?tab=overdue&size=all', owner)).json(),
    );
    expect(new Set(firm.items.map((r) => r.id))).toEqual(new Set(await ids('&plate=over')));

    // Поиск — по контрагенту и ИНН, «Месяц срока» — фильтр и группы с месяцем словами.
    expect(await ids(`&plate=all&q=${encodeURIComponent('Ала-Тоо')}&qcols=cp`)).toHaveLength(5);
    expect(await ids('&plate=all&q=03744097401851&qcols=inn')).toHaveLength(5);
    const dueMonth = encodeURIComponent(
      JSON.stringify({ dueMonth: { type: 'enum', vals: [nextMonth] } }),
    );
    expect(await ids(`&plate=all&filters=${dueMonth}`)).toEqual([reportIds.later]);
    const months = ListValues.parse(
      await (await get(`${base}/values?col=dueMonth&plate=all`)).json(),
    );
    expect(months.items.map((v) => v.value)).toEqual(expect.arrayContaining([month, nextMonth]));
    expect(months.items.find((v) => v.value === nextMonth)?.label).toBe(
      monthLabel(nextMonth as YearMonth),
    );
    const grouped = await page('&plate=all&group=dueMonth');
    expect(grouped.groups?.map((g) => [g.key, g.label, g.count])).toEqual(
      expect.arrayContaining([
        [month, monthLabel(month as YearMonth), 4],
        [nextMonth, monthLabel(nextMonth as YearMonth), 1],
      ]),
    );
    // Чужая организация: свои отчёты, в списке и значениях А её контрагента нет.
    const cps = ListValues.parse(await (await get(`${base}/values?col=cp&plate=all`)).json());
    expect(cps.items.map((v) => v.label ?? v.value).join(' ')).not.toContain('Чужой');
    const other = ReportList.parse(
      await (await get(`/api/admin/organizations/${f.b.orgId}/reports?plate=all&size=all`)).json(),
    );
    expect(other.items.map((r) => r.id)).toEqual([reportIds.foreign]);

    // «По месяцам и видам отчётов»: месяц срока и вид — всего, сдано, просрочено; группы по месяцу.
    const repm = async (query: string) => {
      const res = await get(`${base}/months?size=all${query}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return AdminOrgRepMonthList.parse(await res.json());
    };
    const byMonth = await repm('');
    expect(byMonth.items.filter((r) => r.m === month)).toEqual([
      expect.objectContaining({ n: 4, done: 1, over: 2 }),
    ]);
    expect(byMonth.items.filter((r) => r.m === nextMonth)).toEqual([
      expect.objectContaining({ n: 1, done: 0, over: 0 }),
    ]);
    // Сверху новые месяцы.
    expect(byMonth.items.map((r) => r.m)).toEqual([nextMonth, month]);
    const repmGroups = await repm('&group=m');
    expect(repmGroups.groups?.map((g) => g.label)).toEqual([
      monthLabel(nextMonth as YearMonth),
      monthLabel(month as YearMonth),
    ]);
    const repmValues = ListValues.parse(await (await get(`${base}/months/values?col=m`)).json());
    expect(repmValues.items.map((v) => v.value).sort()).toEqual([month, nextMonth].sort());
    expect((await get(`${base}/months/export?cols=m,t,n,done,over`)).status).toBe(200);
    expect((await get(`${base}/months?sort=nope.asc`)).status).toBe(400);
    const otherMonths = AdminOrgRepMonthList.parse(
      await (await get(`/api/admin/organizations/${f.b.orgId}/reports/months?size=all`)).json(),
    );
    expect(otherMonths.items.reduce((n, r) => n + r.n, 0)).toBe(1);
    expect((await get(`${base}/export?cols=cp,type,due&plate=all`)).status).toBe(200);

    // Окно «Отчёт»: строка, «История статусов», файлы отчёта — без ключа хранилища.
    const work = AdminOrgReport.parse(await (await get(`${base}/${reportIds.work}`)).json());
    expect(work).toMatchObject({ id: reportIds.work, status: 'in_progress' });
    expect(work.statusHistory).toEqual([
      expect.objectContaining({ from: 'todo', to: 'in_progress', actor: 'acc-a' }),
    ]);
    expect(work.files).toEqual([]);
    const done = AdminOrgReport.parse(await (await get(`${base}/${reportIds.done}`)).json());
    expect(done.files).toEqual([
      expect.objectContaining({ name: 'Устав.pdf', bytes: 2_097_152, by: 'acc-a' }),
    ]);
    expect(JSON.stringify(done)).not.toContain('/files/');
    // Отчёт другой организации в окне чужой организации не виден.
    expect(
      (await get(`/api/admin/organizations/${f.b.orgId}/reports/${reportIds.done}`)).status,
    ).toBe(404);
    expect((await get(`${base}/${randomUUID()}`)).status).toBe(404);

    // Налоги: сумма к уплате и оплачено; прежняя версия отчёта не считается.
    expect(c.money.taxes).toEqual([{ month, sum: 120_000, paid: 20_000 }]);
    expect(c.money.feeMonth).toEqual({ charged: expect.any(Number), paid: 0 });
    const s = c.settings!;
    expect(s.timezone).toBeTruthy();
    // «Сводка недели»: день и час (пакет 14.11.2026, блок 3) — строки дня нет, понедельник.
    expect(s).toMatchObject({ digestTime: '09:00', weekDay: 1 });
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

  it('списки карточки: только администратор платформы; нет такой организации — 404', async () => {
    const none = '00000000-0000-4000-8000-000000000000';
    for (const tail of [
      'staff',
      'staff/values?col=fullName',
      'staff/export?cols=fullName',
      'contractors',
      'contractors/values?col=name',
      'contractors/export?cols=name',
      'reports',
      'reports/values?col=cp',
      'reports/export?cols=cp',
      'reports/months',
      'reports/months/values?col=m',
      'reports/months/export?cols=m',
      `reports/${reportIds.work}`,
    ]) {
      const path = `/api/admin/organizations/${f.a.orgId}/${tail}`;
      expect((await get(path, owner)).status, tail).toBe(403);
      expect((await apiRequest(f.app, 'GET', path)).status, tail).toBe(401);
      expect((await get(`/api/admin/organizations/${none}/${tail}`)).status, tail).toBe(404);
    }
    expect(cpId).not.toBe('');
    // Неверный номер, столбец сортировки и столбец значений — 400.
    const base = `/api/admin/organizations/${f.a.orgId}`;
    expect((await get(`${base}/reports/not-a-uuid`)).status).toBe(400);
    expect((await get(`${base}/staff?sort=nope.asc`)).status).toBe(400);
    expect((await get(`${base}/reports/values?col=nope`)).status).toBe(400);
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
    // День недельной сводки организации Б (строка этапа 0) виден в её карточке, у А — прежний.
    await f.t.admin.db
      .insert(schema.orgTelegramNotices)
      .values({ orgId: f.b.orgId, code: 'staff_week', weekday: 5 });
    const c = await card(f.b.orgId, '?refresh=1');
    expect(c.settings).toMatchObject({ weekDay: 5 });
    expect((await card(f.a.orgId, '?refresh=1')).settings).toMatchObject({ weekDay: 1 });
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
