import { fixedClock } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  AssignmentList,
  AssignmentPreview,
  AssignmentSaved,
  ReportCard,
  ReportList,
  ReportSaved,
  ReportTabCounts,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';
import { createDueReportsJob } from './job';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Сегодня в тестах — 18.10.2026 (воскресенье, `createTestDeps`): «На этой неделе» — 19–25.10.
describe.skipIf(!databaseAvailable())('Отчёты: назначения и отчёты к сдаче — методы API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let hr: string;
  let senior: string;
  let ownerB: string;
  let cpA = '';
  let cpChief = '';
  let cpB = '';

  const employee = (login: string) => f.people[login]!.employeeId;
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;
  const assign = (cookie: string, body: Record<string, unknown>) =>
    apiRequest(f.app, 'POST', '/api/assignments', cookie, body);
  const list = async (cookie: string, query = '') => {
    const res = await apiRequest(f.app, 'GET', `/api/reports?size=all${query}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return ReportList.parse(await res.json());
  };
  const card = async (cookie: string, id: string) =>
    ReportCard.parse(await (await apiRequest(f.app, 'GET', `/api/reports/${id}`, cookie)).json());
  const reportsOf = async (cp: string, type: string) =>
    (await list(owner)).items
      .filter((r) => r.contractor.id === cp && r.type.code === type)
      .sort(
        (a, b) =>
          a.periodStart.localeCompare(b.periodStart) ||
          a.dueDate.localeCompare(b.dueDate) ||
          a.revision - b.revision,
      );

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
    // «Кадры» (область «Свои») получают право назначать отчёты и менять срок — для проверки области.
    await f.t.admin.db.insert(schema.rolePermissions).values(
      ['assign', 'repDue'].map((permissionId) => ({
        orgId: f.a.orgId,
        roleId: f.roleIds.hr,
        permissionId,
      })),
    );
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
      const res = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', cookie, {
        connect: codes,
        disconnect: [],
      });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    cpA = await contractor(f.a.orgId, 'ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpChief = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('chief-a'));
    cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', '03744097401852', employee('acc-b'));
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('назначение: право «Назначать отчёты контрагентам», проверки полей, один вид — одно назначение', async () => {
    const nds = { contractorId: cpA, reportTypeCode: 'nds', rate: '12 %' };
    expect((await assign(acc, nds)).status).toBe(403);

    const badRate = await assign(owner, { ...nds, rate: '15 %' });
    expect([badRate.status, await errorCode(badRate)]).toEqual([400, 'rate_invalid']);
    const until = await assign(owner, {
      ...nds,
      fromMonth: '2026-10-01',
      untilMonth: '2026-09-01',
    });
    expect([until.status, await errorCode(until)]).toEqual([400, 'until_before_from']);
    expect((await assign(owner, { ...nds, fromMonth: '2026-10-15' })).status).toBe(400);
    expect((await assign(owner, { ...nds, extra: 1 })).status).toBe(400);
    // «Вариант срока» — только до 10, 15, 20, 25-го или последнего дня (иначе база отказала бы с 500).
    expect((await assign(owner, { ...nds, dueDay: 14 })).status).toBe(400);
    const notConnected = await assign(owner, { ...nds, reportTypeCode: 'npa', rate: null });
    expect([notConnected.status, await errorCode(notConnected)]).toEqual([
      409,
      'report_type_not_connected',
    ]);
    const unknown = await assign(owner, { ...nds, reportTypeCode: 'no-such' });
    expect(unknown.status).toBe(400);

    // «С какого периода» по умолчанию — текущий месяц: отчёты за октябрь и ноябрь.
    const created = await assign(owner, nds);
    expect(created.status, await created.clone().text()).toBe(201);
    expect(AssignmentSaved.parse(await created.json())).toMatchObject({ created: 2, past: 0 });
    const again = await assign(owner, nds);
    expect([again.status, await errorCode(again)]).toEqual([409, 'assignment_exists']);

    const items = AssignmentList.parse(
      await (await apiRequest(f.app, 'GET', `/api/contractors/${cpA}/assignments`, acc)).json(),
    ).items;
    expect(items).toEqual([
      expect.objectContaining({
        reportTypeCode: 'nds',
        fromMonth: '2026-10-01',
        rateText: '12 %',
        responsible: { id: employee('acc-a'), shortName: 'acc-a' },
      }),
    ]);
    // Контрагент вне области «Свои контрагенты» — «не найден».
    expect(
      (await apiRequest(f.app, 'GET', `/api/contractors/${cpChief}/assignments`, acc)).status,
    ).toBe(404);
  });

  it('прошлые периоды: предпросмотр, создание, с отметкой — сразу «Сдан»', async () => {
    const res = await apiRequest(f.app, 'POST', '/api/assignments/preview', owner, {
      contractorId: cpA,
      reportTypeCode: 'soc',
      fromMonth: '2026-07-01',
    });
    expect(AssignmentPreview.parse(await res.json())).toEqual({
      defaultFrom: '2026-10-01',
      fromMonth: '2026-07-01',
      missing: [
        { periodStart: '2026-07-01', label: '07.2026' },
        { periodStart: '2026-08-01', label: '08.2026' },
        { periodStart: '2026-09-01', label: '09.2026' },
      ],
    });
    const soc = await assign(owner, {
      contractorId: cpA,
      reportTypeCode: 'soc',
      fromMonth: '2026-07-01',
      markPast: false,
    });
    expect(AssignmentSaved.parse(await soc.json())).toMatchObject({ created: 2, past: 3 });
    expect((await reportsOf(cpA, 'soc')).map((r) => r.status)).toEqual([
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);

    // Соцфонд ИП Садыкова ведёт бухгалтер: прошлые периоды отмечены сданными.
    const marked = await assign(chief, {
      contractorId: cpChief,
      reportTypeCode: 'soc',
      fromMonth: '2026-08-01',
      responsibleEmployeeId: employee('acc-a'),
    });
    expect(AssignmentSaved.parse(await marked.json())).toMatchObject({ created: 2, past: 2 });
    const rows = await reportsOf(cpChief, 'soc');
    expect(rows.map((r) => [r.periodStart, r.status, r.responsible?.id])).toEqual([
      ['2026-08-01', 'submitted', employee('acc-a')],
      ['2026-09-01', 'submitted', employee('acc-a')],
      ['2026-10-01', 'todo', employee('acc-a')],
      ['2026-11-01', 'todo', employee('acc-a')],
    ]);
  });

  it('область «Свои»: назначения — только своим контрагентам, отчёты — свои контрагенты и свои отчёты (п. А-2)', async () => {
    // У «Кадров» область «Свои»: контрагент бухгалтера для них чужой.
    const res = await assign(hr, { contractorId: cpA, reportTypeCode: 'utli' });
    expect(res.status).toBe(404);

    const mine = await list(acc);
    expect(new Set(mine.items.map((r) => `${r.contractor.name} · ${r.type.code}`))).toEqual(
      new Set(['ОсОО «Ала-Тоо Трейд» · nds', 'ОсОО «Ала-Тоо Трейд» · soc', 'ИП Садыков · soc']),
    );
    expect((await list(hr)).items).toEqual([]);
    expect((await list(ownerB)).items).toEqual([]);
    expect((await apiRequest(f.app, 'GET', '/api/reports', senior)).status).toBe(403);
  });

  it('вкладки, счётчики, значения для фильтра и выгрузка в Excel', async () => {
    const counts = ReportTabCounts.parse(
      await (await apiRequest(f.app, 'GET', '/api/reports/tab-counts', owner)).json(),
    );
    // Просрочены Соцфонд за июль и август; на неделе 19–25.10 — Соцфонд за сентябрь (срок 20.10).
    expect(counts).toMatchObject({ overdue: 2, week: 1 });
    expect((await list(owner, '&tab=overdue')).items.map((r) => r.periodStart)).toEqual([
      '2026-07-01',
      '2026-08-01',
    ]);
    expect((await list(owner, '&tab=week')).items.map((r) => [r.type.code, r.dueDate])).toEqual([
      ['soc', '2026-10-20'],
    ]);
    expect((await apiRequest(f.app, 'GET', '/api/reports?tab=nope', owner)).status).toBe(400);

    const values = (await (
      await apiRequest(f.app, 'GET', '/api/reports/values?col=status', owner)
    ).json()) as { items: { label: string }[] };
    expect(values.items.map((v) => v.label)).toEqual(expect.arrayContaining(['К сдаче', 'Сдан']));
    expect((await apiRequest(f.app, 'GET', '/api/reports/values?col=nope', owner)).status).toBe(
      400,
    );

    const file = await apiRequest(f.app, 'GET', '/api/reports/export?cols=cp,type,period', owner);
    expect(file.status).toBe(200);
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('ИП Садыков');
  });

  it('карточка и «Изменить срок»: причина из справочника, журнал, версия', async () => {
    const [oct] = await reportsOf(cpA, 'nds');
    const before = await card(owner, oct!.id);
    expect(before).toMatchObject({
      dueDate: '2026-11-25',
      assignment: { rateText: '12 %', fixedAmount: null },
      dueChanges: [],
      statusHistory: [expect.objectContaining({ from: null, to: 'todo' })],
      versions: [expect.objectContaining({ id: oct!.id, revision: 0 })],
    });
    const due = (cookie: string, body: Record<string, unknown>) =>
      apiRequest(f.app, 'POST', `/api/reports/${oct!.id}/due`, cookie, body);
    const body = { due: '2026-11-28', reasonCode: 'ПРЧ-001', comment: 'письмо ГНС' };
    // У бухгалтера нет права «Изменять срок отчёта».
    expect((await due(acc, { ...body, version: before.version })).status).toBe(403);
    const badReason = await due(owner, { ...body, reasonCode: 'ПРЧ-999', version: before.version });
    expect([badReason.status, await errorCode(badReason)]).toEqual([400, 'reason_invalid']);
    // «Кадры» с правом, но отчёт чужого контрагента и не их — «не найден».
    expect((await due(hr, { ...body, version: before.version })).status).toBe(404);

    const ok = await due(owner, { ...body, version: before.version });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const stale = await due(owner, { ...body, due: '2026-11-30', version: before.version });
    expect([stale.status, await errorCode(stale)]).toEqual([409, 'record_changed']);
    const after = await card(acc, oct!.id);
    expect(after).toMatchObject({ dueDate: '2026-11-28', dueManual: true });
    expect(after.dueChanges).toEqual([
      expect.objectContaining({
        fromDue: '2026-11-25',
        toDue: '2026-11-28',
        comment: 'письмо ГНС',
        actor: expect.any(String),
      }),
    ]);
    expect((await apiRequest(f.app, 'GET', `/api/reports/${oct!.id}`, ownerB)).status).toBe(404);
  });

  it('«Разовый отчёт»: дата события у разового вида (п. 55), месяц и срок у обычного, без дублей', async () => {
    const manual = (body: Record<string, unknown>) =>
      apiRequest(f.app, 'POST', '/api/reports', acc, { reasonCode: 'ПРЧ-001', ...body });
    const noEvent = await manual({ contractorId: cpA, reportTypeCode: 'utli' });
    expect([noEvent.status, await errorCode(noEvent)]).toEqual([400, 'event_date_required']);
    const first = await manual({
      contractorId: cpA,
      reportTypeCode: 'utli',
      eventDate: '2026-11-05',
    });
    expect(first.status, await first.clone().text()).toBe(201);
    const second = await manual({
      contractorId: cpA,
      reportTypeCode: 'utli',
      eventDate: '2026-11-18',
    });
    expect(second.status).toBe(201);
    const twice = await manual({
      contractorId: cpA,
      reportTypeCode: 'utli',
      eventDate: '2026-11-05',
    });
    expect([twice.status, await errorCode(twice)]).toEqual([409, 'report_event_exists']);
    const utli = await reportsOf(cpA, 'utli');
    expect(utli.map((r) => [r.eventDate, r.payDue, r.periodLabel])).toEqual([
      ['2026-11-05', '2026-11-20', '11.2026 · 05.11'],
      ['2026-11-18', '2026-12-03', '11.2026 · 18.11'],
    ]);

    const noDue = await manual({ contractorId: cpA, reportTypeCode: 'nds', month: '2026-06-01' });
    expect([noDue.status, await errorCode(noDue)]).toEqual([400, 'due_required']);
    const noMonth = await manual({ contractorId: cpA, reportTypeCode: 'nds', due: '2026-07-25' });
    expect([noMonth.status, await errorCode(noMonth)]).toEqual([400, 'month_required']);
    const june = await manual({
      contractorId: cpA,
      reportTypeCode: 'nds',
      month: '2026-06-01',
      due: '2026-07-25',
    });
    expect(june.status).toBe(201);
    const juneAgain = await manual({
      contractorId: cpA,
      reportTypeCode: 'nds',
      month: '2026-06-01',
      due: '2026-07-25',
    });
    expect([juneAgain.status, await errorCode(juneAgain)]).toEqual([409, 'report_exists']);
    // Контрагент не свой — «не найден»; вид не подключён — отказ.
    expect(
      (
        await manual({
          contractorId: cpChief,
          reportTypeCode: 'nds',
          month: '2026-06-01',
          due: '2026-07-25',
        })
      ).status,
    ).toBe(404);
    const off = await manual({
      contractorId: cpA,
      reportTypeCode: 'npa',
      month: '2026-06-01',
      due: '2026-07-25',
    });
    expect([off.status, await errorCode(off)]).toEqual([409, 'report_type_not_connected']);
  });

  it('«Создать уточнённый»: только у сданного, новая версия того же периода', async () => {
    const [aug] = await reportsOf(cpChief, 'soc');
    const [oct] = await reportsOf(cpA, 'nds');
    const notSubmitted = await apiRequest(f.app, 'POST', `/api/reports/${oct!.id}/revision`, acc, {
      version: oct!.version,
    });
    expect([notSubmitted.status, await errorCode(notSubmitted)]).toEqual([
      409,
      'report_not_submitted',
    ]);
    const res = await apiRequest(f.app, 'POST', `/api/reports/${aug!.id}/revision`, acc, {
      version: aug!.version,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = ReportSaved.parse(await res.json());
    const revision = await card(acc, id);
    expect(revision).toMatchObject({ revision: 1, status: 'todo', superseded: false });
    expect(revision.versions.map((v) => [v.revision, v.superseded])).toEqual([
      [1, false],
      [0, true],
    ]);
    // В списке — только последняя версия.
    expect((await reportsOf(cpChief, 'soc')).filter((r) => r.periodStart === '2026-08-01')).toEqual(
      [expect.objectContaining({ id, revision: 1 })],
    );
  });

  it('«Изменить» и «Снять назначение»: ответственный и сроки несданных, «Не требуется» будущим', async () => {
    const [nds] = AssignmentList.parse(
      await (await apiRequest(f.app, 'GET', `/api/contractors/${cpA}/assignments`, owner)).json(),
    ).items;
    const patch = (body: Record<string, unknown>) =>
      apiRequest(f.app, 'PATCH', `/api/assignments/${nds!.id}`, owner, body);
    const blocked = await patch({ ownPeriod: 'Q', version: nds!.version });
    expect([blocked.status, await errorCode(blocked)]).toEqual([400, 'own_not_allowed']);
    const res = await patch({ dueDay: 15, version: nds!.version });
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = AssignmentSaved.parse(await res.json());
    // Несданные получают новый срок, как в прототипе (asgDlg), — и июнь, созданный «Разовым отчётом»;
    // октябрь со сроком, изменённым вручную, не пересчитывается.
    expect((await reportsOf(cpA, 'nds')).map((r) => [r.periodStart, r.dueDate])).toEqual([
      ['2026-06-01', '2026-07-15'],
      ['2026-10-01', '2026-11-28'],
      ['2026-11-01', '2026-12-15'],
    ]);
    const stale = await patch({ dueDay: 20, version: nds!.version });
    expect([stale.status, await errorCode(stale)]).toEqual([409, 'record_changed']);

    const end = await apiRequest(f.app, 'POST', `/api/assignments/${nds!.id}/end`, owner, {
      version: saved.version,
    });
    expect(end.status, await end.clone().text()).toBe(200);
    expect(((await end.json()) as { notRequired: number }).notRequired).toBe(2);
    expect((await reportsOf(cpA, 'nds')).map((r) => r.status)).toEqual([
      'todo',
      'not_required',
      'not_required',
    ]);
    const endAgain = await apiRequest(f.app, 'POST', `/api/assignments/${nds!.id}/end`, owner, {
      version: saved.version + 1,
    });
    expect([endAgain.status, await errorCode(endAgain)]).toEqual([409, 'assignment_ended']);
  });

  it('задача по расписанию: недостающие отчёты во всех организациях, повтор не создаёт дублей', async () => {
    const ctx = { ...f.deps, clock: fixedClock('2026-11-02T03:00:00Z') };
    const slot = new Date('2026-11-01T18:05:00Z');
    const count = async () =>
      (
        await f.t.admin.db
          .select({ id: schema.reports.id })
          .from(schema.reports)
          .where(eq(schema.reports.superseded, false))
      ).length;
    await assign(ownerB, { contractorId: cpB, reportTypeCode: 'nds' });
    const before = await count();
    await createDueReportsJob.run(ctx, slot);
    const after = await count();
    // В ноябре добавляется декабрь: Соцфонд двух контрагентов А и НДС контрагента Б.
    expect(after - before).toBe(3);
    await createDueReportsJob.run(ctx, slot);
    expect(await count()).toBe(after);
    const decB = await f.t.admin.db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(
        and(eq(schema.reports.contractorId, cpB), eq(schema.reports.periodStart, '2026-12-01')),
      );
    expect(decB).toHaveLength(1);
  });

  it('контрагента с отчётами удалить нельзя', async () => {
    const res = await apiRequest(f.app, 'DELETE', `/api/contractors/${cpA}`, owner);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'contractor_in_use', details: { variant: 'has_reports' } },
    });
  });

  it('область и чужая организация: значения, счётчики, выгрузка, предпросмотр, назначения контрагента, правка, снятие, уточнённый', async () => {
    const [soc] = AssignmentList.parse(
      await (await apiRequest(f.app, 'GET', `/api/contractors/${cpA}/assignments`, owner)).json(),
    ).items.filter((x) => x.reportTypeCode === 'soc');
    const values = async (cookie: string) =>
      (
        (await (await apiRequest(f.app, 'GET', '/api/reports/values?col=cp', cookie)).json()) as {
          items: { label: string }[];
        }
      ).items.map((v) => v.label);
    expect(await values(hr)).toEqual([]);
    expect(await values(ownerB)).toEqual(['ОсОО «Бишкек»']);
    expect(await values(acc)).toEqual(expect.arrayContaining(['ОсОО «Ала-Тоо Трейд»']));
    expect(
      ReportTabCounts.parse(
        await (await apiRequest(f.app, 'GET', '/api/reports/tab-counts', hr)).json(),
      ),
    ).toMatchObject({ overdue: 0, week: 0, waiting: 0 });
    const file = await apiRequest(f.app, 'GET', '/api/reports/export?cols=cp', ownerB);
    expect(file.status).toBe(200);
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml'];
    expect(sheet).not.toContain('Ала-Тоо');

    const preview = await apiRequest(f.app, 'POST', '/api/assignments/preview', hr, {
      contractorId: cpA,
      reportTypeCode: 'soc',
      fromMonth: '2026-07-01',
    });
    expect(preview.status).toBe(404);
    expect(
      (await apiRequest(f.app, 'GET', `/api/contractors/${cpA}/assignments`, ownerB)).status,
    ).toBe(404);
    for (const cookie of [hr, ownerB]) {
      const patch = await apiRequest(f.app, 'PATCH', `/api/assignments/${soc!.id}`, cookie, {
        note: 'чужое',
        version: soc!.version,
      });
      expect(patch.status).toBe(404);
      const end = await apiRequest(f.app, 'POST', `/api/assignments/${soc!.id}/end`, cookie, {
        version: soc!.version,
      });
      expect(end.status).toBe(404);
    }
    const [aug] = (await reportsOf(cpChief, 'soc')).filter((r) => r.status === 'submitted');
    const revision = await apiRequest(f.app, 'POST', `/api/reports/${aug!.id}/revision`, ownerB, {
      version: aug!.version,
    });
    expect(revision.status).toBe(404);
    // «С какого периода» в далёком прошлом создало бы сотни отчётов — даты только 2000–2100.
    const ancient = await assign(owner, {
      contractorId: cpA,
      reportTypeCode: 'nds',
      fromMonth: '1900-01-01',
    });
    expect(ancient.status).toBe(400);
  });

  it('строки единого налога по умолчанию — по ГКЭД и месту деятельности (УГНС в Бишкеке)', async () => {
    const cafe = await contractor(
      f.a.orgId,
      'Кафе «Ала-Арча»',
      '03744097401860',
      employee('acc-a'),
    );
    const connect = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['enq'],
      disconnect: [],
    });
    expect(connect.status).toBe(200);
    // Вид «По режиму» не подходит к режиму контрагента — не назначается (прототип compatible).
    const unfit = await assign(owner, { contractorId: cafe, reportTypeCode: 'enq' });
    expect(unfit.status).toBe(400);
    expect(await unfit.json()).toMatchObject({
      error: {
        code: 'report_type_incompatible',
        message: 'Не подходит к режиму «ОНР»',
        details: { field: 'reportTypeCode' },
      },
    });
    await f.t.admin.db
      .update(schema.contractors)
      .set({ regimeCode: 'РЕЖ-03', gked: '56.10.0', taxOfficeCode: 'ugns-bishkek-lenin' })
      .where(eq(schema.contractors.id, cafe));
    const res = await assign(owner, { contractorId: cafe, reportTypeCode: 'enq' });
    expect(res.status, await res.clone().text()).toBe(201);
    const [enq] = AssignmentList.parse(
      await (await apiRequest(f.app, 'GET', `/api/contractors/${cafe}/assignments`, owner)).json(),
    ).items;
    expect(enq).toMatchObject({
      reportTypeCode: 'enq',
      rate: null,
      enRates: [{ code: 'ЕНС-12', variant: 0 }],
    });
  });

  it('разовому контрагенту регулярный отчёт не назначается', async () => {
    const once = await contractor(f.a.orgId, 'ИП «Разовый»', '03744097401862', employee('acc-a'));
    await f.t.admin.db
      .update(schema.contractors)
      .set({ kind: 'oneoff' })
      .where(eq(schema.contractors.id, once));
    const res = await assign(owner, { contractorId: once, reportTypeCode: 'soc', rate: '10 %' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'contractor_oneoff' } });
  });

  it('контрагент в архиве: назначить, изменить и снять назначение нельзя', async () => {
    const closed = await contractor(
      f.a.orgId,
      'ОсОО «Закрыто»',
      '03744097401861',
      employee('acc-a'),
    );
    const first = await assign(owner, {
      contractorId: closed,
      reportTypeCode: 'soc',
      rate: '10 %',
    });
    expect(first.status).toBe(201);
    const saved = AssignmentSaved.parse(await first.json());
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, closed));
    const again = await assign(owner, {
      contractorId: closed,
      reportTypeCode: 'nds',
      rate: '12 %',
    });
    expect([again.status, await errorCode(again)]).toEqual([409, 'contractor_archived']);
    const patch = await apiRequest(f.app, 'PATCH', `/api/assignments/${saved.id}`, owner, {
      note: 'в архиве',
      version: saved.version,
    });
    expect([patch.status, await errorCode(patch)]).toEqual([409, 'contractor_archived']);
    const end = await apiRequest(f.app, 'POST', `/api/assignments/${saved.id}/end`, owner, {
      version: saved.version,
    });
    expect([end.status, await errorCode(end)]).toEqual([409, 'contractor_archived']);
  });
});
