import { formatText, UI_TEXTS, type ListQuery, type Translate } from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { contractorScope, createContractor, type ContractorFields } from './contractors';
import { createFeePayment } from './fees';
import { lockOperation, writeOff, deleteOperation } from './finance';
import {
  deleteFeePayment,
  editFeePayment,
  editOperation,
  editReceipt,
  feePaymentCard,
  feePaymentOf,
  holderKeyOf,
  receiptEditForm,
  type OperationEditInput,
} from './finance-edit';
import {
  bonusesOfMonth,
  closedMonthsOf,
  closeMonth,
  EMPLOYEE_BALANCE,
  finSummary,
  listBonusPage,
  listFinJournalPage,
  listReceiptJournalPage,
  monthClosed,
  type FinJournalOptions,
} from './finance-journal';
import { readHistory } from './history';
import { createReceipt, lockMoneyContractor, payReport, type ReceiptInput } from './money-tax';
import { createOrganization, type CreatedOrganization } from './organizations';
import { createAssignment, type AssignmentInput, type AssignmentTexts } from './reports';
import {
  closedMonths,
  contractors,
  employees,
  feePayments,
  moneyOperations,
  reports,
} from './schema';
import { readSpecJson } from './spec-data';
import { seedPermissions, seedRoleTemplates } from './seed';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * Журнал «Финансовых операций» и изменение операций (задача 2.22): вкладки и группы строк по правам,
 * область «Свои», удалённые, итоги, «Журнал поступлений», плашки; «Изменить» с причиной (было → стало),
 * предел уменьшения поступления; окно оплаты за обслуживание; закрытый месяц; «Списания в бонус»;
 * баланс счёта сотрудника; изоляция организаций.
 */

