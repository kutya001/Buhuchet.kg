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
  const fileOf = (c: Contractor, id: string, cookie?: string) =>
    f.app.request(`/api/page/org-a/${c.inn}/files/${id}`, {
      headers: cookie ? { cookie } : {},
    });

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
    expect(page.sections).toEqual(['pay', 'reports', 'money', 'fee', 'kpi', 'contacts']);
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
    expect(nds.files).toEqual([{ id: ids.ndsFile, name: 'Декларация НДС.pdf' }]);
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
    const before = await view(uks, uksCookie);
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
  });

  it('скрытые разделы сервер не передаёт вовсе; «Ваш бухгалтер» — всегда', async () => {
    await hide(uks, ['pay', 'reports', 'money', 'fee', 'kpi', 'contacts']);
    const page = await view(uks, uksCookie);
    expect(page.sections).toEqual([]);
    expect(page).toMatchObject({
      pay: null,
      reports: null,
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
    expect(json).not.toContain('0555');

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
    const page = await view(uks, uksCookie);
    expect(page.contacts).toMatchObject({
      people: [{ name: 'Сотрудник acc-a', responsible: true }],
      phone: expect.stringContaining('505'),
    });
  });

  it('файл отчёта: только в браузере с кодом, только свой загруженный файл', async () => {
    const ok = await fileOf(uks, ids.ndsFile!, uksCookie);
    expect(ok.status).toBe(302);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const location = ok.headers.get('location') ?? '';
    expect(location).toContain(`org/${f.a.orgId}/files/${ids.ndsFile}`);
    expect(location).toContain('expires=900');
    expect(location).toContain('inline=application%2Fpdf');
    // Без кода, с cookie другой ссылки, чужой, ещё не загруженный и у «Не требуется» — недоступно.
    for (const [id, cookie] of [
      [ids.ndsFile!, undefined],
      [ids.ndsFile!, asanovCookie],
      [ids.asanovFile!, uksCookie],
      [ids.pendingFile!, uksCookie],
      [ids.notRequiredFile!, uksCookie],
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

  it('п. 60: после «Выключить» ни страница, ни файл не открываются', async () => {
    await call('POST', `/api/contractors/${asanov.id}/page/disable`, owner);
    const res = await f.app.request(`/api/page/org-a/${asanov.inn}`, {
      headers: { cookie: asanovCookie },
    });
    expect(PublicPage.parse(await res.json())).toEqual({ state: 'unavailable' });
    expect((await fileOf(asanov, ids.asanovFile!, asanovCookie)).status).toBe(404);
  });
});
