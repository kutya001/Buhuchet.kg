import { randomUUID } from 'node:crypto';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { SCOPE_GROUPS } from '@buhuchet/domain';
import {
  ApiError,
  AssignmentList,
  AssignmentSaved,
  Contractor,
  ContractorSaved,
  ReportList,
  ReportPickApplied,
  ReportPickContext,
  ReportPickPreview,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Пункты приёмки 28 и 30 на уровне API; окно подключат форма создания (2.09) и вкладка карточки (2.11).
// Сегодня в тестах — 18.10.2026.
describe.skipIf(!databaseAvailable())('Подбор отчётов: методы API', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let senior: string;
  let assigner: string;
  let ownerB: string;
  let innSeq = 700;

  const nextInn = () => `0374409740${String(innSeq++).padStart(4, '0')}`;
  const employee = (login: string) => f.people[login]!.employeeId;
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const created = async (patch: Record<string, unknown> = {}) => {
    const res = await apiRequest(f.app, 'POST', '/api/contractors', owner, {
      name: `ОсОО «Подбор ${innSeq}»`,
      inn: nextInn(),
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '47.11.0',
      startDate: '2026-01-15',
      responsibleEmployeeId: employee('acc-a'),
      ...patch,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return ContractorSaved.parse(await res.json());
  };
  const context = (cookie: string, body: Record<string, unknown>) =>
    apiRequest(f.app, 'POST', '/api/contractors/report-pick', cookie, body);
  const contextOf = async (cookie: string, body: Record<string, unknown>) => {
    const res = await context(cookie, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return ReportPickContext.parse(await res.json());
  };
  const preview = (cookie: string, id: string, codes: string[]) =>
    apiRequest(f.app, 'POST', `/api/contractors/${id}/report-pick/preview`, cookie, { codes });
  const apply = (cookie: string, id: string, body: Record<string, unknown>) =>
    apiRequest(f.app, 'PUT', `/api/contractors/${id}/report-pick`, cookie, body);
  const applied = async (cookie: string, id: string, body: Record<string, unknown>) => {
    const res = await apply(cookie, id, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return ReportPickApplied.parse(await res.json());
  };
  const assignmentsOf = async (id: string) =>
    AssignmentList.parse(
      await (await apiRequest(f.app, 'GET', `/api/contractors/${id}/assignments`, owner)).json(),
    ).items;
  const reportsOf = async (id: string, type: string) =>
    ReportList.parse(await (await apiRequest(f.app, 'GET', '/api/reports?size=all', owner)).json())
      .items.filter((r) => r.contractor.id === id && r.type.code === type)
      .map((r) => r.periodStart)
      .sort();
  const history = (contractorId: string, entity: 'assignment' | 'report') =>
    f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.contractorId, contractorId), eq(schema.auditLog.entity, entity)),
      )
      .orderBy(schema.auditLog.at);

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // «Назначает»: видит всех контрагентов, назначает отчёты только своим, контрагентов не меняет.
    const [role] = await f.t.admin.db
      .insert(schema.roles)
      .values({ orgId: f.a.orgId, name: 'Назначает' })
      .returning({ id: schema.roles.id });
    await f.t.admin.db.insert(schema.rolePermissions).values(
      ['cpView', 'repView', 'assign'].map((permissionId) => ({
        orgId: f.a.orgId,
        roleId: role!.id,
        permissionId,
      })),
    );
    await f.t.admin.db.insert(schema.roleScopes).values(
      SCOPE_GROUPS.map((g) => ({
        orgId: f.a.orgId,
        roleId: role!.id,
        permGroup: g,
        scope: g === 'cps' ? ('all' as const) : ('own' as const),
      })),
    );
    await f.t.admin.db
      .update(schema.employees)
      .set({ roleId: role!.id })
      .where(eq(schema.employees.id, employee('hr-a')));
    [owner, acc, senior, assigner, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'hr-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    const res = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['nds', 'nspm', 'npa', 'enq', 'endo', 'soc', 'pkid', 'fin', 'utlq', 'utli'],
      disconnect: [],
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('п. 28: окно получает контрагента для подбора; «Применить» назначает виды, обязательный снимается только с подтверждением', async () => {
    const cp = await created({
      regimeCode: 'РЕЖ-03',
      gked: '62.01.0',
      benefits: [{ code: 'ЛЬГ-01', validFrom: null, validTo: null }],
      bases: ['employees'],
      gkedConfirm: true,
    });
    const ctx = await contextOf(owner, { contractorId: cp.id });
    expect(ctx.subject).toEqual({
      form: { code: 'ФС-01', declarationFor: 'org' },
      regimes: [{ code: 'РЕЖ-03', name: 'Единый налог' }],
      benefits: ['ЛЬГ-01'],
      bases: ['employees'],
      bizSize: 'small',
      gked: '62.01.0',
      gkedExtra: [],
      // Резидент ПКИ с ГКЭД 62.01 — строка ЕНС-13 (прототип pkEn → enAuto).
      enCodes: ['ЕНС-13'],
      singleTax: [],
    });
    expect(ctx.connected.sort()).toEqual(
      ['endo', 'enq', 'fin', 'nds', 'npa', 'nspm', 'pkid', 'soc', 'utli', 'utlq'].sort(),
    );
    expect(ctx).toMatchObject({
      assigned: [],
      version: cp.version,
      edit: { types: true, bases: true },
      today: '2026-10-18',
      socfundStatus: 'ЛЬГ-29',
    });
    // Ставки ЕН — все строки справочника, как у сервера при «Применить».
    expect(ctx.rates.find((r) => r.code === 'ЕНС-16')?.addsTo.length).toBeGreaterThan(0);
    expect(ctx.enRates).toMatch(/^ЕНС-13 · /);
    expect(ctx.gkedIndex.map((x) => x.code)).toContain('62.01.0');
    // «Ближайший срок» — у каждого подключённого вида с периодами; у разового — нет.
    expect(ctx.details.find((d) => d.code === 'nds')?.near).toMatch(/^\d\d\.\d\d\.2026 — за /);
    expect(ctx.details.some((d) => d.code === 'utli' && d.near)).toBe(false);
    // Тариф Соцфонда у вида со взносами — по основаниям окна.
    expect(ctx.socfund).toMatchObject({ types: expect.arrayContaining(['soc']) });
    const noStaff = await contextOf(owner, { contractorId: cp.id, bases: [] });
    expect(noStaff.subject.bases).toEqual([]);
    expect(noStaff.socfund).toBeNull();

    // НДС к единому налогу не подходит — не назначается.
    const nds = await apply(owner, cp.id, { assigned: [], codes: ['nds'] });
    expect([nds.status, (await failure(nds)).code]).toEqual([400, 'report_type_incompatible']);
    // Вид не подключён в организации.
    const off = await apply(owner, cp.id, { assigned: [], codes: ['t1m'] });
    expect([off.status, (await failure(off)).code]).toEqual([409, 'report_type_not_connected']);

    expect(await applied(owner, cp.id, { assigned: [], codes: ['enq', 'pkid', 'soc'] })).toEqual({
      add: ['enq', 'pkid', 'soc'],
      remove: [],
      deleted: 0,
      version: cp.version,
    });
    const items = await assignmentsOf(cp.id);
    expect(items.map((a) => a.reportTypeCode).sort()).toEqual(['enq', 'pkid', 'soc']);
    // Строка ЕН — по ГКЭД (ЕНС-13), ставка Соцфонда — по умолчанию (прототип defRate: первая ставка).
    expect(items.find((a) => a.reportTypeCode === 'enq')).toMatchObject({
      enRates: [{ code: 'ЕНС-13', variant: null }],
    });
    expect(items.find((a) => a.reportTypeCode === 'soc')).toMatchObject({ rate: '10 %' });

    // Выбор устарел: другой пользователь уже назначил виды.
    const stale = await apply(owner, cp.id, { assigned: [], codes: ['enq', 'pkid'] });
    expect([stale.status, (await failure(stale)).code]).toEqual([409, 'report_pick_changed']);
    // ЕН обязателен по режиму: без подтверждения не снимается.
    const must = await apply(owner, cp.id, {
      assigned: ['enq', 'pkid', 'soc'],
      codes: ['pkid', 'soc'],
    });
    expect([must.status, await failure(must)]).toEqual([
      400,
      expect.objectContaining({
        code: 'report_pick_must',
        details: expect.objectContaining({ codes: ['enq'] }),
      }),
    ]);
    expect(
      await applied(owner, cp.id, {
        assigned: ['enq', 'pkid', 'soc'],
        codes: ['pkid', 'soc'],
        forced: ['enq'],
      }),
    ).toMatchObject({ add: [], remove: ['enq'] });
    const ended = (await history(cp.id, 'assignment')).filter((h) => h.action === 'update');
    expect(ended.at(-1)!.reason).toBe(
      'Снят в «Подборе отчётов»; удалено отчётов «К сдаче»: 1 — снял, хотя отчёт обязателен по режиму «Единый налог»',
    );
  });

  it('п. 30: снятый вид удаляет текущий отчёт «К сдаче», прошлые периоды и отчёты с движением остаются', async () => {
    const cp = await created();
    const res = await apiRequest(f.app, 'POST', '/api/assignments', owner, {
      contractorId: cp.id,
      reportTypeCode: 'utlq',
      fromMonth: '2026-01-01',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(AssignmentSaved.parse(await res.json()).past).toBe(3);
    // I–III кварталы — прошлые (срок III — 15.10 — прошёл), IV — к сдаче.
    expect(await reportsOf(cp.id, 'utlq')).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ]);
    // Изменённый вручную срок движением не считается (ТЗ: «статус дальше «К сдаче», деньги, файлы»):
    // отчёт удаляется вместе с журналом сроков.
    const iv = ReportList.parse(
      await (await apiRequest(f.app, 'GET', '/api/reports?size=all', owner)).json(),
    ).items.find(
      (r) => r.contractor.id === cp.id && r.type.code === 'utlq' && r.periodStart === '2026-10-01',
    )!;
    const moved = await apiRequest(f.app, 'POST', `/api/reports/${iv.id}/due`, owner, {
      due: '2027-01-20',
      reasonCode: 'ПРЧ-001',
      comment: 'письмо ГНС',
      version: iv.version,
    });
    expect(moved.status, await moved.clone().text()).toBe(200);

    const p = await preview(owner, cp.id, []);
    expect(p.status, await p.clone().text()).toBe(200);
    expect(ReportPickPreview.parse(await p.json())).toEqual({
      add: [],
      remove: ['utlq'],
      deleted: 1,
      kept: 0,
    });
    expect(await applied(owner, cp.id, { assigned: ['utlq'], codes: [] })).toMatchObject({
      remove: ['utlq'],
      deleted: 1,
    });
    expect(await reportsOf(cp.id, 'utlq')).toEqual(['2026-01-01', '2026-04-01', '2026-07-01']);
    expect(
      await f.t.admin.db
        .select()
        .from(schema.reportDueChanges)
        .where(eq(schema.reportDueChanges.reportId, iv.id)),
    ).toEqual([]);
    const [assignment] = await assignmentsOf(cp.id);
    expect(assignment).toMatchObject({ reportTypeCode: 'utlq', endedOn: '2026-10-18' });
    const deleted = (await history(cp.id, 'report')).filter((h) => h.action === 'delete');
    expect(deleted.map((h) => h.reason)).toEqual([
      'Вид снят в «Подборе отчётов»: отчёт «К сдаче» удалён',
    ]);

    // Отчёт текущего периода «В работе» — уже движение: остаётся и доводится вручную; НДС обязателен
    // по режиму ОНР — снимается с подтверждением.
    expect(await applied(owner, cp.id, { assigned: [], codes: ['nds'] })).toMatchObject({
      add: ['nds'],
    });
    await f.t.admin.db
      .update(schema.reports)
      .set({ status: 'in_progress' })
      .where(
        and(
          eq(schema.reports.contractorId, cp.id),
          eq(schema.reports.reportTypeCode, 'nds'),
          eq(schema.reports.periodStart, '2026-10-01'),
        ),
      );
    // Октябрь «В работе» остаётся, ноябрь «К сдаче» удаляется.
    const kept = ReportPickPreview.parse(await (await preview(owner, cp.id, [])).json());
    expect(kept).toEqual({ add: [], remove: ['nds'], deleted: 1, kept: 1 });
    await applied(owner, cp.id, { assigned: ['nds'], codes: [], forced: ['nds'] });
    expect(await reportsOf(cp.id, 'nds')).toEqual(['2026-10-01']);
  });

  it('снятие вида не удаляет отчёт с файлом, сданный и заменённый уточнённым; уточнённый «К сдаче» удаляет', async () => {
    const cp = await created();
    await applied(owner, cp.id, { assigned: [], codes: ['nds'] });
    // Октябрь и ноябрь — текущий и следующий месяц.
    expect(await reportsOf(cp.id, 'nds')).toEqual(['2026-10-01', '2026-11-01']);
    const period = (start: string) =>
      and(
        eq(schema.reports.contractorId, cp.id),
        eq(schema.reports.reportTypeCode, 'nds'),
        eq(schema.reports.periodStart, start),
      );
    const set = (start: string, patch: Partial<typeof schema.reports.$inferInsert>) =>
      f.t.admin.db.update(schema.reports).set(patch).where(period(start));
    const deleted = async () =>
      ReportPickPreview.parse(await (await preview(owner, cp.id, [])).json()).deleted;
    const [oct] = await f.t.admin.db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(period('2026-10-01'));

    // Ноябрь — уточнённый «К сдаче» (ТЗ и прототип pkDroppable: удаляется, как первичный), октябрь —
    // с файлом, который ещё загружается.
    await set('2026-11-01', { revision: 1 });
    const fileId = randomUUID();
    await f.t.admin.db.insert(schema.files).values({
      id: fileId,
      orgId: f.a.orgId,
      sourceKind: 'report',
      sourceId: oct!.id,
      contractorId: cp.id,
      name: 'Декларация.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: `org/${f.a.orgId}/files/${fileId}`,
      createdBy: f.people['acc-a']!.userId,
    });
    expect(await deleted()).toBe(1);
    // Файл удалён, но есть дата сдачи.
    await f.t.admin.db
      .update(schema.files)
      .set({ state: 'deleted', deletedAt: new Date(), deletedBy: f.people['acc-a']!.userId })
      .where(eq(schema.files.id, fileId));
    await set('2026-10-01', { submittedOn: '2026-10-17' });
    expect(await deleted()).toBe(1);
    // Заменён уточнённым.
    await set('2026-10-01', { submittedOn: null, superseded: true });
    expect(await deleted()).toBe(1);
    await set('2026-10-01', { superseded: false });
    expect(await deleted()).toBe(2);

    await applied(owner, cp.id, { assigned: ['nds'], codes: [], forced: ['nds'] });
    expect(await reportsOf(cp.id, 'nds')).toEqual([]);
  });

  it('основания из шапки окна: с правом «Создавать и изменять контрагентов» и версией записи, в истории', async () => {
    const cp = await created({ bases: [] });
    const saved = await applied(owner, cp.id, {
      assigned: [],
      codes: ['utlq'],
      bases: ['utilGoods'],
      version: cp.version,
    });
    expect(saved).toMatchObject({ add: ['utlq'], version: cp.version + 1 });
    const card = Contractor.parse(
      await (await apiRequest(f.app, 'GET', `/api/contractors/${cp.id}`, owner)).json(),
    );
    expect(card.bases.map((b) => b.code)).toEqual(['utilGoods']);
    // Устаревшая версия записи — «изменена другим пользователем».
    const stale = await apply(owner, cp.id, {
      assigned: ['utlq'],
      codes: ['utlq'],
      bases: [],
      version: cp.version,
    });
    expect(stale.status).toBe(409);
    const unknown = await apply(owner, cp.id, {
      assigned: ['utlq'],
      codes: ['utlq'],
      bases: ['nope'],
      version: saved.version,
    });
    expect([unknown.status, (await failure(unknown)).code]).toEqual([400, 'value_inactive']);
    const noVersion = await apply(owner, cp.id, { assigned: ['utlq'], codes: ['utlq'], bases: [] });
    expect(noVersion.status).toBe(400);
  });

  it('черновик формы: подбор по набранным значениям, без контрагента', async () => {
    const ctx = await contextOf(acc, {
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      bizSize: 'medium',
      gked: '46.34.0',
      bases: ['employees'],
    });
    expect(ctx.subject).toMatchObject({
      form: { code: 'ФС-01', declarationFor: 'org' },
      regimes: [{ code: 'РЕЖ-01', name: 'ОНР' }],
      bizSize: 'medium',
      bases: ['employees'],
    });
    expect(ctx).toMatchObject({
      assigned: [],
      version: null,
      edit: { types: true, bases: true },
      socfund: null,
    });
    expect((await context(acc, { bizSize: 'huge' })).status).toBe(400);

    // Признаки тарифа Соцфонда из формы: пояснение у вида со взносами — и у черновика.
    const flags = { cashless: true, registry: true, confirmed: true, gov: false };
    const sf = await contextOf(acc, {
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '47.11.0',
      bases: ['employees'],
      socfund: { flags },
    });
    expect(sf.socfund).toMatchObject({ warn: false, title: expect.stringContaining('СПиНО') });
    expect(sf.socfund?.types.length).toBeGreaterThan(0);
    // Без основания «Есть наёмные сотрудники» тариф не нужен.
    expect((await contextOf(acc, { gked: '47.11.0', socfund: { flags } })).socfund).toBeNull();
    expect((await context(acc, { socfund: { flags: { cashless: 'да' } } })).status).toBe(400);
  });

  it('права, область и чужая организация', async () => {
    const own = await created();
    const chiefs = await created({ responsibleEmployeeId: employee('chief-a') });
    const mine = await created({ responsibleEmployeeId: employee('hr-a') });
    const seniors = await created({ responsibleEmployeeId: employee('senior-a') });

    // Только просмотр: описания без галочек; применить нельзя.
    // «Выбрать налоги» — только с правом «Справочники».
    expect((await contextOf(senior, { contractorId: seniors.id })).edit).toEqual({
      types: false,
      bases: false,
      connect: false,
    });
    expect((await preview(senior, seniors.id, ['soc'])).status).toBe(403);
    expect((await apply(senior, seniors.id, { assigned: [], codes: ['soc'] })).status).toBe(403);

    // «Свои контрагенты»: чужого контрагента не видно.
    expect((await context(acc, { contractorId: chiefs.id })).status).toBe(404);
    expect((await preview(acc, chiefs.id, [])).status).toBe(404);
    expect((await apply(acc, chiefs.id, { assigned: [], codes: ['soc'] })).status).toBe(404);
    expect(await applied(acc, own.id, { assigned: [], codes: ['soc'] })).toMatchObject({
      add: ['soc'],
    });

    // Только «Назначать отчёты» со своей областью: видит всех, меняет отчёты своих, основания — нет.
    expect((await contextOf(assigner, { contractorId: chiefs.id })).edit).toEqual({
      types: false,
      bases: false,
      connect: false,
    });
    expect((await contextOf(assigner, { contractorId: mine.id })).edit).toEqual({
      types: true,
      bases: false,
      connect: false,
    });
    expect((await apply(assigner, chiefs.id, { assigned: [], codes: ['soc'] })).status).toBe(404);
    const bases = await apply(assigner, mine.id, {
      assigned: [],
      codes: ['soc'],
      bases: ['employees'],
      version: mine.version,
    });
    expect([bases.status, (await failure(bases)).code]).toEqual([403, 'report_pick_bases']);
    expect(await applied(assigner, mine.id, { assigned: [], codes: ['soc'] })).toMatchObject({
      add: ['soc'],
    });

    // Чужая организация.
    expect((await context(ownerB, { contractorId: own.id })).status).toBe(404);
    expect((await preview(ownerB, own.id, [])).status).toBe(404);
    expect((await apply(ownerB, own.id, { assigned: ['soc'], codes: [] })).status).toBe(404);
    expect(await reportsOf(own.id, 'soc')).not.toEqual([]);

    // Неверные данные.
    expect((await apply(owner, own.id, { assigned: 'soc', codes: [] })).status).toBe(400);
    expect((await apply(owner, 'не-номер', { assigned: [], codes: [] })).status).toBe(400);
  });

  it('архивный и разовый контрагент: отчёты в подборе не меняются', async () => {
    const closed = await created();
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, closed.id));
    expect((await contextOf(owner, { contractorId: closed.id })).edit).toEqual({
      types: false,
      bases: false,
      connect: true,
    });
    const archived = await apply(owner, closed.id, { assigned: [], codes: ['soc'] });
    expect([archived.status, (await failure(archived)).code]).toEqual([409, 'contractor_archived']);

    const once = await created({ kind: 'oneoff' });
    expect((await contextOf(owner, { contractorId: once.id })).edit.types).toBe(false);
    const oneoff = await apply(owner, once.id, { assigned: [], codes: ['soc'] });
    expect([oneoff.status, (await failure(oneoff)).code]).toEqual([409, 'contractor_oneoff']);
  });
});
