import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ListValues, ManualReportOptions, ReportList, ReportTabCounts } from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

// Сегодня в тестах — 18.10.2026 (воскресенье, `createTestDeps`): «На этой неделе» — 19–25.10.
describe.skipIf(!databaseAvailable())(
  'Отчёты: вкладки, плашки и быстрый фильтр списка (задача 2.13)',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpChief = '';
    let cpArchived = '';
    let cpB = '';
    const ids: Record<string, string> = {};

    const employee = (login: string) => f.people[login]!.employeeId;
    const user = (login: string) => f.people[login]!.userId;
    const get = (cookie: string, path: string) => apiRequest(f.app, 'GET', path, cookie);
    const list = async (cookie: string, query = '') => {
      const res = await get(cookie, `/api/reports?size=all${query}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ReportList.parse(await res.json());
    };
    const names = async (cookie: string, query = '') =>
      (await list(cookie, query)).items.map((r) => r.id);
    const of = (...keys: string[]) => keys.map((k) => ids[k]).sort();
    const summary = async (cookie: string) => {
      const res = await get(cookie, '/api/reports/tab-counts');
      expect(res.status, await res.clone().text()).toBe(200);
      return ReportTabCounts.parse(await res.json());
    };

    async function contractor(
      orgId: string,
      name: string,
      inn: string,
      responsible: string,
      serviceStatus: 'active' | 'archived' = 'active',
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
          startDate: '2026-01-15',
          responsibleEmployeeId: responsible,
          serviceStatus,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }

    async function report(key: string, values: Omit<Report, 'orgId'>) {
      const [row] = await f.t.admin.db
        .insert(schema.reports)
        .values({ orgId: f.a.orgId, ...values })
        .returning({ id: schema.reports.id });
      ids[key] = row!.id;
    }

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      [owner, chief, acc, senior, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'senior-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      const res = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
        connect: ['nds', 't1m', 'pat', 'utli'],
        disconnect: [],
      });
      expect(res.status, await res.clone().text()).toBe(200);
      cpA = await contractor(
        f.a.orgId,
        'ОсОО «Ала-Тоо Трейд»',
        '03744097401851',
        employee('acc-a'),
      );
      cpChief = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('chief-a'));
      cpArchived = await contractor(
        f.a.orgId,
        'ОсОО «Архив»',
        '03744097401853',
        employee('chief-a'),
        'archived',
      );
      cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', '03744097401852', employee('acc-b'));

      const mine = { contractorId: cpA, responsibleEmployeeId: employee('acc-a') };
      // НДС за сентябрь: сдача + уплата, срок на неделе, сумма не указана.
      await report('ndsSep', {
        ...mine,
        reportTypeCode: 'nds',
        period: 'M',
        periodStart: '2026-09-01',
        act: 'both',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-20',
      });
      // 1-Т за июль: срок 31.08 (День независимости) перенесён на 01.09, сдан.
      await report('t1Jul', {
        ...mine,
        reportTypeCode: 't1m',
        period: 'M',
        periodStart: '2026-06-01',
        act: 'sub',
        dueBase: '2026-08-31',
        dueDate: '2026-09-01',
        status: 'submitted',
        submittedOn: '2026-08-28',
        confirmedAt: new Date('2026-08-29T04:00:00Z'),
        confirmedBy: f.a.ownerUserId,
      });
      // 1-Т за сентябрь: только сдача, просрочен.
      await report('t1Q3', {
        ...mine,
        reportTypeCode: 't1m',
        period: 'M',
        periodStart: '2026-09-01',
        act: 'sub',
        dueBase: '2026-10-15',
        dueDate: '2026-10-15',
      });
      // Патент за октябрь: только уплата — ни на неделе, ни в просроченных сдачи нет.
      await report('patOct', {
        ...mine,
        reportTypeCode: 'pat',
        period: 'M',
        periodStart: '2026-10-01',
        act: 'pay',
        dueBase: '2026-10-21',
        dueDate: '2026-10-21',
        payDue: '2026-10-21',
        amount: 500_000,
      });
      // НДС за август: сдан бухгалтером 10.10, ждёт подтверждения 8 дней.
      await report('ndsAug', {
        ...mine,
        reportTypeCode: 'nds',
        period: 'M',
        periodStart: '2026-08-01',
        act: 'both',
        dueBase: '2026-09-21',
        dueDate: '2026-09-21',
        payDue: '2026-10-25',
        status: 'submitted',
        submittedOn: '2026-10-10',
        submittedAt: new Date('2026-10-10T05:00:00Z'),
        submittedBy: user('acc-a'),
        amount: 300_000,
      });
      // НДС за июль у контрагента главного бухгалтера: сдан и подтверждён.
      await report('ndsJul', {
        contractorId: cpChief,
        responsibleEmployeeId: employee('chief-a'),
        reportTypeCode: 'nds',
        period: 'M',
        periodStart: '2026-07-01',
        act: 'both',
        dueBase: '2026-08-20',
        dueDate: '2026-08-20',
        payDue: '2026-09-25',
        status: 'submitted',
        submittedOn: '2026-09-20',
        submittedBy: user('chief-a'),
        confirmedAt: new Date('2026-09-22T04:00:00Z'),
        confirmedBy: f.a.ownerUserId,
        amount: 200_000,
      });
      // 1-Т за июль — «Не требуется»: ни «Сдать», ни «Уплатить».
      await report('t1Q2', {
        ...mine,
        reportTypeCode: 't1m',
        period: 'M',
        periodStart: '2026-07-01',
        act: 'sub',
        dueBase: '2026-07-15',
        dueDate: '2026-07-15',
        status: 'not_required',
      });
      // НДС за июнь у контрагента бухгалтера, ответственный — главный бухгалтер: сдан, ждёт; сумма 0.
      await report('ndsJun', {
        contractorId: cpA,
        responsibleEmployeeId: employee('chief-a'),
        reportTypeCode: 'nds',
        period: 'M',
        periodStart: '2026-06-01',
        act: 'both',
        dueBase: '2026-07-20',
        dueDate: '2026-07-20',
        payDue: '2026-07-20',
        status: 'submitted',
        submittedOn: '2026-10-12',
        amount: 0,
      });
      // Прежняя версия уточнённого — в списке и счётчиках её нет.
      await report('old', {
        ...mine,
        reportTypeCode: 't1m',
        period: 'M',
        periodStart: '2026-01-01',
        act: 'sub',
        dueBase: '2026-04-15',
        dueDate: '2026-04-15',
        superseded: true,
      });
      await f.t.admin.db.insert(schema.statusHistory).values({
        orgId: f.a.orgId,
        scale: 'report',
        entityId: ids.ndsAug!,
        fromStatus: 'in_progress',
        toStatus: 'submitted',
        actorUserId: user('acc-a'),
        at: new Date('2026-10-10T05:00:00Z'),
      });
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('вкладки и быстрый фильтр «Все / Сдать / Уплатить» (п. 11)', async () => {
      expect((await names(owner)).sort()).toEqual(
        of('ndsSep', 't1Jul', 't1Q3', 'patOct', 'ndsAug', 'ndsJul', 't1Q2', 'ndsJun'),
      );
      expect(await names(owner, '&tab=week')).toEqual(of('ndsSep'));
      expect(await names(owner, '&tab=overdue')).toEqual(of('t1Q3'));
      expect((await names(owner, '&tab=waiting')).sort()).toEqual(of('ndsAug', 'ndsJun'));
      // «Сдать» — несданные со сдачей; «Уплатить» — с уплатой, где сумма не указана или больше нуля.
      expect((await names(owner, '&quick=sub')).sort()).toEqual(of('ndsSep', 't1Q3'));
      expect((await names(owner, '&quick=pay')).sort()).toEqual(
        of('ndsSep', 'patOct', 'ndsAug', 'ndsJul'),
      );
      expect(await names(owner, '&tab=week&quick=pay')).toEqual(of('ndsSep'));
      expect(await names(owner, '&tab=overdue&quick=pay')).toEqual([]);
      expect((await get(owner, '/api/reports?quick=nope')).status).toBe(400);
      expect((await get(owner, '/api/reports?tab=nope')).status).toBe(400);
    });

    it('плашки и числа вкладок: просрочено, неделя, ожидают, сдано в месяце, к уплате за месяц', async () => {
      const s = await summary(owner);
      expect(s).toEqual({
        overdue: 1,
        week: 1,
        waiting: 2,
        submittedMonth: 2,
        // Патент 5 000 и НДС за август 3 000 сом — срок оплаты в октябре.
        toPayMonth: 800_000,
        quick: {
          week: { all: 1, sub: 1, pay: 1 },
          overdue: { all: 1, sub: 1, pay: 0 },
          waiting: { all: 2, sub: 0, pay: 1 },
          all: { all: 8, sub: 2, pay: 4 },
        },
        month: '2026-10-01',
        weekFrom: '2026-10-19',
        weekTo: '2026-10-25',
        waitDays: 3,
        empty: false,
      });
      expect(await summary(ownerB)).toMatchObject({ overdue: 0, waiting: 0, empty: true });
    });

    it('«Ожидают подтверждения»: без права подтверждать — только свои отчёты; без подтверждения в политике — пусто', async () => {
      // Бухгалтер (область «Свои», права «Подтверждать» нет): НДС за июнь — у его контрагента, но
      // ответственный — главный бухгалтер; в «Ожидают» его нет, во «Все отчёты» — есть (п. А-2).
      expect(await names(acc, '&tab=waiting')).toEqual(of('ndsAug'));
      expect((await summary(acc)).waiting).toBe(1);
      expect(await names(acc)).toContain(ids.ndsJun);
      expect(await names(acc)).not.toContain(ids.ndsJul);
      expect((await names(chief, '&tab=waiting')).sort()).toEqual(of('ndsAug', 'ndsJun'));

      const policy = (on: boolean) =>
        f.t.admin.db
          .update(schema.orgSettings)
          .set({ reportConfirm: on })
          .where(eq(schema.orgSettings.orgId, f.a.orgId));
      await policy(false);
      try {
        expect(await names(owner, '&tab=waiting')).toEqual([]);
        expect((await summary(owner)).waiting).toBe(0);
        const rows = (await list(owner)).items;
        expect(rows.find((r) => r.id === ids.ndsAug)).toBeDefined();
        const values = ListValues.parse(
          await (await get(owner, '/api/reports/values?col=confirm')).json(),
        );
        expect(values.items).toEqual([{ value: '', label: null, count: 8 }]);
      } finally {
        await policy(true);
      }
    });

    it('строка: кто сдал, кто подтвердил, последняя смена статуса; «Ждёт, дней» и «Подтверждение»', async () => {
      const rows = (await list(owner, '&tab=waiting')).items;
      const aug = rows.find((r) => r.id === ids.ndsAug)!;
      expect(aug).toMatchObject({
        submittedAt: '2026-10-10T05:00:00.000Z',
        submittedBy: { id: employee('acc-a'), shortName: 'acc-a' },
        waitDays: 8,
        confirmedAt: null,
        confirmedBy: null,
        lastStatus: { at: '2026-10-10T05:00:00.000Z', by: 'acc-a' },
      });
      const jul = (await list(owner)).items.find((r) => r.id === ids.ndsJul)!;
      expect(jul.confirmedBy?.id).toBe(f.a.ownerEmployeeId);
      expect(jul.confirmedAt).toBe('2026-09-22T04:00:00.000Z');
      const rows2 = (await list(owner)).items;
      expect(rows2.find((r) => r.id === ids.t1Jul)?.dueHoliday).toBe('День независимости');
      expect(rows2.find((r) => r.id === ids.ndsSep)?.dueHoliday).toBeNull();

      // «Ждёт, дней»: с 10.10 — 8, у сданного без момента — от даты сдачи 12.10 — 6.
      const sorted = await list(owner, '&tab=waiting&sort=wait.asc');
      expect(sorted.items.map((r) => r.id)).toEqual([ids.ndsJun, ids.ndsAug]);
      const waitValues = ListValues.parse(
        await (await get(owner, '/api/reports/values?col=wait&tab=waiting')).json(),
      );
      expect(waitValues.items.map((v) => v.value).sort()).toEqual(['6', '8']);
      const confirm = ListValues.parse(
        await (await get(owner, '/api/reports/values?col=confirm')).json(),
      );
      expect(confirm.items).toEqual(
        expect.arrayContaining([
          { value: 'waiting', label: 'Ждёт подтверждения', count: 2 },
          { value: 'confirmed', label: 'Подтверждено', count: 2 },
        ]),
      );
      const by = ListValues.parse(
        await (await get(owner, '/api/reports/values?col=submittedBy&tab=waiting')).json(),
      );
      expect(by.items.map((v) => v.label).sort()).toEqual(['acc-a', 'chief-a']);
    });

    it('выгрузка вкладки с быстрым фильтром; права и чужая организация', async () => {
      const file = await get(
        owner,
        '/api/reports/export?cols=cp,type,wait,confirm&tab=waiting&quick=pay',
      );
      expect(file.status).toBe(200);
      const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))[
        'xl/worksheets/sheet1.xml'
      ]!;
      expect(sheet).toContain('Ждёт подтверждения');
      expect(sheet).toContain('Ала-Тоо');
      expect((sheet.match(/<row /g) ?? []).length).toBe(2);

      expect((await apiRequest(f.app, 'GET', '/api/reports/tab-counts')).status).toBe(401);
      expect((await get(senior, '/api/reports/tab-counts')).status).toBe(403);
      expect((await list(ownerB, '&tab=waiting')).items).toEqual([]);
    });

    it('«Разовый отчёт»: списки окна и срок разового вида по дате события (п. 55)', async () => {
      const options = ManualReportOptions.parse(
        await (await get(owner, '/api/reports/manual-options')).json(),
      );
      // Архивного контрагента и контрагентов чужой организации в окне нет.
      expect(options.contractors.map((c) => c.id).sort()).toEqual([cpA, cpChief].sort());
      expect(options.contractors.map((c) => c.id)).not.toContain(cpArchived);
      expect(options.types.map((t) => t.code)).toEqual(
        expect.arrayContaining(['nds', 't1m', 'pat', 'utli']),
      );
      expect(options.types.find((t) => t.code === 'utli')).toMatchObject({
        oneOff: true,
        act: 'pay',
        dueText: 'в течение 15 дней после события',
      });
      const accOptions = ManualReportOptions.parse(
        await (await get(acc, '/api/reports/manual-options')).json(),
      );
      expect(accOptions.contractors.map((c) => c.id)).toEqual([cpA]);
      expect((await get(senior, '/api/reports/manual-options')).status).toBe(403);
      expect((await apiRequest(f.app, 'GET', '/api/reports/manual-options')).status).toBe(401);

      const due = async (cookie: string, query: string) =>
        get(cookie, `/api/reports/manual-due?${query}`);
      const ok = await due(owner, `contractorId=${cpA}&reportTypeCode=utli&eventDate=2026-11-05`);
      expect(ok.status, await ok.clone().text()).toBe(200);
      expect(await ok.json()).toEqual({ due: '2026-11-20' });
      expect(
        await (
          await due(owner, `contractorId=${cpA}&reportTypeCode=nds&eventDate=2026-11-05`)
        ).json(),
      ).toEqual({ due: null });
      expect(
        (await due(owner, `contractorId=${cpA}&reportTypeCode=utli&eventDate=2026-13-05`)).status,
      ).toBe(400);
      expect(
        (await due(acc, `contractorId=${cpChief}&reportTypeCode=utli&eventDate=2026-11-05`)).status,
      ).toBe(404);
      expect(
        (await due(owner, `contractorId=${cpB}&reportTypeCode=utli&eventDate=2026-11-05`)).status,
      ).toBe(404);
      expect(
        (await due(senior, `contractorId=${cpA}&reportTypeCode=utli&eventDate=2026-11-05`)).status,
      ).toBe(403);
    });
  },
);