const TODAY = '2026-10-28';
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const texts = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const som = (v: number) => v * 100;
/** Пробелы в деньгах — неразрывные: сравниваем текст с обычными. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const refused = (code: string, status = 409) =>
  expect.objectContaining({ name: 'MoneyRefusedError', code, status });
const feeRefused = (code: string, status = 409) =>
  expect.objectContaining({ name: 'FeeRefusedError', code, status });
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const query = (patch: Partial<ListQuery> = {}): ListQuery => ({
  sort: undefined,
  page: 1,
  size: 50,
  filters: {},
  ...patch,
});

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

const assignment = (patch: Partial<AssignmentInput> = {}): AssignmentInput => ({
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
  startDate: '2026-07-01',
  firstMonthMode: 'full',
  feeDay: 15,
  paysTo: 'emp',
  gkedConfirmation: null,
  socfundFlags: {},
  socfundTariff: null,
  ...patch,
});

const TARIFF = { amount: som(3_000), period: 'M' as const, validFrom: '2026-07-01', note: '' };

describe.skipIf(!databaseAvailable())('Журнал финансовых операций и изменение операций', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA = '';
  let accUser = '';
  /** Ответственный — Алишер Т., деньги — ему. */
  let cpMine = '';
  /** Ответственного нет, деньги — организации, есть плата за обслуживание. */
  let cpOrg = '';
  /** Для изменения поступления с потраченными деньгами. */
  let cpSpent = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: accUser }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId } as OrgContext, fn);
  const reportOf = async (contractorId: string, periodStart: string) => {
    const [r] = await inA((tx) =>
      tx
        .select()
        .from(reports)
        .where(
          and(
            eq(reports.contractorId, contractorId),
            eq(reports.reportTypeCode, 'nds'),
            eq(reports.periodStart, periodStart),
            eq(reports.superseded, false),
          ),
        ),
    );
    return r!;
  };
  const setAmount = (id: string, amount: number | null) =>
    inA((tx) => tx.update(reports).set({ amount }).where(eq(reports.id, id)));
  const receipt = (contractorId: string, patch: Partial<ReceiptInput>, fee = false) =>
    inA((tx) =>
      createReceipt(
        tx,
        contractorId,
        { total: 0, date: TODAY, rows: [], files: 0, ...patch },
        { today: TODAY, scope: undefined, filesOn: false, t, fee },
      ),
    );
  const pay = async (id: string, amount: number) => {
    const [r] = await inA((tx) => tx.select().from(reports).where(eq(reports.id, id)));
    return inA((tx) =>
      payReport(
        tx,
        id,
        { version: r!.version, amount, date: TODAY, self: false },
        { today: TODAY, scope: undefined, finScope: undefined },
      ),
    );
  };
  const bonus = (contractorId: string, amount: number, date = TODAY) =>
    inA(async (tx) =>
      writeOff(
        tx,
        await lockMoneyContractor(tx, contractorId, undefined),
        { kind: 'bonus', amount, date, note: 'Остаток после оплаты налогов' },
        { today: TODAY },
      ),
    );
  const opOf = (id: string) =>
    inA(
      async (tx) => (await tx.select().from(moneyOperations).where(eq(moneyOperations.id, id)))[0]!,
    );
  const edit = (id: string, patch: Partial<OperationEditInput>) =>
    inA(async (tx) => {
      const locked = await lockOperation(tx, id, undefined);
      return editOperation(
        tx,
        locked,
        {
          version: locked.op.version,
          amount: Math.abs(Number(locked.op.amount)),
          date: locked.op.opDate,
          note: locked.op.note,
          reason: '',
          ...patch,
        },
        { today: TODAY, t },
      );
    });
  const journal = (o: Partial<FinJournalOptions> = {}, q: Partial<ListQuery> = {}) =>
    inA((tx) =>
      listFinJournalPage(tx, query(q), {
        tab: 'all',
        deleted: false,
        tax: true,
        fee: true,
        scope: undefined,
        t: texts,
        ...o,
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
      slug: 'fj-a',
      owner: owner('fj-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810467',
      slug: 'fj-b',
      owner: owner('fj-owner-b'),
    });
    const role = a.roles.find((r) => r.templateCode === 'acc')!;
    const asOwner = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
      withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
    accA = await asOwner((tx) =>
      createEmployee(tx, {
        fullName: 'Токтогулов Алишер Бакытович',
        shortName: 'Алишер Т.',
        login: 'fj-acc-a',
        passwordHash: 'x',
        phone: null,
        role,
      }),
    );
    const ids = await asOwner((tx) =>
      tx.execute<{ id: string; user_id: string }>(sql`select id, user_id from employees`),
    );
    accUser = ids.find((e) => e.id === accA)!.user_id;
    cpMine = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ responsibleEmployeeId: accA }), null),
    );
    cpOrg = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ИП Садыкова', inn: '21503198700015', paysTo: 'org' }),
        TARIFF,
      ),
    );
    cpSpent = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ОсОО «Укс»', inn: '01503198700018', responsibleEmployeeId: accA }),
        null,
      ),
    );
    await db.admin.db
      .update(contractors)
      .set({ createdAt: new Date('2026-06-20T10:00:00+06:00') })
      .where(sql`true`);
    for (const contractorId of [cpMine, cpOrg, cpSpent]) {
      await inA((tx) =>
        createAssignment(
          tx,
          { ...assignment(), contractorId, reportTypeCode: 'nds' },
          { today: TODAY, scope: undefined, markPast: false, confirm: false, texts: TEXTS },
        ),
      );
    }
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('журнал: вкладки по группам, удалённые — с «Показать удалённые» и без итогов, область «Свои»', async () => {
    const sep = await reportOf(cpMine, '2026-09-01');
    await setAmount(sep.id, som(1_000));
    const { id: inId } = await receipt(cpMine, {
      total: som(1_500),
      rows: [{ reportId: sep.id, amount: som(1_000) }],
    });
    const { id: bonusId } = await bonus(cpMine, som(200));
    const { id: other } = await receipt(cpOrg, { total: som(700) });
    await inA(async (tx) =>
      deleteOperation(tx, await lockOperation(tx, other, undefined), 'Внесли по ошибке', {
        scope: undefined,
        t,
      }),
    );
    const all = await journal();
    expect(all.rows.map((r) => r.id).sort()).toEqual([inId, bonusId].sort());
    // Расход — с минусом; итог: 1 500 − 200.
    expect(all.totals.amount).toBe(som(1_300));
    const inRow = all.rows.find((r) => r.id === inId)!;
    expect(inRow).toMatchObject({ kind: 'in', amount: som(1_500), deleted: false, edited: false });
    expect(plain(inRow.what)).toBe('НДС 09.2026 — 1 000; аванс — 500');
    expect(all.rows.find((r) => r.id === bonusId)).toMatchObject({
      kind: 'bonus',
      signed: -som(200),
      what: 'Остаток после оплаты налогов',
      acc: { kind: 'employee', name: 'Алишер Т.' },
    });
    expect((await journal({ tab: 'wo' })).rows.map((r) => r.id)).toEqual([bonusId]);
    expect((await journal({ tab: 'tax' })).rows.map((r) => r.id)).toEqual([inId]);
    // Налоговые операции не видны — нет строк налогов и списаний.
    expect((await journal({ tax: false })).rows).toEqual([]);
    // «Показать удалённые»: видны, в итоги не входят.
    const withDeleted = await journal({ deleted: true });
    expect(withDeleted.rows.find((r) => r.id === other)).toMatchObject({ deleted: true });
    expect(withDeleted.totals.amount).toBe(som(1_300));
    // Область «Свои»: только контрагенты Алишера.
    const own = await journal({ scope: contractorScope(accA), deleted: true });
    expect(own.rows.every((r) => r.contractor.id !== cpOrg)).toBe(true);
    // Фильтр и поиск — общим механизмом списков.
    const found = await journal({}, { search: { q: 'Остаток после', keys: ['what'] } });
    expect(found.rows.map((r) => r.id)).toEqual([bonusId]);
    // Плашки месяца.
    expect(
      await inA((tx) => finSummary(tx, '2026-10', { tax: true, fee: true, scope: undefined })),
    ).toEqual({
      month: '2026-10',
      tax: { received: som(1_500), paid: 0 },
      fee: 0,
      wo: som(200),
    });
  });

  it('оплаты за обслуживание: строки «Обслуживание» тому, кто видит плату; часть поступления — «из общего поступления»', async () => {
    const { id } = await receipt(
      cpOrg,
      { total: som(4_000), fee: [{ month: '2026-07', amount: som(3_000) }] },
      true,
    );
    const fee = await journal({ tab: 'fee' });
    const part = fee.rows.find((r) => r.src === 'fee' && r.receiptPart)!;
    expect(part).toMatchObject({ kind: 'fee', amount: som(3_000) });
    expect(part.what).toBe('Обслуживание за июль 2026 · из общего поступления');
    // Сама строка поступления — только часть на налоги, и «ещё … за обслуживание» отдельной строкой.
    const row = (await journal({ tab: 'tax' })).rows.find((r) => r.id === id)!;
    expect(row.amount).toBe(som(1_000));
    expect(plain(row.what)).toBe('Аванс · ещё 3 000 сом за обслуживание — отдельной строкой');
    // Без права на плату — без строк обслуживания и без хвоста.
    expect((await journal({ fee: false, tab: 'fee' })).rows).toEqual([]);
    expect((await journal({ fee: false, tab: 'tax' })).rows.find((r) => r.id === id)!.what).toBe(
      'Аванс',
    );
    // «Журнал поступлений»: общая сумма с платой, распределено, аванс.
    const rec = await inA((tx) =>
      listReceiptJournalPage(tx, query(), {
        deleted: false,
        fee: true,
        scope: undefined,
        t: texts,
      }),
    );
    expect(rec.rows.find((r) => r.id === id)).toMatchObject({
      total: som(4_000),
      tax: som(1_000),
      fee: som(3_000),
      distributed: som(3_000),
      advance: som(1_000),
      spent: 0,
    });
    // Часть общего поступления так не удаляют и не меняют.
    const partId = part.id;
    await expect(
      inA(async (tx) => deleteFeePayment(tx, await feePaymentOf(tx, partId, undefined, true), 'x')),
    ).rejects.toEqual(feeRefused('fee_payment_receipt_part'));
  });

  it('проверка задачи (п. 66): поступление 15 000 с потраченными 10 000 не уменьшить ниже 10 000; окно называет оплаты', async () => {
    const sep = await reportOf(cpSpent, '2026-09-01');
    await setAmount(sep.id, som(10_000));
    const { id } = await receipt(cpSpent, {
      total: som(15_000),
      rows: [{ reportId: sep.id, amount: som(10_000) }],
    });
    const { operationId: payId } = await pay(sep.id, som(10_000));
    const form = await inA(async (tx) =>
      receiptEditForm(tx, await lockOperation(tx, id, undefined), { today: TODAY, fee: false, t }),
    );
    expect(form.spent).toMatchObject({ min: som(10_000), payments: [{ id: payId }] });
    expect(form.allocations).toEqual([{ reportId: sep.id, amount: som(10_000) }]);
    // Отчёт из своей детализации остаётся в форме: его «уже получено» — без этого поступления.
    expect(form.rows.rows.find((r) => r.reportId === sep.id)).toMatchObject({ left: som(10_000) });
    const save = (
      total: number,
      reason: string,
      rows = [{ reportId: sep.id, amount: som(10_000) }],
      holder?: string,
    ) =>
      inA(async (tx) => {
        const locked = await lockOperation(tx, id, undefined);
        return editReceipt(
          tx,
          locked,
          {
            version: locked.op.version,
            total,
            date: TODAY,
            rows,
            holder: holder ?? 'org',
            reason,
          },
          { today: TODAY, fee: false, t },
        );
      });
    await expect(save(som(9_000), 'Ошибка', [])).rejects.toEqual(refused('receipt_min', 400));
    // Причина обязательна, если меняются сумма или счёт.
    await expect(save(som(12_000), '')).rejects.toEqual(refused('op_reason_required', 400));
    // Без изменений — сохраняется (прототип inDlg): «Сохранено без изменений», без «Изменена».
    const op0 = await opOf(id);
    const v0 = op0.version;
    expect(await save(som(15_000), '', undefined, holderKeyOf(op0))).toEqual({ changed: false });
    expect(await opOf(id)).toMatchObject({ version: v0 + 1, edited: false });
    expect((await inA((tx) => readHistory(tx, 'money_operation', id))).at(-1)).toMatchObject({
      action: 'update',
      changes: [{ field: 'kind', from: 'in', to: 'in' }],
    });
    expect(await save(som(12_000), 'Ошибка в сумме платёжки')).toEqual({ changed: true });
    const op = await opOf(id);
    expect(op).toMatchObject({ amount: som(12_000), total: som(12_000), edited: true });
    expect(op.holderKind).toBe('org');
    const hist = await inA((tx) => readHistory(tx, 'money_operation', id));
    expect(hist.at(-1)).toMatchObject({
      action: 'update',
      reason: 'Ошибка в сумме платёжки',
      changes: expect.arrayContaining([
        { field: 'total', from: som(15_000), to: som(12_000) },
        expect.objectContaining({ field: 'holder' }),
      ]),
    });
  });

  it('«Изменить» списание: не больше свободного остатка, с причиной; было → стало, «Изменена»', async () => {
    const { id } = await receipt(cpMine, { total: som(300) });
    const { id: bonusId } = await bonus(cpMine, som(100));
    await expect(edit(bonusId, { amount: som(5_000), reason: 'x' })).rejects.toEqual(
      refused('op_free_over', 400),
    );
    await expect(edit(bonusId, { amount: som(150) })).rejects.toEqual(
      refused('op_reason_required', 400),
    );
    await expect(edit(bonusId, { date: '2026-10-29', reason: 'x' })).rejects.toEqual(
      refused('money_date_future', 400),
    );
    expect(await edit(bonusId, { amount: som(150), reason: 'Ошибка в сумме' })).toEqual({
      changed: true,
    });
    expect(await edit(bonusId, {})).toEqual({ changed: false });
    // Примечание меняется без причины.
    expect(await edit(bonusId, { note: 'Бонус за октябрь' })).toEqual({ changed: true });
    expect(await opOf(bonusId)).toMatchObject({ amount: som(150), edited: true });
    const hist = await inA((tx) => readHistory(tx, 'money_operation', bonusId));
    expect(hist.filter((h) => h.action === 'update')).toMatchObject([
      {
        reason: 'Ошибка в сумме',
        changes: [
          { field: 'kind', from: 'bonus', to: 'bonus' },
          { field: 'amount', from: som(100), to: som(150) },
        ],
      },
      {
        changes: [
          { field: 'kind', from: 'bonus', to: 'bonus' },
          { field: 'note', from: 'Остаток после оплаты налогов', to: 'Бонус за октябрь' },
        ],
      },
    ]);
    // Устаревшая версия — «запись изменена другим пользователем».
    await expect(
      inA(async (tx) =>
        editOperation(
          tx,
          await lockOperation(tx, bonusId, undefined),
          { version: 1, amount: som(10), date: TODAY, note: '', reason: 'x' },
          { today: TODAY, t },
        ),
      ),
    ).rejects.toEqual(expect.objectContaining({ name: 'RecordChangedError' }));
    expect(id).toBeTruthy();
  });

  it('«Изменить» оплату налога: «Оплачено в бюджет» отчёта меняется на разницу', async () => {
    const oct = await reportOf(cpMine, '2026-10-01');
    await setAmount(oct.id, som(400));
    await receipt(cpMine, { total: som(1_000) });
    const { operationId } = await pay(oct.id, som(300));
    expect(await edit(operationId, { amount: som(400), reason: 'Ошибка' })).toEqual({
      changed: true,
    });
    const r = await reportOf(cpMine, '2026-10-01');
    expect(Number(r.paid)).toBe(som(400));
  });

  it('закрытый месяц: «Закрыть» — один раз, с записью в истории; оплаты и списания в него не переносят', async () => {
    await bonus(cpMine, som(10), '2026-09-15');
    expect(await inA((tx) => bonusesOfMonth(tx, '2026-09'))).toEqual({
      count: 1,
      amount: som(10),
    });
    await inA((tx) => closeMonth(tx, '2026-09'));
    await expect(inA((tx) => closeMonth(tx, '2026-09'))).rejects.toEqual(
      expect.objectContaining({ name: 'MonthClosedTakenError' }),
    );
    expect(await inA((tx) => closedMonthsOf(tx))).toEqual(['2026-09']);
    expect(await inA((tx) => monthClosed(tx, '2026-09-30'))).toBe(true);
    expect(await inA((tx) => readHistory(tx, 'org_settings', a.orgId))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ changes: [{ field: 'monthClosed', to: '2026-09' }] }),
      ]),
    );
    const { id: bonusId } = await bonus(cpMine, som(5));
    await expect(edit(bonusId, { date: '2026-09-20', reason: 'Не тот месяц' })).rejects.toEqual(
      refused('op_date_closed', 400),
    );
    // Закрытый месяц не открывается снова и не стирается.
    await expect(inA((tx) => tx.delete(closedMonths))).rejects.toEqual(permissionDenied);
    await expect(inA((tx) => tx.update(closedMonths).set({ month: '2026-08-01' }))).rejects.toEqual(
      permissionDenied,
    );
    // «Списания в бонус»: только действующие списания, итог.
    const page = await inA((tx) => listBonusPage(tx, query(), { scope: undefined, t: texts }));
    expect(page.rows.every((r) => r.amount > 0)).toBe(true);
    expect(page.totals.sum).toBe(page.rows.reduce((s, r) => s + r.amount, 0));
  });

  it('оплата за обслуживание: «Изменить» с причиной, «Удалить» с причиной — уходит из долга', async () => {
    const ctx = { today: TODAY, scope: undefined, t };
    const { id } = await inA((tx) =>
      createFeePayment(
        tx,
        cpOrg,
        {
          amount: som(3_000),
          date: TODAY,
          to: 'org',
          allocation: [{ month: '2026-08', amount: som(3_000) }],
          note: '',
        },
        ctx,
      ),
    );
    const save = (patch: { amount?: number; reason?: string; note?: string }) =>
      inA(async (tx) => {
        const locked = await feePaymentOf(tx, id, undefined, true);
        return editFeePayment(
          tx,
          locked,
          {
            version: locked.payment.version,
            amount: patch.amount ?? som(3_000),
            date: TODAY,
            to: 'org',
            allocation: [
              { month: '2026-08', amount: Math.min(patch.amount ?? som(3_000), som(3_000)) },
            ],
            note: patch.note ?? '',
            reason: patch.reason ?? '',
          },
          { today: TODAY, t },
        );
      });
    await expect(save({ amount: som(2_000) })).rejects.toEqual(
      feeRefused('fee_reason_required', 400),
    );
    // Без изменений — сохраняется (прототип feePayDlg): «Изменено: без изменений», без «Изменена».
    const v0 = (await inA((tx) => feePaymentCard(tx, id, undefined)))!.payment.version;
    expect(await save({})).toEqual({ changed: false });
    const same = await inA((tx) => feePaymentCard(tx, id, undefined));
    expect(same!.payment).toMatchObject({ version: v0 + 1, edited: false });
    expect(same!.history[0]).toMatchObject({ action: 'update', changes: [], reason: null });
    expect(await save({ amount: som(2_000), reason: 'Ошибка в сумме' })).toEqual({
      changed: true,
    });
    const card = await inA((tx) => feePaymentCard(tx, id, undefined));
    expect(card).toMatchObject({
      allocation: [{ month: '2026-08', amount: som(2_000) }],
      receipt: null,
    });
    expect(card!.payment).toMatchObject({ amount: som(2_000), edited: true });
    await inA(async (tx) =>
      deleteFeePayment(tx, await feePaymentOf(tx, id, undefined, true), 'Внесли по ошибке'),
    );
    const after = await inA((tx) => feePaymentCard(tx, id, undefined));
    expect(after!.payment.deleteReason).toBe('Внесли по ошибке');
    expect((await journal({ tab: 'fee' })).rows.some((r) => r.id === id)).toBe(false);
    expect(
      (await journal({ tab: 'fee', deleted: true })).rows.find((r) => r.id === id),
    ).toMatchObject({ deleted: true, edited: true });
    // Удалённую не меняют и не удаляют снова.
    await expect(save({ amount: som(1_000), reason: 'x' })).rejects.toEqual(
      feeRefused('fee_payment_deleted'),
    );
    // Стереть оплату не из поступления роль приложения не может.
    await expect(
      inA((tx) => tx.delete(feePayments).where(eq(feePayments.id, id))),
    ).resolves.toBeDefined();
    expect(
      await inA((tx) => tx.select().from(feePayments).where(eq(feePayments.id, id))),
    ).toHaveLength(1);
  });

  it('баланс счёта сотрудника: поступления и переводы — приход, оплаты и бонусы — расход', async () => {
    const [row] = await inA((tx) =>
      tx.select({ balance: EMPLOYEE_BALANCE }).from(employees).where(eq(employees.id, accA)),
    );
    const ops = await inA((tx) =>
      tx
        .select()
        .from(moneyOperations)
        .where(
          and(
            eq(moneyOperations.holderEmployeeId, accA),
            sql`${moneyOperations.cancelledAt} is null`,
          ),
        ),
    );
    const expected = ops.reduce(
      (s, o) =>
        s +
        (['in', 'back', 'corr', 'xfer'].includes(o.kind) ? Number(o.amount) : -Number(o.amount)),
      0,
    );
    expect(Number(row!.balance)).toBe(expected);
  });

  it('чужая организация не видна: журнал, закрытые месяцы, оплаты за обслуживание', async () => {
    const page = await inB((tx) =>
      listFinJournalPage(tx, query(), {
        tab: 'all',
        deleted: true,
        tax: true,
        fee: true,
        scope: undefined,
        t: texts,
      }),
    );
    expect(page.rows).toEqual([]);
    expect(await inB((tx) => closedMonthsOf(tx))).toEqual([]);
    expect(await inB((tx) => tx.select().from(closedMonths))).toEqual([]);
    // Закрыть месяц за чужую организацию нельзя: запись с чужим org_id не создаётся.
    await expect(
      inB((tx) => tx.insert(closedMonths).values({ orgId: a.orgId, month: '2026-07-01' })),
    ).rejects.toThrow();
    expect(
      (await inA((tx) => tx.select().from(closedMonths))).some((m) => m.month === '2026-07-01'),
    ).toBe(false);
    const [fp] = await inA((tx) => tx.select({ id: feePayments.id }).from(feePayments).limit(1));
    expect(await inB((tx) => feePaymentCard(tx, fp!.id, undefined))).toBeNull();
  });
});
