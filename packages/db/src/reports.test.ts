import {
  formatText,
  KB_STEP_RULES,
  RecordNotFoundError,
  UI_TEXTS,
  type ListQuery,
} from '@buhuchet/domain';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import {
  assignContractors,
  contractorScope,
  contractorUsage,
  createContractor,
  getContractor,
  transferPreview,
  updateContractor,
  type ContractorFields,
} from './contractors';
import { readHistory } from './history';
import { kbDoneFacts } from './kb';
import {
  exportReports,
  getReportRow,
  listReportsPage,
  listReportValues,
  reportScope,
  reportSummary,
  type ReportListOptions,
} from './report-list';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  activeAssignmentCounts,
  AssignmentChangedError,
  assignmentPreview,
  AssignmentEndedError,
  AssignmentExistsError,
  changeReportDue,
  ContractorArchivedError,
  ContractorOneOffError,
  contractorReportCount,
  createAssignment,
  createDueReports,
  createManualReport,
  createRevision,
  endAssignment,
  listAssignments,
  moveUnfinishedReports,
  ReportChangedError,
  ReportExistsError,
  ReportStateError,
  unfinishedReportsCount,
  updateAssignment,
  type AssignmentInput,
  type AssignmentTexts,
} from './reports';
import { assignments, reportDueChanges, reports } from './schema';
import { readSpecJson } from './spec-data';
import { seedPermissions, seedRoleTemplates } from './seed';
import { createEmployee } from './staff';
import { readStatusHistory } from './status';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-27';
const TEXTS: AssignmentTexts = {
  ended: 'Назначение снято',
  restored: 'Назначено снова',
  until: 'Позже «до какого периода»',
  past: 'Создан за прошлый период при назначении',
  pastMarked: 'Создан за прошлый период и отмечен сданным при назначении',
  pastConfirmed: 'Создан за прошлый период и отмечен сданным и подтверждённым при назначении',
  pastConfirmNote: 'Прошлый период отмечен при назначении',
  ownRuleChanged: 'В назначении изменены периодичность или срок — отчёт создан заново',
};
const t = (key: string, params?: Record<string, string | number>) =>
  formatText((UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key, params);
const lctx = (scope?: SQL) => ({ scope, today: TODAY, t });
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

const input = (patch: Partial<AssignmentInput> = {}): AssignmentInput => ({
  fromMonth: '2026-10-01',
  untilMonth: null,
  responsibleEmployeeId: null,
  rate: '12 %',
  enRates: [],
  rateAdditions: [],
  dueDay: null,
  ownPeriod: null,
  ownDay: null,
  ownMonth: null,
  fixedAmount: null,
  note: '',
  ...patch,
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

describe.skipIf(!databaseAvailable())('Отчёты: назначения и отчёты к сдаче', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA = '';
  let chiefA = '';
  let cpA = '';
  let cpChief = '';
  let cpBig = '';
  let cpB = '';
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctxA(), fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const ctx = (
    patch: {
      markPast?: boolean;
      confirm?: boolean;
      scope?: ReturnType<typeof contractorScope>;
    } = {},
  ) => ({
    today: TODAY,
    scope: undefined,
    markPast: false,
    confirm: false,
    texts: TEXTS,
    ...patch,
  });
  const reportsOf = (contractorId: string, typeCode: string) =>
    inA((tx) =>
      tx
        .select()
        .from(reports)
        .where(and(eq(reports.contractorId, contractorId), eq(reports.reportTypeCode, typeCode)))
        .orderBy(asc(reports.periodStart), asc(reports.revision)),
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({
      fullName: 'Владелец Организации',
      login,
      passwordHash: 'x',
    });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'rep-a',
      owner: owner('rep-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'rep-b',
      owner: owner('rep-owner-b'),
    });
    const role = (code: string) => a.roles.find((r) => r.templateCode === code)!;
    [accA, chiefA] = await inA(async (tx) => [
      await createEmployee(tx, {
        fullName: 'Токтогулов Алишер Бакытович',
        shortName: 'Алишер Т.',
        login: 'rep-acc-a',
        passwordHash: 'x',
        phone: null,
        role: role('acc'),
      }),
      await createEmployee(tx, {
        fullName: 'Кадырова Мээрим Асановна',
        shortName: 'Мээрим К.',
        login: 'rep-chief-a',
        passwordHash: 'x',
        phone: null,
        role: role('chief'),
      }),
    ]);
    [cpA, cpChief, cpBig] = await inA(async (tx) => [
      await createContractor(tx, a.orgId, fields({ responsibleEmployeeId: accA }), null),
      await createContractor(
        tx,
        a.orgId,
        fields({ name: 'ИП Садыков', inn: '20101199000123', responsibleEmployeeId: chiefA }),
        null,
      ),
      await createContractor(
        tx,
        a.orgId,
        fields({
          name: 'ОАО «Крупный»',
          inn: '01504200510012',
          responsibleEmployeeId: accA,
          benefits: [{ code: 'ЛЬГ-30', validFrom: null, validTo: null }],
        }),
        null,
      ),
    ]);
    cpB = await inB((tx) => createContractor(tx, b.orgId, fields(), null));
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('назначение создаёт отчёты на текущий и следующий период со сроками вида', async () => {
    const { assignment, effect } = await inA((tx) =>
      createAssignment(tx, { ...input(), contractorId: cpA, reportTypeCode: 'nds' }, ctx()),
    );
    expect(effect).toMatchObject({ created: 2, past: 0, restored: 0 });
    const rows = await reportsOf(cpA, 'nds');
    expect(
      rows.map((r) => [
        r.periodStart,
        r.dueBase,
        r.dueDate,
        r.payDue,
        r.status,
        r.responsibleEmployeeId,
      ]),
    ).toEqual([
      ['2026-10-01', '2026-11-25', '2026-11-25', '2026-11-25', 'todo', accA],
      ['2026-11-01', '2026-12-25', '2026-12-25', '2026-12-25', 'todo', accA],
    ]);
    expect(rows.every((r) => r.assignmentId === assignment.id && r.period === 'M')).toBe(true);
    const status = await inA((tx) => readStatusHistory(tx, 'report', rows[0]!.id));
    expect(status).toEqual([expect.objectContaining({ from: null, to: 'todo' })]);
    const [history] = await inA((tx) => readHistory(tx, 'assignment', assignment.id));
    expect(history).toMatchObject({ action: 'create', contractorId: cpA });
    expect(history!.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['reportTypeCode', 'fromMonth', 'rate']),
    );
    // Тот же вид второй раз не назначается.
    await expect(
      inA((tx) =>
        createAssignment(tx, { ...input(), contractorId: cpA, reportTypeCode: 'nds' }, ctx()),
      ),
    ).rejects.toBeInstanceOf(AssignmentExistsError);
    expect(await inA((tx) => listAssignments(tx, cpA, lctx()))).toEqual([
      expect.objectContaining({
        reportTypeCode: 'nds',
        reportTypeName: 'НДС',
        endedOn: null,
        responsible: { id: accA, shortName: expect.any(String) },
      }),
    ]);
  });

  it('повторный запуск расписания не создаёт дублей, в том числе одновременный', async () => {
    expect(await inA((tx) => createDueReports(tx, { today: TODAY }))).toBe(0);
    const [x, y] = await Promise.all([
      inA((tx) => createDueReports(tx, { today: '2026-11-02' })),
      inA((tx) => createDueReports(tx, { today: '2026-11-02' })),
    ]);
    // В ноябре добавляется только декабрь — одним из двух запусков.
    expect(x + y).toBe(1);
    expect((await reportsOf(cpA, 'nds')).map((r) => r.periodStart)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ]);
  });

  it('статус со своим сроком: крупный налогоплательщик сдаёт НДС до 30.11, платит до 25.11 (п. 52)', async () => {
    await inA((tx) =>
      createAssignment(tx, { ...input(), contractorId: cpBig, reportTypeCode: 'nds' }, ctx()),
    );
    const [october] = await reportsOf(cpBig, 'nds');
    expect([october!.dueDate, october!.payDue]).toEqual(['2026-11-30', '2026-11-25']);
    // Строка «Сдаёт отчёты»: срок словами по статусу и метка «по статусу» (прототип contractor-card).
    expect(await inA((tx) => listAssignments(tx, cpBig, lctx()))).toEqual([
      expect.objectContaining({
        reportTypeCode: 'nds',
        authority: 'ГНС',
        dueText: 'до последнего дня месяца после отчётного',
        dueStatus: { code: 'ЛЬГ-30', name: 'Крупный налогоплательщик' },
        period: 'M',
        periodInAssignment: false,
        oneOff: false,
        act: 'both',
        typeActive: true,
      }),
    ]);
  });

  it('прошлые периоды: отчёты создаются, с отметкой — сразу «Сдан» и «Подтверждено»', async () => {
    const preview = (fromMonth: string | null) =>
      inA((tx) =>
        assignmentPreview(
          tx,
          {
            ...input({ rate: null }),
            fromMonth,
            contractorId: cpA,
            reportTypeCode: 'soc',
          },
          { today: TODAY, scope: undefined },
        ),
      );
    // По умолчанию — текущий месяц: прошлых периодов нет.
    expect(await preview(null)).toEqual({
      defaultFrom: '2026-10-01',
      fromMonth: '2026-10-01',
      missing: [],
    });
    expect((await preview('2026-07-01')).missing).toEqual([
      { period: 'M', start: '2026-07-01' },
      { period: 'M', start: '2026-08-01' },
      { period: 'M', start: '2026-09-01' },
    ]);
    const { effect } = await inA((tx) =>
      createAssignment(
        tx,
        {
          ...input({ fromMonth: '2026-07-01', rate: null }),
          contractorId: cpA,
          reportTypeCode: 'soc',
        },
        ctx({ markPast: true, confirm: true }),
      ),
    );
    expect(effect).toMatchObject({ created: 2, past: 3 });
    const rows = await reportsOf(cpA, 'soc');
    expect(rows.map((r) => [r.periodStart, r.status, r.submittedOn, r.amount])).toEqual([
      ['2026-07-01', 'submitted', '2026-08-20', 0],
      ['2026-08-01', 'submitted', '2026-09-20', 0],
      ['2026-09-01', 'submitted', '2026-10-20', 0],
      ['2026-10-01', 'todo', null, null],
      ['2026-11-01', 'todo', null, null],
    ]);
    expect(rows[0]!.confirmedBy).toBe(a.ownerUserId);
    expect(rows[0]!.confirmNote).toBe(TEXTS.pastConfirmNote);
    const status = await inA((tx) => readStatusHistory(tx, 'report', rows[0]!.id));
    expect(status).toEqual([
      expect.objectContaining({ from: null, to: 'submitted', reason: TEXTS.pastConfirmed }),
    ]);
    expect((await preview('2026-07-01')).missing).toEqual([]);
  });

  it('снятие назначения: несданные со сроком впереди — «Не требуется», повторное назначение возвращает', async () => {
    const [current] = await inA((tx) => listAssignments(tx, cpA, lctx())).then((list) =>
      list.filter((x) => x.reportTypeCode === 'soc'),
    );
    const { notRequired } = await inA((tx) =>
      endAssignment(tx, current!.id, {
        version: current!.version,
        today: TODAY,
        scope: undefined,
        texts: TEXTS,
      }),
    );
    expect(notRequired).toBe(2);
    expect((await reportsOf(cpA, 'soc')).map((r) => r.status)).toEqual([
      'submitted',
      'submitted',
      'submitted',
      'not_required',
      'not_required',
    ]);
    await expect(
      inA((tx) =>
        endAssignment(tx, current!.id, {
          version: current!.version + 1,
          today: TODAY,
          scope: undefined,
          texts: TEXTS,
        }),
      ),
    ).rejects.toBeInstanceOf(AssignmentEndedError);
    const notRequiredId = (await reportsOf(cpA, 'soc'))[3]!.id;
    expect(await inA((tx) => readStatusHistory(tx, 'report', notRequiredId))).toEqual([
      expect.objectContaining({ to: 'todo' }),
      expect.objectContaining({ from: 'todo', to: 'not_required', reason: TEXTS.ended }),
    ]);

    const { effect } = await inA((tx) =>
      createAssignment(
        tx,
        {
          ...input({ fromMonth: '2026-10-01', rate: null }),
          contractorId: cpA,
          reportTypeCode: 'soc',
        },
        ctx(),
      ),
    );
    expect(effect).toMatchObject({ restored: 2, created: 0, past: 0 });
    expect((await reportsOf(cpA, 'soc')).map((r) => r.status).slice(3)).toEqual(['todo', 'todo']);
    const list = await inA((tx) => listAssignments(tx, cpA, lctx()));
    expect(list.filter((x) => x.reportTypeCode === 'soc').map((x) => x.endedOn)).toEqual([
      null,
      TODAY,
    ]);
  });

  it('«Изменить» назначение: новые сроки и ответственный несданных, «до какого периода», повторяющаяся сумма', async () => {
    const [nds] = (await inA((tx) => listAssignments(tx, cpA, lctx()))).filter(
      (x) => x.reportTypeCode === 'nds',
    );
    await expect(
      inA((tx) =>
        updateAssignment(tx, nds!.id, { dueDay: 15 }, { ...ctx(), version: nds!.version + 5 }),
      ),
    ).rejects.toBeInstanceOf(AssignmentChangedError);
    const { effect } = await inA((tx) =>
      updateAssignment(
        tx,
        nds!.id,
        {
          dueDay: 15,
          untilMonth: '2026-11-01',
          responsibleEmployeeId: chiefA,
          fixedAmount: 125_050,
        },
        { ...ctx(), version: nds!.version },
      ),
    );
    expect(effect).toMatchObject({ notRequired: 1, created: 0 });
    const rows = await reportsOf(cpA, 'nds');
    expect(
      rows.map((r) => [
        r.periodStart,
        r.dueDate,
        r.status,
        r.responsibleEmployeeId,
        r.amount,
        r.amountAuto,
      ]),
    ).toEqual([
      // 15.11 — воскресенье: срок переносится на понедельник 16.11; оплата своим правилом — 25.11.
      ['2026-10-01', '2026-11-16', 'todo', chiefA, 125_050, true],
      ['2026-11-01', '2026-12-15', 'todo', chiefA, 125_050, true],
      ['2026-12-01', '2027-01-25', 'not_required', accA, null, false],
    ]);
    expect(rows[0]!.payDue).toBe('2026-11-25');
    const history = await inA((tx) => readHistory(tx, 'assignment', nds!.id));
    expect(
      history
        .find((h) => h.action === 'update')!
        .changes.map((c) => c.field)
        .sort(),
    ).toEqual(['dueDay', 'fixedAmount', 'responsibleEmployeeId', 'untilMonth'].sort());
  });

  it('«Изменить срок»: причина в журнал и историю, ручной срок не пересчитывается', async () => {
    const [october] = await reportsOf(cpA, 'nds');
    await expect(
      inA((tx) =>
        changeReportDue(
          tx,
          october!.id,
          {
            due: '2026-12-01',
            reasonCode: 'ПРЧ-001',
            reasonName: 'Продление от госоргана',
            comment: '',
          },
          { today: TODAY, version: october!.version + 1, scope: undefined },
        ),
      ),
    ).rejects.toBeInstanceOf(ReportChangedError);
    const updated = await inA((tx) =>
      changeReportDue(
        tx,
        october!.id,
        {
          due: '2026-12-01',
          reasonCode: 'ПРЧ-001',
          reasonName: 'Продление от госоргана',
          comment: 'письмо ГНС',
        },
        { today: TODAY, version: october!.version, scope: undefined },
      ),
    );
    // У НДС своё правило уплаты: срок уплаты не меняется вместе со сроком сдачи.
    expect(october!.payDue).not.toBeNull();
    expect(updated).toMatchObject({
      dueDate: '2026-12-01',
      payDue: october!.payDue,
      dueManual: true,
      version: october!.version + 1,
    });
    const journal = await inA((tx) =>
      tx.select().from(reportDueChanges).where(eq(reportDueChanges.reportId, october!.id)),
    );
    expect(journal).toEqual([
      expect.objectContaining({
        fromDue: '2026-11-16',
        toDue: '2026-12-01',
        reasonCode: 'ПРЧ-001',
        comment: 'письмо ГНС',
        createdBy: a.ownerUserId,
      }),
    ]);
    const [history] = await inA((tx) => readHistory(tx, 'report', october!.id));
    expect(history).toMatchObject({
      reason: 'Продление от госоргана, письмо ГНС',
      contractorId: cpA,
    });
    // Новое правило назначения не трогает ручной срок.
    const [nds] = (await inA((tx) => listAssignments(tx, cpA, lctx()))).filter(
      (x) => x.reportTypeCode === 'nds',
    );
    await inA((tx) =>
      updateAssignment(tx, nds!.id, { dueDay: 20 }, { ...ctx(), version: nds!.version }),
    );
    const [after, november] = await reportsOf(cpA, 'nds');
    expect([after!.dueDate, november!.dueDate]).toEqual(['2026-12-01', '2026-12-21']);
    // Записи журнала не меняются и не удаляются.
    await expect(inA((tx) => tx.update(reportDueChanges).set({ comment: 'x' }))).rejects.toEqual(
      permissionDenied,
    );
    await expect(inA((tx) => tx.delete(reportDueChanges))).rejects.toEqual(permissionDenied);
  });

  it('у сданного срок не меняется; уточнённый — новая версия того же периода', async () => {
    const [july] = await reportsOf(cpA, 'soc');
    const change = (id: string, version: number, due = '2026-12-01') =>
      inA((tx) =>
        changeReportDue(
          tx,
          id,
          {
            due,
            reasonCode: 'ПРЧ-003',
            reasonName: 'Ошибка в расчёте срока',
            comment: '',
          },
          { today: TODAY, version, scope: undefined },
        ),
      );
    await expect(change(july!.id, july!.version)).rejects.toEqual(
      expect.objectContaining({ reason: 'not_open' }),
    );
    const revision = await inA((tx) =>
      createRevision(tx, july!.id, { version: july!.version, today: TODAY, scope: undefined }),
    );
    // Срок прежней версии прошёл: через 10 дней.
    expect(revision).toMatchObject({
      revision: 1,
      periodStart: '2026-07-01',
      status: 'todo',
      dueDate: '2026-11-06',
      payDue: '2026-11-06',
      amount: null,
    });
    const versions = (await reportsOf(cpA, 'soc')).filter((r) => r.periodStart === '2026-07-01');
    expect(versions.map((r) => [r.revision, r.superseded, r.status])).toEqual([
      [0, true, 'submitted'],
      [1, false, 'todo'],
    ]);
    // Шаг «Базы знаний» «Создать уточнённый отчёт» засчитывается тому, кто его создал (задача 2.13).
    const ver = [{ id: 'ver', rule: KB_STEP_RULES.ver!.done! }];
    expect([...(await inA((tx) => kbDoneFacts(tx, ctxA().userId, ver))).keys()]).toEqual(['ver']);
    expect((await inB((tx) => kbDoneFacts(tx, ctxA().userId, ver))).size).toBe(0);
    await expect(
      inA((tx) =>
        createRevision(tx, july!.id, {
          version: july!.version + 1,
          today: TODAY,
          scope: undefined,
        }),
      ),
    ).rejects.toBeInstanceOf(ReportStateError);
    await expect(
      inA((tx) =>
        createRevision(tx, revision.id, {
          version: revision.version,
          today: TODAY,
          scope: undefined,
        }),
      ),
    ).rejects.toEqual(expect.objectContaining({ reason: 'not_submitted' }));
    // У Соцфонда уплата идёт по сроку сдачи (своего правила уплаты нет) — меняется вместе с ним.
    const moved = await change(revision.id, revision.version);
    expect(moved).toMatchObject({ dueDate: '2026-12-01', payDue: '2026-12-01' });
    expect(await change(revision.id, moved.version, '2026-11-06')).toMatchObject({
      dueDate: '2026-11-06',
      payDue: '2026-11-06',
    });
  });

  it('«Разовый отчёт»: срок от даты события (п. 55), за прошлый месяц, без дублей', async () => {
    const manual = (patch: Partial<Parameters<typeof createManualReport>[1]>) =>
      inA((tx) =>
        createManualReport(
          tx,
          {
            contractorId: cpA,
            reportTypeCode: 'utli',
            month: null,
            eventDate: '2026-11-05',
            due: null,
            reasonCode: 'ПРЧ-001',
            reasonName: 'Продление от госоргана',
            ...patch,
          },
          { today: TODAY, scope: undefined },
        ),
      );
    expect(await manual({})).toMatchObject({
      period: 'M',
      periodStart: '2026-11-01',
      eventDate: '2026-11-05',
      dueDate: '2026-11-20',
      payDue: '2026-11-20',
      dueManual: false,
      assignmentId: null,
      responsibleEmployeeId: accA,
    });
    expect(await manual({ eventDate: '2026-11-18' })).toMatchObject({ dueDate: '2026-12-03' });
    await expect(manual({})).rejects.toBeInstanceOf(ReportExistsError);
    // Срок у разового вида — только у сдачи; у вида «Оплата» его не меняют.
    const [first] = await reportsOf(cpA, 'utli');
    await expect(
      inA((tx) =>
        changeReportDue(
          tx,
          first!.id,
          { due: '2026-12-01', reasonCode: 'ПРЧ-001', reasonName: 'x', comment: '' },
          { today: TODAY, version: first!.version, scope: undefined },
        ),
      ),
    ).rejects.toEqual(expect.objectContaining({ reason: 'pay_only' }));
    const journal = await inA((tx) =>
      tx.select().from(reportDueChanges).where(eq(reportDueChanges.reportId, first!.id)),
    );
    expect(journal).toEqual([expect.objectContaining({ fromDue: null, toDue: '2026-11-20' })]);
    const [history] = await inA((tx) => readHistory(tx, 'report', first!.id));
    expect(history).toMatchObject({ action: 'create', reason: 'Продление от госоргана' });
    // Уточнённого у вида «Уплата» нет: уточняют декларацию, а не платёж.
    const [paid] = await inA((tx) =>
      tx
        .update(reports)
        .set({ status: 'submitted', submittedOn: '2026-11-10' })
        .where(eq(reports.id, first!.id))
        .returning(),
    );
    await expect(
      inA((tx) =>
        createRevision(tx, first!.id, { version: paid!.version, today: TODAY, scope: undefined }),
      ),
    ).rejects.toEqual(expect.objectContaining({ reason: 'pay_only' }));
    await inA((tx) =>
      tx
        .update(reports)
        .set({ status: 'todo', submittedOn: null })
        .where(eq(reports.id, first!.id)),
    );

    // Пропущенный отчёт за прошлый месяц: срок задают руками.
    const past = await manual({
      reportTypeCode: 't1m',
      eventDate: null,
      month: '2026-06-01',
      due: '2026-11-03',
    });
    expect(past).toMatchObject({
      period: 'M',
      periodStart: '2026-06-01',
      dueDate: '2026-11-03',
      payDue: null,
    });
  });

  it('область «Свои контрагенты»: чужой контрагент сотрудника — «не найден»', async () => {
    const own = contractorScope(accA);
    await expect(
      inA((tx) =>
        createAssignment(
          tx,
          { ...input(), contractorId: cpChief, reportTypeCode: 'nds' },
          ctx({ scope: own }),
        ),
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await inA((tx) =>
      createAssignment(
        tx,
        { ...input({ rate: null }), contractorId: cpChief, reportTypeCode: 'soc' },
        ctx(),
      ),
    );
    const [chiefReport] = await reportsOf(cpChief, 'soc');
    await expect(
      inA((tx) =>
        createRevision(tx, chiefReport!.id, {
          version: chiefReport!.version,
          today: TODAY,
          scope: own,
        }),
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(inA((tx) => listAssignments(tx, cpChief, lctx(own)))).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('передача контрагента: незавершённые отчёты прежнего ответственного переходят к новому', async () => {
    expect(await inA((tx) => unfinishedReportsCount(tx, [cpChief], chiefA))).toBe(2);
    expect(
      await inA((tx) =>
        moveUnfinishedReports(tx, [{ contractorId: cpChief, from: chiefA, to: accA }]),
      ),
    ).toBe(2);
    expect((await reportsOf(cpChief, 'soc')).map((r) => r.responsibleEmployeeId)).toEqual([
      accA,
      accA,
    ]);
    expect(await inA((tx) => contractorReportCount(tx, cpChief))).toBe(2);
    expect(Object.fromEntries(await inA((tx) => activeAssignmentCounts(tx)))).toEqual({
      nds: 2,
      soc: 2,
    });
  });

  it('контрагент не на обслуживании: отчёты по расписанию не создаются', async () => {
    await db.admin.db.execute(
      sql`update contractors set service_status = 'paused' where id = ${cpBig}`,
    );
    // Декабрь и январь Соцфонда у двух контрагентов; НДС у первого закончился ноябрём.
    expect(await inA((tx) => createDueReports(tx, { today: '2026-12-02' }))).toBe(4);
    expect((await reportsOf(cpBig, 'nds')).map((r) => r.periodStart)).toEqual([
      '2026-10-01',
      '2026-11-01',
    ]);
    // Архивный контрагент — только чтение: ни назначений, ни разовых отчётов.
    await db.admin.db.execute(
      sql`update contractors set service_status = 'archived' where id = ${cpBig}`,
    );
    await expect(
      inA((tx) =>
        createAssignment(
          tx,
          { ...input({ rate: null }), contractorId: cpBig, reportTypeCode: 'npa' },
          ctx(),
        ),
      ),
    ).rejects.toBeInstanceOf(ContractorArchivedError);
    await expect(
      inA((tx) =>
        createManualReport(
          tx,
          {
            contractorId: cpBig,
            reportTypeCode: 'soc',
            month: '2026-06-01',
            eventDate: null,
            due: '2026-07-20',
            reasonCode: 'ПРЧ-001',
            reasonName: 'Причина',
          },
          { today: TODAY, scope: undefined },
        ),
      ),
    ).rejects.toBeInstanceOf(ContractorArchivedError);
    await db.admin.db.execute(
      sql`update contractors set service_status = 'paused' where id = ${cpBig}`,
    );
  });

  it('чужая организация не видна: назначения, отчёты, журнал сроков', async () => {
    const [mine] = await reportsOf(cpA, 'nds');
    const seen = await inB(async (tx) => ({
      assignments: await tx.select().from(assignments),
      reports: await tx.select().from(reports),
      journal: await tx.select().from(reportDueChanges),
    }));
    expect(seen).toEqual({ assignments: [], reports: [], journal: [] });
    await expect(
      inB((tx) =>
        changeReportDue(
          tx,
          mine!.id,
          { due: '2026-12-10', reasonCode: 'ПРЧ-001', reasonName: 'x', comment: '' },
          { today: TODAY, version: mine!.version, scope: undefined },
        ),
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(inB((tx) => listAssignments(tx, cpA, lctx()))).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    // Отчёт на контрагента чужой организации не вставить: составной ключ и RLS.
    await expect(
      inA((tx) =>
        tx.insert(reports).values({
          contractorId: cpB,
          reportTypeCode: 'nds',
          act: 'both',
          period: 'M',
          periodStart: '2026-10-01',
          dueBase: '2026-11-25',
          dueDate: '2026-11-25',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      inB((tx) =>
        tx.insert(reports).values({
          orgId: a.orgId,
          contractorId: cpA,
          reportTypeCode: 'nds',
          act: 'both',
          period: 'M',
          periodStart: '2027-03-01',
          dueBase: '2027-04-25',
          dueDate: '2027-04-25',
        }),
      ),
    ).rejects.toThrow();
    // Назначение чужой организации не меняется и не удаляется: RLS его не показывает.
    const changed = await inB(async (tx) => ({
      updated: await tx
        .update(assignments)
        .set({ note: 'чужая правка' })
        .where(eq(assignments.contractorId, cpA))
        .returning({ id: assignments.id }),
      deleted: await tx
        .delete(assignments)
        .where(eq(assignments.contractorId, cpA))
        .returning({ id: assignments.id }),
    }));
    expect(changed).toEqual({ updated: [], deleted: [] });
    expect((await inA((tx) => listAssignments(tx, cpA, lctx()))).length).toBeGreaterThan(0);
    // Запись журнала сроков на чужой отчёт не вставить: ни своим org_id, ни чужим.
    for (const orgId of [undefined, a.orgId]) {
      await expect(
        inB((tx) =>
          tx.insert(reportDueChanges).values({
            ...(orgId ? { orgId } : {}),
            reportId: mine!.id,
            fromDue: mine!.dueDate,
            toDue: '2026-12-31',
            reasonCode: 'ПРЧ-001',
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it('контрагента с отчётами удалить нельзя', async () => {
    await expect(
      inA((tx) => tx.execute(sql`delete from contractors where id = ${cpA}`)),
    ).rejects.toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({ constraint_name: expect.stringMatching(/^reports_/) }),
      }),
    );
  });
  it('список отчётов: столбцы словами, вкладки, область, группы и выгрузка', async () => {
    await inA((tx) =>
      createAssignment(
        tx,
        {
          ...input({ fromMonth: '2026-07-01', rate: '10 %' }),
          contractorId: cpChief,
          reportTypeCode: 'npa',
        },
        ctx(),
      ),
    );
    const today = '2026-11-16';
    const options = (patch: Partial<ReportListOptions> = {}): ReportListOptions => ({
      t,
      today,
      scope: undefined,
      tab: 'all',
      quick: 'all',
      waiting: { confirm: true, own: null },
      ...patch,
    });
    const summary = (scope: ReportListOptions['scope']) =>
      inA((tx) => reportSummary(tx, { scope, today, waiting: { confirm: true, own: null } }));
    expect(await summary(undefined)).toMatchObject({ overdue: 2, week: 3 });
    // Область «Свои» (п. А-2, вариант В): отчёты своих контрагентов и Соцфонд ИП Садыкова, который
    // перешёл к бухгалтеру при передаче, хотя контрагент закреплён за главным бухгалтером.
    expect(await summary(reportScope(accA))).toMatchObject({ overdue: 2, week: 2 });

    const overdue = await inA((tx) => listReportsPage(tx, query(), options({ tab: 'overdue' })));
    expect(
      overdue.rows.map((r) => [
        r.type.shortName,
        r.periodLabel,
        r.periodFull,
        r.days,
        r.overdue,
        r.revision,
      ]),
    ).toEqual([
      ['1-Т', '06.2026', 'Июнь 2026', -13, true, 0],
      ['Соцфонд', '07.2026', 'Июль 2026', -10, true, 1],
    ]);

    const all = await inA((tx) => listReportsPage(tx, query(), options()));
    // Прежняя версия уточнённого не видна.
    expect(
      all.rows.some(
        (r) => r.revision === 0 && r.periodStart === '2026-07-01' && r.type.code === 'soc',
      ),
    ).toBe(false);
    const npa = all.rows.find((r) => r.type.code === 'npa')!;
    expect([npa.periodLabel, npa.periodFull, npa.rate, npa.act]).toEqual([
      'III кв. 2026',
      'III квартал 2026',
      '10 %',
      'both',
    ]);
    const utli = all.rows.find((r) => r.type.code === 'utli' && r.eventDate === '2026-11-05')!;
    expect([utli.periodLabel, utli.periodFull, utli.pays]).toEqual([
      '11.2026 · 05.11',
      'Ноябрь 2026 · дата ввоза 05.11.2026',
      'Утилизационный сбор',
    ]);
    const nds = all.rows.find(
      (r) => r.type.code === 'nds' && r.contractor.id === cpA && r.periodStart === '2026-10-01',
    )!;
    expect(nds).toMatchObject({
      rate: '12 %',
      amount: 125_050,
      amountAuto: true,
      dueManual: true,
      responsible: { id: chiefA, shortName: 'Мээрим К.' },
      organ: 'ГНС',
    });
    expect(all.totals.amount).toBeGreaterThanOrEqual(125_050);

    const mine = await inA((tx) =>
      listReportsPage(tx, query(), options({ scope: reportScope(accA) })),
    );
    expect(new Set(mine.rows.map((r) => r.contractor.id))).toEqual(new Set([cpA, cpBig, cpChief]));
    expect(
      new Set(mine.rows.filter((r) => r.contractor.id === cpChief).map((r) => r.type.code)),
    ).toEqual(new Set(['soc']));

    const statuses = await inA((tx) => listReportValues(tx, 'status', options()));
    expect(statuses.items.map((v) => v.label)).toEqual(
      expect.arrayContaining(['К сдаче', 'Сдан', 'Не требуется']),
    );
    const grouped = await inA((tx) => listReportsPage(tx, query({ group: ['type'] }), options()));
    expect(grouped.groups!.map((g) => g.label)).toEqual(expect.arrayContaining(['НДС', 'Соцфонд']));
    const filtered = await inA((tx) =>
      listReportsPage(
        tx,
        query({ filters: { period: { type: 'enum', vals: ['2026-07-01'] } } }),
        options(),
      ),
    );
    expect(filtered.rows.map((r) => r.type.code).sort()).toEqual(['npa', 'soc']);

    const xls = await inA((tx) =>
      exportReports(tx, query(), ['cp', 'period', 'version'], options({ tab: 'overdue' })),
    );
    expect(xls.rows).toEqual([
      ['ОсОО «Ала-Тоо Трейд»', '06.2026', 'Первичный'],
      ['ОсОО «Ала-Тоо Трейд»', '07.2026', 'Уточнённый 1'],
    ]);
    expect(
      await inA((tx) => getReportRow(tx, npa.id, { t, today, scope: reportScope(accA) })),
    ).toBeNull();
    expect(
      await inA((tx) => getReportRow(tx, npa.id, { t, today, scope: undefined })),
    ).toMatchObject({
      id: npa.id,
    });
  });
  it('контрагент: снятый статус пересчитывает сроки, новый ответственный получает отчёты, удалить нельзя', async () => {
    const big = await inA((tx) => getContractor(tx, cpBig, { scope: undefined, today: TODAY }));
    await inA((tx) =>
      updateContractor(tx, a.orgId, cpBig, big!.version, { benefits: [] }, undefined, {
        today: TODAY,
        texts: {
          byStatus: 'Срок по статусу «{name}»',
          byCatalog: 'Срок по каталогу',
          byCatalogDropped: 'Срок по каталогу (снят статус «{name}»)',
        },
      }),
    );
    const [october] = await reportsOf(cpBig, 'nds');
    expect([october!.dueDate, october!.payDue]).toEqual(['2026-11-25', '2026-11-25']);
    const redue = (await inA((tx) => readHistory(tx, 'report', october!.id))).at(-1);
    expect(redue).toMatchObject({
      action: 'update',
      reason: 'Срок по каталогу (снят статус «Крупный налогоплательщик»)',
      changes: [{ field: 'dueDate', from: '2026-11-30', to: '2026-11-25' }],
      contractorId: cpBig,
    });

    expect(await inA((tx) => assignContractors(tx, [cpBig], chiefA, undefined))).toEqual({
      changed: 1,
      archived: [],
    });
    expect((await reportsOf(cpBig, 'nds')).map((r) => r.responsibleEmployeeId)).toEqual([
      chiefA,
      chiefA,
    ]);
    // У Мээрим: Соцфонд за декабрь и январь, налог на прибыль за III квартал, НДС крупного за два месяца.
    expect(await inA((tx) => transferPreview(tx, chiefA))).toMatchObject({
      contractors: 2,
      reports: 5,
    });
    expect((await inA((tx) => contractorUsage(tx, cpA))).reports).toBeGreaterThan(0);
  });

  it('новая периодичность в назначении: несданные со сроком впереди создаются заново', async () => {
    const cp = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ОсОО «Периоды»', inn: '01504200510099', responsibleEmployeeId: null }),
        null,
      ),
    );
    const { assignment } = await inA((tx) =>
      createAssignment(
        tx,
        {
          ...input({
            fromMonth: '2026-07-01',
            rate: null,
            ownPeriod: 'Q',
            ownDay: 15,
            ownMonth: 1,
          }),
          contractorId: cp,
          reportTypeCode: 'opu',
        },
        ctx(),
      ),
    );
    const before = await reportsOf(cp, 'opu');
    // III квартал — прошлый период (срок 15.10 прошёл), IV квартал — до 15.01.2027.
    expect(before.map((r) => [r.period, r.periodStart, r.dueDate])).toEqual([
      ['Q', '2026-07-01', '2026-10-15'],
      ['Q', '2026-10-01', '2027-01-15'],
    ]);
    await inA((tx) =>
      updateAssignment(
        tx,
        assignment.id,
        { ownPeriod: 'M', ownDay: 25, ownMonth: 1 },
        { ...ctx(), version: assignment.version },
      ),
    );
    // Просроченный III квартал остаётся (он же занимает июль); IV квартал создан заново помесячно, август
    // и сентябрь — недостающие прошлые периоды (их заранее показывает предпросмотр назначения).
    expect((await reportsOf(cp, 'opu')).map((r) => [r.period, r.periodStart, r.dueDate])).toEqual([
      ['Q', '2026-07-01', '2026-10-15'],
      ['M', '2026-08-01', '2026-09-25'],
      ['M', '2026-09-01', '2026-10-26'],
      ['M', '2026-10-01', '2026-11-25'],
      ['M', '2026-11-01', '2026-12-25'],
    ]);
    const gone = await inA((tx) => readHistory(tx, 'report', before[1]!.id));
    expect(gone.at(-1)).toMatchObject({
      action: 'delete',
      reason: TEXTS.ownRuleChanged,
      contractorId: cp,
    });
  });

  it('новая периодичность в назначении: отчёт с изменённым вручную сроком остаётся с журналом', async () => {
    const cp = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ОсОО «Ручной срок»', inn: '01504200510098', responsibleEmployeeId: null }),
        null,
      ),
    );
    const { assignment } = await inA((tx) =>
      createAssignment(
        tx,
        {
          ...input({
            fromMonth: '2026-10-01',
            rate: null,
            ownPeriod: 'Q',
            ownDay: 15,
            ownMonth: 1,
          }),
          contractorId: cp,
          reportTypeCode: 'opu',
        },
        ctx(),
      ),
    );
    const [q4] = await reportsOf(cp, 'opu');
    await inA((tx) =>
      changeReportDue(
        tx,
        q4!.id,
        {
          due: '2027-01-20',
          reasonCode: 'ПРЧ-001',
          reasonName: 'Продление от госоргана',
          comment: '',
        },
        { today: TODAY, version: q4!.version, scope: undefined },
      ),
    );
    await inA((tx) =>
      updateAssignment(
        tx,
        assignment.id,
        { ownPeriod: 'M', ownDay: 25, ownMonth: 1 },
        { ...ctx(), version: assignment.version },
      ),
    );
    // IV квартал с ручным сроком занимает октябрь; помесячно создаётся только ноябрь.
    expect((await reportsOf(cp, 'opu')).map((r) => [r.period, r.periodStart, r.dueDate])).toEqual([
      ['Q', '2026-10-01', '2027-01-20'],
      ['M', '2026-11-01', '2026-12-25'],
    ]);
    const journal = await inA((tx) =>
      tx.select().from(reportDueChanges).where(eq(reportDueChanges.reportId, q4!.id)),
    );
    expect(journal).toHaveLength(1);
  });

  it('разовому контрагенту регулярные отчёты не назначаются и расписание их не создаёт', async () => {
    const cp = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({
          name: 'ИП Разовый',
          inn: '21504200510077',
          kind: 'oneoff',
          responsibleEmployeeId: null,
        }),
        null,
      ),
    );
    await expect(
      inA((tx) =>
        createAssignment(tx, { ...input(), contractorId: cp, reportTypeCode: 'nds' }, ctx()),
      ),
    ).rejects.toBeInstanceOf(ContractorOneOffError);
    // Назначение, появившееся в обход (например, контрагента сделали разовым), расписание пропускает.
    await inA((tx) =>
      tx
        .insert(assignments)
        .values({ contractorId: cp, reportTypeCode: 'nds', fromMonth: '2026-10-01' }),
    );
    await inA((tx) => createDueReports(tx, { today: TODAY, contractorIds: [cp] }));
    expect(await reportsOf(cp, 'nds')).toEqual([]);
  });

  it('просроченные архивного контрагента остаются в «Просрочено», приостановленного — нет', async () => {
    const cp = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ОсОО «Архив»', inn: '01504200510076', responsibleEmployeeId: null }),
        null,
      ),
    );
    await inA((tx) =>
      createManualReport(
        tx,
        {
          contractorId: cp,
          reportTypeCode: 'soc',
          month: '2026-08-01',
          eventDate: null,
          due: '2026-09-20',
          reasonCode: 'ПРЧ-001',
          reasonName: 'Причина',
        },
        { today: TODAY, scope: undefined },
      ),
    );
    const counts = () =>
      inA((tx) =>
        reportSummary(tx, {
          scope: undefined,
          today: TODAY,
          waiting: { confirm: true, own: null },
        }),
      );
    const active = await counts();
    const setStatus = (status: string) =>
      db.admin.db.execute(sql`update contractors set service_status = ${status} where id = ${cp}`);
    await setStatus('paused');
    expect((await counts()).overdue).toBe(active.overdue - 1);
    await setStatus('archived');
    expect((await counts()).overdue).toBe(active.overdue);
  });
});
