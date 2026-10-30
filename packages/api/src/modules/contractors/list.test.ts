import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ContractorHistory, ContractorList, ContractorSummary, ReportList } from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): срок 15.10 прошёл, 20.10 — ещё нет.
describe.skipIf(!databaseAvailable())(
  'Контрагенты: список, плашки и история карточки (задачи 2.10, 2.11)',
  () => {
    let f: Fixture;
    let owner: string;
    let acc: string;
    let ownerB: string;
    let cpA = '';
    let cpPaused = '';
    let cpNoGked = '';
    let cpArchived = '';
    let cpB = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const get = (cookie: string, path: string) => apiRequest(f.app, 'GET', path, cookie);
    const list = async (cookie: string, query = '') => {
      const res = await get(cookie, `/api/contractors?size=all${query}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorList.parse(await res.json());
    };
    const filter = (value: unknown) => `&filters=${encodeURIComponent(JSON.stringify(value))}`;
    const summary = async (cookie: string) => {
      const res = await get(cookie, '/api/contractors/summary');
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorSummary.parse(await res.json());
    };
    const history = async (cookie: string, id: string) => {
      const res = await get(cookie, `/api/contractors/${id}/history`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorHistory.parse(await res.json());
    };

    async function contractor(
      orgId: string,
      name: string,
      inn: string,
      values: Partial<typeof schema.contractors.$inferInsert> = {},
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
          gked: '46.34.0',
          startDate: '2026-01-15',
          ...values,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }

    async function report(
      values: Omit<Report, 'orgId' | 'period' | 'act'> & { act?: Report['act'] },
    ) {
      await f.t.admin.db
        .insert(schema.reports)
        .values({ orgId: f.a.orgId, period: 'M', act: 'sub', ...values });
    }

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      [owner, acc, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      cpA = await contractor(f.a.orgId, 'ОсОО «Ала-Тоо Трейд»', '03744097401851', {
        responsibleEmployeeId: employee('acc-a'),
      });
      cpPaused = await contractor(f.a.orgId, 'ОсОО «Пауза»', '03744097401852', {
        responsibleEmployeeId: employee('chief-a'),
        serviceStatus: 'paused',
      });
      cpNoGked = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', {
        gked: null,
        kind: 'oneoff',
      });
      cpArchived = await contractor(f.a.orgId, 'ОсОО «Архив»', '03744097401853', {
        responsibleEmployeeId: employee('acc-a'),
        serviceStatus: 'archived',
      });
      cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', '03744097401854', {
        responsibleEmployeeId: employee('acc-b'),
      });
      // Период с месяца начала создаётся сам; у приостановленного он закончился в сентябре.
      await f.t.admin.db
        .update(schema.contractorServicePeriods)
        .set({ toMonth: '2026-09-01' })
        .where(eq(schema.contractorServicePeriods.contractorId, cpPaused));
      const mine = { contractorId: cpA, responsibleEmployeeId: employee('acc-a') };
      // Просрочен: срок 15.10, «К сдаче».
      await report({
        ...mine,
        reportTypeCode: 't1m',
        periodStart: '2026-09-01',
        dueBase: '2026-10-15',
        dueDate: '2026-10-15',
      });
      // Срок ещё не прошёл.
      await report({
        ...mine,
        reportTypeCode: 'nds',
        act: 'both',
        periodStart: '2026-09-01',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
      });
      // Сдан: не просрочен и не «несданный».
      await report({
        ...mine,
        reportTypeCode: 't1m',
        periodStart: '2026-08-01',
        dueBase: '2026-09-15',
        dueDate: '2026-09-15',
        status: 'submitted',
        submittedOn: '2026-09-10',
      });
      // У приостановленного просрочки нет, хотя срок прошёл.
      await report({
        contractorId: cpPaused,
        responsibleEmployeeId: employee('chief-a'),
        reportTypeCode: 't1m',
        periodStart: '2026-08-01',
        dueBase: '2026-09-15',
        dueDate: '2026-09-15',
      });
      await f.t.admin.db.insert(schema.assignments).values([
        {
          orgId: f.a.orgId,
          contractorId: cpA,
          reportTypeCode: 't1m',
          fromMonth: '2026-01-01',
        },
        {
          orgId: f.a.orgId,
          contractorId: cpA,
          reportTypeCode: 'nds',
          fromMonth: '2026-01-01',
        },
        {
          orgId: f.a.orgId,
          contractorId: cpA,
          reportTypeCode: 'pat',
          fromMonth: '2026-01-01',
          endedOn: '2026-06-01',
        },
      ]);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('строка: просрочено, несданных, видов отчётов и обслуживание для меню', async () => {
      const rows = (await list(owner)).items;
      const a = rows.find((r) => r.id === cpA)!;
      expect(a).toMatchObject({ overdue: 1, openReports: 2, reportTypes: 2, hasReports: true });
      expect(a.service).toEqual({
        periods: [{ from: '2026-01', to: null }],
        month: '2026-10',
        plannedPause: null,
        plannedResume: null,
      });
      expect(rows.find((r) => r.id === cpPaused)).toMatchObject({ overdue: 0, openReports: 1 });
      expect(rows.find((r) => r.id === cpNoGked)).toMatchObject({
        hasReports: false,
        reportTypes: 0,
      });
      // Архивные — только с фильтром «Статус обслуживания».
      expect(rows.map((r) => r.id)).not.toContain(cpArchived);
    });

    it('дата под шкалой обслуживания: последняя смена статуса, без смен — создание', async () => {
      const chief = f.people['chief-a']!;
      await f.t.admin.db.insert(schema.statusHistory).values({
        orgId: f.a.orgId,
        scale: 'service',
        entityId: cpPaused,
        fromStatus: 'active',
        toStatus: 'paused',
        actorUserId: chief.userId,
        at: new Date('2026-10-01T03:00:00Z'),
      });
      const [who] = await f.t.admin.db
        .select({ name: schema.employees.shortName })
        .from(schema.employees)
        .where(eq(schema.employees.id, chief.employeeId));
      const rows = (await list(owner)).items;
      expect(rows.find((r) => r.id === cpPaused)!.serviceSince).toEqual({
        at: '2026-10-01T03:00:00.000Z',
        by: who!.name,
      });
      const a = rows.find((r) => r.id === cpA)!;
      expect(a.serviceSince).toEqual({ at: a.audit.createdAt, by: a.audit.createdBy });
    });

    it('фильтры: «Без ГКЭД», «Просрочено» от 1, «Без ответственного»', async () => {
      const ids = async (value: unknown) =>
        (await list(owner, filter(value))).items.map((r) => r.id);
      expect(await ids({ gkedSet: { type: 'enum', vals: ['no'] } })).toEqual([cpNoGked]);
      expect(await ids({ overdue: { type: 'num', from: 1, to: null } })).toEqual([cpA]);
      expect(await ids({ responsible: { type: 'enum', vals: [''] } })).toEqual([cpNoGked]);
      expect(
        (
          await list(owner, `${filter({ service: { type: 'enum', vals: ['archived'] } })}`)
        ).items.map((r) => r.id),
      ).toEqual([cpArchived]);
    });

    it('плашки: итоги в области; со «Своими» — только свои', async () => {
      expect(await summary(owner)).toEqual({
        active: 3,
        noResponsible: 1,
        withOverdue: 1,
        noGked: 1,
        socfundAsk: 0,
        // Функция «Показатели контрагентов» выключена — плашки нет.
        kpiMissing: null,
        paused: 1,
        oneoff: 1,
        archived: 1,
        scopeAll: true,
      });
      expect(await summary(acc)).toMatchObject({
        active: 1,
        noResponsible: 0,
        withOverdue: 1,
        noGked: 0,
        paused: 0,
        archived: 1,
        scopeAll: false,
      });
      const b = await summary(ownerB);
      expect(b).toMatchObject({ active: 1, withOverdue: 0, archived: 0 });
    });

    it('«Не заполнены показатели»: с функцией — плашка и столбец для фильтра', async () => {
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { indicators: true } })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
      try {
        // Показателей ещё нет — незаполненных нет.
        expect((await summary(owner)).kpiMissing).toBe(0);
        const res = await get(
          owner,
          `/api/contractors?size=all${filter({ kpiMissing: { type: 'enum', vals: ['yes'] } })}`,
        );
        expect(res.status, await res.clone().text()).toBe(200);
        expect(ContractorList.parse(await res.json()).items).toEqual([]);
      } finally {
        await f.t.admin.db
          .update(schema.orgSettings)
          .set({ features: {} })
          .where(eq(schema.orgSettings.orgId, f.a.orgId));
      }
    });

    it('«Отчёты к сдаче» карточки: только отчёты этого контрагента', async () => {
      const res = await get(owner, `/api/reports?size=all&contractorId=${cpA}`);
      expect(res.status, await res.clone().text()).toBe(200);
      const items = ReportList.parse(await res.json()).items;
      expect(items).toHaveLength(3);
      expect(new Set(items.map((r) => r.contractor.id))).toEqual(new Set([cpA]));
    });

    it('история: смена ответственного — с именами, отчёт — с видом и периодом; от новых к старым', async () => {
      const assign = await apiRequest(f.app, 'POST', '/api/contractors/assign', owner, {
        ids: [cpNoGked],
        responsibleEmployeeId: employee('acc-a'),
      });
      expect(assign.status, await assign.clone().text()).toBe(200);
      const h = await history(owner, cpNoGked);
      expect(h.items[0]).toMatchObject({
        entity: 'contractor',
        action: 'update',
        actor: expect.stringContaining('owner-a'),
        changes: [{ field: 'responsibleEmployeeId', from: null, to: employee('acc-a') }],
      });
      expect(h.names[employee('acc-a')]).toBe('acc-a');

      // Запись отчёта с contractor_id — с подписью «вид период».
      const [r] = await f.t.admin.db
        .select({ id: schema.reports.id })
        .from(schema.reports)
        .where(eq(schema.reports.contractorId, cpA))
        .limit(1);
      await f.t.admin.db.insert(schema.auditLog).values({
        orgId: f.a.orgId,
        entity: 'report',
        entityId: r!.id,
        action: 'update',
        contractorId: cpA,
        changes: [{ field: 'dueDate', from: '2026-10-15', to: '2026-10-16' }],
        actorUserId: f.a.ownerUserId,
      });
      const ha = await history(owner, cpA);
      expect(ha.items[0]).toMatchObject({ entity: 'report', subject: expect.any(String) });
      expect(ha.items[0]!.subject).toMatch(/^(1-Т|НДС|[^ ]+) (08|09)\.2026$/);
    });

    it('история по правам: без «Видеть плату» — без полей платы; отчёты, задачи, показатели и файлы — как вкладки карточки', async () => {
      const senior = await signIn(f.app, 'senior-a', TEST_PASSWORD);
      const cp = await contractor(f.a.orgId, 'ОсОО «История»', '02810201510077', {
        responsibleEmployeeId: employee('senior-a'),
      });
      const setFeatures = (features: Record<string, boolean>) =>
        f.t.admin.db
          .update(schema.orgSettings)
          .set({ features })
          .where(eq(schema.orgSettings.orgId, f.a.orgId));
      const entry = (
        entity: string,
        action: string,
        changes: { field: string; from?: unknown; to?: unknown }[],
      ) => ({
        orgId: f.a.orgId,
        entity,
        entityId: crypto.randomUUID(),
        action,
        contractorId: cp,
        changes,
        actorUserId: f.a.ownerUserId,
      });
      await f.t.admin.db.insert(schema.auditLog).values([
        entry('contractor', 'create', [
          { field: 'name', to: 'ОсОО «История»' },
          { field: 'tariff', to: { amount: 1_200_000, period: 'M', validFrom: '2026-01-01' } },
          { field: 'feeDay', to: 5 },
        ]),
        entry('contractor', 'update', [{ field: 'tariff', from: null, to: { amount: 1 } }]),
        entry('assignment', 'create', [{ field: 'typeCode', to: 'nds' }]),
        entry('report', 'update', [{ field: 'amount', from: 0, to: 500_000 }]),
        entry('task', 'create', [{ field: 'title', to: 'Сверка' }]),
        entry('indicator_value', 'update', [{ field: 'value', from: 1, to: 2 }]),
        entry('file', 'file_attach', [{ field: 'file', to: 'Договор.pdf' }]),
        // Сущность без правила (например, деньги потока В) не видна никому.
        entry('employee', 'update', [{ field: 'phone', from: '1', to: '2' }]),
      ]);
      const kinds = (h: ContractorHistory) => h.items.map((x) => x.entity).sort();

      await setFeatures({ fee: true, tasks: true, indicators: true, files: true });
      expect(kinds(await history(owner, cp))).toEqual([
        'assignment',
        'contractor',
        'contractor',
        'file',
        'indicator_value',
        'report',
        'task',
      ]);
      const ownCreate = (await history(owner, cp)).items.find(
        (x) => x.entity === 'contractor' && x.action === 'create',
      );
      expect(ownCreate?.changes.map((x) => x.field)).toEqual(['name', 'tariff', 'feeDay']);

      // «Старший»: только «Просматривать контрагентов» — без отчётов, показателей, файлов и платы.
      const h = await history(senior, cp);
      expect(kinds(h)).toEqual(['contractor', 'task']);
      expect(h.items.find((x) => x.entity === 'contractor')?.changes).toEqual([
        { field: 'name', to: 'ОсОО «История»' },
      ]);
      expect(JSON.stringify(h)).not.toContain('1200000');

      // Выключенные функции прячут свои записи и у владельца.
      await setFeatures({ fee: false, tasks: false, indicators: false, files: false });
      const off = await history(owner, cp);
      expect(kinds(off)).toEqual(['assignment', 'contractor', 'report']);
      expect(off.items.find((x) => x.entity === 'contractor')?.changes).toHaveLength(1);
      await setFeatures({});
    });

    it('история: неверный номер — 400, без входа — 401, чужая организация и чужой контрагент со «Своими» — «не найден»', async () => {
      expect((await get(owner, '/api/contractors/not-a-uuid/history')).status).toBe(400);
      expect((await apiRequest(f.app, 'GET', `/api/contractors/${cpA}/history`)).status).toBe(401);
      expect((await apiRequest(f.app, 'GET', '/api/contractors/summary')).status).toBe(401);
      expect((await get(ownerB, `/api/contractors/${cpA}/history`)).status).toBe(404);
      expect((await get(acc, `/api/contractors/${cpPaused}/history`)).status).toBe(404);
      expect((await get(acc, `/api/contractors/${cpA}/history`)).status).toBe(200);
      expect((await get(owner, `/api/contractors/${cpB}/history`)).status).toBe(404);
    });
  },
);
