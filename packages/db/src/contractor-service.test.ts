import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeService,
  ContractorNotArchivedError,
  ContractorRegularError,
  ServiceRefusedError,
  syncServiceStatuses,
  type ServiceAction,
  type ServiceTexts,
} from './contractor-service';
import { withOrgContext, type OrgContext } from './context';
import { contractorScope, createContractor, type ContractorFields } from './contractors';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  ContractorArchivedError,
  ContractorOneOffError,
  createAssignment,
  createDueReports,
  type AssignmentInput,
  type AssignmentTexts,
} from './reports';
import { contractors, contractorServicePeriods, contractorTariffs, reports, statusHistory } from './schema';
import { readSpecJson } from './spec-data';
import { seedPermissions, seedRoleTemplates } from './seed';
import { servicePeriodsOf } from './service-periods';
import { createEmployee } from './staff';
import { readStatusHistory, writeStatusChange } from './status';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-27';
const TEXTS: ServiceTexts = {
  pausedFrom: 'С {month}',
  pausedFromResume: 'С {month}, возобновление с {resume}',
  pauseReason: 'Причина: {reason}',
  resumedFrom: 'Возобновление с {month}',
  regularFrom: 'Постоянное обслуживание с {month}',
  reportPaused: 'Обслуживание контрагента приостановлено',
  reportArchived: 'Контрагент отправлен в архив',
  reportResumed: 'Обслуживание контрагента возобновлено',
  reportFilled: 'Досоздан при откате приостановки',
};
const ASSIGN_TEXTS: AssignmentTexts = {
  ended: 'Назначение снято',
  restored: 'Назначено снова',
  until: 'Позже «до какого периода»',
  past: 'Создан за прошлый период при назначении',
  pastMarked: 'Создан за прошлый период и отмечен сданным при назначении',
  pastConfirmed: 'Создан за прошлый период и отмечен сданным и подтверждённым при назначении',
  pastConfirmNote: 'Прошлый период отмечен при назначении',
  ownRuleChanged: 'В назначении изменены периодичность или срок — отчёт создан заново',
};
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

const fields = (patch: Partial<ContractorFields> = {}): ContractorFields => ({
  name: 'ОсОО «Ала-Тоо Трейд»',
  inn: '03744097401851',
  phone: '+996505890076',
  kind: 'regular',
  formCode: 'ФС-01',
  regimeCode: 'РЕЖ-01',
  regime2Code: null,
  gked: '46.34.0',
  gkedExtra: [],
  taxOfficeCode: null,
  bizSize: 'small',
  benefits: [],
  bases: [],
  responsibleEmployeeId: null,
  head: '',
  contact: '',
  contractNo: '',
  contractDate: null,
  note: '',
  registration: {},
  startDate: '2024-07-16',
  firstMonthMode: 'full',
  feeDay: 15,
  paysTo: 'emp',
  gkedConfirmation: null,
  ...patch,
});

const assignment = (fromMonth: string): AssignmentInput => ({
  fromMonth,
  untilMonth: null,
  responsibleEmployeeId: null,
  rate: null,
  enRates: [],
  rateAdditions: [],
  dueDay: null,
  ownPeriod: null,
  ownDay: null,
  ownMonth: null,
  fixedAmount: null,
  note: '',
});

