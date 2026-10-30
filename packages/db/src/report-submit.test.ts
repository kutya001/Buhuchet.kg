import { randomUUID } from 'node:crypto';
import { formatText, UI_TEXTS, type ReportConfirmer, type Translate } from '@buhuchet/domain';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import {
  createContractor,
  getContractor,
  updateContractor,
  type ContractorFields,
} from './contractors';
import { insertPendingFile, markFileReady } from './files';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  confirmReport,
  confirmReports,
  confirmWaitingReports,
  reportFileTarget,
  ReportRefusedError,
  reportSubmitView,
  returnReportForFix,
  rollbackReport,
  setReportAmount,
  setReportStep,
  submitReport,
  submitReports,
  type ReportActionContext,
} from './report-submit';
import {
  createAssignment,
  createManualReport,
  createRevision,
  ReportChangedError,
  type AssignmentInput,
  type AssignmentTexts,
} from './reports';
import { assignments, employees, orgReportTypes, reports, reportTaxLines } from './schema';
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

// Среда, 28.10.2026: уточнённый «сегодня + 10» попадает на субботу 07.11.
const TODAY = '2026-10-28';
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
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
const som = (v: number) => v * 100;
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const refused = (code: string, status?: number) =>
  expect.objectContaining({ name: 'ReportRefusedError', code, ...(status ? { status } : {}) });

const input = (patch: Partial<AssignmentInput> = {}): AssignmentInput => ({
  fromMonth: '2026-08-01',
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
  socfundFlags: {},
  socfundTariff: null,
  ...patch,
});

