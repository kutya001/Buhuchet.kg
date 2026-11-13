import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { pageStateTone } from '@buhuchet/domain';
import { Contractor, ContractorPage, PublicPage, type PublicPageBody } from '@buhuchet/shared';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

/** M-Bank и Бакай Банк — коды refDB.json. */
const MBANK = 'БНК-13';
const BAKAI = 'БНК-02';

/*
 * Разделы открытой страницы контрагента (задача 2.43). Часы тестов — 18.10.2026 09:00 по Бишкеку.
 */
describe.skipIf(!databaseAvailable())('Страница контрагента: разделы', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  /** ОсОО «Укс» платит налоги на счёт организации, ИП Асанов — на кошелёк бухгалтера. */
  let uks: Contractor;
  let asanov: Contractor;
  let uksCookie: string;
  let asanovCookie: string;
  const ids: Record<string, string> = {};

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const features = (on: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: sql`${schema.orgSettings.features} || ${JSON.stringify(on)}::jsonb` })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
  const contractor = async (name: string, inn: string, tariff: number) => {
    const res = await call('POST', '/api/contractors', owner, {
      name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      gkedExtra: [],
      bases: [],
      startDate: '2026-09-01',
      responsibleEmployeeId: employee('acc-a'),
      tariff: { amount: tariff, period: 'M' },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return Contractor.parse(await res.json());
  };
  /** Включить страницу и войти по коду: cookie этой ссылки. */
  const opened = async (c: Contractor) => {
    const res = await call('POST', `/api/contractors/${c.id}/page/enable`, owner);
    const on = ContractorPage.parse(await res.json());
    const ok = await f.app.request(`/api/page/org-a/${c.inn}/code`, {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.40',
      },
      body: JSON.stringify({ code: on.code }),
    });
    expect(ok.status).toBe(200);
    return (ok.headers.get('set-cookie') ?? '').split(';')[0]!;
  };
  const view = async (c: Contractor, cookie: string): Promise<PublicPageBody> => {
    const res = await f.app.request(`/api/page/org-a/${c.inn}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const state = PublicPage.parse(await res.json());
    if (state.state !== 'open') throw new Error(`страница не открыта: ${state.state}`);
    return state.page;
  };
  const hide = async (c: Contractor, hiddenSections: string[]) => {
    const card = ContractorPage.parse(
      await (await call('GET', `/api/contractors/${c.id}/page`, owner)).json(),
    );
    const res = await call('PUT', `/api/contractors/${c.id}/page/sections`, owner, {
      hiddenSections,
      version: card.version,
    });
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const report = async (
    key: string,
    c: Contractor,
    values: Omit<Report, 'orgId' | 'contractorId'>,
  ) => {
    const [row] = await f.t.admin.db
      .insert(schema.reports)
      .values({ orgId: f.a.orgId, contractorId: c.id, ...values })
      .returning({ id: schema.reports.id });
    ids[key] = row!.id;
  };
  const file = async (
    key: string,
    c: Contractor,
    reportKey: string,
    name: string,
    state = 'ready',
  ) => {
    const id = randomUUID();
    await f.t.admin.db.insert(schema.files).values({
      id,
      orgId: f.a.orgId,
      sourceKind: 'report',
      sourceId: ids[reportKey]!,
      contractorId: c.id,
      name,
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: `org/${f.a.orgId}/files/${id}`,
      createdBy: f.people['acc-a']!.userId,
      state: state as 'ready',
    });
    ids[key] = id;
  };
  const fileOf = (c: Contractor, id: string, cookie?: string, query = '') =>
    f.app.request(`/api/page/org-a/${c.inn}/files/${id}${query}`, {
      headers: cookie ? { cookie } : {},
    });
  /** Загруженный файл любого источника (раздел «Файлы»). */
  const otherFile = async (
    key: string,
    c: Contractor,
    values: Pick<typeof schema.files.$inferInsert, 'sourceKind' | 'name'> &
      Partial<typeof schema.files.$inferInsert>,
  ) => {
    const id = randomUUID();
    await f.t.admin.db.insert(schema.files).values({
      id,
      orgId: f.a.orgId,
      sourceId: null,
      contractorId: c.id,
      contentType: 'application/pdf',
      sizeBytes: 2048,
      storageKey: `org/${f.a.orgId}/files/${id}`,
      createdBy: f.people['acc-a']!.userId,
      state: 'ready',
      ...values,
    });
    ids[key] = id;
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features({ cppage: true, taxpay: true, fee: true, indicators: true, files: true });
    [owner, acc] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
    ]);
    // П. 67: перевод по номеру 0555 123 456 в M-Bank и Бакай Банк, «Налоги и обслуживание».
    const account = await call('POST', '/api/org/accounts', owner, {
      kind: 'phone',
      bankCode: null,
      accountNo: null,
      bik: null,
      phone: '+996555123456',
      phoneBanks: [MBANK, BAKAI],
      holderName: 'Организация А',
      purpose: 'both',
      mainTax: true,
      mainFee: true,
    });
    expect(account.status, await account.clone().text()).toBe(200);
    // Основной реквизит бухгалтера — кошелёк, второй — без отметки.
    for (const [phone, isMain] of [
      ['+996700111222', false],
      ['+996700333444', true],
    ] as const) {
      const res = await call('POST', '/api/profile/wallets', acc, {
        kind: 'phone',
        bankCode: null,
        accountNo: null,
        phone,
        phoneBanks: [MBANK],
        holderName: 'Бухгалтер А.',
        isMain,
      });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    uks = await contractor('ОсОО «Укс»', '03744097401851', 500_000);
    asanov = await contractor('ИП Асанов', '03744097401852', 0);
    // Заведены в программе 01.09 (начисления — с месяца, когда завели, docs/deviations.md п. В-5).
    await f.t.admin.db
      .update(schema.contractors)
      .set({ createdAt: new Date('2026-08-31T18:00:00Z') });
    await f.t.admin.db
      .update(schema.contractors)
      .set({ paysTo: 'org' })
      .where(eq(schema.contractors.id, uks.id));

    const mine = { responsibleEmployeeId: employee('acc-a'), period: 'M' as const };
    // НДС за сентябрь: срок 20.10 — впереди, к уплате 1 250,50.
    await report('ndsSep', uks, {
      ...mine,
      reportTypeCode: 'nds',
      periodStart: '2026-09-01',
      act: 'both',
      dueBase: '2026-10-20',
      dueDate: '2026-10-20',
      payDue: '2026-10-20',
      amount: 125_050,
    });
    // 1-Т за август: сдан.
    await report('t1Aug', uks, {
      ...mine,
      reportTypeCode: 't1m',
      periodStart: '2026-08-01',
      act: 'sub',
      dueBase: '2026-09-10',
      dueDate: '2026-09-10',
      status: 'submitted',
      submittedOn: '2026-09-08',
    });
    // «Не требуется» — на страницу не попадает.
    await report('t1Jul', uks, {
      ...mine,
      reportTypeCode: 't1m',
      periodStart: '2026-07-01',
      act: 'sub',
      dueBase: '2026-08-10',
      dueDate: '2026-08-10',
      status: 'not_required',
    });
    await report('asanovNds', asanov, {
      ...mine,
      reportTypeCode: 'nds',
      periodStart: '2026-09-01',
      act: 'both',
      dueBase: '2026-10-20',
      dueDate: '2026-10-20',
      payDue: '2026-10-20',
    });
    await file('ndsFile', uks, 'ndsSep', 'Декларация НДС.pdf');
    await file('pendingFile', uks, 'ndsSep', 'Загружается.pdf', 'pending');
    await file('notRequiredFile', uks, 't1Jul', 'Не нужен.pdf');
    await file('asanovFile', asanov, 'asanovNds', 'Чужой.pdf');
    uksCookie = await opened(uks);
    asanovCookie = await opened(asanov);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('открытая страница: только разделы для контрагента — без задач, истории и бонусов', async () => {
    const page = await view(uks, uksCookie);
    expect(Object.keys(page).sort()).toEqual(
      [
        'accountant',
        'asOf',
        'contacts',
        'contractor',
        'fee',
        'files',
        'issues',
        'kpi',
        'main',
        'money',
        'org',
        'pay',
        'reports',
        'sections',
        'texts',
        'today',
      ].sort(),
    );
    expect(page.sections).toEqual(['pay', 'reports', 'files', 'money', 'fee', 'kpi', 'contacts']);
    expect(page.today).toBe('2026-10-18');
    const json = JSON.stringify(page);
    for (const hidden of ['task', 'history', 'bonus', 'comment', 'storageKey', 'org/']) {
      expect(json, hidden).not.toContain(hidden);
    }
    // «Ваш бухгалтер» — ответственный.
    expect(page.accountant).toEqual({
      name: 'Сотрудник acc-a',
      role: expect.any(String),
      phone: null,
    });
    // Пояснения — по обозначениям страницы из «Текстов элементов экрана».
    expect(page.texts['secs.reports']).toBeTruthy();
  });

  it('п. 67: перевод по номеру на обеих карточках у платящего на счёт организации', async () => {
    const page = await view(uks, uksCookie);
    const card = {
      kind: 'phone',
      bank: '',
      number: '0555 123 456',
      copy: '0555123456',
      banks: ['Бакай Банк', 'M-Bank'],
      bik: null,
      holder: 'Организация А',
    };
    expect(page.pay).toEqual({ tax: card, fee: card });
  });

  it('п. 67: платящий на кошелёк бухгалтера видит на «Налогах» основной реквизит бухгалтера', async () => {
    const page = await view(asanov, asanovCookie);
    expect(page.pay?.tax).toMatchObject({
      kind: 'phone',
      number: '0700 333 444',
      copy: '0700333444',
      banks: ['M-Bank'],
      holder: 'Бухгалтер А.',
    });
    expect(page.pay?.fee?.number).toBe('0555 123 456');
  });

  it('«Отчёты»: без «Не требуется», виды с пояснением, файлы — только загруженные', async () => {
    const page = await view(uks, uksCookie);
    const items = page.reports!.items;
    expect(items.map((r) => [r.type, r.period, r.status, r.due])).toEqual([
      ['t1m', 'август 2026', 'submitted', '2026-09-10'],
      ['nds', 'сентябрь 2026', 'todo', '2026-10-20'],
    ]);
    const nds = items[1]!;
    expect(nds).toMatchObject({ hasSum: true, sum: 125_050, payStatus: 'unpaid' });
    // PDF открывается в окне просмотра страницы (прототип v74 `pubFileOpen`).
    expect(nds.files).toEqual([{ id: ids.ndsFile, name: 'Декларация НДС.pdf', preview: 'pdf' }]);
    expect(items[0]).toMatchObject({
      hasSum: false,
      sum: null,
      payStatus: null,
      submittedOn: '2026-09-08',
    });
    const types = Object.fromEntries(page.reports!.types.map((t) => [t.code, t]));
    expect(types.nds).toMatchObject({ short: 'НДС', periodicity: 'M' });
    expect(types.nds!.note).toContain('Налог на добавленную стоимость');
    // «Главное»: сдано 1 из 2, ближайший срок — НДС за сентябрь, налоги года — к уплате 1 250,50.
    expect(page.main.reports).toEqual({
      submitted: 1,
      total: 2,
      next: { due: '2026-10-20', type: 'НДС', period: 'сентябрь 2026' },
    });
    expect(page.main.taxes).toEqual({ due: 125_050, got: 0, paid: 0, go: 'money' });
    expect(page.money).toMatchObject({ monthEnd: '2026-10-31', verdict: 'short', dueSum: 125_050 });
    expect(page.money!.due).toEqual([
      {
        id: ids.ndsSep,
        type: 'НДС',
        period: expect.any(String),
        left: 125_050,
        payDue: '2026-10-20',
      },
    ]);
  });

  it('п. 74: просрочек нет, есть долг — жёлтая строка; отчёт просрочен — красная', async () => {
    // Только долг за обслуживание: «Деньги на налоги» скрыты — нехватки на налоги в строке нет.
    await hide(uks, ['money']);
    const before = await view(uks, uksCookie);
    expect(before.issues.short).toBe(0);
    expect(before.issues.late).toBe(0);
    expect(before.issues.feeDebt).toBeGreaterThan(0);
    expect(before.issues.feeDebt).toBe(before.fee!.debt);
    expect(before.main.fee).toEqual({ debt: before.fee!.debt, paidTill: null });
    expect(pageStateTone(before.issues)).toBe('warn');
    // 1-Т за сентябрь: срок 15.10 прошёл, не сдан.
    await report('t1Sep', uks, {
      responsibleEmployeeId: employee('acc-a'),
      period: 'M',
      reportTypeCode: 't1m',
      periodStart: '2026-09-01',
      act: 'sub',
      dueBase: '2026-10-15',
      dueDate: '2026-10-15',
    });
    const after = await view(uks, uksCookie);
    expect(after.issues.late).toBe(1);
    expect(pageStateTone(after.issues)).toBe('bad');
    await f.t.admin.db.delete(schema.reports).where(eq(schema.reports.id, ids.t1Sep!));
    await hide(uks, []);
  });

  it('скрытые разделы сервер не передаёт вовсе; «Ваш бухгалтер» — всегда', async () => {
    await hide(uks, ['pay', 'reports', 'files', 'money', 'fee', 'kpi', 'contacts']);
    const page = await view(uks, uksCookie);
    expect(page.sections).toEqual([]);
    expect(page).toMatchObject({
      pay: null,
      reports: null,
      files: null,
      money: null,
      fee: null,
      kpi: null,
      contacts: null,
      main: { reports: null, taxes: null, fee: null },
      issues: { late: 0, short: 0, feeDebt: 0 },
    });
    expect(page.accountant?.name).toBe('Сотрудник acc-a');
    const json = JSON.stringify(page);
    expect(json).not.toContain('Декларация');
    // Номер для перевода — по его 9 цифрам: так ловится и местный вид «0555 123 456», и «+996555123456».
    // Короткое «0555» искать нельзя: оно иногда встречается внутри случайного UUID в ответе.
    expect(json).not.toContain('555123456');
    expect(json).not.toContain('555 123 456');

    // Скрыты только «Отчёты»: плитка «Налоги» остаётся при «Деньгах на налоги».
    await hide(uks, ['reports']);
    const money = await view(uks, uksCookie);
    expect(money.reports).toBeNull();
    expect(money.main.reports).toBeNull();
    expect(money.main.taxes).toMatchObject({ due: 125_050, go: 'money' });
    await hide(uks, []);
  });

  it('«Показатели»: ведущиеся у контрагента, значения по текущий месяц', async () => {
    const [revenue] = await f.t.admin.db
      .select({ id: schema.indicators.id })
      .from(schema.indicators)
      .where(eq(schema.indicators.orgId, f.a.orgId))
      .orderBy(schema.indicators.sortOrder)
      .limit(1);
    await f.t.admin.db.insert(schema.indicatorValues).values([
      {
        orgId: f.a.orgId,
        contractorId: uks.id,
        indicatorId: revenue!.id,
        month: '2025-12',
        value: 10_000,
      },
      {
        orgId: f.a.orgId,
        contractorId: uks.id,
        indicatorId: revenue!.id,
        month: '2026-09',
        value: 50_000,
      },
      {
        orgId: f.a.orgId,
        contractorId: uks.id,
        indicatorId: revenue!.id,
        month: '2026-11',
        value: 70_000,
      },
    ]);
    const page = await view(uks, uksCookie);
    expect(page.kpi!.years).toEqual(['2026', '2025']);
    const shown = page.kpi!.indicators.find((i) => i.id === revenue!.id)!;
    expect(shown.values).toEqual([
      { month: '2025-12', value: 10_000 },
      { month: '2026-09', value: 50_000 },
    ]);
    // Функция выключена — раздела нет.
    await features({ indicators: false });
    expect((await view(uks, uksCookie)).kpi).toBeNull();
    await features({ indicators: true });
  });

  it('«Контакты»: ответственный с видами отчётов, данные контрагента', async () => {
    await f.t.admin.db
      .update(schema.organizations)
      .set({ phone: '+996312900100' })
      .where(eq(schema.organizations.id, f.a.orgId));
    const page = await view(uks, uksCookie);
    expect(page.contacts).toMatchObject({
      people: [{ name: 'Сотрудник acc-a', responsible: true }],
      phone: expect.stringContaining('505'),
    });
    expect(page.org.phone?.digits).toBe('996312900100');
    // Телефон организации — только в «Контактах» или при «Бухгалтер пока не назначен».
    await hide(uks, ['contacts']);
    expect((await view(uks, uksCookie)).org.phone).toBeNull();
    await hide(uks, []);
    await f.t.admin.db
      .update(schema.organizations)
      .set({ phone: null })
      .where(eq(schema.organizations.id, f.a.orgId));
  });

  it('файл отчёта: только в браузере с кодом, только свой загруженный файл', async () => {
    const ok = await fileOf(uks, ids.ndsFile!, uksCookie);
    expect(ok.status).toBe(302);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const location = ok.headers.get('location') ?? '';
    expect(location).toContain(`org/${f.a.orgId}/files/${ids.ndsFile}`);
    // Ссылка страницы — на 5 минут (ТЗ «Файлы»).
    expect(location).toContain('expires=300');
    expect(location).toContain('inline=application%2Fpdf');
    // Без кода, с cookie другой ссылки, чужой и ещё не загруженный — недоступно.
    for (const [id, cookie] of [
      [ids.ndsFile!, undefined],
      [ids.ndsFile!, asanovCookie],
      [ids.asanovFile!, uksCookie],
      [ids.pendingFile!, uksCookie],
      [randomUUID(), uksCookie],
    ] as const) {
      const res = await fileOf(uks, id, cookie);
      expect(res.status, id).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'page_unavailable',
      );
    }
    expect((await fileOf(uks, 'не-номер', uksCookie)).status).toBe(400);
  });

  it('файл недоступен при скрытых «Отчётах» и выключенных «Файлах в карточках»', async () => {
    await hide(uks, ['reports']);
    expect((await fileOf(uks, ids.ndsFile!, uksCookie)).status).toBe(404);
    await hide(uks, []);
    await features({ files: false });
    expect((await fileOf(uks, ids.ndsFile!, uksCookie)).status).toBe(404);
    // Файлов у периодов нет.
    const page = await view(uks, uksCookie);
    expect(page.reports!.items.every((r) => r.files.length === 0)).toBe(true);
    await features({ files: true });
    expect((await fileOf(uks, ids.ndsFile!, uksCookie)).status).toBe(302);
  });

  it('«Файлы»: файлы контрагента по категориям, от новых к старым; скрытые и задачи — нет', async () => {
    // Оплата НДС за сентябрь 15.10 (её файл — в «Оплатах налогов»), отменённая — не показывается.
    const [pay, cancelled] = await f.t.admin.db
      .insert(schema.moneyOperations)
      .values([
        {
          orgId: f.a.orgId,
          contractorId: uks.id,
          kind: 'pay' as const,
          amount: 125_050,
          opDate: '2026-10-15',
          holderKind: 'org' as const,
          reportId: ids.ndsSep!,
        },
        {
          orgId: f.a.orgId,
          contractorId: uks.id,
          kind: 'pay' as const,
          amount: 1_000,
          opDate: '2026-10-16',
          holderKind: 'org' as const,
          reportId: ids.ndsSep!,
          cancelledAt: new Date('2026-10-17T03:00:00Z'),
          cancelledBy: f.people['acc-a']!.userId,
          cancelReason: 'ошибка',
        },
      ])
      .returning({ id: schema.moneyOperations.id });
    await otherFile('docFile', uks, {
      sourceKind: 'manual',
      name: 'Устав.pdf',
      note: 'Устав в новой редакции',
      createdAt: new Date('2026-10-05T04:00:00Z'),
    });
    await otherFile('regFile', uks, {
      sourceKind: 'contractor',
      name: 'Свидетельство.jpg',
      contentType: 'image/jpeg',
      createdAt: new Date('2026-09-01T04:00:00Z'),
    });
    await otherFile('xlsFile', uks, {
      sourceKind: 'manual',
      name: 'Сверка.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      createdAt: new Date('2026-10-10T04:00:00Z'),
    });
    await otherFile('payFile', uks, {
      sourceKind: 'tax_payment',
      sourceId: pay!.id,
      name: 'Платёжка НДС.pdf',
    });
    await otherFile('cancelledFile', uks, {
      sourceKind: 'tax_payment',
      sourceId: cancelled!.id,
      name: 'Отменённая.pdf',
    });
    await otherFile('hiddenFile', uks, {
      sourceKind: 'manual',
      name: 'Черновик.pdf',
      pageHidden: true,
    });
    await otherFile('taskFile', uks, {
      sourceKind: 'task',
      sourceId: randomUUID(),
      name: 'Задача.pdf',
    });
    await otherFile('asanovDoc', asanov, { sourceKind: 'manual', name: 'Чужой документ.pdf' });
    await otherFile('deletedFile', uks, {
      sourceKind: 'manual',
      name: 'Удалённый.pdf',
      state: 'deleted',
      deletedAt: new Date('2026-10-12T04:00:00Z'),
      deletedBy: f.people['acc-a']!.userId,
    });

    const page = await view(uks, uksCookie);
    expect(page.files!.map((x) => [x.name, x.category, x.date])).toEqual([
      ['Декларация НДС.pdf', 'rep', '2026-10-20'],
      ['Платёжка НДС.pdf', 'pay', '2026-10-15'],
      ['Сверка.xlsx', 'doc', '2026-10-10'],
      ['Устав.pdf', 'doc', '2026-10-05'],
      ['Свидетельство.jpg', 'doc', '2026-09-01'],
      ['Не нужен.pdf', 'rep', '2026-08-10'],
    ]);
    const byName = Object.fromEntries(page.files!.map((x) => [x.name, x]));
    expect(byName['Декларация НДС.pdf']).toMatchObject({
      id: ids.ndsFile,
      rel: 'НДС · 09.2026',
      size: 10,
      preview: 'pdf',
    });
    // В суммах — неразрывные пробелы.
    expect(byName['Платёжка НДС.pdf']!.rel.replace(/\u00a0/g, ' ')).toBe(
      'НДС · 09.2026, оплата 1 250,50 сом от 15.10.2026',
    );
    // Примечание к файлу видно только сотрудникам (docs/deviations.md п. И-4): на странице его нет.
    expect(byName['Устав.pdf']!.rel).toBe('');
    expect(JSON.stringify(page)).not.toContain('Устав в новой редакции');
    expect(byName['Свидетельство.jpg']).toMatchObject({
      rel: 'Из свидетельства и выписки',
      preview: 'image',
    });
    expect(byName['Сверка.xlsx']).toMatchObject({ rel: '', preview: null });
    const json = JSON.stringify(page.files);
    for (const hidden of [
      'Черновик',
      'Задача',
      'Отменённая',
      'Чужой',
      'Загружается',
      'Удалённый',
      'org/',
    ]) {
      expect(json, hidden).not.toContain(hidden);
    }
    // У отчёта скрытый файл не показывается и в «Отчётах».
    await f.t.admin.db
      .update(schema.files)
      .set({ pageHidden: true })
      .where(eq(schema.files.id, ids.notRequiredFile!));
    expect((await view(uks, uksCookie)).files!.map((x) => x.name)).not.toContain('Не нужен.pdf');
    await f.t.admin.db
      .update(schema.files)
      .set({ pageHidden: false })
      .where(eq(schema.files.id, ids.notRequiredFile!));

    // Скрыты «Отчёты» и «Деньги на налоги» — их категорий в разделе нет.
    await hide(uks, ['reports', 'money']);
    const docs = await view(uks, uksCookie);
    expect([...new Set(docs.files!.map((x) => x.category))]).toEqual(['doc']);
    await hide(uks, []);
    // «Файлы в карточках» выключены — раздела нет.
    await features({ files: false });
    expect((await view(uks, uksCookie)).files).toBeNull();
    await features({ files: true });
  });

  it('«Файлы»: файл открывается по ссылке на 5 минут; «Скачать» — вложением; лишнее — недоступно', async () => {
    const open = await fileOf(uks, ids.docFile!, uksCookie);
    expect(open.status).toBe(302);
    expect(open.headers.get('cache-control')).toBe('no-store');
    const location = open.headers.get('location') ?? '';
    expect(location).toContain(`org/${f.a.orgId}/files/${ids.docFile}`);
    expect(location).toContain('expires=300');
    expect(location).toContain('inline=application%2Fpdf');
    // «Скачать» в окне просмотра — без показа в браузере.
    const download = await fileOf(uks, ids.docFile!, uksCookie, '?download=1');
    expect(download.status).toBe(302);
    expect(download.headers.get('location')).not.toContain('inline=');
    // Не картинка и не PDF — всегда скачивается.
    const xls = await fileOf(uks, ids.xlsFile!, uksCookie);
    expect(xls.headers.get('location')).not.toContain('inline=');
    // Файл «Не требуется» — в разделе «Файлы», открывается.
    expect((await fileOf(uks, ids.notRequiredFile!, uksCookie)).status).toBe(302);
    for (const id of [
      ids.hiddenFile!,
      ids.taskFile!,
      ids.cancelledFile!,
      ids.asanovDoc!,
      ids.pendingFile!,
      ids.deletedFile!,
    ]) {
      const res = await fileOf(uks, id, uksCookie);
      expect(res.status, id).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'page_unavailable',
      );
    }
    expect((await fileOf(uks, ids.docFile!, uksCookie, '?download=2')).status).toBe(400);
    // Раздел «Файлы» скрыт — его нет в ответе, документ компании недоступен, файл отчёта — по «Отчётам».
    await hide(uks, ['files']);
    expect((await view(uks, uksCookie)).files).toBeNull();
    expect((await fileOf(uks, ids.docFile!, uksCookie)).status).toBe(404);
    expect((await fileOf(uks, ids.notRequiredFile!, uksCookie)).status).toBe(404);
    expect((await fileOf(uks, ids.ndsFile!, uksCookie)).status).toBe(302);
    await hide(uks, []);
    // Без кода — недоступно.
    expect((await fileOf(uks, ids.docFile!)).status).toBe(404);
  });

  it('п. 60: после «Выключить» ни страница, ни файл не открываются', async () => {
    await call('POST', `/api/contractors/${asanov.id}/page/disable`, owner);
    const res = await f.app.request(`/api/page/org-a/${asanov.inn}`, {
      headers: { cookie: asanovCookie },
    });
    expect(PublicPage.parse(await res.json())).toEqual({ state: 'unavailable' });
    expect((await fileOf(asanov, ids.asanovFile!, asanovCookie)).status).toBe(404);
  });
});