describe.skipIf(!databaseAvailable())('Обслуживание контрагента: приостановка, архив, разовые', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA = '';
  let inn = 3_744_097_401_000;
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctxA(), fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);

  /** Контрагент организации А с назначенным Соцфондом (ежемесячный) с `from`. */
  const contractor = async (patch: Partial<ContractorFields> = {}, from = '2026-07-01') => {
    inn += 1;
    const id = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ inn: `0${inn}`, responsibleEmployeeId: accA, ...patch }),
        null,
        { today: TODAY },
      ),
    );
    if ((patch.kind ?? 'regular') === 'regular') {
      await inA((tx) =>
        createAssignment(
          tx,
          { ...assignment(from), contractorId: id, reportTypeCode: 'soc' },
          { today: TODAY, scope: undefined, markPast: false, confirm: false, texts: ASSIGN_TEXTS },
        ),
      );
    }
    return id;
  };
  /** Задача по расписанию: без пользователя («Система»). */
  const sync = (today: string) =>
    withOrgContext(db.app.db, { orgId: a.orgId, kind: 'job' }, (tx) =>
      syncServiceStatuses(tx, { today, texts: TEXTS }),
    );
  const act = (id: string, action: ServiceAction, today = TODAY, version: number | null = null) =>
    inA((tx) => changeService(tx, id, action, { today, scope: undefined, version, texts: TEXTS }));
  const periodsOf = async (id: string) =>
    (await inA((tx) => servicePeriodsOf(tx, [id]))).get(id)!.map(({ from, to }) => ({ from, to }));
  const statusOf = async (id: string) =>
    (await inA((tx) => tx.select().from(contractors).where(eq(contractors.id, id))))[0]!;
  const reportsOf = (id: string) =>
    inA((tx) =>
      tx
        .select({ id: reports.id, start: reports.periodStart, status: reports.status })
        .from(reports)
        .where(eq(reports.contractorId, id))
        .orderBy(asc(reports.periodStart)),
    );
  const statusesOf = async (id: string) =>
    Object.fromEntries((await reportsOf(id)).map((r) => [r.start.slice(0, 7), r.status]));

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец Организации', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'svc-a',
      owner: owner('svc-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'svc-b',
      owner: owner('svc-owner-b'),
    });
    accA = await inA((tx) =>
      createEmployee(tx, {
        fullName: 'Токтогулов Алишер Бакытович',
        shortName: 'Алишер Т.',
        login: 'svc-acc-a',
        passwordHash: 'x',
        phone: null,
        role: a.roles.find((r) => r.templateCode === 'acc')!,
      }),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('новый контрагент: постоянный — период с месяца начала, разовый — без периодов', async () => {
    const regular = await contractor();
    expect(await periodsOf(regular)).toEqual([{ from: '2024-07', to: null }]);
    expect((await statusOf(regular)).serviceStatus).toBe('active');
    const oneOff = await contractor({ kind: 'oneoff' });
    expect(await periodsOf(oneOff)).toEqual([]);
    expect((await statusOf(oneOff)).serviceStatus).toBe('active');
    // Начало в будущем — «Приостановлен» до него (прототип cpStatus).
    const later = await contractor({ startDate: '2026-12-01' });
    expect((await statusOf(later)).serviceStatus).toBe('paused');
    expect(await periodsOf(later)).toEqual([{ from: '2026-12', to: null }]);
    // Первый период ставит база, кто бы ни создавал запись (наполнение, тесты других модулей).
    const [direct] = await db.admin.db
      .insert(contractors)
      .values({
        orgId: a.orgId,
        name: 'ИП Прямой',
        inn: `0${++inn}`,
        phone: '+996505890076',
        formCode: 'ФС-01',
        startDate: '2025-03-31',
      })
      .returning({ id: contractors.id });
    expect(await periodsOf(direct!.id)).toEqual([{ from: '2025-03', to: null }]);
  });

  it('запланированная приостановка: отчёты не создаются, статус меняет задача в декабре', async () => {
    const id = await contractor();
    const { version } = await statusOf(id);
    const effect = await act(
      id,
      { kind: 'pause', from: '2026-12', resume: '2027-05', reason: 'Сезонная деятельность' },
      TODAY,
      version,
    );
    expect(effect).toMatchObject({ notRequired: 0, restored: 0 });
    expect(await periodsOf(id)).toEqual([
      { from: '2024-07', to: '2026-11' },
      { from: '2027-05', to: null },
    ]);
    const row = await statusOf(id);
    expect(row.serviceStatus).toBe('active');
    expect(row.version).toBe(version + 1);
    const history = await inA((tx) => readHistory(tx, 'contractor', id));
    expect(history.at(-1)).toMatchObject({
      action: 'update',
      reason: 'Сезонная деятельность',
      changes: expect.arrayContaining([
        { field: 'servicePeriods', from: '07.2024–…', to: '07.2024–11.2026, 05.2027–…' },
      ]),
    });
    // Устаревшая версия окна — «изменено другим пользователем».
    await expect(act(id, { kind: 'cancel_pause' }, TODAY, version)).rejects.toBeInstanceOf(
      RecordChangedError,
    );

    // Декабрь: отчёты за месяцы паузы не создаются, статус сверяет задача по расписанию.
    expect(
      await inA(async (tx) => {
        await createDueReports(tx, { today: '2026-12-02', contractorIds: [id] });
        return null;
      }),
    ).toBeNull();
    expect(Object.keys(await statusesOf(id))).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(await sync('2026-12-02')).toMatchObject({ paused: expect.any(Number) });
    expect((await statusOf(id)).serviceStatus).toBe('paused');
    const svc = await inA((tx) => readStatusHistory(tx, 'service', id));
    expect(svc.at(-1)).toMatchObject({
      from: 'active',
      to: 'paused',
      reason: 'С декабря 2026, возобновление с мая 2027. Причина: Сезонная деятельность',
      actor: null,
    });
    // Повтор ничего не меняет; в мае — возобновление.
    await sync('2026-12-03');
    expect(await inA((tx) => readStatusHistory(tx, 'service', id))).toHaveLength(svc.length);
    await sync('2027-05-01');
    expect((await statusOf(id)).serviceStatus).toBe('active');
    expect((await inA((tx) => readStatusHistory(tx, 'service', id))).at(-1)).toMatchObject({
      to: 'active',
      reason: 'Возобновление с мая 2027',
    });
  });

  it('приостановка с идущего месяца: несданные отчёты «Не требуется», возобновление возвращает их', async () => {
    const id = await contractor();
    expect(await statusesOf(id)).toMatchObject({ '2026-10': 'todo', '2026-11': 'todo' });
    // «Не требуется», поставленное вручную, при возобновлении не возвращается.
    const manual = (await reportsOf(id)).find((r) => r.start === '2026-11-01')!;
    const effect = await act(id, { kind: 'pause', from: '2026-10', resume: null, reason: '' });
    expect(effect).toMatchObject({ notRequired: 2, restored: 0, created: 0, open: 3 });
    expect((await statusOf(id)).serviceStatus).toBe('paused');
    expect((await inA((tx) => readStatusHistory(tx, 'service', id))).at(-1)).toMatchObject({
      from: 'active',
      to: 'paused',
      reason: 'С октября 2026',
    });
    const reportHistory = await inA((tx) =>
      tx
        .select({ cause: statusHistory.cause, reason: statusHistory.reason })
        .from(statusHistory)
        .where(and(eq(statusHistory.scale, 'report'), eq(statusHistory.entityId, manual.id)))
        .orderBy(asc(statusHistory.id)),
    );
    expect(reportHistory.at(-1)).toEqual({
      cause: 'service',
      reason: 'Обслуживание контрагента приостановлено',
    });
    // Пользователь снимает «Не требуется» и ставит снова — уже своё.
    await inA(async (tx) => {
      await writeStatusChange(
        tx,
        { scale: 'report', entityId: manual.id, from: 'not_required', to: 'todo', reason: 'x', rollback: true },
        { scale: 'report', entityId: manual.id, from: 'todo', to: 'not_required' },
      );
    });

    const resumed = await act(id, { kind: 'resume', from: '2026-11' });
    expect(resumed).toMatchObject({ restored: 0 });
    expect(await periodsOf(id)).toEqual([
      { from: '2024-07', to: '2026-09' },
      { from: '2026-11', to: null },
    ]);
    expect((await statusOf(id)).serviceStatus).toBe('paused');
    expect(await statusesOf(id)).toMatchObject({ '2026-10': 'not_required', '2026-11': 'not_required' });

    // Обслуживание продолжается с идущего месяца: октябрь возвращается в «К сдаче».
    const again = await act(id, { kind: 'resume', from: '2026-10' });
    expect(again).toMatchObject({ restored: 1 });
    expect(await periodsOf(id)).toEqual([{ from: '2024-07', to: null }]);
    expect((await statusOf(id)).serviceStatus).toBe('active');
    expect(await statusesOf(id)).toMatchObject({ '2026-10': 'todo', '2026-11': 'not_required' });
  });

  it('правила: прошлый месяц, повторная приостановка, разовый, область', async () => {
    const id = await contractor();
    const refused = (code: string) => expect.objectContaining({ name: 'ServiceRefusedError', code });
    await expect(act(id, { kind: 'pause', from: '2026-09', resume: null, reason: '' })).rejects.toEqual(
      refused('service_month_in_past'),
    );
    await expect(act(id, { kind: 'resume', from: '2026-11' })).rejects.toEqual(
      refused('service_not_paused'),
    );
    await expect(act(id, { kind: 'cancel_pause' })).rejects.toBeInstanceOf(ServiceRefusedError);
    await expect(act(id, { kind: 'unarchive' })).rejects.toBeInstanceOf(ContractorNotArchivedError);
    await expect(
      act(id, { kind: 'to_regular', from: '2026-11', tariff: null }),
    ).rejects.toBeInstanceOf(ContractorRegularError);
    const oneOff = await contractor({ kind: 'oneoff' });
    await expect(
      act(oneOff, { kind: 'pause', from: '2026-11', resume: null, reason: '' }),
    ).rejects.toBeInstanceOf(ContractorOneOffError);
    // Вне области «Свои» и в чужой организации — «не найден».
    await expect(
      inA((tx) =>
        changeService(tx, id, { kind: 'archive' }, {
          today: TODAY,
          scope: contractorScope('00000000-0000-4000-8000-000000000000'),
          version: null,
          texts: TEXTS,
        }),
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      inB((tx) =>
        changeService(tx, id, { kind: 'archive' }, { today: TODAY, scope: undefined, version: null, texts: TEXTS }),
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('отмена запланированной приостановки: обслуживание без перерыва', async () => {
    const id = await contractor();
    await act(id, { kind: 'pause', from: '2026-11', resume: null, reason: '' });
    expect(await statusesOf(id)).toMatchObject({ '2026-10': 'todo', '2026-11': 'not_required' });
    const effect = await act(id, { kind: 'cancel_pause' });
    expect(effect).toMatchObject({ restored: 1 });
    expect(await periodsOf(id)).toEqual([{ from: '2024-07', to: null }]);
    expect(await statusesOf(id)).toMatchObject({ '2026-10': 'todo', '2026-11': 'todo' });
    const history = await inA((tx) => readHistory(tx, 'contractor', id));
    expect(history.at(-1)!.changes).toEqual(
      expect.arrayContaining([{ field: 'pauseCancelled', to: true }]),
    );
  });

  it('откат действующей приостановки: досоздать отчёты за отмеченные месяцы', async () => {
    const id = await contractor({}, '2026-05-01');
    // Приостановка с августа сделана в июле (отчёты за август тогда стали «Не требуется»).
    await act(id, { kind: 'pause', from: '2026-08', resume: '2027-03', reason: '' }, '2026-07-20');
    await db.admin.db
      .delete(reports)
      .where(and(eq(reports.contractorId, id), eq(reports.periodStart, '2026-09-01')));
    expect(await statusesOf(id)).toMatchObject({ '2026-08': 'not_required', '2026-10': 'not_required' });
    await sync(TODAY);
    expect((await statusOf(id)).serviceStatus).toBe('paused');

    await expect(
      act(id, { kind: 'rollback', reason: 'По ошибке', fill: ['2026-07'] }),
    ).rejects.toEqual(expect.objectContaining({ code: 'service_fill_not_skipped' }));
    const effect = await act(id, { kind: 'rollback', reason: 'По ошибке', fill: ['2026-08', '2026-09'] });
    expect(await periodsOf(id)).toEqual([{ from: '2024-07', to: null }]);
    expect(effect).toMatchObject({ restored: 3, created: 1 });
    expect(await statusesOf(id)).toMatchObject({
      '2026-08': 'todo',
      '2026-09': 'todo',
      '2026-10': 'todo',
      '2026-11': 'todo',
    });
    expect((await statusOf(id)).serviceStatus).toBe('active');
    expect((await inA((tx) => readStatusHistory(tx, 'service', id))).at(-1)).toMatchObject({
      from: 'paused',
      to: 'active',
      rollback: true,
      reason: 'По ошибке',
    });
  });

  it('архив: отчёты после текущего месяца «Не требуется», возврат продолжает с текущего периода', async () => {
    const id = await contractor();
    expect(await statusesOf(id)).toMatchObject({ '2026-10': 'todo', '2026-11': 'todo' });
    const archived = await act(id, { kind: 'archive' });
    expect(archived).toMatchObject({ notRequired: 1, open: 4 });
    expect(await periodsOf(id)).toEqual([{ from: '2024-07', to: '2026-10' }]);
    expect((await statusOf(id)).serviceStatus).toBe('archived');
    // Несданные за обслуженные месяцы остаются к сдаче.
    expect(await statusesOf(id)).toMatchObject({ '2026-10': 'todo', '2026-11': 'not_required' });
    await expect(
      act(id, { kind: 'pause', from: '2026-11', resume: null, reason: '' }),
    ).rejects.toBeInstanceOf(ContractorArchivedError);
    // Отчёты архивного по расписанию не создаются.
    await inA((tx) => createDueReports(tx, { today: '2026-12-02', contractorIds: [id] }));
    expect(Object.keys(await statusesOf(id))).not.toContain('2026-12');

    const back = await act(id, { kind: 'unarchive' }, '2026-12-02');
    expect(await periodsOf(id)).toEqual([
      { from: '2024-07', to: '2026-10' },
      { from: '2026-12', to: null },
    ]);
    expect(back.created).toBe(2);
    expect((await statusOf(id)).serviceStatus).toBe('active');
    expect((await inA((tx) => readStatusHistory(tx, 'service', id))).at(-1)).toMatchObject({
      from: 'archived',
      to: 'active',
    });
  });

  it('возврат из архива в том же месяце: «Не требуется» от архива снова «К сдаче»', async () => {
    const id = await contractor();
    await act(id, { kind: 'archive' });
    const back = await act(id, { kind: 'unarchive' });
    expect(back).toMatchObject({ restored: 1 });
    expect(await periodsOf(id)).toEqual([{ from: '2024-07', to: null }]);
    expect(await statusesOf(id)).toMatchObject({ '2026-10': 'todo', '2026-11': 'todo' });
  });

  it('разовый → постоянный: тип, начало, режим, ставка и периоды', async () => {
    const id = await contractor({ kind: 'oneoff', startDate: '2026-04-12', regimeCode: null });
    await act(id, {
      kind: 'to_regular',
      from: '2026-11',
      regimeCode: 'РЕЖ-01',
      tariff: { amount: 1_500_000, period: 'M', note: 'Переход на постоянное обслуживание' },
    });
    const row = await statusOf(id);
    expect(row).toMatchObject({
      kind: 'regular',
      startDate: '2026-11-01',
      regimeCode: 'РЕЖ-01',
      serviceStatus: 'paused',
    });
    expect(await periodsOf(id)).toEqual([{ from: '2026-11', to: null }]);
    const tariffs = await inA((tx) =>
      tx.select().from(contractorTariffs).where(eq(contractorTariffs.contractorId, id)),
    );
    expect(tariffs).toMatchObject([{ amount: 1_500_000, period: 'M', validFrom: '2026-11-01' }]);
    expect((await inA((tx) => readStatusHistory(tx, 'service', id))).at(-1)).toMatchObject({
      from: 'active',
      to: 'paused',
      reason: 'Постоянное обслуживание с ноября 2026',
    });
  });

  it('чужая организация не видна: периоды обслуживания', async () => {
    const id = await contractor();
    expect(await inB((tx) => tx.select().from(contractorServicePeriods))).toEqual([]);
    expect(await db.app.db.select().from(contractorServicePeriods)).toEqual([]);
    await expect(
      inB((tx) =>
        tx
          .insert(contractorServicePeriods)
          .values({ orgId: a.orgId, contractorId: id, fromMonth: '2027-01-01' }),
      ),
    ).rejects.toEqual(permissionDenied);
    const changed = await inB((tx) =>
      tx
        .update(contractorServicePeriods)
        .set({ toMonth: '2026-12-01' })
        .where(eq(contractorServicePeriods.contractorId, id))
        .returning(),
    );
    expect(changed).toEqual([]);
    expect(await periodsOf(id)).toEqual([{ from: '2024-07', to: null }]);
  });

  it('база не даёт двух открытых периодов и конца раньше начала', async () => {
    const id = await contractor();
    await expect(
      db.admin.db.execute(
        sql`insert into contractor_service_periods (org_id, contractor_id, from_month) values (${a.orgId}, ${id}, '2027-01-01')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.admin.db.execute(
        sql`insert into contractor_service_periods (org_id, contractor_id, from_month, to_month) values (${a.orgId}, ${id}, '2027-01-01', '2026-12-01')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.admin.db.execute(
        sql`insert into contractor_service_periods (org_id, contractor_id, from_month, to_month) values (${a.orgId}, ${id}, '2027-01-15', null)`,
      ),
    ).rejects.toThrow();
  });
});
