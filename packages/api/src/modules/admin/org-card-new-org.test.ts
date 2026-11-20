import { schema } from '@buhuchet/db';
import type { MemoryStorage } from '@buhuchet/adapters';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { addDays, bishkekDate, OPEN_REPORT_STATUSES } from '@buhuchet/domain';
import {
  ActivityOverview,
  AdminOrgCard,
  AdminOrgContractorList,
  AdminOrgStaffList,
  AdminUserCard,
  ContractorFees,
  ContractorList,
  ContractorSummary,
  ContractorTabCounts,
  EmployeeList,
  FeePaymentForm,
  FileManagerSummary,
  FileUploadTicket,
  FileUsage,
  OrgActivityList,
  OrgActivityOverview,
  OrgPolicy,
  ReportList,
  ReportSaved,
  ReportSubmitted,
  ReportTabCounts,
  TaskList,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/**
 * Проверка «Админка на новой организации» (доработки 20.11.2026, пакет 2, блок 2): фирма заводит всё
 * сама через свои методы, как сразу после регистрации, — контрагентов, отчёты, оплату, файлы, задачу;
 * каждое число карточки организации, её списков, карточки владельца и «Активности» Админки совпадает
 * с тем, что видит у себя сама фирма. Организация Б фикстуры — новая: в ней только владелец и сотрудник.
 */
describe.skipIf(!databaseAvailable())('Админка на новой организации: числа — как у фирмы', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;
  let acc: string;
  let accEmp: string;
  let orgId: string;
  /** «Сегодня» сайта — по часам теста. */
  let today: string;
  const cps: string[] = [];
  // Пустой список контрагентов: до первого контрагента и у сотрудника с областью «Свои» после него.
  let emptyAtStart: ContractorSummary;
  let accAfterFirst: ContractorSummary;
  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, cookie: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const ok = async <T>(res: Response, parse: (x: unknown) => T, status = 200): Promise<T> => {
    expect(res.status, await res.clone().text()).toBe(status);
    return parse(await res.json());
  };
  const get = async <T>(path: string, cookie: string, parse: (x: unknown) => T) =>
    ok(await call('GET', path, cookie), parse);

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    orgId = f.b.orgId;
    today = bishkekDate(f.deps.clock.now());
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    acc = await signIn(f.app, 'acc-b', TEST_PASSWORD);
    const summary = (cookie: string) =>
      get('/api/contractors/summary', cookie, (x) => ContractorSummary.parse(x));
    emptyAtStart = await summary(owner);
    const ownerEmp = f.b.ownerEmployeeId;
    accEmp = f.people['acc-b']!.employeeId;

    // Учётная политика: все функции включены, как у фирмы, которая пользуется всем.
    const policy = await get('/api/org/policy', owner, (x) => OrgPolicy.parse(x));
    const features = Object.fromEntries(Object.keys(policy.features).map((k) => [k, true]));
    await ok(
      await call('PATCH', '/api/org/policy', owner, { version: policy.version, features }),
      (x) => x,
    );
    await ok(
      await call('POST', '/api/org-report-types/connect', owner, {
        connect: ['nds', 't1m'],
        disconnect: [],
      }),
      (x) => x,
    );
    // Три контрагента: два постоянных с платой за обслуживание, один разовый.
    const contractor = async (
      name: string,
      inn: string,
      kind: string,
      resp: string,
      fee: number,
    ) => {
      const created = await ok(
        await call('POST', '/api/contractors', owner, {
          name,
          inn,
          phone: '+996505890076',
          kind,
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          gked: '46.34.0',
          gkedExtra: [],
          bases: [],
          startDate: '2026-07-01',
          responsibleEmployeeId: resp,
          ...(fee ? { tariff: { amount: fee, period: 'M' } } : {}),
        }),
        (x) => x as { id: string },
        201,
      );
      cps.push(created.id);
      return created.id;
    };
    const c1 = await contractor(
      'ОсОО «Первый клиент»',
      '03744097409011',
      'regular',
      ownerEmp,
      500_000,
    );
    accAfterFirst = await summary(acc);
    const c2 = await contractor('ИП Второй Клиент', '20101199009022', 'regular', accEmp, 300_000);
    await contractor('ОсОО «Разовый клиент»', '03744097409033', 'oneoff', ownerEmp, 0);
    // Часы тестов стоят на 18.10.2026, а момент создания записи база ставит по своим часам: плата
    // начисляется не раньше месяца создания контрагента (п. В-5) — «заведены» в июле.
    await f.t.admin.db
      .update(schema.contractors)
      .set({ createdAt: new Date('2026-07-01T00:00:00Z') })
      .where(eq(schema.contractors.orgId, orgId));
    // Назначения с июля без отметки прошлых сданными — у новой фирмы сразу есть просроченные.
    for (const cp of [c1, c2]) {
      for (const [code, rate] of [
        ['nds', '12 %'],
        ['t1m', null],
      ] as const) {
        await ok(
          await call('POST', '/api/assignments', owner, {
            contractorId: cp,
            reportTypeCode: code,
            rate,
            fromMonth: '2026-07-01',
            markPast: false,
          }),
          (x) => x,
          201,
        );
      }
    }
    // Отчёты в разных статусах: у второго контрагента один «В работе», один «Сдан» сегодня; у первого —
    // сумма к уплате (плитки «В работе» и «Сдано», налоги по месяцам, «Работа» сотрудника).
    const overdueNow = await get('/api/reports?tab=overdue&size=all', owner, (x) =>
      ReportList.parse(x),
    );
    // Сумма к уплате есть только у НДС, у «Т1» её нет — он сдаётся без ожидания оплаты.
    const of = (cp: string, code: string) =>
      overdueNow.items.find((r) => r.contractor.id === cp && r.type.code === code)!;
    const nds2 = of(c2, 'nds');
    const t1m2 = of(c2, 't1m');
    const nds1 = of(c1, 'nds');
    const started = await ok(
      await call('POST', `/api/reports/${nds2.id}/start`, owner, { version: nds2.version }),
      (x) => ReportSaved.parse(x),
    );
    await ok(
      await call('POST', `/api/reports/${started.id}/amount`, owner, {
        version: started.version,
        amount: 70_000,
      }),
      (x) => x,
    );
    const submitted = await ok(
      await call('POST', `/api/reports/${t1m2.id}/submit`, owner, {
        version: t1m2.version,
        date: today,
      }),
      (x) => ReportSubmitted.parse(x),
    );
    expect(submitted.waitsPayment).toBeNull();
    await ok(
      await call('POST', `/api/reports/${nds1.id}/amount`, owner, {
        version: nds1.version,
        amount: 150_000,
      }),
      (x) => x,
    );
    // Оплата за обслуживание у первого контрагента — за месяц карточки.
    const form = await get(`/api/contractors/${c1}/fee-payment-form`, owner, (x) =>
      FeePaymentForm.parse(x),
    );
    const month = form.months.at(-1)!;
    await ok(
      await call('POST', `/api/contractors/${c1}/fee-payments`, owner, {
        amount: month.left,
        date: today,
        to: form.to[0]!.key,
        allocation: [{ month: month.month, amount: month.left }],
      }),
      (x) => x,
      201,
    );
    // Файлы: у контрагента и общий.
    const upload = async (name: string, size: number, contractorId: string | null) => {
      const ticket = await ok(
        await call('POST', '/api/files/uploads', owner, {
          source: { kind: 'manual', id: null },
          name,
          size,
          contractorId,
        }),
        (x) => FileUploadTicket.parse(x),
        201,
      );
      const [row] = await f.t.admin.db
        .select({ key: schema.files.storageKey, type: schema.files.contentType })
        .from(schema.files)
        .where(eq(schema.files.id, ticket.id));
      await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(size), {
        contentType: row!.type,
      });
      await ok(await call('POST', `/api/files/${ticket.id}/complete`, owner), (x) => x);
    };
    await upload('Договор первого клиента.pdf', 30_000, c1);
    await upload('Общий приказ.pdf', 12_000, null);
    await ok(
      await call('POST', '/api/tasks', owner, {
        title: 'Сверить акты',
        description: '',
        categoryCode: 'КАТ-001',
        contractorId: c1,
        executorEmployeeId: accEmp,
        term: 'day',
        dueDate: '2026-10-25',
        needFile: false,
        confirm: false,
      }),
      (x) => x,
      201,
    );
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('«Сводка» и списки карточки — те же числа, что у фирмы', async () => {
    const card = await get(`/api/admin/organizations/${orgId}/card?refresh=1`, admin, (x) =>
      AdminOrgCard.parse(x),
    );
    const s = card.summary;

    // Сотрудники и контрагенты.
    const staff = await get('/api/staff?size=all', owner, (x) => EmployeeList.parse(x));
    expect(s.staff).toBe(staff.items.filter((e) => e.active).length);
    expect(s.staffBlocked).toBe(staff.items.filter((e) => !e.active).length);
    const staffTab = await get(`/api/admin/organizations/${orgId}/staff?size=all`, admin, (x) =>
      AdminOrgStaffList.parse(x),
    );
    expect(staffTab.total).toBe(staff.total);
    const cpTabs = await get('/api/contractors/tab-counts', owner, (x) =>
      ContractorTabCounts.parse(x),
    );
    expect(s.contractors.regular + s.contractors.oneoff + s.contractors.paused).toBe(cpTabs.all);
    expect([s.contractors.regular, s.contractors.oneoff]).toEqual([2, 1]);
    const cpTab = await get(`/api/admin/organizations/${orgId}/contractors?size=all`, admin, (x) =>
      AdminOrgContractorList.parse(x),
    );
    expect(cpTab.total).toBe(cpTabs.all + s.contractors.archived);

    // Отчёты: «Просрочено» и несданные — как вкладки отчётов фирмы.
    const repTabs = await get('/api/reports/tab-counts', owner, (x) => ReportTabCounts.parse(x));
    expect(s.reports.overdue).toBeGreaterThan(0);
    expect(s.reports.overdue).toBe(repTabs.overdue);
    const firmAll = await get('/api/reports?tab=all&size=all', owner, (x) => ReportList.parse(x));
    expect(s.reports.open).toBe(
      firmAll.items.filter((r) => OPEN_REPORT_STATUSES.has(r.status)).length,
    );
    expect(s.reports.month + s.reports.later).toBe(s.reports.open);
    // Плитки списка отчётов Админки — по статусам отчётов фирмы; списки плиток — те же числа.
    const byStatus = (statuses: readonly string[]) =>
      firmAll.items.filter((r) => statuses.includes(r.status)).length;
    const plates = card.reports.plates;
    expect(plates).toEqual({
      due: s.reports.open,
      work: byStatus(['in_progress', 'needs_fix']),
      done: byStatus(['submitted']),
      over: repTabs.overdue,
      all: firmAll.total,
    });
    expect([plates.work, plates.done]).toEqual([1, 1]);
    for (const [plate, firm] of Object.entries(plates)) {
      const list = await get(
        `/api/admin/organizations/${orgId}/reports?plate=${plate}&size=all`,
        admin,
        (x) => ReportList.parse(x),
      );
      expect(list.total, plate).toBe(firm);
    }
    // Пустая вкладка «Отчёты»: контрагенты без архива и сколько из них с назначениями.
    const cpSummary = await get('/api/contractors/summary', owner, (x) =>
      ContractorSummary.parse(x),
    );
    expect(card.reports.contractors).toBe(cpSummary.active);
    expect(card.reports.assigned).toBe(new Set(firmAll.items.map((r) => r.contractor.id)).size);
    expect(card.reports.assigned).toBe(2);

    // Задачи и файлы.
    const tasks = await get('/api/tasks?tab=all&size=all', owner, (x) => TaskList.parse(x));
    expect(s.tasks).toBe(tasks.total);
    const usage = await get('/api/files/usage', owner, (x) => FileUsage.parse(x));
    expect(s.files).toEqual({ count: usage.count, bytes: usage.bytes });
    // Вкладка «Файлы» — по видам, как плашки «Файлового менеджера» фирмы.
    const manager = await get('/api/files/manager/summary', owner, (x) =>
      FileManagerSummary.parse(x),
    );
    const plateCounts = Object.fromEntries(
      manager.plates.filter((p) => p.count > 0).map((p) => [p.kind, p.count]),
    );
    expect(Object.fromEntries(card.files.byKind.map((k) => [k.kind, k.count]))).toEqual(
      plateCounts,
    );
    expect(s.telegram).toBe(staff.items.filter((e) => e.telegram).length);
    expect(usage).toEqual({ count: 2, bytes: 42_000 });

    // Плата за обслуживание месяца карточки — сумма начислений и оплат по карточкам контрагентов фирмы.
    let charged = 0;
    let paid = 0;
    for (const cp of cps) {
      const fees = await get(`/api/contractors/${cp}/fees`, owner, (x) => ContractorFees.parse(x));
      const m = fees.months.find((row) => row.month === s.month);
      charged += m?.charge ?? 0;
      paid += m?.paid ?? 0;
    }
    expect(card.money?.feeMonth).toEqual({ charged, paid });
    expect(paid).toBeGreaterThan(0);

    // За год — с января по месяц карточки, по тем же карточкам контрагентов.
    let yearCharged = 0;
    let yearPaid = 0;
    for (const cp of cps) {
      const fees = await get(`/api/contractors/${cp}/fees`, owner, (x) => ContractorFees.parse(x));
      for (const m of fees.months) {
        if (m.month < `${s.month.slice(0, 4)}-01` || m.month > s.month) continue;
        yearCharged += m.charge;
        yearPaid += m.paid;
      }
    }
    expect(card.money?.feeYear).toEqual({ charged: yearCharged, paid: yearPaid });
    expect(yearCharged).toBeGreaterThan(charged);

    // Налоги по месяцам уплаты: суммы к уплате отчётов фирмы по месяцу срока оплаты (иначе — сдачи).
    const taxes = new Map<string, { sum: number; paid: number }>();
    for (const r of firmAll.items) {
      if (!r.amount || r.amount <= 0) continue;
      const m = (r.payDue ?? r.dueDate).slice(0, 7);
      const row = taxes.get(m) ?? { sum: 0, paid: 0 };
      row.sum += r.amount;
      row.paid += Math.min(r.paid, r.amount);
      taxes.set(m, row);
    }
    const expected = [...taxes.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => b.month.localeCompare(a.month));
    expect(card.money?.taxes).toEqual(expected);
    expect(expected.reduce((n, t) => n + t.sum, 0)).toBe(220_000);
  });

  it('карточка владельца и «Активность» — как «Главная» → «Активность» фирмы', async () => {
    const [ownerUser] = await f.t.admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.login, 'owner-b'));
    const userCard = await get(`/api/admin/users/${ownerUser!.id}/card?refresh=1`, admin, (x) =>
      AdminUserCard.parse(x),
    );
    expect(userCard.user.orgId).toBe(orgId);
    // «Работа» владельца — его контрагенты и их просроченные отчёты, как «Мои контрагенты» фирмы.
    const cpTabs = await get('/api/contractors/tab-counts', owner, (x) =>
      ContractorTabCounts.parse(x),
    );
    expect(userCard.work?.contractors.count).toBe(cpTabs.mine);
    const mine = await get('/api/contractors?tab=mine&size=all', owner, (x) =>
      ContractorList.parse(x),
    );
    const mineIds = new Set(mine.items.map((c) => c.id));
    const overdue = await get('/api/reports?tab=overdue&size=all', owner, (x) =>
      ReportList.parse(x),
    );
    const ownOverdue = overdue.items.filter((r) => mineIds.has(r.contractor.id)).length;
    expect(ownOverdue).toBeGreaterThan(0);
    expect(userCard.work?.overdue.count).toBe(ownOverdue);
    expect(userCard.sessions.open).toBeGreaterThan(0);

    // «Работа» сотрудника — отчёты, где он ответственный, и его открытые задачи, как у фирмы.
    const [accUser] = await f.t.admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.login, 'acc-b'));
    const accCard = await get(`/api/admin/users/${accUser!.id}/card?refresh=1`, admin, (x) =>
      AdminUserCard.parse(x),
    );
    const accTabs = await get('/api/contractors/tab-counts', acc, (x) =>
      ContractorTabCounts.parse(x),
    );
    const firmAll = await get('/api/reports?tab=all&size=all', owner, (x) => ReportList.parse(x));
    const his = firmAll.items.filter((r) => r.responsible?.id === accEmp);
    const hisOverdue = overdue.items.filter((r) => r.responsible?.id === accEmp).length;
    const firmTasks = await get('/api/tasks?tab=all&size=all', owner, (x) => TaskList.parse(x));
    const work = accCard.work!;
    expect({
      contractors: work.contractors.count,
      due: work.due.count,
      inWork: work.inWork.count,
      overdue: work.overdue.count,
      done: work.done.count,
      tasks: work.tasks.count,
    }).toEqual({
      contractors: accTabs.mine,
      due: his.filter((r) => r.status === 'todo').length,
      inWork: his.filter((r) => r.status === 'in_progress').length,
      overdue: hisOverdue,
      done: his.filter(
        (r) => r.status === 'submitted' && r.submittedOn?.startsWith(today.slice(0, 7)),
      ).length,
      tasks: firmTasks.items.filter(
        (t) => t.executor.id === accEmp && ['todo', 'in_progress', 'rework'].includes(t.status),
      ).length,
    });
    expect([work.contractors.count, work.inWork.count, work.done.count, work.tasks.count]).toEqual([
      1, 1, 1, 1,
    ]);
    expect(work.overdue.count).toBeGreaterThan(0);

    // «Активность» за год: период считается по часам сайта (тест — 18.10.2026), а входы, действия и
    // смены статусов база пишет по своим, настоящим, — после конца периода. События фирмы переносятся
    // на вчера по часам сайта, как месяц создания контрагентов (docs/typical-mistakes.md № 52, 57).
    const moved = new Date(`${addDays(today, -1)}T06:00:00Z`);
    await f.t.admin.db
      .update(schema.auditLog)
      .set({ at: moved })
      .where(eq(schema.auditLog.orgId, orgId));
    await f.t.admin.db
      .update(schema.statusHistory)
      .set({ at: moved })
      .where(eq(schema.statusHistory.orgId, orgId));
    await f.t.admin.db
      .update(schema.sessionLog)
      .set({ startedAt: moved, lastSeenAt: moved })
      .where(eq(schema.sessionLog.orgId, orgId));
    const firm = await get('/api/home/activity/summary?k=y&off=0', owner, (x) =>
      ActivityOverview.parse(x),
    );
    const all = await get('/api/admin/org-activity/summary?k=y&off=0', admin, (x) =>
      OrgActivityOverview.parse(x),
    );
    const rows = await get('/api/admin/org-activity?size=all&k=y&off=0', admin, (x) =>
      OrgActivityList.parse(x),
    );
    const row = rows.items.find((r) => r.id === orgId)!;
    expect(row).toBeDefined();
    expect([row.in, row.n, row.sub]).toEqual([firm.in, firm.n, firm.sub]);
    expect([row.in, row.n, row.sub].every((n) => n > 0)).toBe(true);
    expect(row.staff).toBe(firm.staff);
    expect(all.cps).toBeGreaterThanOrEqual(row.cps);
  });

  it('пустой список контрагентов: первый вход — по всей организации, а не по области', () => {
    expect(emptyAtStart).toMatchObject({ active: 0, archived: 0, orgEmpty: true });
    // У сотрудника с областью «Свои» своих контрагентов ещё нет, но в организации они уже есть.
    expect(accAfterFirst).toMatchObject({ active: 0, scopeAll: false, orgEmpty: false });
  });
});
