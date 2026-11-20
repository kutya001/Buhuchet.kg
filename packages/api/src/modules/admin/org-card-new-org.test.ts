import { schema } from '@buhuchet/db';
import type { MemoryStorage } from '@buhuchet/adapters';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { OPEN_REPORT_STATUSES } from '@buhuchet/domain';
import {
  ActivityOverview,
  AdminOrgCard,
  AdminOrgContractorList,
  AdminOrgStaffList,
  AdminUserCard,
  ContractorFees,
  ContractorList,
  ContractorTabCounts,
  EmployeeList,
  FeePaymentForm,
  FileUploadTicket,
  FileUsage,
  OrgActivityList,
  OrgActivityOverview,
  OrgPolicy,
  ReportList,
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
  let orgId: string;
  const cps: string[] = [];
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
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    const [ownerEmp] = await f.t.admin.db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(eq(schema.employees.orgId, orgId));
    const accEmp = f.people['acc-b']!.employeeId;

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
      ownerEmp!.id,
      500_000,
    );
    const c2 = await contractor('ИП Второй Клиент', '20101199009022', 'regular', accEmp, 300_000);
    await contractor('ОсОО «Разовый клиент»', '03744097409033', 'oneoff', ownerEmp!.id, 0);
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
    // Оплата за обслуживание у первого контрагента — за месяц карточки.
    const form = await get(`/api/contractors/${c1}/fee-payment-form`, owner, (x) =>
      FeePaymentForm.parse(x),
    );
    const month = form.months.at(-1)!;
    await ok(
      await call('POST', `/api/contractors/${c1}/fee-payments`, owner, {
        amount: month.left,
        date: '2026-10-18',
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
    expect(s.staff).toBe(staff.total);
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
    for (const [plate, firm] of [
      ['over', repTabs.overdue],
      ['all', firmAll.total],
    ] as const) {
      const list = await get(
        `/api/admin/organizations/${orgId}/reports?plate=${plate}&size=all`,
        admin,
        (x) => ReportList.parse(x),
      );
      expect(list.total, plate).toBe(firm);
    }

    // Задачи и файлы.
    const tasks = await get('/api/tasks?tab=all&size=all', owner, (x) => TaskList.parse(x));
    expect(s.tasks).toBe(tasks.total);
    const usage = await get('/api/files/usage', owner, (x) => FileUsage.parse(x));
    expect(s.files).toEqual({ count: usage.count, bytes: usage.bytes });
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

    // «Активность» за год: входы и действия пишет база по своим часам, а период считается по часам
    // сайта — год охватывает и то и другое; сравнивается организация с самой собой.
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
    expect(row.staff).toBe(firm.staff);
    expect(all.cps).toBeGreaterThanOrEqual(row.cps);
  });
});
