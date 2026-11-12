import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { socfundTax } from '@buhuchet/domain';
import { ApiError, IndicatorCard, Indicators, KpiTaxBox, ReportList } from '@buhuchet/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import refDB from '../../../../../spec/data/refDB.json';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сотые: 1 250 000 сом → 125000000; 5 человек → 500. */
const som = (n: number) => n * 100;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): отчёты за июль — сентябрь 2026 уже созданы.
describe.skipIf(!databaseAvailable())(
  'Показатели в расчёте налогов: отметка показателя и «Расчёт по показателям» отчёта (прототип v80)',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpChief = '';
    let revenue = '';
    let fot = '';
    let staff = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (method: 'GET' | 'POST' | 'PUT', path: string, cookie: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const reportOf = async (cp: string, type: string, periodStart: string) => {
      const res = await call('GET', '/api/reports?size=all', owner);
      return ReportList.parse(await res.json()).items.find(
        (r) => r.contractor.id === cp && r.type.code === type && r.periodStart === periodStart,
      )!;
    };
    const box = async (cookie: string, reportId: string) => {
      const res = await call('GET', `/api/kpi/tax/${reportId}`, cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      return KpiTaxBox.parse(await res.json()).box;
    };
    const put = (
      cookie: string,
      values: { contractorId: string; indicatorId: string; month: string; value: number | null }[],
    ) => call('PUT', '/api/kpi/values', cookie, { values });
    const indicators = async () =>
      Indicators.parse(await (await call('GET', '/api/kpi/indicators', owner)).json()).items;
    /** Поля окна показателя для сохранения. */
    const fieldsOf = async (id: string) => {
      const {
        id: _i,
        archived: _a,
        order: _o,
        valueCount: _v,
        hasRows: _h,
        on: _n,
        history: _hs,
        ...fields
      } = IndicatorCard.parse(await (await call('GET', `/api/kpi/indicators/${id}`, owner)).json());
      return fields;
    };
    const features = (on: Record<string, boolean>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: sql`${schema.orgSettings.features} || ${JSON.stringify(on)}::jsonb` })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));

    async function contractor(orgId: string, name: string, inn: string, responsible: string) {
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
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      await features({ indicators: true });
      await f.t.admin.db.update(schema.indicators).set({ startMonth: '2026-01' });
      [owner, chief, acc, senior, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'senior-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      const connect = await call('POST', '/api/org-report-types/connect', owner, {
        connect: ['nds', 'soc', 't1m', 'nspq'],
        disconnect: [],
      });
      expect(connect.status, await connect.clone().text()).toBe(200);
      cpA = await contractor(
        f.a.orgId,
        'ОсОО «Ала-Тоо Трейд»',
        '03744097401851',
        employee('acc-a'),
      );
      cpChief = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('chief-a'));
      for (const [cp, type, rate] of [
        [cpA, 'nds', '12 %'],
        [cpA, 'soc', '10 %'],
        [cpA, 'nspq', '2 %'],
        [cpA, 't1m', null],
        [cpChief, 'soc', '10 %'],
      ] as const) {
        const res = await call('POST', '/api/assignments', owner, {
          contractorId: cp,
          reportTypeCode: type,
          rate,
          fromMonth: '2026-07-01',
          markPast: false,
        });
        expect(res.status, await res.clone().text()).toBe(201);
      }
      const list = await indicators();
      revenue = list.find((i) => i.name === 'Выручка')!.id;
      fot = list.find((i) => i.name === 'ФОТ')!.id;
      staff = list.find((i) => i.name === 'Количество сотрудников')!.id;
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('показатели новой организации отмечены: выручка, численность и ФОТ; отметка — у одного показателя и только подходящего типа', async () => {
      expect((await indicators()).map((i) => [i.name, i.taxRole])).toEqual([
        ['Выручка', 'rev'],
        ['Количество сотрудников', 'emp'],
        ['ФОТ', 'fot'],
      ]);
      const body = {
        name: 'Оборот',
        unit: 'сом',
        type: 'som',
        total: 'sum',
        description: '',
        required: false,
        dueDay: 10,
        start: '2026-10',
        scope: 'all',
        autoNew: true,
        taxRole: 'rev',
        selected: [],
      };
      const taken = await call('POST', '/api/kpi/indicators', chief, body);
      expect(taken.status).toBe(400);
      expect(await failure(taken)).toMatchObject({
        code: 'tax_role_taken',
        message: 'Эта отметка уже у показателя «Выручка»: снимите её там',
        details: { field: 'taxRole', name: 'Выручка' },
      });
      // Неизвестная отметка и поле без значения — неверное тело.
      expect(
        (await call('POST', '/api/kpi/indicators', chief, { ...body, taxRole: 'nds' })).status,
      ).toBe(400);
      const { taxRole: _t, ...noRole } = body;
      expect((await call('POST', '/api/kpi/indicators', chief, noRole)).status).toBe(400);
      // Снять отметку у «Выручки» — «Оборот» её получает; вернуть «Выручке» уже нельзя.
      const fields = await fieldsOf(revenue);
      const cleared = await call('PUT', `/api/kpi/indicators/${revenue}`, chief, {
        ...fields,
        taxRole: null,
      });
      expect(cleared.status, await cleared.clone().text()).toBe(200);
      const created = await call('POST', '/api/kpi/indicators', chief, body);
      expect(created.status, await created.clone().text()).toBe(200);
      const back = await call('PUT', `/api/kpi/indicators/${revenue}`, chief, {
        ...(await fieldsOf(revenue)),
        taxRole: 'rev',
      });
      expect((await failure(back)).code).toBe('tax_role_taken');
      // Тип: численность — только целое число, выручка и ФОТ — только деньги.
      const wrongInt = await call('PUT', `/api/kpi/indicators/${revenue}`, chief, {
        ...(await fieldsOf(revenue)),
        taxRole: 'emp',
      });
      expect(await failure(wrongInt)).toMatchObject({
        code: 'tax_role_taken',
        details: { field: 'taxRole' },
      });
      const staffFields = await fieldsOf(staff);
      await call('PUT', `/api/kpi/indicators/${staff}`, chief, { ...staffFields, taxRole: null });
      const wrongType = await call('PUT', `/api/kpi/indicators/${revenue}`, chief, {
        ...(await fieldsOf(revenue)),
        taxRole: 'emp',
      });
      expect(await failure(wrongType)).toMatchObject({
        code: 'tax_role_int',
        message: 'Нужен тип значения «Целое число»',
      });
      const wrongMoney = await call('PUT', `/api/kpi/indicators/${staff}`, chief, {
        ...(await fieldsOf(staff)),
        taxRole: 'fot',
      });
      expect((await failure(wrongMoney)).code).toBe('tax_role_taken');
      await call('PUT', `/api/kpi/indicators/${staff}`, chief, {
        ...(await fieldsOf(staff)),
        taxRole: 'emp',
      });
      // История показателя: «Для расчёта налогов: было → стало».
      const card = IndicatorCard.parse(
        await (await call('GET', `/api/kpi/indicators/${revenue}`, owner)).json(),
      );
      expect(card.history.flatMap((h) => h.changes).filter((x) => x.field === 'taxRole')).toEqual([
        { field: 'taxRole', from: 'rev', to: null },
      ]);
    });

    it('архив: отметку архивного показателя можно отдать другому; при возврате из архива занятая отметка снимается', async () => {
      const list = await indicators();
      const turnover = list.find((i) => i.name === 'Оборот')!;
      const arch = await call('POST', `/api/kpi/indicators/${turnover.id}/archive`, chief, {
        archived: true,
        version: turnover.version,
      });
      expect(arch.status, await arch.clone().text()).toBe(200);
      const given = await call('PUT', `/api/kpi/indicators/${revenue}`, chief, {
        ...(await fieldsOf(revenue)),
        taxRole: 'rev',
      });
      expect(given.status, await given.clone().text()).toBe(200);
      const archived = (await indicators()).find((i) => i.id === turnover.id)!;
      expect(archived).toMatchObject({ archived: true, taxRole: 'rev' });
      const restored = await call('POST', `/api/kpi/indicators/${turnover.id}/archive`, chief, {
        archived: false,
        version: archived.version,
      });
      expect(restored.status, await restored.clone().text()).toBe(200);
      const after = Indicators.parse(await restored.json()).items;
      expect(after.find((i) => i.id === turnover.id)).toMatchObject({
        archived: false,
        taxRole: null,
      });
      expect(after.find((i) => i.id === revenue)!.taxRole).toBe('rev');
      // Показатель без занятой отметки возвращается из архива с ней.
      const fotNow = after.find((i) => i.id === fot)!;
      await call('POST', `/api/kpi/indicators/${fot}/archive`, chief, {
        archived: true,
        version: fotNow.version,
      });
      const fotArchived = (await indicators()).find((i) => i.id === fot)!;
      const fotBack = await call('POST', `/api/kpi/indicators/${fot}/archive`, chief, {
        archived: false,
        version: fotArchived.version,
      });
      expect(Indicators.parse(await fotBack.json()).items.find((i) => i.id === fot)!.taxRole).toBe(
        'fot',
      );
    });

    it('вход, права, функция, область отчётов и чужая организация', async () => {
      const sep = await reportOf(cpA, 'soc', '2026-09-01');
      const path = `/api/kpi/tax/${sep.id}`;
      expect((await apiRequest(f.app, 'GET', path, '')).status).toBe(401);
      // «Старший»: ни «Просматривать показатели», ни «Просматривать отчёты».
      expect((await failure(await call('GET', path, senior))).code).toBe('forbidden');
      // Одного права из двух мало: только «Просматривать отчёты», потом только «Просматривать показатели».
      const only = async (permissionId: string) => {
        await f.t.admin.db
          .delete(schema.rolePermissions)
          .where(
            and(
              eq(schema.rolePermissions.roleId, f.roleIds.senior),
              inArray(schema.rolePermissions.permissionId, ['repView', 'kpiView']),
            ),
          );
        if (permissionId)
          await f.t.admin.db
            .insert(schema.rolePermissions)
            .values({ orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId });
        const res = await call('GET', path, senior);
        return { status: res.status, code: (await failure(res)).code };
      };
      expect(await only('repView')).toEqual({ status: 403, code: 'forbidden' });
      expect(await only('kpiView')).toEqual({ status: 403, code: 'forbidden' });
      expect(await only('')).toEqual({ status: 403, code: 'forbidden' });
      // Чужая организация и отчёт вне области «Свои» — «не найден»; не номер — 400.
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: sql`${schema.orgSettings.features} || '{"indicators": true}'::jsonb` })
        .where(eq(schema.orgSettings.orgId, f.b.orgId));
      expect((await call('GET', path, ownerB)).status).toBe(404);
      const foreign = await reportOf(cpChief, 'soc', '2026-09-01');
      expect((await call('GET', `/api/kpi/tax/${foreign.id}`, acc)).status).toBe(404);
      expect((await call('GET', '/api/kpi/tax/no-such', owner)).status).toBe(400);
      expect(
        (await call('GET', '/api/kpi/tax/00000000-0000-4000-8000-0000000000ff', owner)).status,
      ).toBe(404);
      // Функция «Показатели контрагентов» выключена — 403 `indicators_off`.
      await features({ indicators: false });
      const off = await call('GET', path, owner);
      expect(off.status).toBe(403);
      expect((await failure(off)).code).toBe('indicators_off');
      await features({ indicators: true });
    });

    it('отчёт видит, а показатели контрагента вне области «Свои» группы «Показатели» — блока нет', async () => {
      // «Кадры» — область «Свои» во всех группах: отчёт, где сотрудник ответственный, он видит и у чужого
      // контрагента (docs/deviations.md п. А-2), а показатели — только своих контрагентов.
      const hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
      const sep = await reportOf(cpChief, 'soc', '2026-09-01');
      expect((await call('GET', `/api/kpi/tax/${sep.id}`, hr)).status).toBe(404);
      await f.t.admin.db
        .update(schema.reports)
        .set({ responsibleEmployeeId: employee('hr-a') })
        .where(eq(schema.reports.id, sep.id));
      expect((await call('GET', `/api/reports/${sep.id}`, hr)).status).toBe(200);
      expect(await box(hr, sep.id)).toBeNull();
      expect((await box(chief, sep.id))?.contractor.id).toBe(cpChief);
    });

    it('у вида без расчёта блока нет', async () => {
      const t1 = await reportOf(cpA, 't1m', '2026-09-01');
      expect(await box(owner, t1.id)).toBeNull();
    });

    it('«Соцфонд»: нет ФОТ — «внесите»; внесли — тариф не определён; с тарифом — подоходный налог и взносы в строки платежей', async () => {
      const sep = await reportOf(cpA, 'soc', '2026-09-01');
      const empty = (await box(acc, sep.id))!;
      expect(empty).toMatchObject({
        contractor: { id: cpA, name: 'ОсОО «Ала-Тоо Трейд»' },
        main: 'fot',
        months: ['2026-09'],
        current: '2026-10',
        editable: true,
        canSetup: false,
        result: { kind: 'missing', indicator: 'ФОТ', months: ['2026-09'] },
      });
      expect(empty.rows.map((r) => [r.role, r.indicator.name, r.on, r.total])).toEqual([
        ['fot', 'ФОТ', true, null],
        ['emp', 'Количество сотрудников', true, null],
      ]);
      expect(empty.rows[0]!.cells).toEqual([{ month: '2026-09', value: null, input: true }]);
      // Значение вносится обычным методом показателей — блок его видит.
      expect(
        (
          await put(acc, [
            { contractorId: cpA, indicatorId: fot, month: '2026-09', value: som(3_000_000) },
            { contractorId: cpA, indicatorId: staff, month: '2026-09', value: som(2) },
          ])
        ).status,
      ).toBe(200);
      expect((await box(acc, sep.id))!.result).toEqual({ kind: 'no_tariff' });
      await f.t.admin.db
        .update(schema.contractors)
        .set({ socfundTariff: { id: 'spino', manual: true, reason: 'проверка' } })
        .where(eq(schema.contractors.id, cpA));
      const tariff = refDB.taxes
        .find((x) => x.code === 'ПЛТ-01')!
        .guide!.tariffs!.find((x) => x.id === 'spino')!;
      const expected = socfundTax({
        tariff: { id: 'spino', total: tariff.total, parts: tariff.parts, cap: tariff.cap ?? null },
        rateText: '10 %',
        fot: [som(3_000_000)],
        emp: [som(2)],
      });
      expect(expected.capped).toBe(true);
      expect((await box(acc, sep.id))!.result).toEqual({
        kind: 'socfund',
        tariff: 'СПиНО',
        total: '12,25 %',
        ...expected,
        incomeKey: 'pay:0',
        contributionsKey: 'pay:1',
      });
    });

    it('налог с продаж за квартал: выручка трёх месяцев × ставка назначения; «Итого» — сумма; нет месяца — «внесите»', async () => {
      const q3 = await reportOf(cpA, 'nspq', '2026-07-01');
      await put(acc, [
        { contractorId: cpA, indicatorId: revenue, month: '2026-07', value: som(1_000_000) },
        { contractorId: cpA, indicatorId: revenue, month: '2026-08', value: som(1_250_000) },
      ]);
      const partial = (await box(acc, q3.id))!;
      expect(partial.months).toEqual(['2026-07', '2026-08', '2026-09']);
      expect(partial.rows.map((r) => [r.role, r.total])).toEqual([['rev', som(2_250_000)]]);
      expect(partial.result).toEqual({
        kind: 'missing',
        indicator: 'Выручка',
        months: ['2026-09'],
      });
      await put(acc, [
        { contractorId: cpA, indicatorId: revenue, month: '2026-09', value: som(750_000) },
      ]);
      expect((await box(acc, q3.id))!.result).toEqual({
        kind: 'rate',
        pct: '2 %',
        revenue: som(3_000_000),
        amount: som(60_000),
      });
    });

    it('НДС: выручка справочно — сумму вписывают сами; без права «Вносить значения» ячейки не для ввода', async () => {
      const sep = await reportOf(cpA, 'nds', '2026-09-01');
      const view = (await box(owner, sep.id))!;
      expect(view.result).toEqual({ kind: 'no_rate', revenue: som(750_000), vat: true });
      expect(view.canSetup).toBe(true);
      // У «Бухгалтера» право «Вносить значения» отнято — только просмотр.
      const accRole = f.a.roles.find((r) => r.templateCode === 'acc')!.id;
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          sql`${schema.rolePermissions.roleId} = ${accRole} and ${schema.rolePermissions.permissionId} = 'kpiEdit'`,
        );
      const fresh = await signIn(f.app, 'acc-a', TEST_PASSWORD);
      const readonly = (await box(fresh, sep.id))!;
      expect(readonly.editable).toBe(false);
      expect(readonly.rows[0]!.cells).toEqual([
        { month: '2026-09', value: som(750_000), input: false },
      ]);
    });

    it('показатель у контрагента не ведётся — метка и «Вести» только с правом «Настраивать показатели»; без показателя с отметкой — подсказка', async () => {
      const sep = await reportOf(cpA, 'soc', '2026-09-01');
      const off = await call('PUT', '/api/kpi/who', owner, {
        changes: [{ indicatorId: staff, contractorId: cpA, on: false }],
      });
      expect(off.status, await off.clone().text()).toBe(200);
      const row = (await box(owner, sep.id))!.rows.find((r) => r.role === 'emp')!;
      expect(row).toMatchObject({ on: false, offSince: '2026-10', canTurnOn: true });
      expect(row.cells[0]!.input).toBe(false);
      expect((await box(acc, sep.id))!.rows.find((r) => r.role === 'emp')!.canTurnOn).toBe(false);
      // Отметку «ФОТ» сняли — у «Соцфонда» нет основного показателя: строк нет, только подсказка.
      await call('PUT', `/api/kpi/indicators/${fot}`, chief, {
        ...(await fieldsOf(fot)),
        taxRole: null,
      });
      expect(await box(owner, sep.id)).toMatchObject({
        rows: [],
        result: { kind: 'no_indicator' },
      });
    });
  },
);