describe.skipIf(!databaseAvailable())('Отчёты: сдача, подтверждение, откат и сумма', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA = '';
  let chiefA = '';
  let accUser = '';
  let chiefUser = '';
  let cpA = '';
  let cpB = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2], userId?: string) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: userId ?? a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId } as OrgContext, fn);
  const act = (patch: Partial<ReportActionContext> = {}): ReportActionContext => ({
    today: TODAY,
    scope: undefined,
    confirmOn: true,
    filesOn: true,
    t,
    ...patch,
  });
  const texts = { repeat: 'Повторяющаяся сумма из назначения' };
  const chief: ReportConfirmer = { canConfirm: true, userId: '', isOwner: false };
  const reportOf = async (contractorId: string, typeCode: string, periodStart: string) => {
    const [r] = await inA((tx) =>
      tx
        .select()
        .from(reports)
        .where(
          and(
            eq(reports.contractorId, contractorId),
            eq(reports.reportTypeCode, typeCode),
            eq(reports.periodStart, periodStart),
          ),
        )
        .orderBy(asc(reports.revision)),
    );
    return r!;
  };
  const submit = (
    id: string,
    version: number,
    patch: Partial<Parameters<typeof submitReport>[2]> = {},
    userId = accUser,
  ) =>
    inA(
      (tx) =>
        submitReport(
          tx,
          id,
          { date: TODAY, amount: null, lines: null, repeat: false, fileIds: [], ...patch },
          { ...act(), version, texts },
        ),
      userId,
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810466',
      slug: 'sub-a',
      owner: owner('sub-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810467',
      slug: 'sub-b',
      owner: owner('sub-owner-b'),
    });
    const role = (code: string) => a.roles.find((r) => r.templateCode === code)!;
    [accA, chiefA] = await inA(async (tx) => [
      await createEmployee(tx, {
        fullName: 'Токтогулов Алишер Бакытович',
        shortName: 'Алишер Т.',
        login: 'sub-acc-a',
        passwordHash: 'x',
        phone: null,
        role: role('acc'),
      }),
      await createEmployee(tx, {
        fullName: 'Кадырова Мээрим Асановна',
        shortName: 'Мээрим К.',
        login: 'sub-chief-a',
        passwordHash: 'x',
        phone: null,
        role: role('chief'),
      }),
    ]);
    const userOf = async (id: string) =>
      (await inA((tx) => tx.select().from(employees).where(eq(employees.id, id))))[0]!.userId!;
    accUser = await userOf(accA);
    chiefUser = await userOf(chiefA);
    chief.userId = chiefUser;
    cpA = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ responsibleEmployeeId: accA }), null),
    );
    cpB = await inB((tx) => createContractor(tx, b.orgId, fields(), null));
    const assign = (reportTypeCode: string, patch: Partial<AssignmentInput> = {}) =>
      inA((tx) =>
        createAssignment(
          tx,
          { ...input(patch), contractorId: cpA, reportTypeCode },
          { today: TODAY, scope: undefined, markPast: false, confirm: false, texts: TEXTS },
        ),
      );
    await assign('nds');
    await assign('soc', { rate: '10 %' });
    await assign('t1q', { rate: null, fromMonth: '2026-07-01' });
    await assign('enq', {
      rate: null,
      enRates: [{ code: 'ЕНС-04', variant: null }],
      fromMonth: '2026-07-01',
    });
    await inB((tx) =>
      createAssignment(
        tx,
        { ...input(), contractorId: cpB, reportTypeCode: 'nds' },
        { today: TODAY, scope: undefined, markPast: false, confirm: false, texts: TEXTS },
      ),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('п. 61: ЕН кв., ЕНС-04 безнал 300 000 и нал 200 000 → строки 12 000 + 12 000, итог 24 000', async () => {
    const q3 = await reportOf(cpA, 'enq', '2026-07-01');
    const view = await inA((tx) => reportSubmitView(tx, q3.id, t));
    expect(view.lineDefs.map((d) => [d.key, d.label])).toEqual([
      ['ЕНС-04:cl', 'Безналичная выручка, 4 %'],
      ['ЕНС-04:ca', 'Наличная выручка, 6 %'],
    ]);
    const done = await submit(q3.id, q3.version, {
      date: '2026-10-20',
      lines: [
        { key: 'ЕНС-04:cl', revenue: som(300_000), tax: null },
        { key: 'ЕНС-04:ca', revenue: som(200_000), tax: null },
      ],
    });
    expect(done).toMatchObject({
      status: 'submitted',
      submittedOn: '2026-10-20',
      amount: som(24_000),
    });
    const after = await inA((tx) => reportSubmitView(tx, q3.id, t));
    expect(after.lines.map((l) => [l.key, l.revenue, l.tax])).toEqual([
      ['ЕНС-04:cl', som(300_000), som(12_000)],
      ['ЕНС-04:ca', som(200_000), som(12_000)],
    ]);
    // п. 10: в истории — дата сдачи, сумма и строки, кто и когда.
    const [h] = after.history;
    expect(h).toMatchObject({ actor: 'Алишер Т.', action: 'update' });
    expect(h!.changes.map((c) => c.field)).toEqual(['submittedOn', 'amount', 'lines']);
    expect(h!.changes[1]).toMatchObject({ from: null, to: som(24_000) });
    const status = await inA((tx) => readStatusHistory(tx, 'report', q3.id));
    expect(status.at(-1)).toMatchObject({ from: 'todo', to: 'submitted', actor: 'Алишер Т.' });
    // Чужой ключ строки — отказ 400.
    await expect(
      inA((tx) =>
        setReportAmount(
          tx,
          q3.id,
          { amount: null, lines: [{ key: 'ЕНС-99:r', revenue: 1, tax: null }], repeat: false },
          { ...act(), version: done.version, texts },
        ),
      ),
    ).rejects.toEqual(refused('report_lines_invalid', 400));
  });

  it('п. 3: у отчёта статистики суммы нет — сдаётся без неё', async () => {
    const q3 = await reportOf(cpA, 't1q', '2026-07-01');
    await expect(
      inA((tx) =>
        setReportAmount(
          tx,
          q3.id,
          { amount: som(100), lines: null, repeat: false },
          { ...act(), version: q3.version, texts },
        ),
      ),
    ).rejects.toEqual(refused('report_no_amount'));
    const done = await submit(q3.id, q3.version, { amount: som(100) });
    expect(done).toMatchObject({ status: 'submitted', amount: null });
    expect((await inA((tx) => reportSubmitView(tx, q3.id, t))).lineDefs).toEqual([]);
  });

  it('Соцфонд: сумма по платежам — подоходный налог и страховые взносы', async () => {
    const aug = await reportOf(cpA, 'soc', '2026-08-01');
    const view = await inA((tx) => reportSubmitView(tx, aug.id, t));
    expect(view.lineDefs.map((d) => [d.key, d.label])).toEqual([
      ['pay:0', 'Подоходный налог'],
      ['pay:1', 'Страховые взносы'],
    ]);
    const done = await submit(aug.id, aug.version, {
      lines: [
        { key: 'pay:0', revenue: null, tax: som(1_000) },
        { key: 'pay:1', revenue: null, tax: som(1_500) },
      ],
    });
    expect(done.amount).toBe(som(2_500));
    const lines = await inA((tx) =>
      tx.select().from(reportTaxLines).where(eq(reportTaxLines.reportId, aug.id)),
    );
    expect(lines.map((l) => [l.kind, l.lineKey, l.tax])).toEqual([
      ['payment', 'pay:0', som(1_000)],
      ['payment', 'pay:1', som(1_500)],
    ]);
  });

  it('п. 62: «Ждёт подтверждения» → «Подтвердить» другим сотрудником; свой — нельзя', async () => {
    const aug = await reportOf(cpA, 'nds', '2026-08-01');
    const done = await submit(aug.id, aug.version, { amount: som(5_000), date: '2026-09-20' });
    const confirm = (version: number, who: ReportConfirmer, userId: string, note = '') =>
      inA(
        (tx) =>
          confirmReport(tx, aug.id, { note, fileIds: [] }, { ...act(), confirmer: who, version }),
        userId,
      );
    await expect(confirm(done.version, { ...chief, userId: accUser }, accUser)).rejects.toEqual(
      refused('report_confirm_own', 403),
    );
    await expect(confirm(done.version, { ...chief, canConfirm: false }, chiefUser)).rejects.toEqual(
      refused('report_confirm_right', 403),
    );
    // Владелец организации подтверждает и свой сданный отчёт (прототип repConfWhy).
    const confirmed = await confirm(done.version, chief, chiefUser, 'Проверено');
    expect(confirmed).toMatchObject({ confirmedBy: chiefUser, confirmNote: 'Проверено' });
    expect(confirmed.confirmedAt).not.toBeNull();
    const status = await inA((tx) => readStatusHistory(tx, 'report', aug.id));
    expect(status.at(-1)).toMatchObject({
      from: 'submitted',
      to: 'confirmed',
      actor: 'Мээрим К.',
      reason: 'Проверено',
    });
    await expect(confirm(confirmed.version, chief, chiefUser)).rejects.toEqual(
      refused('report_not_waiting', 409),
    );
    await expect(confirm(done.version, chief, chiefUser)).rejects.toBeInstanceOf(
      ReportChangedError,
    );

    // Откат: сначала снимается подтверждение, затем «Сдан» → «В работе» без даты сдачи.
    const back = (version: number, to: string) =>
      inA((tx) => rollbackReport(tx, aug.id, { to, reason: 'Ошибка' }, { ...act(), version }));
    await expect(back(confirmed.version, 'in_progress')).rejects.toEqual(
      refused('report_step_invalid', 400),
    );
    const waiting = await back(confirmed.version, 'waiting');
    expect(waiting).toMatchObject({ status: 'submitted', confirmedAt: null, confirmedBy: null });
    const open = await back(waiting.version, 'in_progress');
    expect(open).toMatchObject({ status: 'in_progress', submittedOn: null, submittedBy: null });
    expect((await inA((tx) => readStatusHistory(tx, 'report', aug.id))).slice(-2)).toEqual([
      expect.objectContaining({
        from: 'confirmed',
        to: 'waiting',
        rollback: true,
        reason: 'Ошибка',
      }),
      expect.objectContaining({ from: 'submitted', to: 'in_progress', rollback: true }),
    ]);
  });

  it('п. 62: «На исправление» — только с причиной; ответственный видит причину и кто вернул', async () => {
    const sep = await reportOf(cpA, 'nds', '2026-09-01');
    const done = await submit(sep.id, sep.version, { amount: som(5_000) });
    const fix = (reason: string, version = done.version) =>
      inA(
        (tx) => returnReportForFix(tx, sep.id, reason, { ...act(), confirmer: chief, version }),
        chiefUser,
      );
    await expect(fix('  ')).rejects.toEqual(refused('report_fix_reason', 400));
    const back = await fix('Неверная сумма НДС');
    expect(back).toMatchObject({ status: 'needs_fix', confirmedAt: null });
    const view = await inA((tx) => reportSubmitView(tx, sep.id, t));
    expect(view.fix).toMatchObject({ actor: 'Мээрим К.', reason: 'Неверная сумма НДС' });
    // Снова «Сдан» — снова ждёт подтверждения.
    const again = await submit(sep.id, back.version);
    expect(again).toMatchObject({ status: 'submitted', confirmedAt: null });
  });

  it('шаги из меню: «Взять в работу», «Требует исправления», «Не требуется»', async () => {
    const oct = await reportOf(cpA, 'nds', '2026-10-01');
    const step = (to: 'in_progress' | 'needs_fix' | 'not_required', version: number) =>
      inA((tx) => setReportStep(tx, oct.id, to, { ...act(), version }));
    await expect(step('needs_fix', oct.version)).rejects.toEqual(refused('report_step_invalid'));
    const taken = await step('in_progress', oct.version);
    expect(taken.status).toBe('in_progress');
    const done = await submit(oct.id, taken.version);
    // Сданный, но ждущий подтверждения, отмечается «Не требуется» — поля сдачи снимаются.
    const nr = await step('not_required', done.version);
    expect(nr).toMatchObject({ status: 'not_required', submittedOn: null, submittedBy: null });
    await expect(step('not_required', nr.version)).rejects.toEqual(
      refused('report_not_required_invalid'),
    );
    // Сумма у «Не требуется» не указывается.
    await expect(
      inA((tx) =>
        setReportAmount(
          tx,
          oct.id,
          { amount: som(1), lines: null, repeat: false },
          { ...act(), version: nr.version, texts },
        ),
      ),
    ).rejects.toEqual(refused('report_amount_not_required'));
  });

  it('«Указать сумму» с «Повторять эту сумму»: сумма в назначении и в следующих несданных', async () => {
    const sep = await reportOf(cpA, 'soc', '2026-09-01');
    // У Соцфонда сумма — итог платежей (прототип partsFld): подоходный налог и страховые взносы.
    const lines = [
      { key: 'pay:0', revenue: null, tax: som(1_200) },
      { key: 'pay:1', revenue: null, tax: som(3_000) },
    ];
    const set = (version: number, repeat: boolean) =>
      inA((tx) =>
        setReportAmount(tx, sep.id, { amount: null, lines, repeat }, { ...act(), version, texts }),
      );
    const saved = await set(sep.version, true);
    expect(saved).toMatchObject({ amount: som(4_200), amountAuto: false });
    const [a1] = await inA((tx) =>
      tx
        .select()
        .from(assignments)
        .where(and(eq(assignments.contractorId, cpA), eq(assignments.reportTypeCode, 'soc'))),
    );
    expect(a1!.fixedAmount).toBe(som(4_200));
    const nov = await reportOf(cpA, 'soc', '2026-11-01');
    expect(nov).toMatchObject({ amount: som(4_200), amountAuto: true });
    expect((await inA((tx) => readHistory(tx, 'report', nov.id))).at(-1)).toMatchObject({
      reason: 'Повторяющаяся сумма из назначения',
    });
    // Галочку сняли — повторяющаяся сумма уходит из следующих отчётов.
    await set(saved.version, false);
    expect((await reportOf(cpA, 'soc', '2026-11-01')).amount).toBeNull();
    // Строки пустые, суммы ещё нет — сумма не указана.
    const q4 = await reportOf(cpA, 'enq', '2026-10-01');
    await expect(
      inA((tx) =>
        setReportAmount(
          tx,
          q4.id,
          { amount: null, lines: [{ key: 'ЕНС-04:cl', revenue: null, tax: null }], repeat: false },
          { ...act(), version: q4.version, texts },
        ),
      ),
    ).rejects.toEqual(refused('report_amount_required', 400));
  });

  it('файл при сдаче обязателен по настройке вида; массовая сдача пропускает такие отчёты', async () => {
    await inA((tx) =>
      tx
        .insert(orgReportTypes)
        .values({ orgId: a.orgId, reportTypeCode: 'enq', remindDays: [3], needFile: true })
        .onConflictDoUpdate({
          target: [orgReportTypes.orgId, orgReportTypes.reportTypeCode],
          set: { needFile: true },
        }),
    );
    const t1 = await reportOf(cpA, 'enq', '2026-10-01');
    const nov = await reportOf(cpA, 'nds', '2026-11-01');
    await expect(submit(t1.id, t1.version)).rejects.toEqual(refused('report_file_required', 400));
    // Без «Файлов в карточках» требования нет (docs/deviations.md п. Б-6) — проверяет правило домена.
    const batch = await inA(
      (tx) =>
        submitReports(
          tx,
          [
            { id: t1.id, version: t1.version, amount: null },
            { id: nov.id, version: nov.version, amount: som(3_000) },
          ],
          TODAY,
          act(),
        ),
      accUser,
    );
    expect(batch).toEqual({ done: 1, skippedFile: 1, skipped: 0 });
    expect(await reportOf(cpA, 'nds', '2026-11-01')).toMatchObject({
      status: 'submitted',
      amount: som(3_000),
    });
    // Файл прикреплён — сдаётся, в «Истории статусов» — с файлом.
    const fileId = randomUUID();
    await inA(async (tx) => {
      await insertPendingFile(tx, {
        id: fileId,
        sourceKind: 'report',
        sourceId: t1.id,
        contractorId: cpA,
        name: 'ЕН IV кв.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `org/${a.orgId}/files/${fileId}`,
      });
      await markFileReady(tx, fileId);
    });
    await expect(submit(t1.id, t1.version, { fileIds: [randomUUID()] })).rejects.toEqual(
      refused('report_file_not_found', 400),
    );
    const done = await submit(t1.id, t1.version, { fileIds: [fileId] });
    expect(done.status).toBe('submitted');
    const status = await inA((tx) => readStatusHistory(tx, 'report', t1.id));
    expect(status.at(-1)!.file).toMatchObject({ id: fileId, name: 'ЕН IV кв.pdf' });
    expect((await inA((tx) => reportSubmitView(tx, t1.id, t))).files).toEqual([
      { id: fileId, name: 'ЕН IV кв.pdf' },
    ]);
    // Источник файлов: отчёт в области; чужой организации — нет.
    expect(await inA((tx) => reportFileTarget(tx, t1.id, undefined))).toMatchObject({
      contractor: { id: cpA, archived: false },
    });
    expect(await inB((tx) => reportFileTarget(tx, t1.id, undefined))).toBeNull();
  });

  it('массовое «Подтвердить»: свои и не ждущие пропускаются; выключили подтверждение — подтверждены все', async () => {
    const nov = await reportOf(cpA, 'nds', '2026-11-01');
    const sep = await reportOf(cpA, 'nds', '2026-09-01');
    const res = await inA(
      (tx) =>
        confirmReports(
          tx,
          [
            { id: nov.id, version: nov.version },
            { id: sep.id, version: sep.version },
          ],
          '',
          { ...act(), confirmer: { ...chief, userId: accUser } },
        ),
      accUser,
    );
    expect(res).toEqual({ done: 0, skippedFile: 0, skipped: 2 });
    const n = await inA((tx) => confirmWaitingReports(tx, t('report.reason.confirm_off')));
    expect(n).toBeGreaterThanOrEqual(2);
    expect((await reportOf(cpA, 'nds', '2026-11-01')).confirmedAt).not.toBeNull();
    expect((await inA((tx) => readStatusHistory(tx, 'report', sep.id))).at(-1)).toMatchObject({
      to: 'confirmed',
      reason: 'Подтверждение выключено в учётной политике',
    });
    // Отчёты другой организации не тронуты.
    const [bReport] = await inB((tx) =>
      tx.select().from(reports).where(eq(reports.status, 'submitted')),
    );
    expect(bReport).toBeUndefined();
  });

  it('Д-18: уточнённый и «Разовый отчёт» — срок на рабочий день; статус контрагента их сроки не меняет', async () => {
    const cpD = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ОсОО «Д-18»', inn: '03744097401999', responsibleEmployeeId: accA }),
        null,
      ),
    );
    // Прошлые периоды (август, сентябрь) — сразу «Сдан».
    await inA((tx) =>
      createAssignment(
        tx,
        { ...input(), contractorId: cpD, reportTypeCode: 'nds' },
        { today: TODAY, scope: undefined, markPast: true, confirm: false, texts: TEXTS },
      ),
    );
    const sep = await reportOf(cpD, 'nds', '2026-09-01');
    expect(sep.status).toBe('submitted');
    const revision = await inA((tx) =>
      createRevision(tx, sep.id, { version: sep.version, today: TODAY, scope: undefined }),
    );
    // Среда 28.10 + 10 = суббота 07.11 → понедельник 09.11.
    expect(revision).toMatchObject({ revision: 1, dueBase: '2026-11-07', dueDate: '2026-11-09' });
    const manual = await inA((tx) =>
      createManualReport(
        tx,
        {
          contractorId: cpD,
          reportTypeCode: 'nds',
          month: '2026-07-01',
          eventDate: null,
          due: '2026-11-07',
          reasonCode: 'ПРЧ-001',
          reasonName: 'Продление от госоргана',
        },
        { today: TODAY, scope: undefined },
      ),
    );
    expect(manual).toMatchObject({ dueBase: '2026-11-07', dueDate: '2026-11-09' });
    const oct = await reportOf(cpD, 'nds', '2026-10-01');
    const cp = await inA((tx) => getContractor(tx, cpD, { scope: undefined, today: TODAY }));
    const { redued } = await inA((tx) =>
      updateContractor(
        tx,
        a.orgId,
        cpD,
        cp!.version,
        { benefits: [{ code: 'ЛЬГ-30', validFrom: null, validTo: null }] },
        undefined,
        {
          today: TODAY,
          texts: {
            byStatus: 'Срок по статусу «{name}»',
            byCatalog: 'По каталогу',
            byCatalogDropped: 'x',
          },
        },
      ),
    );
    // Отчёты по правилу (октябрь, ноябрь) получили срок крупного налогоплательщика; уточнённый и
    // разовый — прежние.
    expect(redued).toBe(2);
    expect((await reportOf(cpD, 'nds', '2026-10-01')).dueDate).not.toBe(oct.dueDate);
    const [rev] = await inA((tx) => tx.select().from(reports).where(eq(reports.id, revision.id)));
    const [man] = await inA((tx) => tx.select().from(reports).where(eq(reports.id, manual.id)));
    expect([rev!.dueDate, man!.dueDate]).toEqual(['2026-11-09', '2026-11-09']);
  });

  it('чужая организация не видна: строки суммы отчёта', async () => {
    const q3 = await reportOf(cpA, 'enq', '2026-07-01');
    expect(
      await inB((tx) => tx.select().from(reportTaxLines).where(eq(reportTaxLines.reportId, q3.id))),
    ).toEqual([]);
    await expect(
      inB((tx) =>
        tx.insert(reportTaxLines).values({
          orgId: a.orgId,
          reportId: q3.id,
          kind: 'rate',
          lineKey: 'x',
          label: 'x',
          tax: 1,
        }),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inB((tx) =>
        submitReport(
          tx,
          q3.id,
          { date: TODAY, amount: null, lines: null, repeat: false, fileIds: [] },
          { ...act(), version: q3.version, texts },
        ),
      ),
    ).rejects.toEqual(expect.objectContaining({ name: 'RecordNotFoundError' }));
    expect(ReportRefusedError).toBeDefined();
  });
});
