import { formatText, UI_TEXTS, type ListQuery, type Translate } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { contractorHistory, type ContractorHistoryAccess } from './contractor-history';
import {
  contractorSummary,
  contractorTabCounts,
  contractorUsage,
  createContractor,
  listContractorsPage,
  type ContractorFields,
  type ContractorListOptions,
} from './contractors';
import {
  addTariff,
  contractorFeeView,
  createFeePayment,
  feePaymentFormOf,
  feeToOptions,
  logFeeReminder,
  type FeePaymentInput,
} from './fees';
import { readHistory } from './history';
import { createReceipt, saveMoneySettings, type ReceiptInput } from './money-tax';
import { createOrganization, type CreatedOrganization } from './organizations';
import { contractors, feeAllocations, feePayments, moneyOperations } from './schema';
import { readSpecJson } from './spec-data';
import { seedPermissions, seedRoleTemplates } from './seed';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-28';
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const som = (v: number) => v * 100;
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const refused = (code: string, status = 400) =>
  expect.objectContaining({ name: 'FeeRefusedError', code, status });
const moneyRefused = (code: string, status = 400) =>
  expect.objectContaining({ name: 'MoneyRefusedError', code, status });
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;

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
  paysTo: 'org',
  gkedConfirmation: null,
  socfundFlags: {},
  socfundTariff: null,
  ...patch,
});

const TARIFF = { amount: som(30_000), period: 'M' as const, validFrom: '2026-07-01', note: '' };

