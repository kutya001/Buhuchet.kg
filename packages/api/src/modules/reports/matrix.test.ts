import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  AssignmentBulkResult,
  AssignmentEndPreview,
  AssignmentList,
  AssignmentMassOptions,
  OrgPolicy,
  ReportCalendar,
  ReportCard,
  ReportList,
  ReportMatrix,
  ResponsibleOptions,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Сегодня в тестах — 18.10.2026 (воскресенье, `createTestDeps`).
describe.skipIf(!databaseAvailable())(
  'Отчёты: «Кто что сдаёт», массовое назначение, «сменить», календарь — методы API (2.15)',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let hr: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpChief = '';
    let cpHr = '';
    let cpPatent = '';
    let cpArchived = '';
    let cpB = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (method: string, path: string, cookie: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const json = async (res: Response, status = 200) => {
      expect(res.status, await res.clone().text()).toBe(status);
      return res.json() as Promise<unknown>;
    };
    const errorCode = async (res: Response) =>
      ((await res.json()) as { error: { code: string } }).error.code;
    const matrix = async (cookie: string, q = '') =>
      ReportMatrix.parse(
        await json(
          await call('GET', `/api/reports/matrix${q ? `?q=${encodeURIComponent(q)}` : ''}`, cookie),
        ),
      );
    const bulk = (cookie: string, body: Record<string, unknown>) =>
      call('POST', '/api/assignments/bulk', cookie, body);
    const reportsOf = async (cp: string, type: string) =>
      ReportList.parse(await json(await call('GET', '/api/reports?size=all', owner)))
        .items.filter((r) => r.contractor.id === cp && r.type.code === type)
        .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    const card = async (cookie: string, id: string) =>
      ReportCard.parse(await json(await call('GET', `/api/reports/${id}`, cookie)));
    const cellOf = (m: ReportMatrix, cp: string, type: string) =>
      m.rows.find((r) => r.contractor.id === cp)!.cells[m.types.findIndex((t) => t.code === type)]!;

    async function contractor(
      orgId: string,
      name: string,
      inn: string,
      responsible: string,
      extra: Partial<typeof schema.contractors.$inferInsert> = {},
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
          ...extra,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      // «Кадры» (область «Свои») получают право назначать отчёты — для проверки области.
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'assign' });
      [owner, chief, acc, hr, senior, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'hr-a', TEST_PASSWORD),
        signIn(f.app, 'senior-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      for (const [cookie, codes] of [
        [owner, ['nds', 'soc', 'utli']],
        [ownerB, ['nds']],
      ] as const) {
        await json(
          await call('POST', '/api/org-report-types/connect', cookie, {
            connect: codes,
            disconnect: [],
          }),
        );
      }
      cpA = await contractor(
        f.a.orgId,
        'ОсОО «Ала-Тоо Трейд»',
        '03744097401851',
        employee('acc-a'),
      );
      cpChief = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('chief-a'));
      cpHr = await contractor(f.a.orgId, 'ОсОО «Кадры»', '03744097401853', employee('hr-a'));
      cpPatent = await contractor(f.a.orgId, 'ИП Патентова', '20101199000124', employee('acc-a'), {
        regimeCode: 'РЕЖ-02',
      });
      cpArchived = await contractor(
        f.a.orgId,
        'ОсОО «Архив»',
        '03744097401854',
        employee('acc-a'),
        {
          serviceStatus: 'archived',
        },
      );
      cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', '03744097401852', employee('acc-b'));
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('НДС назначен трём контрагентам одним действием: отчёты за текущий и следующий месяц с правильным сроком (п. 1 приёмки)', async () => {
      const options = AssignmentMassOptions.parse(
        await json(await call('GET', '/api/assignments/mass', owner)),
      );
      // По умолчанию — НДС; срок словами, ставки вида, «Ставка для отмеченных» — вторая.
      expect(options.type).toMatchObject({
        code: 'nds',
        rates: ['12 %', '0 %'],
        defaultRate: '0 %',
        singleTax: false,
      });
      expect(options.types.map((x) => x.code)).toEqual(['nds', 'soc', 'utli']);
      // Архивного и чужого контрагента в окне нет; патент НДС не сдаёт — «не подходит».
      expect(new Set(options.contractors.map((c) => c.id))).toEqual(
        new Set([cpA, cpChief, cpHr, cpPatent]),
      );
      expect(options.contractors.find((c) => c.id === cpPatent)?.why).toMatch(/Патент/);
      expect(options.contractors.find((c) => c.id === cpA)).toMatchObject({
        assigned: false,
        why: null,
      });
      const soc = AssignmentMassOptions.parse(
        await json(await call('GET', '/api/assignments/mass?type=soc', owner)),
      );
      expect(soc.type?.code).toBe('soc');

      expect((await bulk(acc, { reportTypeCode: 'nds', contractorIds: [cpA] })).status).toBe(403);

      const done = AssignmentBulkResult.parse(
        await json(
          await bulk(owner, {
            reportTypeCode: 'nds',
            contractorIds: [cpA, cpChief, cpHr],
            rate: '12 %',
          }),
        ),
      );
      expect(done).toEqual({ done: 3, created: 6, skipped: 0 });
      for (const cp of [cpA, cpChief, cpHr]) {
        expect((await reportsOf(cp, 'nds')).map((r) => [r.periodStart, r.dueDate])).toEqual([
          ['2026-10-01', '2026-11-25'],
          ['2026-11-01', '2026-12-25'],
        ]);
        const items = AssignmentList.parse(
          await json(await call('GET', `/api/contractors/${cp}/assignments`, owner)),
        ).items;
        expect(items).toEqual([
          expect.objectContaining({
            reportTypeCode: 'nds',
            fromMonth: '2026-10-01',
            rateText: '12 %',
          }),
        ]);
      }
      // Ответственный отчётов — ответственный контрагента.
      expect((await reportsOf(cpChief, 'nds'))[0]?.responsible?.id).toBe(employee('chief-a'));

      // Повтор и неподходящий контрагент — пропускаются, ничего не создаётся.
      expect(
        AssignmentBulkResult.parse(
          await json(
            await bulk(owner, {
              reportTypeCode: 'nds',
              contractorIds: [cpA, cpPatent, cpArchived],
            }),
          ),
        ),
      ).toEqual({ done: 0, created: 0, skipped: 3 });
    });

    it('массовое назначение: чужой контрагент — 404 на всё, неверные данные — 400, неподключённый вид — 409', async () => {
      const foreign = await bulk(owner, { reportTypeCode: 'soc', contractorIds: [cpA, cpB] });
      expect(foreign.status).toBe(404);
      expect(await reportsOf(cpA, 'soc')).toEqual([]);
      // «Свои»: контрагент бухгалтера для «Кадров» чужой.
      expect((await bulk(hr, { reportTypeCode: 'soc', contractorIds: [cpA] })).status).toBe(404);

      const many = Array.from({ length: 501 }, () => cpA);
      expect((await bulk(owner, { reportTypeCode: 'soc', contractorIds: many })).status).toBe(400);
      expect((await bulk(owner, { reportTypeCode: 'soc', contractorIds: [] })).status).toBe(400);
      expect((await bulk(owner, { reportTypeCode: 'soc', contractorIds: ['x'] })).status).toBe(400);
      expect(
        (await bulk(owner, { reportTypeCode: 'soc', contractorIds: [cpA], extra: 1 })).status,
      ).toBe(400);
      const badRate = await bulk(owner, {
        reportTypeCode: 'nds',
        contractorIds: [cpPatent, cpA],
        rate: '15 %',
      });
      // НДС у Ала-Тоо уже есть, патенту не подходит — пропуск раньше проверки ставки.
      expect(AssignmentBulkResult.parse(await json(badRate))).toEqual({
        done: 0,
        created: 0,
        skipped: 2,
      });
      const rate = await bulk(owner, { reportTypeCode: 'soc', contractorIds: [cpA], rate: '15 %' });
      expect([rate.status, await errorCode(rate)]).toEqual([400, 'rate_invalid']);
      const off = await bulk(owner, { reportTypeCode: 'npa', contractorIds: [cpA] });
      expect([off.status, await errorCode(off)]).toEqual([409, 'report_type_not_connected']);
      expect((await call('GET', '/api/assignments/mass?type=npa', owner)).status).toBe(200);
      expect((await call('GET', '/api/assignments/mass', acc)).status).toBe(403);
    });

    it('сетка «Кто что сдаёт»: подключённые виды, назначения, «не подходит», область и поиск', async () => {
      const m = await matrix(owner);
      expect(m.types.map((x) => [x.code, x.active])).toEqual([
        ['nds', true],
        ['soc', true],
        ['utli', true],
      ]);
      expect(m.types[0]?.defaultRate).toBe('0 %');
      expect(new Set(m.rows.map((r) => r.contractor.id))).toEqual(
        new Set([cpA, cpChief, cpHr, cpPatent]),
      );
      expect(cellOf(m, cpA, 'nds').assignment).not.toBeNull();
      expect(cellOf(m, cpA, 'soc')).toEqual({ assignment: null, why: null });
      expect(cellOf(m, cpPatent, 'nds')).toMatchObject({
        assignment: null,
        why: expect.stringMatching(/Патент/),
      });
      expect(m.rows.find((r) => r.contractor.id === cpPatent)?.contractor.regime).toBe('Патент');

      // Бухгалтер (область «Свои») — свои контрагенты; поиск по названию и ИНН.
      expect(new Set((await matrix(acc)).rows.map((r) => r.contractor.id))).toEqual(
        new Set([cpA, cpPatent]),
      );
      expect((await matrix(owner, 'садыков')).rows.map((r) => r.contractor.id)).toEqual([cpChief]);
      expect((await matrix(owner, '03744097401853')).rows.map((r) => r.contractor.id)).toEqual([
        cpHr,
      ]);
      // Чужая организация не видна.
      expect((await matrix(ownerB)).rows.map((r) => r.contractor.id)).toEqual([cpB]);
      expect((await call('GET', '/api/reports/matrix', senior)).status).toBe(403);
      expect((await call('GET', '/api/reports/matrix', '')).status).toBe(401);
      expect((await call('GET', `/api/reports/matrix?q=${'я'.repeat(300)}`, owner)).status).toBe(
        400,
      );
    });

    it('снятая галочка: сколько будущих несданных отчётов получат «Не требуется», затем снятие', async () => {
      const cell = cellOf(await matrix(owner), cpHr, 'nds');
      const id = cell.assignment!.id;
      const preview = (cookie: string) => call('GET', `/api/assignments/${id}/end-preview`, cookie);
      expect(AssignmentEndPreview.parse(await json(await preview(owner)))).toEqual({
        notRequired: 2,
      });
      expect((await preview(acc)).status).toBe(403);
      expect((await preview(ownerB)).status).toBe(404);
      expect((await call('GET', '/api/assignments/nope/end-preview', owner)).status).toBe(400);
      await json(
        await call('POST', `/api/assignments/${id}/end`, owner, {
          version: cell.assignment!.version,
        }),
      );
      expect(cellOf(await matrix(owner), cpHr, 'nds').assignment).toBeNull();
      expect((await reportsOf(cpHr, 'nds')).map((r) => r.status)).toEqual([
        'not_required',
        'not_required',
      ]);
    });

    it('«сменить» ответственного в карточке отчёта: право, версия, история с именами, область', async () => {
      const options = ResponsibleOptions.parse(
        await json(await call('GET', '/api/assignments/responsible-options', owner)),
      );
      expect(options.employees.map((e) => e.shortName)).toEqual(
        expect.arrayContaining(['chief-a', 'acc-a', 'hr-a']),
      );
      expect(options.employees.some((e) => e.shortName === 'acc-b')).toBe(false);
      expect((await call('GET', '/api/assignments/responsible-options', acc)).status).toBe(403);

      const [oct] = await reportsOf(cpA, 'nds');
      const change = (cookie: string, body: Record<string, unknown>) =>
        call('PATCH', `/api/reports/${oct!.id}/responsible`, cookie, body);
      const body = { responsibleEmployeeId: employee('chief-a'), version: oct!.version };
      expect((await change(acc, body)).status).toBe(403);
      // «Кадры» (право есть, область «Свои») чужой отчёт не видят.
      expect((await change(hr, body)).status).toBe(404);
      // Чужая организация: свой сотрудник, но отчёт не найден.
      expect(
        (await change(ownerB, { ...body, responsibleEmployeeId: employee('acc-b') })).status,
      ).toBe(404);
      const unknown = await change(owner, { ...body, responsibleEmployeeId: employee('acc-b') });
      expect(unknown.status).toBe(400);
      expect((await change(owner, { ...body, extra: 1 })).status).toBe(400);

      await json(await change(owner, body));
      const after = await card(owner, oct!.id);
      expect(after.responsible).toEqual({ id: employee('chief-a'), shortName: 'chief-a' });
      expect(after.history[0]).toMatchObject({
        action: 'update',
        changes: [{ field: 'responsibleEmployeeId', from: 'acc-a', to: 'chief-a' }],
      });
      const stale = await change(owner, body);
      expect([stale.status, await errorCode(stale)]).toEqual([409, 'record_changed']);
      // Тот же ответственный — без изменений и без строки истории.
      await json(await change(owner, { ...body, version: after.version }));
      expect((await card(owner, oct!.id)).history).toHaveLength(after.history.length);

      // У прежней версии ответственного не меняют.
      const [, nov] = await reportsOf(cpA, 'nds');
      await f.t.admin.db
        .update(schema.reports)
        .set({ superseded: true })
        .where(eq(schema.reports.id, nov!.id));
      const old = await call('PATCH', `/api/reports/${nov!.id}/responsible`, owner, {
        responsibleEmployeeId: employee('chief-a'),
        version: nov!.version,
      });
      expect([old.status, await errorCode(old)]).toEqual([409, 'report_superseded']);
      await f.t.admin.db
        .update(schema.reports)
        .set({ superseded: false })
        .where(eq(schema.reports.id, nov!.id));
    });

    it('«Разовый отчёт»: срок на нерабочий день переносится на ближайший рабочий', async () => {
      const shift = async (date: string, code = 'nds') =>
        call('GET', `/api/reports/due-shift?reportTypeCode=${code}&date=${date}`, owner);
      // 24.10.2026 — суббота: срок будет 26.10.2026.
      expect(await json(await shift('2026-10-24'))).toEqual({ date: '2026-10-26' });
      expect(await json(await shift('2026-10-27'))).toEqual({ date: '2026-10-27' });
      expect((await shift('2026-10-24', 'no-such')).status).toBe(400);
      expect((await shift('2026-13-01')).status).toBe(400);
      expect(
        (await call('GET', '/api/reports/due-shift?reportTypeCode=nds&date=2026-10-24', senior))
          .status,
      ).toBe(403);

      const res = await call('POST', '/api/reports', owner, {
        contractorId: cpChief,
        reportTypeCode: 'soc',
        month: '2026-06-01',
        eventDate: null,
        due: '2026-10-24',
        reasonCode: 'ПРЧ-001',
      });
      const { id } = (await json(res, 201)) as { id: string };
      const created = await card(owner, id);
      expect(created.dueDate).toBe('2026-10-26');
      expect(created.history.at(-1)).toMatchObject({
        action: 'create',
        changes: expect.arrayContaining([
          { field: 'dueShift', from: '2026-10-24', to: '2026-10-26' },
        ]),
      });
    });

    it('календарь: 42 дня с понедельника, числа к сдаче и сдано, область, выключенная функция', async () => {
      const cal = async (cookie: string, month: string) =>
        call('GET', `/api/reports/calendar?month=${month}`, cookie);
      const nov = ReportCalendar.parse(await json(await cal(owner, '2026-11')));
      expect(nov.days).toHaveLength(42);
      expect([nov.days[0]!.date, nov.days.at(-1)!.date]).toEqual(['2026-10-26', '2026-12-06']);
      const day = (c: ReportCalendar, date: string) => c.days.find((d) => d.date === date)!;
      // 25.11: НДС за октябрь — у Ала-Тоо и Садыкова (у «Кадров» снят — «Не требуется» не считается).
      expect(day(nov, '2026-11-25')).toMatchObject({ working: true, todo: 2, done: 0 });
      expect(day(nov, '2026-11-28')).toMatchObject({ working: false, todo: 0 });
      const oct = ReportCalendar.parse(await json(await cal(owner, '2026-10')));
      expect(day(oct, '2026-10-26')).toMatchObject({ todo: 1 });
      // Бухгалтер видит свои отчёты: НДС Ала-Тоо (ответственный сменён на главного, но контрагент — свой).
      expect(
        day(ReportCalendar.parse(await json(await cal(acc, '2026-11'))), '2026-11-25'),
      ).toMatchObject({
        todo: 1,
      });
      expect(
        day(ReportCalendar.parse(await json(await cal(ownerB, '2026-11'))), '2026-11-25').todo,
      ).toBe(0);
      expect((await cal(owner, '2026-13')).status).toBe(400);
      expect((await cal(owner, '1999-12')).status).toBe(400);
      expect((await cal(senior, '2026-11')).status).toBe(403);

      // Список дня — та же область; без дня вкладка «Календарь» не отвечает.
      const list = await call('GET', '/api/reports?size=all&tab=calendar&day=2026-11-25', owner);
      expect(
        ReportList.parse(await json(list)).items.map((r) => [r.contractor.id, r.type.code]),
      ).toEqual(
        expect.arrayContaining([
          [cpA, 'nds'],
          [cpChief, 'nds'],
        ]),
      );
      expect((await call('GET', '/api/reports?tab=calendar', owner)).status).toBe(400);
      expect(
        (await call('GET', '/api/reports/values?col=status&tab=calendar&day=2026-11-25', owner))
          .status,
      ).toBe(200);

      // «Календарь отчётов» выключен в учётной политике — метод закрыт.
      const policy = OrgPolicy.parse(await json(await call('GET', '/api/org/policy', owner)));
      await json(
        await call('PATCH', '/api/org/policy', owner, {
          version: policy.version,
          features: { calendar: false },
        }),
      );
      const closed = await cal(owner, '2026-11');
      expect([closed.status, await errorCode(closed)]).toEqual([403, 'calendar_off']);
      const back = OrgPolicy.parse(await json(await call('GET', '/api/org/policy', owner)));
      await json(
        await call('PATCH', '/api/org/policy', owner, {
          version: back.version,
          features: { calendar: true },
        }),
      );
      expect((await cal(chief, '2026-11')).status).toBe(200);
    });
  },
);
