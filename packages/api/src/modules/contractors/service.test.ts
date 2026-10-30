import { fixedClock } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { formatText, UI_TEXTS, type UiTextKey } from '@buhuchet/domain';
import {
  ApiError,
  ArchiveContractorsResult,
  ContractorService,
  ContractorServiceSaved,
  ContractorUnarchived,
  ReportList,
  ReportTabCounts,
} from '@buhuchet/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { syncServiceStatusesJob } from './job';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): идущий месяц — октябрь 2026. Соцфонд — ежемесячный,
// срок — 20-е следующего месяца: за июль и август просрочен, за сентябрь — на этой неделе.
describe.skipIf(!databaseAvailable())('Контрагенты: обслуживание — методы API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let senior: string;
  let ownerB: string;
  let innSeq = 500;

  const employee = (login: string) => f.people[login]!.employeeId;
  const nextInn = () => `0374409740${String(innSeq++).padStart(4, '0')}`;
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  /** Что покажет экран: текст словаря по коду ошибки. */
  const screen = ({ code, details }: { code: string; details?: unknown }) => {
    const { variant, ...params } = (details ?? {}) as Record<string, string | number>;
    const key = (variant ? `err.${code}.${variant}` : `err.${code}`) as UiTextKey;
    return formatText(UI_TEXTS[key].ru, params);
  };
  const call = (cookie: string, path: string, body?: unknown) =>
    apiRequest(f.app, body === undefined ? 'GET' : 'POST', `/api/contractors${path}`, cookie, body);
  const service = async (cookie: string, id: string) => {
    const res = await call(cookie, `/${id}/service`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorService.parse(await res.json());
  };
  const saved = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorServiceSaved.parse(await res.json());
  };
  /** Отчёты Соцфонда контрагента: период и статус по порядку. */
  const socOf = async (id: string) =>
    (
      await f.t.admin.db
        .select({ period: schema.reports.periodStart, status: schema.reports.status })
        .from(schema.reports)
        .where(and(eq(schema.reports.contractorId, id), eq(schema.reports.superseded, false)))
        .orderBy(asc(schema.reports.periodStart))
    ).map((r) => `${r.period.slice(0, 7)} ${r.status}`);
  const reportsList = async (cookie: string, query: string) => {
    const res = await apiRequest(f.app, 'GET', `/api/reports?size=all${query}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return ReportList.parse(await res.json());
  };

  /** Постоянный контрагент А (обслуживается с января 2026) с Соцфондом с июля. */
  async function contractor(
    responsible = employee('acc-a'),
    patch: Partial<typeof schema.contractors.$inferInsert> = {},
  ) {
    const [row] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name: `ОсОО «Тест ${innSeq}»`,
        inn: nextInn(),
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        startDate: '2026-01-15',
        responsibleEmployeeId: responsible,
        ...patch,
      })
      .returning({ id: schema.contractors.id });
    const id = row!.id;
    if ((patch.kind ?? 'regular') === 'regular') {
      const res = await apiRequest(f.app, 'POST', '/api/assignments', owner, {
        contractorId: id,
        reportTypeCode: 'soc',
        fromMonth: '2026-07-01',
        markPast: false,
      });
      expect(res.status, await res.clone().text()).toBe(201);
    }
    return id;
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // Плата за обслуживание включена у организации А: её видят владелец и главный бухгалтер.
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { fee: true } })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
    [owner, chief, acc, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    const res = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['soc'],
      disconnect: [],
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('обслуживание для карточки: статус, периоды словами, месяц, история; область и вход', async () => {
    const cp = await contractor();
    expect(await service(owner, cp)).toEqual({
      id: cp,
      kind: 'regular',
      status: 'active',
      periods: [{ from: '2026-01', to: null }],
      periodsText: '01.2026–…',
      month: '2026-10',
      plannedPause: null,
      plannedResume: null,
      skipped: [],
      statusHistory: [],
      version: 1,
    });
    // Бухгалтер видит своего; контрагент главного бухгалтера для него — «не найден».
    expect((await service(acc, cp)).status).toBe('active');
    const chiefs = await contractor(employee('chief-a'));
    expect((await call(acc, `/${chiefs}/service`)).status).toBe(404);
    expect((await call(ownerB, `/${cp}/service`)).status).toBe(404);
    expect((await apiRequest(f.app, 'GET', `/api/contractors/${cp}/service`, '')).status).toBe(401);
    expect((await call(owner, '/not-a-uuid/service')).status).toBe(400);
  });

  it('приостановка: права, проверки окна, запланированная — статус меняет задача, отмена — с правом отката', async () => {
    const cp = await contractor(employee('chief-a'));
    const pause = {
      from: '2026-12',
      resume: '2027-05',
      reason: 'Сезонная деятельность',
      version: 1,
    };
    // «Приостанавливать контрагентов» есть у главного бухгалтера, но не у бухгалтера и «Старшего».
    expect((await call(acc, `/${cp}/pause`, pause)).status).toBe(403);
    expect((await call(senior, `/${cp}/pause`, pause)).status).toBe(403);

    const past = await call(chief, `/${cp}/pause`, { ...pause, from: '2026-09' });
    const pastError = await failure(past);
    expect([past.status, pastError.code, pastError.details]).toEqual([
      400,
      'service_month_in_past',
      { field: 'from' },
    ]);
    expect(screen(pastError)).toBe(pastError.message);
    const early = await failure(await call(chief, `/${cp}/pause`, { ...pause, resume: '2026-12' }));
    expect([early.code, early.details]).toEqual([
      'service_resume_before_pause',
      { field: 'resume' },
    ]);
    expect(screen(early)).toBe(early.message);
    expect((await call(chief, `/${cp}/pause`, { ...pause, extra: 1 })).status).toBe(400);
    expect((await call(chief, `/${cp}/pause`, { ...pause, from: '2026-13' })).status).toBe(400);
    expect((await call(chief, `/${cp}/pause`, { ...pause, reason: 'x'.repeat(501) })).status).toBe(
      400,
    );
    const stale = await call(chief, `/${cp}/pause`, { ...pause, version: 7 });
    expect([stale.status, (await failure(stale)).code]).toEqual([409, 'record_changed']);

    const planned = await saved(await call(chief, `/${cp}/pause`, pause));
    expect(planned.service).toMatchObject({
      status: 'active',
      periods: [
        { from: '2026-01', to: '2026-11' },
        { from: '2027-05', to: null },
      ],
      periodsText: '01.2026–11.2026, 05.2027–…',
      plannedPause: { from: '2026-12', resume: '2027-05' },
      plannedResume: null,
      version: 2,
    });
    expect(planned.effect).toEqual({ notRequired: 0, restored: 0, created: 0, open: 5 });
    const again = await call(chief, `/${cp}/pause`, { ...pause, version: 2 });
    expect([again.status, (await failure(again)).code]).toEqual([409, 'service_already_paused']);

    // Наступил декабрь: задача по расписанию ставит «Приостановлен» с причиной в истории статусов.
    const december = { ...f.deps, clock: fixedClock('2026-12-01T00:30:00Z') };
    await syncServiceStatusesJob.run(december, new Date('2026-11-30T18:02:00Z'));
    const [row] = await f.t.admin.db
      .select({ status: schema.contractors.serviceStatus })
      .from(schema.contractors)
      .where(eq(schema.contractors.id, cp));
    expect(row!.status).toBe('paused');
    const synced = await service(owner, cp);
    // Изменение системой — тоже новая версия: окно, открытое раньше, получит «изменена другим».
    expect(synced.version).toBe(3);
    expect(synced.statusHistory).toEqual([
      expect.objectContaining({
        from: 'active',
        to: 'paused',
        actor: null,
        reason: 'С декабря 2026, возобновление с мая 2027. Причина: Сезонная деятельность',
      }),
    ]);
    // Дальше — снова октябрь.
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'active' })
      .where(eq(schema.contractors.id, cp));

    // «Отменить приостановку» — и «Приостанавливать», и «Откат статусов»: у главного бухгалтера отката нет.
    expect((await call(chief, `/${cp}/pause/cancel`, { version: 3 })).status).toBe(403);
    const cancelled = await saved(await call(owner, `/${cp}/pause/cancel`, { version: 3 }));
    expect(cancelled.service).toMatchObject({
      periods: [{ from: '2026-01', to: null }],
      plannedPause: null,
      version: 4,
    });
    const none = await call(owner, `/${cp}/pause/cancel`, { version: 4 });
    const noneError = await failure(none);
    expect([none.status, noneError.code]).toEqual([409, 'service_no_planned_pause']);
    expect(screen(noneError)).toBe(noneError.message);
  });

  it('(приёмка) приостановленный с идущего месяца не попадает в «Просрочено»; возобновление и откат', async () => {
    const cp = await contractor();
    const overdueOf = async () =>
      (await reportsList(owner, '&tab=overdue')).items
        .filter((r) => r.contractor.id === cp)
        .map((r) => r.periodStart);
    expect(await overdueOf()).toEqual(['2026-07-01', '2026-08-01']);
    const before = ReportTabCounts.parse(
      await (await apiRequest(f.app, 'GET', '/api/reports/tab-counts', owner)).json(),
    );

    const paused = await saved(
      await call(owner, `/${cp}/pause`, {
        from: '2026-10',
        reason: 'Нет деятельности',
        version: 1,
      }),
    );
    expect(paused.service).toMatchObject({
      status: 'paused',
      periods: [{ from: '2026-01', to: '2026-09' }],
      skipped: ['2026-10'],
    });
    expect(paused.service.statusHistory).toEqual([
      expect.objectContaining({
        from: 'active',
        to: 'paused',
        reason: 'С октября 2026. Причина: Нет деятельности',
        rollback: false,
      }),
    ]);
    // За октябрь и ноябрь — «Не требуется»; за обслуженные месяцы остаются к сдаче.
    expect(paused.effect).toEqual({ notRequired: 2, restored: 0, created: 0, open: 3 });
    expect(await socOf(cp)).toEqual([
      '2026-07 todo',
      '2026-08 todo',
      '2026-09 todo',
      '2026-10 not_required',
      '2026-11 not_required',
    ]);
    expect(await overdueOf()).toEqual([]);
    const after = ReportTabCounts.parse(
      await (await apiRequest(f.app, 'GET', '/api/reports/tab-counts', owner)).json(),
    );
    expect(after.overdue).toBe(before.overdue - 2);

    // «Возобновить» с ноября: октябрь остаётся «Не требуется», ноябрь — снова к сдаче.
    const resumed = await saved(
      await call(chief, `/${cp}/resume`, { from: '2026-11', version: 2 }),
    );
    expect(resumed.service).toMatchObject({
      status: 'paused',
      periods: [
        { from: '2026-01', to: '2026-09' },
        { from: '2026-11', to: null },
      ],
      plannedResume: '2026-11',
    });
    expect(resumed.effect).toMatchObject({ restored: 1 });
    expect(await socOf(cp)).toContain('2026-11 todo');
    expect((await call(acc, `/${cp}/resume`, { from: '2026-12', version: 3 })).status).toBe(403);

    // Откат действующей приостановки — право «Откат статусов», причина обязательна.
    expect(
      (await call(chief, `/${cp}/pause/rollback`, { reason: 'Ошибка', fill: [], version: 3 }))
        .status,
    ).toBe(403);
    expect(
      (await call(owner, `/${cp}/pause/rollback`, { reason: '', fill: [], version: 3 })).status,
    ).toBe(400);
    const notSkipped = await call(owner, `/${cp}/pause/rollback`, {
      reason: 'Ошибка',
      fill: ['2026-09'],
      version: 3,
    });
    expect([notSkipped.status, (await failure(notSkipped)).details]).toEqual([
      400,
      { field: 'fill' },
    ]);
    const rolled = await saved(
      await call(owner, `/${cp}/pause/rollback`, {
        reason: 'Статус поставили по ошибке',
        fill: ['2026-10', '2026-10'],
        version: 3,
      }),
    );
    expect(rolled.service).toMatchObject({
      status: 'active',
      periods: [{ from: '2026-01', to: null }],
      skipped: [],
    });
    expect(rolled.service.statusHistory.at(-1)).toMatchObject({
      from: 'paused',
      to: 'active',
      reason: 'Статус поставили по ошибке',
      rollback: true,
    });
    expect(await socOf(cp)).toEqual([
      '2026-07 todo',
      '2026-08 todo',
      '2026-09 todo',
      '2026-10 todo',
      '2026-11 todo',
    ]);
    const notPaused = await call(owner, `/${cp}/pause/rollback`, {
      reason: 'Ещё раз',
      version: 4,
    });
    expect([notPaused.status, (await failure(notPaused)).code]).toEqual([
      409,
      'service_not_paused',
    ]);
  });

  it('откат приостановки с прошлых месяцев: досоздаются отчёты только за отмеченные', async () => {
    const cp = await contractor();
    // Приостановлен с августа (до задачи: периоды и статус — напрямую).
    await f.t.admin.db
      .update(schema.contractorServicePeriods)
      .set({ toMonth: '2026-07-01' })
      .where(eq(schema.contractorServicePeriods.contractorId, cp));
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'paused' })
      .where(eq(schema.contractors.id, cp));
    await f.t.admin.db
      .delete(schema.reports)
      .where(
        and(eq(schema.reports.contractorId, cp), eq(schema.reports.periodStart, '2026-08-01')),
      );
    expect((await service(owner, cp)).skipped).toEqual(['2026-08', '2026-09', '2026-10']);
    const rolled = await saved(
      await call(owner, `/${cp}/pause/rollback`, {
        reason: 'Обслуживали без перерыва',
        fill: ['2026-08'],
        version: 1,
      }),
    );
    expect(rolled.effect.created).toBe(1);
    expect((await socOf(cp))[1]).toBe('2026-08 todo');
  });

  it('архив и возврат: права, все или никто, уже архивные пропускаются; (приёмка) отчёты — с текущего периода', async () => {
    const cp = await contractor();
    const other = await contractor();
    expect((await call(chief, '/archive', { ids: [cp] })).status).toBe(403);
    expect((await call(owner, '/archive', { ids: [] })).status).toBe(400);
    const missing = await call(owner, '/archive', {
      ids: [cp, '00000000-0000-4000-8000-000000000000'],
    });
    expect(missing.status).toBe(404);
    expect((await service(owner, cp)).status).toBe('active');
    expect((await call(ownerB, '/archive', { ids: [cp] })).status).toBe(404);

    const res = await call(owner, '/archive', { ids: [cp, other, cp] });
    expect(res.status, await res.clone().text()).toBe(200);
    // Обслуживание заканчивается октябрём: «Не требуется» — за ноябрь.
    expect(ArchiveContractorsResult.parse(await res.json())).toEqual({
      archived: 2,
      skipped: 0,
      notRequired: 2,
    });
    expect(await socOf(cp)).toEqual([
      '2026-07 todo',
      '2026-08 todo',
      '2026-09 todo',
      '2026-10 todo',
      '2026-11 not_required',
    ]);
    const twice = ArchiveContractorsResult.parse(
      await (await call(owner, '/archive', { ids: [cp] })).json(),
    );
    expect(twice).toEqual({ archived: 0, skipped: 1, notRequired: 0 });

    // Архивного не приостанавливают и не правят — тот же ответ, что у «Изменить».
    const archived = await service(owner, cp);
    expect(archived).toMatchObject({
      status: 'archived',
      periods: [{ from: '2026-01', to: '2026-10' }],
    });
    const pause = await call(owner, `/${cp}/pause`, { from: '2026-11', version: archived.version });
    const pauseError = await failure(pause);
    expect([pause.status, pauseError.code]).toEqual([409, 'contractor_archived']);
    expect(screen(pauseError)).toBe(pauseError.message);

    // Вернуть: только с правом архива; ответ — карточка (форма 2.09 открывает «Изменить»).
    expect((await call(chief, `/${cp}/unarchive`, {})).status).toBe(403);
    expect((await call(owner, `/${cp}/unarchive`, { extra: 1 })).status).toBe(400);
    const stale = await call(owner, `/${cp}/unarchive`, { version: 1 });
    expect([stale.status, (await failure(stale)).code]).toEqual([409, 'record_changed']);
    const back = await call(owner, `/${cp}/unarchive`, {});
    expect(back.status, await back.clone().text()).toBe(200);
    const card = ContractorUnarchived.parse(await back.json());
    expect(card).toMatchObject({
      id: cp,
      serviceStatus: 'active',
      notices: [],
      service: { status: 'active', periods: [{ from: '2026-01', to: null }] },
      effect: { restored: 1, open: 5 },
    });
    expect(await socOf(cp)).toEqual([
      '2026-07 todo',
      '2026-08 todo',
      '2026-09 todo',
      '2026-10 todo',
      '2026-11 todo',
    ]);
    const notArchived = await call(owner, `/${cp}/unarchive`, {});
    const notArchivedError = await failure(notArchived);
    expect([notArchived.status, notArchivedError.code]).toEqual([409, 'contractor_not_archived']);
    expect(screen(notArchivedError)).toBe(notArchivedError.message);
  });

  it('(приёмка) возврат из архива через месяцы: отчёты создаются с текущего периода, пропущенные — нет', async () => {
    const cp = await contractor();
    // В архиве с июля: обслуживание закончилось июлем, отчётов после него нет.
    await f.t.admin.db
      .update(schema.contractorServicePeriods)
      .set({ toMonth: '2026-07-01' })
      .where(eq(schema.contractorServicePeriods.contractorId, cp));
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, cp));
    await f.t.admin.db
      .delete(schema.reports)
      .where(
        and(eq(schema.reports.contractorId, cp), eq(schema.reports.periodStart, '2026-08-01')),
      );
    await f.t.admin.db
      .delete(schema.reports)
      .where(
        and(eq(schema.reports.contractorId, cp), eq(schema.reports.periodStart, '2026-10-01')),
      );

    const card = ContractorUnarchived.parse(
      await (await call(owner, `/${cp}/unarchive`, {})).json(),
    );
    expect(card.service.periods).toEqual([
      { from: '2026-01', to: '2026-07' },
      { from: '2026-10', to: null },
    ]);
    expect(card.service.periodsText).toBe('01.2026–07.2026, 10.2026–…');
    expect(card.effect).toMatchObject({ created: 1 });
    // Август не досоздан, сентябрь (месяц вне обслуживания) — «Не требуется», октябрь создан заново.
    expect(await socOf(cp)).toEqual([
      '2026-07 todo',
      '2026-09 not_required',
      '2026-10 todo',
      '2026-11 todo',
    ]);
  });

  it('разовый → постоянный: право «Создавать», ставка — тому, кто видит плату, режим проверяется', async () => {
    const cp = await contractor(employee('acc-a'), { kind: 'oneoff' });
    const oneOff = await service(owner, cp);
    expect(oneOff).toMatchObject({
      kind: 'oneoff',
      status: 'active',
      periods: [],
      periodsText: '',
    });

    // У разового нет приостановки.
    const pause = await call(owner, `/${cp}/pause`, { from: '2026-11', version: 1 });
    const pauseError = await failure(pause);
    expect([pause.status, pauseError.code]).toEqual([409, 'service_oneoff']);
    expect(screen(pauseError)).toBe(pauseError.message);

    const body = { from: '2026-11', version: 1 };
    expect((await call(senior, `/${cp}/to-regular`, body)).status).toBe(403);
    // Бухгалтер не видит плату: ставку задать не может, без неё — переводит.
    const accTariff = await call(acc, `/${cp}/to-regular`, {
      ...body,
      tariff: { amount: 1_500_000, period: 'M' },
    });
    expect([accTariff.status, (await failure(accTariff)).code]).toEqual([403, 'forbidden']);
    // Владелец видит плату: без ставки — отказ с полем.
    const noTariff = await call(owner, `/${cp}/to-regular`, body);
    const noTariffError = await failure(noTariff);
    expect([noTariff.status, noTariffError.code, noTariffError.details]).toEqual([
      400,
      'tariff_required',
      { field: 'tariff' },
    ]);
    expect(screen(noTariffError)).toBe(noTariffError.message);
    expect((await call(owner, `/${cp}/to-regular`, { ...body, from: '2026-09' })).status).toBe(400);
    const negative = await call(owner, `/${cp}/to-regular`, {
      ...body,
      tariff: { amount: -100, period: 'M' },
    });
    expect(negative.status).toBe(400);
    expect(
      (await call(owner, `/${cp}/to-regular`, { ...body, regimeCode: 'НЕТ-ТАКОГО' })).status,
    ).toBe(400);

    const regular = await saved(
      await call(owner, `/${cp}/to-regular`, {
        ...body,
        regimeCode: 'РЕЖ-01',
        tariff: { amount: 1_500_000, period: 'M' },
      }),
    );
    expect(regular.service).toMatchObject({
      kind: 'regular',
      status: 'paused',
      periods: [{ from: '2026-11', to: null }],
      plannedResume: '2026-11',
    });
    const [tariff] = await f.t.admin.db
      .select()
      .from(schema.contractorTariffs)
      .where(eq(schema.contractorTariffs.contractorId, cp));
    expect(tariff).toMatchObject({
      amount: 1_500_000,
      period: 'M',
      validFrom: '2026-11-01',
      note: 'Переход на постоянное обслуживание',
    });
    const again = await call(owner, `/${cp}/to-regular`, { ...body, version: 2 });
    const againError = await failure(again);
    expect([again.status, againError.code]).toEqual([409, 'contractor_regular']);
    expect(screen(againError)).toBe(againError.message);

    // Бухгалтер переводит своего разового без ставки.
    const mine = await contractor(employee('acc-a'), { kind: 'oneoff' });
    expect(
      (await saved(await call(acc, `/${mine}/to-regular`, { from: '2026-10', version: 1 })))
        .service,
    ).toMatchObject({ kind: 'regular', status: 'active' });
  });

  it('чужая организация не видна: обслуживание и все действия — «не найден»', async () => {
    const cp = await contractor();
    for (const [path, body] of [
      [`/${cp}/service`, undefined],
      [`/${cp}/pause`, { from: '2026-11', version: 1 }],
      [`/${cp}/resume`, { from: '2026-11', version: 1 }],
      [`/${cp}/pause/cancel`, { version: 1 }],
      [`/${cp}/pause/rollback`, { reason: 'x', version: 1 }],
      [`/${cp}/to-regular`, { from: '2026-11', version: 1 }],
      [`/${cp}/unarchive`, {}],
      ['/archive', { ids: [cp] }],
    ] as const) {
      expect((await call(ownerB, path, body)).status, path).toBe(404);
    }
    expect(await service(owner, cp)).toMatchObject({ status: 'active', version: 1 });
  });
});