describe.skipIf(!databaseAvailable())('Плата за обслуживание: оплаты, ставки, долг', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let cpPay = '';
  let cpDebt = '';
  let cpOne = '';
  let cpB = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId } as OrgContext, fn);
  const ctx = { today: TODAY, scope: undefined, t };
  const pay = (id: string, patch: Partial<FeePaymentInput>) =>
    inA((tx) =>
      createFeePayment(
        tx,
        id,
        { amount: 0, date: TODAY, to: 'org', allocation: [], note: '', ...patch },
        ctx,
      ),
    );
  const view = (id: string) =>
    inA((tx) => contractorFeeView(tx, id, { today: TODAY, scope: undefined }));
  const receipt = (id: string, patch: Partial<ReceiptInput>, fee = true) =>
    inA((tx) =>
      createReceipt(
        tx,
        id,
        { total: 0, date: TODAY, rows: [], files: 0, ...patch },
        { today: TODAY, scope: undefined, filesOn: false, t, fee },
      ),
    );
  const listOptions = (patch: Partial<ContractorListOptions> = {}): ContractorListOptions => ({
    t: (key) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key,
    today: TODAY,
    fee: true,
    scope: undefined,
    tab: 'all',
    employeeId: a.ownerEmployeeId,
    ...patch,
  });
  const access = (fee: boolean): ContractorHistoryAccess => ({
    fee,
    reports: undefined,
    tasks: true,
    kpi: false,
    files: false,
    money: undefined,
  });

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
      slug: 'fees-a',
      owner: owner('fees-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810467',
      slug: 'fees-b',
      owner: owner('fees-owner-b'),
    });
    cpPay = await inA((tx) => createContractor(tx, a.orgId, fields(), TARIFF));
    cpDebt = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ name: 'ИП Садыкова', inn: '21503198700015' }), TARIFF),
    );
    cpOne = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ИП Разовый', inn: '21503198700023', kind: 'oneoff' }),
        null,
      ),
    );
    cpB = await inB((tx) => createContractor(tx, b.orgId, fields(), TARIFF));
    // Контрагентов «завели» в июне: начисления — с месяца начала обслуживания (п. В-5).
    await db.admin.db
      .update(contractors)
      .set({ createdAt: new Date('2026-06-20T10:00:00+06:00') })
      .where(sql`true`);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('вкладка «Обслуживание»: начисления с июля, долг за прошедшие сроки, принять можно', async () => {
    const v = (await view(cpPay))!;
    expect(v.fees.months.map((m) => [m.month, m.charge / 100, m.status])).toEqual([
      ['2026-07', 30_000, 'unpaid'],
      ['2026-08', 30_000, 'unpaid'],
      ['2026-09', 30_000, 'unpaid'],
      ['2026-10', 30_000, 'unpaid'],
    ]);
    expect(v.fees.debt).toBe(som(120_000));
    expect(v.canAccept).toBe(true);
    expect(v.current).toEqual({ amount: som(30_000), period: 'M', from: '2026-07' });
    expect(v.tariffs.map((x) => x.from)).toEqual(['2026-07']);
    // У разового начислений нет — оплату не принять.
    expect((await view(cpOne))!.canAccept).toBe(false);
    // Чужой контрагент не виден.
    expect(await view(cpB)).toBeNull();
  });

  it('окно оплаты: подставлен долг, распределение от старых к новым', async () => {
    const f = (await inA((tx) =>
      feePaymentFormOf(tx, cpDebt, { today: TODAY, scope: undefined }),
    ))!;
    expect(f.form.amount).toBe(som(120_000));
    expect(f.form.months.map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(await inA((tx) => feeToOptions(tx, t))).toEqual([
      { key: 'org', label: 'Счёт организации', main: false },
      { key: 'owner', label: 'Владельцу организации', main: false },
    ]);
  });

  it('«Принять оплату»: распределение по месяцам, излишек — аванс, история', async () => {
    const { id } = await pay(cpPay, {
      amount: som(70_000),
      allocation: [
        { month: '2026-07', amount: som(30_000) },
        { month: '2026-08', amount: som(30_000) },
      ],
      to: 'owner',
    });
    const [row] = await inA((tx) => tx.select().from(feePayments).where(eq(feePayments.id, id)));
    expect(row).toMatchObject({
      amount: som(70_000),
      toKind: 'owner',
      toLabel: 'Владельцу организации',
    });
    const allocs = await inA((tx) =>
      tx.select().from(feeAllocations).where(eq(feeAllocations.paymentId, id)),
    );
    expect(allocs.map((x) => [x.month, x.amount])).toEqual([
      ['2026-07-01', som(30_000)],
      ['2026-08-01', som(30_000)],
    ]);
    const v = (await view(cpPay))!;
    // Аванс 10 000 сам засчитан в сентябрь.
    expect(v.fees.months.map((m) => [m.month, m.got / 100, m.status])).toEqual([
      ['2026-07', 30_000, 'paid'],
      ['2026-08', 30_000, 'paid'],
      ['2026-09', 10_000, 'partial'],
      ['2026-10', 0, 'unpaid'],
    ]);
    expect(v.fees.debt).toBe(som(50_000));
    expect(v.fees.advance).toBe(0);
    const hist = await inA((tx) => readHistory(tx, 'fee_payment', id));
    expect(hist[0]).toMatchObject({ action: 'create', contractorId: cpPay });
    expect(hist[0]!.changes).toEqual([
      { field: 'amount', to: som(70_000) },
      { field: 'paidOn', to: TODAY },
      {
        field: 'allocation',
        to: [
          { month: '2026-07', amount: som(30_000) },
          { month: '2026-08', amount: som(30_000) },
        ],
      },
      { field: 'to', to: 'Владельцу организации' },
    ]);
  });

  it('оплата: неверные строки, суммы, дата и «куда» — отказ', async () => {
    // Июль уже оплачен — его строки в окне нет.
    await expect(
      pay(cpPay, { amount: som(1_000), allocation: [{ month: '2026-07', amount: som(1_000) }] }),
    ).rejects.toEqual(refused('fee_month_invalid'));
    await expect(
      pay(cpPay, { amount: som(50_000), allocation: [{ month: '2026-09', amount: som(25_000) }] }),
    ).rejects.toEqual(refused('fee_row_over_debt'));
    await expect(
      pay(cpPay, { amount: som(5_000), allocation: [{ month: '2026-10', amount: som(10_000) }] }),
    ).rejects.toEqual(refused('fee_allocated_over_amount'));
    await expect(pay(cpPay, { amount: 0 })).rejects.toEqual(refused('fee_amount_required'));
    await expect(pay(cpPay, { amount: som(1_000), date: '2026-10-29' })).rejects.toEqual(
      refused('fee_date_future'),
    );
    await expect(pay(cpPay, { amount: som(1_000), to: 'acc:x' })).rejects.toEqual(
      refused('fee_to_invalid'),
    );
    await expect(pay(cpOne, { amount: som(1_000) })).rejects.toEqual(
      refused('fee_not_accepted', 409),
    );
    await expect(pay(cpB, { amount: som(1_000) })).rejects.toThrow();
  });

  it('новая ставка: с будущего месяца, не дважды в месяц, история', async () => {
    const add = (from: string, amount = som(35_000)) =>
      inA((tx) =>
        addTariff(
          tx,
          cpDebt,
          { amount, period: 'M', from, note: '' },
          { today: TODAY, scope: undefined },
        ),
      );
    await add('2026-11');
    await expect(add('2026-11')).rejects.toEqual(refused('tariff_month_taken'));
    await expect(add('2026-09')).rejects.toEqual(refused('tariff_month_past'));
    const v = (await view(cpDebt))!;
    expect(v.tariffs.map((x) => [x.from, x.amount / 100])).toEqual([
      ['2026-07', 30_000],
      ['2026-11', 35_000],
    ]);
    // Прошлые начисления не пересчитываются.
    expect(v.fees.debt).toBe(som(120_000));
    const hist = await inA((tx) => readHistory(tx, 'contractor', cpDebt));
    expect(hist.at(-1)!.changes).toEqual([
      {
        field: 'tariffAdded',
        to: { amount: som(35_000), period: 'M', validFrom: '2026-11-01', note: '' },
      },
    ]);
    await expect(
      inA((tx) =>
        addTariff(tx, cpOne, { amount: som(1), period: 'M', from: '2026-11', note: '' }, ctx),
      ),
    ).rejects.toEqual(refused('fee_not_accepted', 409));
  });

  it('часть за обслуживание в поступлении: по оплате на месяц, на налоги — остальное', async () => {
    await expect(
      receipt(
        cpPay,
        { total: som(20_000), fee: [{ month: '2026-09', amount: som(20_000) }] },
        false,
      ),
    ).rejects.toEqual(moneyRefused('receipt_fee_invalid'));
    await expect(
      receipt(cpPay, { total: som(30_000), fee: [{ month: '2026-09', amount: som(25_000) }] }),
    ).rejects.toEqual(moneyRefused('receipt_row_over'));
    await expect(
      receipt(cpPay, { total: som(30_000), fee: [{ month: '2026-07', amount: som(1_000) }] }),
    ).rejects.toEqual(moneyRefused('receipt_fee_invalid'));
    await expect(
      receipt(cpPay, { total: som(10_000), fee: [{ month: '2026-10', amount: som(20_000) }] }),
    ).rejects.toEqual(moneyRefused('receipt_total_less'));
    const { id } = await receipt(cpPay, {
      total: som(60_000),
      fee: [
        { month: '2026-10', amount: som(30_000) },
        { month: '2026-09', amount: som(20_000) },
      ],
    });
    const [op] = await inA((tx) =>
      tx.select().from(moneyOperations).where(eq(moneyOperations.id, id)),
    );
    expect([op!.amount, op!.total]).toEqual([som(10_000), som(60_000)]);
    const parts = await inA((tx) =>
      tx
        .select()
        .from(feePayments)
        .where(eq(feePayments.operationId, id))
        .orderBy(feePayments.amount),
    );
    expect(parts.map((p) => [p.amount, p.toKind])).toEqual([
      [som(20_000), 'org'],
      [som(30_000), 'org'],
    ]);
    expect((await view(cpPay))!.fees.debt).toBe(0);
    const hist = await inA((tx) => readHistory(tx, 'money_operation', id));
    expect(hist[0]!.changes).toEqual(
      expect.arrayContaining([
        { field: 'total', to: som(10_000) },
        { field: 'feeTotal', to: som(50_000) },
        {
          field: 'feeAllocations',
          to: [
            { month: '2026-09', amount: som(20_000) },
            { month: '2026-10', amount: som(30_000) },
          ],
        },
      ]),
    );
  });

  it('у контрагента со счётом ответственного части за обслуживание в поступлении нет', async () => {
    const cpEmp = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ОсОО «Бета»', inn: '01503198700031', paysTo: 'emp' }),
        TARIFF,
      ),
    );
    await db.admin.db
      .update(contractors)
      .set({ createdAt: new Date('2026-06-20T10:00:00+06:00') })
      .where(eq(contractors.id, cpEmp));
    await expect(
      receipt(cpEmp, { total: som(10_000), fee: [{ month: '2026-10', amount: som(10_000) }] }),
    ).rejects.toEqual(moneyRefused('receipt_fee_invalid'));
  });

  it('список: «Долг за обслуживание» с итогом, «Должники», плашка и счётчик', async () => {
    const page = await inA((tx) => listContractorsPage(tx, query(), listOptions()));
    const debtOf = (id: string) => page.rows.find((r) => r.id === id)!.feeDebt;
    expect(debtOf(cpPay)).toBe(0);
    expect(debtOf(cpDebt)).toBe(som(120_000));
    expect(debtOf(cpOne)).toBe(0);
    expect(page.totals.debt).toBe(som(120_000) + som(30_000) * 4);
    const debtors = await inA((tx) =>
      listContractorsPage(tx, query(), listOptions({ tab: 'debtors' })),
    );
    expect(debtors.rows.map((r) => r.name).sort()).toEqual(['ИП Садыкова', 'ОсОО «Бета»']);
    const summary = await inA((tx) => contractorSummary(tx, listOptions()));
    expect(summary.debtors).toEqual({ count: 2, sum: som(240_000) });
    const counts = await inA((tx) =>
      contractorTabCounts(tx, undefined, a.ownerEmployeeId, { today: TODAY }),
    );
    expect(counts.debtors).toBe(2);
    // Без права на плату — ни долга, ни «Должников».
    const hidden = await inA((tx) => listContractorsPage(tx, query(), listOptions({ fee: false })));
    expect(hidden.rows.every((r) => r.feeDebt === null)).toBe(true);
    expect(
      (
        await inA((tx) =>
          listContractorsPage(tx, query(), listOptions({ fee: false, tab: 'debtors' })),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await inA((tx) => contractorSummary(tx, listOptions({ fee: false })))).debtors,
    ).toBeNull();
    expect(
      (await inA((tx) => contractorTabCounts(tx, undefined, a.ownerEmployeeId))).debtors,
    ).toBeNull();
  });

  it('история контрагента: без права на плату — без оплат, ставок и напоминаний', async () => {
    await inA((tx) => logFeeReminder(tx, cpPay));
    const full = (await inA((tx) =>
      contractorHistory(tx, cpPay, { scope: undefined, access: access(true), t }),
    ))!;
    expect(full.items.some((r) => r.entity === 'fee_payment')).toBe(true);
    expect(full.items.some((r) => r.changes.some((c) => c.field === 'feeReminder'))).toBe(true);
    expect(full.items.some((r) => r.changes.some((c) => c.field === 'feeTotal'))).toBe(true);
    const cut = (await inA((tx) =>
      contractorHistory(tx, cpPay, { scope: undefined, access: access(false), t }),
    ))!;
    expect(cut.items.some((r) => r.entity === 'fee_payment')).toBe(false);
    const fieldsOf = cut.items.flatMap((r) => r.changes.map((c) => c.field));
    for (const f of ['feeReminder', 'feeTotal', 'feeAllocations', 'tariff']) {
      expect(fieldsOf).not.toContain(f);
    }
    // Поступление видно — без части за обслуживание.
    expect(cut.items.some((r) => r.entity === 'money_operation')).toBe(true);
  });

  it('«Платит одной суммой»: с версией и историей, у разового — нет', async () => {
    const [c] = await inA((tx) => tx.select().from(contractors).where(eq(contractors.id, cpDebt)));
    await inA((tx) =>
      saveMoneySettings(tx, cpDebt, { version: c!.version, oneSum: true }, undefined),
    );
    const [after] = await inA((tx) =>
      tx.select().from(contractors).where(eq(contractors.id, cpDebt)),
    );
    expect(after!.oneSum).toBe(true);
    const hist = await inA((tx) => readHistory(tx, 'contractor', cpDebt));
    expect(hist.at(-1)!.changes).toEqual([{ field: 'oneSum', from: false, to: true }]);
    const [one] = await inA((tx) => tx.select().from(contractors).where(eq(contractors.id, cpOne)));
    await expect(
      inA((tx) => saveMoneySettings(tx, cpOne, { version: one!.version, oneSum: true }, undefined)),
    ).rejects.toEqual(moneyRefused('one_sum_one_off'));
  });

  it('оплаты за обслуживание — деньги: контрагента нельзя удалить', async () => {
    expect((await inA((tx) => contractorUsage(tx, cpPay))).money).toBe(1);
    expect((await inA((tx) => contractorUsage(tx, cpOne))).money).toBe(0);
  });

  it('оплаты и распределение не меняются и не удаляются ролью приложения', async () => {
    await expect(inA((tx) => tx.update(feePayments).set({ amount: 1 }))).rejects.toEqual(
      permissionDenied,
    );
    await expect(inA((tx) => tx.delete(feePayments))).rejects.toEqual(permissionDenied);
    await expect(inA((tx) => tx.update(feeAllocations).set({ amount: 1 }))).rejects.toEqual(
      permissionDenied,
    );
    await expect(inA((tx) => tx.delete(feeAllocations))).rejects.toEqual(permissionDenied);
  });

  it('чужая организация оплат и распределения не видит и не пишет', async () => {
    expect(await inB((tx) => tx.select().from(feePayments))).toEqual([]);
    expect(await inB((tx) => tx.select().from(feeAllocations))).toEqual([]);
    const all = await db.admin.db.select().from(feePayments);
    expect(all.length).toBeGreaterThan(0);
    const [p] = all;
    // Распределение на оплату чужой организации не вставить: строка с org_id своей организации не
    // найдёт оплату (составной внешний ключ), а с чужим org_id отсекает политика.
    await expect(
      inB((tx) =>
        tx.insert(feeAllocations).values({ paymentId: p!.id, month: '2026-10-01', amount: 1 }),
      ),
    ).rejects.toThrow();
    await expect(
      inB((tx) =>
        tx
          .insert(feePayments)
          .values({ orgId: a.orgId, contractorId: cpPay, amount: 1, paidOn: TODAY, toKind: 'org' }),
      ),
    ).rejects.toThrow();
  });
});
