import { randomUUID } from 'node:crypto';
import { formatText, paymentDefaults, UI_TEXTS, type Translate } from '@buhuchet/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { insertPendingFile, markFileReady } from './files';
import { readHistory } from './history';
import {
  cancelPayment,
  contractorBalance,
  contractorMoneyOf,
  contractorOperations,
  createReceipt,
  FUNDS_STATE,
  moneyFileSource,
  payReport,
  saveMoneySettings,
  RECEIVED,
  receiptFormRows,
  REPORT_MONEY,
  reportMoneyCard,
  rmField,
  type ReceiptInput,
} from './money-tax';
import { createOrganization, type CreatedOrganization } from './organizations';
import { getReportRow } from './report-list';
import { submitReport, submitReports, type ReportActionContext } from './report-submit';
import { createAssignment, type AssignmentInput, type AssignmentTexts } from './reports';
import { contractors, moneyAllocations, moneyOperations, reports } from './schema';
import { readSpecJson } from './spec-data';
import { seedPermissions, seedRoleTemplates } from './seed';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-28';
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const som = (v: number) => v * 100;
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
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const refused = (code: string, status = 409) =>
  expect.objectContaining({ name: 'MoneyRefusedError', code, status });

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

describe.skipIf(!databaseAvailable())('Деньги по отчётам: поступления и оплата налога', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA = '';
  let accUser = '';
  let cpA = '';
  let cpOrg = '';
  let cpB = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2], userId?: string) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: userId ?? accUser }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId } as OrgContext, fn);
  const act = (patch: Partial<ReportActionContext> = {}): ReportActionContext => ({
    today: TODAY,
    scope: undefined,
    contractorScope: undefined,
    confirmOn: false,
    filesOn: true,
    payFirst: true,
    t,
    ...patch,
  });
  const texts = {
    repeat: 'Повторяющаяся сумма из назначения',
    afterPayment: 'сдача — после оплаты',
  };
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
            eq(reports.superseded, false),
          ),
        ),
    );
    return r!;
  };
  const setAmount = (id: string, amount: number | null) =>
    inA((tx) => tx.update(reports).set({ amount }).where(eq(reports.id, id)));
  const receipt = (contractorId: string, patch: Partial<ReceiptInput>) =>
    inA((tx) =>
      createReceipt(
        tx,
        contractorId,
        { total: 0, date: TODAY, rows: [], files: 0, ...patch },
        { today: TODAY, scope: undefined, t },
      ),
    );
  const pay = async (id: string, patch: { amount: number; self?: boolean; date?: string }) => {
    const [r] = await inA((tx) => tx.select().from(reports).where(eq(reports.id, id)));
    return inA((tx) =>
      payReport(
        tx,
        id,
        {
          version: r!.version,
          amount: patch.amount,
          date: patch.date ?? TODAY,
          self: patch.self ?? false,
        },
        { today: TODAY, scope: undefined, finScope: undefined },
      ),
    );
  };
  const rowOf = (id: string) =>
    inA((tx) =>
      getReportRow(tx, id, {
        t: (k) => t(k as never),
        today: TODAY,
        scope: undefined,
        taxpay: true,
      }),
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
      slug: 'money-a',
      owner: owner('money-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810467',
      slug: 'money-b',
      owner: owner('money-owner-b'),
    });
    const role = a.roles.find((r) => r.templateCode === 'acc')!;
    accA = await withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
      createEmployee(tx, {
        fullName: 'Токтогулов Алишер Бакытович',
        shortName: 'Алишер Т.',
        login: 'money-acc-a',
        passwordHash: 'x',
        phone: null,
        role,
      }),
    );
    accUser = (
      await withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
        tx.execute<{ user_id: string }>(sql`select user_id from employees where id = ${accA}`),
      )
    )[0]!.user_id;
    cpA = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ responsibleEmployeeId: accA }), null),
    );
    cpOrg = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ИП Садыкова', inn: '21503198700015', paysTo: 'org' }),
        null,
      ),
    );
    cpB = await inB((tx) => createContractor(tx, b.orgId, fields(), null));
    const assign = (
      contractorId: string,
      reportTypeCode: string,
      patch: Partial<AssignmentInput> = {},
    ) =>
      inA((tx) =>
        createAssignment(
          tx,
          { ...input(patch), contractorId, reportTypeCode },
          { today: TODAY, scope: undefined, markPast: false, confirm: false, texts: TEXTS },
        ),
      );
    await assign(cpA, 'nds');
    await assign(cpA, 'enq', {
      rate: null,
      enRates: [{ code: 'ЕНС-04', variant: null }],
      fromMonth: '2026-07-01',
    });
    await assign(cpA, 't1q', { rate: null, fromMonth: '2026-07-01' });
    await assign(cpOrg, 'nds');
    await assign(cpOrg, 'soc', { rate: '10 %' });
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

  it('п. 69: НДС 5 000 без оплаты — «Сдан» не ставится; после оплаты 3 000 — ставится; статистический — сразу', async () => {
    const sep = await reportOf(cpA, 'nds', '2026-09-01');
    await setAmount(sep.id, som(5_000));
    const fresh = await reportOf(cpA, 'nds', '2026-09-01');
    const waits = await inA((tx) =>
      submitReport(
        tx,
        sep.id,
        { date: TODAY, amount: null, lines: null, repeat: false, fileIds: [] },
        { ...act(), version: fresh.version, texts },
      ),
    );
    expect(waits.waitsPayment).toEqual({ amount: som(5_000), paid: 0 });
    expect(waits.report.status).toBe(fresh.status);
    // Строка списка: три суммы и «Не оплачено».
    expect(await rowOf(sep.id)).toMatchObject({
      amount: som(5_000),
      paid: 0,
      received: 0,
      paymentStatus: 'unpaid',
      funds: { state: 'short', need: som(5_000), short: som(5_000) },
    });
    // Поступление 3 000 под НДС и оплата 3 000 из денег контрагента.
    const { rows } = await inA((tx) => receiptFormRows(tx, cpA));
    expect(rows.find((r) => r.reportId === sep.id)).toMatchObject({
      sum: som(5_000),
      already: 0,
      left: som(5_000),
    });
    await receipt(cpA, { total: som(3_000), rows: [{ reportId: sep.id, amount: som(3_000) }] });
    expect(await rowOf(sep.id)).toMatchObject({
      received: som(3_000),
      paid: 0,
      funds: { state: 'short', short: som(2_000) },
    });
    // Своими деньгами контрагента налог платится, когда их на отчёт хватает: «Достаточно».
    await expect(pay(sep.id, { amount: som(3_000) })).rejects.toEqual(
      refused('payment_not_enough', 409),
    );
    await receipt(cpA, { total: som(2_000), rows: [{ reportId: sep.id, amount: som(2_000) }] });
    expect(await rowOf(sep.id)).toMatchObject({ funds: { state: 'enough', need: som(5_000) } });
    await pay(sep.id, { amount: som(3_000) });
    expect(await rowOf(sep.id)).toMatchObject({
      paid: som(3_000),
      received: som(5_000),
      paymentStatus: 'partial',
    });
    const paid = await reportOf(cpA, 'nds', '2026-09-01');
    const done = await inA((tx) =>
      submitReport(
        tx,
        sep.id,
        { date: TODAY, amount: null, lines: null, repeat: false, fileIds: [] },
        { ...act(), version: paid.version, texts },
      ),
    );
    expect(done.waitsPayment).toBeNull();
    expect(done.report.status).toBe('submitted');
    // Статистический отчёт («Сдача») отмечается сданным сразу.
    const stat = await reportOf(cpA, 't1q', '2026-07-01');
    const statDone = await inA((tx) =>
      submitReport(
        tx,
        stat.id,
        { date: TODAY, amount: null, lines: null, repeat: false, fileIds: [] },
        { ...act(), version: stat.version, texts },
      ),
    );
    expect(statDone.report.status).toBe('submitted');
    expect(await rowOf(stat.id)).toMatchObject({ paymentStatus: 'not_required', funds: null });
  });

  it('п. 72: ЕН III кв. без суммы — окно «Сдан» сохраняет 4 000 и файл, «Сдан» не ставит', async () => {
    const q3 = await reportOf(cpA, 'enq', '2026-07-01');
    const fileId = randomUUID();
    await inA(async (tx) => {
      await insertPendingFile(tx, {
        id: fileId,
        sourceKind: 'report',
        sourceId: q3.id,
        contractorId: cpA,
        name: 'ЕН III кв.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `org/${a.orgId}/files/${fileId}`,
      });
      await markFileReady(tx, fileId);
    });
    const res = await inA((tx) =>
      submitReport(
        tx,
        q3.id,
        { date: TODAY, amount: som(4_000), lines: null, repeat: false, fileIds: [fileId] },
        { ...act(), version: q3.version, texts },
      ),
    );
    expect(res.waitsPayment).toEqual({ amount: som(4_000), paid: 0 });
    const after = await reportOf(cpA, 'enq', '2026-07-01');
    expect(after).toMatchObject({ status: q3.status, amount: som(4_000), amountAuto: false });
    const history = await inA((tx) => readHistory(tx, 'report', q3.id));
    expect(history.at(-1)).toMatchObject({
      reason: 'сдача — после оплаты',
      changes: [
        { field: 'amount', from: null, to: som(4_000) },
        { field: 'files', to: ['ЕН III кв.pdf'] },
      ],
    });
  });

  it('массовая «Сдан»: неоплаченные помечены «Нет оплаты» и не отмечаются, сумма из окна сохраняется', async () => {
    const aug = await reportOf(cpOrg, 'nds', '2026-08-01');
    const socAug = await reportOf(cpOrg, 'soc', '2026-08-01');
    const res = await inA((tx) =>
      submitReports(
        tx,
        [
          { id: aug.id, version: aug.version, amount: som(1_200) },
          { id: socAug.id, version: socAug.version, amount: 0 },
        ],
        TODAY,
        { ...act(), texts },
      ),
    );
    expect(res).toEqual({ done: 1, skippedFile: 0, skipped: 0, skippedPay: 1 });
    expect(await reportOf(cpOrg, 'nds', '2026-08-01')).toMatchObject({
      status: aug.status,
      amount: som(1_200),
    });
    // Нулевой отчёт оплаты не ждёт.
    expect(await reportOf(cpOrg, 'soc', '2026-08-01')).toMatchObject({
      status: 'submitted',
      amount: 0,
    });
    // Без «Сдачи только после оплаты» — всё сразу.
    const augNow = await reportOf(cpOrg, 'nds', '2026-08-01');
    const off = await inA((tx) =>
      submitReports(tx, [{ id: aug.id, version: augNow.version, amount: null }], TODAY, {
        ...act({ payFirst: false }),
        texts,
      }),
    );
    expect(off).toMatchObject({ done: 1, skippedPay: 0 });
  });

  it('п. 73: у контрагента 1 000, к уплате 5 000 — «Оплатил контрагент сам» отмечено, остаток не меняется', async () => {
    const oct = await reportOf(cpOrg, 'nds', '2026-10-01');
    await setAmount(oct.id, som(5_000));
    await receipt(cpOrg, { total: som(1_000) });
    const before = await inA((tx) => contractorBalance(tx, cpOrg));
    expect(before).toMatchObject({ available: som(1_000), received: som(1_000) });
    const card = await inA(async (tx) => {
      const [r] = await tx.select().from(reports).where(eq(reports.id, oct.id));
      return reportMoneyCard(tx, { ...r!, amount: Number(r!.amount), paid: Number(r!.paid) });
    });
    expect(card.funds).toMatchObject({ state: 'short' });
    const defaults = paymentDefaults({ sum: som(5_000), paid: 0 }, card.schedule, card.funds);
    expect(defaults).toEqual({ amount: som(5_000), self: true });
    // Без «Оплатил сам» денег не хватает: недостача по отчёту.
    await expect(pay(oct.id, { amount: som(5_000) })).rejects.toEqual(
      refused('payment_not_enough', 409),
    );
    await pay(oct.id, { amount: som(5_000), self: true });
    expect(await rowOf(oct.id)).toMatchObject({ paid: som(5_000), selfPaid: som(5_000) });
    const after = await inA((tx) => contractorBalance(tx, cpOrg));
    expect(after).toMatchObject({
      available: som(1_000),
      received: som(1_000),
      paid: som(5_000),
      selfPaid: som(5_000),
    });
    // Операция «Оплатил сам» — мимо счетов, деньги организации не тронуты.
    const ops = await inA((tx) => contractorOperations(tx, cpOrg, t));
    expect(ops[0]).toMatchObject({ kind: 'pay', self: true, amount: som(5_000) });
    const [op] = await inA((tx) =>
      tx.select().from(moneyOperations).where(eq(moneyOperations.reportId, oct.id)),
    );
    expect(op).toMatchObject({ holderKind: 'client', holderEmployeeId: null });
  });

  it('оплата из денег контрагента: срок не позже сегодня, источник файлов, отмена последней оплаты', async () => {
    const aug = await reportOf(cpA, 'nds', '2026-08-01');
    await setAmount(aug.id, som(2_000));
    await receipt(cpA, { total: som(2_000), rows: [{ reportId: aug.id, amount: som(2_000) }] });
    await expect(pay(aug.id, { amount: som(1_000), date: '2026-10-29' })).rejects.toEqual(
      refused('money_date_future', 400),
    );
    const { operationId } = await pay(aug.id, { amount: som(1_500) });
    await pay(aug.id, { amount: som(500) });
    expect(await rowOf(aug.id)).toMatchObject({ paid: som(2_000), paymentStatus: 'paid' });
    // Платёжное поручение загружается к операции оплаты: источник — её контрагент и отчёт.
    expect(
      await inA((tx) => moneyFileSource(tx, operationId, 'tax_payment', undefined)),
    ).toMatchObject({
      contractor: { id: cpA },
      reportId: aug.id,
      cancelled: false,
    });
    expect(await inA((tx) => moneyFileSource(tx, operationId, 'receipt', undefined))).toBeNull();
    expect(
      await inB((tx) => moneyFileSource(tx, operationId, 'tax_payment', undefined)),
    ).toBeNull();
    // Полностью оплаченный отчёт оплаты не ждёт.
    await expect(pay(aug.id, { amount: som(1) })).rejects.toEqual(refused('payment_not_allowed'));
    const r = await reportOf(cpA, 'nds', '2026-08-01');
    await inA((tx) =>
      cancelPayment(
        tx,
        aug.id,
        { version: r.version, reason: 'Ошибка в сумме' },
        { scope: undefined, finScope: undefined },
      ),
    );
    expect(await rowOf(aug.id)).toMatchObject({ paid: som(1_500), paymentStatus: 'partial' });
    const history = await inA((tx) => readHistory(tx, 'report', aug.id));
    expect(history.at(-1)).toMatchObject({
      reason: 'Ошибка в сумме',
      changes: [
        { field: 'paymentCancel', from: { amount: som(500), date: TODAY } },
        { field: 'paid', from: som(2_000), to: som(1_500) },
      ],
    });
    // Отменённая оплата в операциях не показывается, остаток вернулся.
    expect((await inA((tx) => contractorBalance(tx, cpA))).paid).toBe(som(4_500));
  });

  it('поступление: проверки детализации, файла и архива', async () => {
    const oct = await reportOf(cpA, 'nds', '2026-10-01');
    await setAmount(oct.id, som(1_000));
    await expect(
      receipt(cpA, { total: som(500), rows: [{ reportId: oct.id, amount: som(600) }] }),
    ).rejects.toEqual(refused('receipt_total_less', 400));
    await expect(
      receipt(cpA, { total: som(5_000), rows: [{ reportId: oct.id, amount: som(1_001) }] }),
    ).rejects.toEqual(refused('receipt_row_over', 400));
    const alien = await reportOf(cpOrg, 'nds', '2026-09-01');
    await expect(
      receipt(cpA, { total: som(5_000), rows: [{ reportId: alien.id, amount: som(1) }] }),
    ).rejects.toEqual(refused('receipt_row_invalid', 400));
    await expect(receipt(cpA, { total: som(1), date: '2026-10-29' })).rejects.toEqual(
      refused('money_date_future', 400),
    );
    await inA((tx) =>
      tx.update(contractors).set({ needReceiptFile: true }).where(eq(contractors.id, cpA)),
    );
    await expect(receipt(cpA, { total: som(100) })).rejects.toEqual(
      refused('receipt_file_required', 400),
    );
    const { id } = await receipt(cpA, {
      total: som(1_500),
      rows: [{ reportId: oct.id, amount: som(1_000) }],
      files: 1,
    });
    const history = await inA((tx) => readHistory(tx, 'money_operation', id));
    expect(history[0]).toMatchObject({
      action: 'create',
      changes: expect.arrayContaining([
        { field: 'total', to: som(1_500) },
        { field: 'allocations', to: [{ report: 'НДС 10.2026', amount: som(1_000) }] },
      ]),
    });
    // Отчёт полностью получен — в форме поступления его больше нет.
    expect(
      (await inA((tx) => receiptFormRows(tx, cpA))).rows.some((r) => r.reportId === oct.id),
    ).toBe(false);
    await inA((tx) =>
      tx
        .update(contractors)
        .set({ needReceiptFile: false, serviceStatus: 'archived' })
        .where(eq(contractors.id, cpA)),
    );
    await expect(receipt(cpA, { total: som(1) })).rejects.toEqual(refused('contractor_archived'));
    await inA((tx) =>
      tx.update(contractors).set({ serviceStatus: 'active' }).where(eq(contractors.id, cpA)),
    );
  });

  it('«Деньги на налоги переводит»: смена счёта переносит деньги, «Файл при поступлении» — с версией', async () => {
    const version = async () =>
      (await inA((tx) => tx.select().from(contractors).where(eq(contractors.id, cpOrg))))[0]!
        .version;
    // Без ответственного деньги на кошелёк переводить некому.
    const v0 = await version();
    await expect(
      inA((tx) => saveMoneySettings(tx, cpOrg, { version: v0, paysTo: 'emp' }, undefined)),
    ).rejects.toEqual(refused('no_holder'));
    await inA((tx) =>
      tx.update(contractors).set({ responsibleEmployeeId: accA }).where(eq(contractors.id, cpOrg)),
    );
    const v = await version();
    await inA((tx) => saveMoneySettings(tx, cpOrg, { version: v, paysTo: 'emp' }, undefined));
    const ops = await inA((tx) =>
      tx.select().from(moneyOperations).where(eq(moneyOperations.contractorId, cpOrg)),
    );
    expect(
      ops
        .filter((o) => !o.self)
        .every((o) => o.holderKind === 'employee' && o.holderEmployeeId === accA),
    ).toBe(true);
    expect(ops.filter((o) => o.self).every((o) => o.holderKind === 'client')).toBe(true);
    const history = await inA((tx) => readHistory(tx, 'contractor', cpOrg));
    expect(history.at(-1)).toMatchObject({
      changes: [{ field: 'paysTo', from: 'org', to: 'emp' }],
    });
    // Устаревшая версия — «запись изменена другим пользователем».
    await expect(
      inA((tx) => saveMoneySettings(tx, cpOrg, { version: v, needReceiptFile: true }, undefined)),
    ).rejects.toEqual(expect.objectContaining({ name: 'RecordChangedError' }));
    await inA(async (tx) =>
      saveMoneySettings(tx, cpOrg, { version: await version(), paysTo: 'org' }, undefined),
    );
  });

  it('сверка в SQL совпадает с правилом домена на случайных данных', async () => {
    const list = await inA((tx) =>
      tx
        .select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.contractorId, cpOrg), eq(reports.superseded, false)))
        .orderBy(asc(reports.periodStart)),
    );
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 25; round++) {
      // Сбрасывает данные владелец таблиц: у роли приложения нет DELETE на операции.
      await db.admin.db.delete(moneyAllocations);
      await db.admin.db.delete(moneyOperations).where(eq(moneyOperations.contractorId, cpOrg));
      await inA(async (tx) => {
        for (const r of list) {
          const amount = rnd(4) === 0 ? null : som(rnd(6) * 500);
          await tx
            .update(reports)
            .set({ amount, paid: amount && rnd(3) === 0 ? Math.min(amount, som(rnd(4) * 400)) : 0 })
            .where(eq(reports.id, r.id));
        }
        for (let i = 0; i < 1 + rnd(4); i++) {
          const total = som(200 * (1 + rnd(10)));
          const [op] = await tx
            .insert(moneyOperations)
            .values({
              contractorId: cpOrg,
              kind: 'in',
              amount: total,
              total,
              opDate: TODAY,
              holderKind: 'org',
            })
            .returning({ id: moneyOperations.id });
          const target = list[rnd(list.length)]!;
          if (rnd(2)) {
            await tx
              .insert(moneyAllocations)
              .values({
                operationId: op!.id,
                reportId: target.id,
                amount: som(100 * (1 + rnd(10))),
              });
          }
        }
        if (rnd(2)) {
          await tx.insert(moneyOperations).values({
            contractorId: cpOrg,
            kind: 'pay',
            amount: som(300),
            opDate: TODAY,
            holderKind: 'client',
            self: true,
            reportId: list[rnd(list.length)]!.id,
          });
        }
        if (rnd(3) === 0) {
          await tx.insert(moneyOperations).values({
            contractorId: cpOrg,
            kind: 'bonus',
            amount: som(2_000),
            opDate: TODAY,
            holderKind: 'org',
          });
        }
      });
      const { money } = await inA((tx) => contractorMoneyOf(tx, cpOrg));
      const fromSql = await inA((tx) =>
        tx
          .select({
            id: reports.id,
            received: RECEIVED.mapWith(Number),
            state: FUNDS_STATE,
            need: sql<string | null>`${rmField('need')}`,
            short: sql<string | null>`${rmField('short')}`,
          })
          .from(reports)
          .leftJoin(REPORT_MONEY, sql`${rmField('id')} = ${reports.id}`)
          .where(and(eq(reports.contractorId, cpOrg), eq(reports.superseded, false))),
      );
      for (const row of fromSql) {
        const m = money.reports.get(row.id)!;
        expect({ id: row.id, received: row.received, state: row.state }).toEqual({
          id: row.id,
          received: m.received,
          state: m.funds?.state ?? null,
        });
        if (m.funds?.state === 'short') expect(Number(row.short)).toBe(m.funds.short);
        if (m.funds && m.funds.state !== 'paid') expect(Number(row.need)).toBe(m.funds.need);
      }
    }
  });

  it('чужая организация не видна: операции и детализация', async () => {
    const own = await inA((tx) => tx.select().from(moneyOperations));
    expect(own.length).toBeGreaterThan(0);
    expect(await inB((tx) => tx.select().from(moneyOperations))).toEqual([]);
    expect(await inB((tx) => tx.select().from(moneyAllocations))).toEqual([]);
    await expect(
      inB((tx) =>
        tx.insert(moneyOperations).values({
          orgId: a.orgId,
          contractorId: cpA,
          kind: 'in',
          amount: 1,
          total: 1,
          opDate: TODAY,
          holderKind: 'org',
        }),
      ),
    ).rejects.toEqual(permissionDenied);
    expect(await inB((tx) => tx.update(moneyOperations).set({ note: 'x' }).returning())).toEqual(
      [],
    );
    // Операции не удаляются и не очищаются даже в своей организации (миграция 0071).
    await expect(inA((tx) => tx.delete(moneyOperations).returning())).rejects.toEqual(
      permissionDenied,
    );
    await expect(inA((tx) => tx.delete(moneyAllocations).returning())).rejects.toEqual(
      permissionDenied,
    );
    await expect(
      inA((tx) => tx.update(moneyOperations).set({ amount: 1 }).returning()),
    ).rejects.toEqual(permissionDenied);
    // Чужой контрагент для поступления не найден.
    await expect(
      inB((tx) =>
        createReceipt(
          tx,
          cpA,
          { total: 100, date: TODAY, rows: [], files: 0 },
          { today: TODAY, scope: undefined, t },
        ),
      ),
    ).rejects.toEqual(expect.objectContaining({ name: 'RecordNotFoundError' }));
    // Своя организация Б не видит денег организации А и в сверке.
    expect((await inB((tx) => contractorBalance(tx, cpB))).available).toBe(0);
  });
});
