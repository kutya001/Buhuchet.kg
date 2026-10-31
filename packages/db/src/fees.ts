import {
  allocationText,
  canAcceptFeePayment,
  contractorFees,
  currentTariff,
  feePaymentErrorCode,
  feePaymentForm,
  feePaymentProblem,
  formatSomWithUnit,
  localPhoneText,
  MONEY_NOTE_MAX,
  monthLabelGen,
  orgMainAccount,
  purposeServes,
  RecordNotFoundError,
  requisiteText,
  savedAllocation,
  tariffErrorCode,
  tariffProblem,
  type Allocation,
  type ContractorFees,
  type FeeContractor,
  type FeeMessageKey,
  type FeePayment,
  type FeePaymentForm,
  type FeeToKind,
  type FirstMonthMode,
  type IsoDate,
  type PaysTo,
  type Tariff,
  type TariffPeriod,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import { writeHistory } from './history';
import {
  banks,
  contractors,
  contractorTariffs,
  employees,
  feeAllocations,
  feePayments,
  orgAccounts,
  orgSettings,
} from './schema';
import { dateOfMonth, servicePeriodsOf } from './service-periods';
import { phoneCodeList } from './staff';

/*
 * Плата за обслуживание (задача 2.21; ТЗ «Контрагенты» → «Плата за обслуживание»; прототип
 * modules/contractor-card.js — вкладка «Обслуживание», `tariffDlg`, `feePayDlg`; core/derive.js).
 * Правила — @buhuchet/domain (`contractorFees`, `feePaymentForm`, `tariffProblem`); начисления не
 * хранятся — их считает домен по журналу тарифов и периодам обслуживания (docs/decisions.md п. В-7).
 * Здесь — что прочитать и что записать; запись и история — в одной транзакции.
 */

/** Отказ действия платы за обслуживание: код — `FEE_MESSAGES`; 400 — неверный ввод, 409 — не сейчас. */
export class FeeRefusedError extends Error {
  constructor(
    readonly code: FeeMessageKey,
    readonly status: 400 | 409 = 409,
    readonly field?: string,
    readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(code);
    this.name = 'FeeRefusedError';
  }
}

const UUID = /^[0-9a-f-]{36}$/i;
const monthOfDate = (d: string): YearMonth => d.slice(0, 7);

/** Контрагент глазами платы за обслуживание: поля для домена и для окон. */
export interface FeeSubject extends FeeContractor {
  id: string;
  name: string;
  phone: string;
  archived: boolean;
  paysTo: PaysTo;
  oneSum: boolean;
  version: number;
}

/** Оплата за обслуживание с распределением по месяцам. */
export interface FeePaymentRow extends FeePayment {
  id: string;
  date: IsoDate;
  operationId: string | null;
  /** Изменена после ввода (задача 2.22): ярлык «изменена» во вкладке «Обслуживание». */
  edited: boolean;
  author: string | null;
  createdAt: Date;
}

/** Запись журнала тарифов для вкладки: кто и когда внёс, примечание. */
export interface TariffRow extends Tariff {
  id: string;
  note: string;
  author: string | null;
  at: IsoDate;
}

const baseFields = {
  id: contractors.id,
  name: contractors.name,
  phone: contractors.phone,
  kind: contractors.kind,
  start: contractors.startDate,
  createdOn: sql<string>`to_char(${contractors.createdAt} at time zone 'Asia/Bishkek', 'YYYY-MM-DD')`,
  feeDay: contractors.feeDay,
  firstMonth: contractors.firstMonthMode,
  archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
  paysTo: contractors.paysTo,
  oneSum: contractors.oneSum,
  version: contractors.version,
};

/**
 * Контрагенты с журналом тарифов и периодами: `ids` — эти (в области `scope`), null — все
 * контрагенты организации, кроме разовых (для «Должников» и столбца «Долг за обслуживание»).
 */
async function feeSubjects(
  tx: Tx,
  ids: readonly string[] | null,
  scope?: SQL,
): Promise<Map<string, FeeSubject>> {
  const rows = await tx
    .select(baseFields)
    .from(contractors)
    .where(and(ids ? inArray(contractors.id, [...ids]) : ne(contractors.kind, 'oneoff'), scope));
  const list = rows.map((r) => r.id);
  const [periods, tariffs] = await Promise.all([
    servicePeriodsOf(tx, list),
    list.length
      ? tx
          .select({
            contractorId: contractorTariffs.contractorId,
            amount: contractorTariffs.amount,
            period: contractorTariffs.period,
            validFrom: contractorTariffs.validFrom,
          })
          .from(contractorTariffs)
          .where(ids ? inArray(contractorTariffs.contractorId, list) : undefined)
          .orderBy(asc(contractorTariffs.validFrom), asc(contractorTariffs.createdAt))
      : [],
  ]);
  const byId = new Map<string, Tariff[]>();
  for (const t of tariffs) {
    const l = byId.get(t.contractorId) ?? [];
    l.push({ amount: t.amount, period: t.period as TariffPeriod, from: monthOfDate(t.validFrom) });
    byId.set(t.contractorId, l);
  }
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        phone: r.phone,
        oneOff: r.kind === 'oneoff',
        start: r.start,
        createdOn: r.createdOn,
        feeDay: r.feeDay,
        firstMonth: r.firstMonth as FirstMonthMode,
        periods: (periods.get(r.id) ?? []).map(({ from, to }) => ({ from, to })),
        tariffs: byId.get(r.id) ?? [],
        archived: r.archived,
        paysTo: r.paysTo as PaysTo,
        oneSum: r.oneSum,
        version: r.version,
      },
    ]),
  );
}

/**
 * Оплаты контрагентов (`ids`; null — все в организации) с распределением, по дате и времени записи.
 * Удалённые (вместе с общим поступлением — задача 2.20) в долг и итоги не входят; `exceptOperation` —
 * без частей этого поступления (его изменяют: свои части не считаются «уже оплаченным», задача 2.22).
 */
async function feePaymentsOf(
  tx: Tx,
  ids: readonly string[] | null,
  exceptOperation?: string,
): Promise<Map<string, FeePaymentRow[]>> {
  if (ids && ids.length === 0) return new Map();
  const where = and(
    ids ? inArray(feePayments.contractorId, [...ids]) : undefined,
    isNull(feePayments.deletedAt),
    exceptOperation
      ? sql`${feePayments.operationId} is distinct from ${exceptOperation}::uuid`
      : undefined,
  );
  const [pays, allocs] = await Promise.all([
    tx
      .select({
        id: feePayments.id,
        contractorId: feePayments.contractorId,
        amount: feePayments.amount,
        date: feePayments.paidOn,
        operationId: feePayments.operationId,
        edited: feePayments.edited,
        author: employees.shortName,
        createdAt: feePayments.createdAt,
      })
      .from(feePayments)
      .leftJoin(employees, eq(employees.userId, feePayments.createdBy))
      .where(where)
      .orderBy(asc(feePayments.paidOn), asc(feePayments.createdAt), asc(feePayments.id)),
    tx
      .select({
        paymentId: feeAllocations.paymentId,
        month: feeAllocations.month,
        amount: feeAllocations.amount,
      })
      .from(feeAllocations)
      .innerJoin(feePayments, eq(feePayments.id, feeAllocations.paymentId))
      .where(where)
      .orderBy(asc(feeAllocations.month)),
  ]);
  const alloc = new Map<string, { month: YearMonth; amount: Tyiyn }[]>();
  for (const a of allocs) {
    const l = alloc.get(a.paymentId) ?? [];
    l.push({ month: monthOfDate(a.month), amount: a.amount });
    alloc.set(a.paymentId, l);
  }
  const out = new Map<string, FeePaymentRow[]>();
  for (const p of pays) {
    const l = out.get(p.contractorId) ?? [];
    l.push({
      id: p.id,
      amount: p.amount,
      allocation: alloc.get(p.id) ?? [],
      date: p.date,
      operationId: p.operationId,
      edited: p.edited,
      author: p.author,
      createdAt: p.createdAt,
    });
    out.set(p.contractorId, l);
  }
  return out;
}

/** Контрагент в области `scope` с оплатами; null — нет такого или он не виден. */
export async function feeSubject(
  tx: Tx,
  contractorId: string,
  scope: SQL | undefined,
  exceptOperation?: string,
): Promise<{ subject: FeeSubject; payments: FeePaymentRow[] } | null> {
  if (!UUID.test(contractorId)) return null;
  const subject = (await feeSubjects(tx, [contractorId], scope)).get(contractorId);
  if (!subject) return null;
  const payments =
    (await feePaymentsOf(tx, [contractorId], exceptOperation)).get(contractorId) ?? [];
  return { subject, payments };
}

/** Вкладка «Обслуживание» (прототип contractor-card.js, `st.tab==='fee'`). */
export interface ContractorFeeView {
  subject: FeeSubject;
  fees: ContractorFees;
  payments: FeePaymentRow[];
  tariffs: TariffRow[];
  current: Tariff | null;
  canAccept: boolean;
}

/** Начисления, оплаты, долг, аванс и журнал тарифов контрагента; null — нет такого в области. */
export async function contractorFeeView(
  tx: Tx,
  contractorId: string,
  o: { today: IsoDate; scope: SQL | undefined },
): Promise<ContractorFeeView | null> {
  const found = await feeSubject(tx, contractorId, o.scope);
  if (!found) return null;
  const { subject, payments } = found;
  const fees = contractorFees(subject, payments, o.today);
  const tariffs = await tx
    .select({
      id: contractorTariffs.id,
      amount: contractorTariffs.amount,
      period: contractorTariffs.period,
      from: contractorTariffs.validFrom,
      note: contractorTariffs.note,
      author: employees.shortName,
      at: sql<string>`to_char(${contractorTariffs.createdAt} at time zone 'Asia/Bishkek', 'YYYY-MM-DD')`,
    })
    .from(contractorTariffs)
    .leftJoin(employees, eq(employees.userId, contractorTariffs.createdBy))
    .where(eq(contractorTariffs.contractorId, contractorId))
    .orderBy(asc(contractorTariffs.validFrom), asc(contractorTariffs.createdAt));
  return {
    subject,
    fees,
    payments,
    tariffs: tariffs.map((x) => ({
      ...x,
      period: x.period as TariffPeriod,
      from: monthOfDate(x.from),
    })),
    current: currentTariff(subject.tariffs, o.today),
    canAccept: canAcceptFeePayment(subject, subject.archived, fees),
  };
}

/** Поле таблицы долгов `fd` — для столбца, фильтра и плашки списка контрагентов. */
export const FEE_DEBT = {
  id: sql.raw('"fd"."id"'),
  debt: sql.raw('"fd"."debt"'),
  charged: sql.raw('"fd"."charged"'),
};

/**
 * Долг за обслуживание контрагентов организации (прототип derive: `c.feeDebt`): считается доменом по
 * журналу тарифов, периодам и оплатам и подставляется в запрос списка таблицей `fd` (id, debt,
 * charged — есть начисление больше 0, прототип `feeAccOk`). Разовых и контрагентов без начислений и
 * долга в таблице нет; должник — `debt > 0`.
 */
export async function feeDebtTable(tx: Tx, today: IsoDate): Promise<SQL> {
  const [subjects, payments] = await Promise.all([feeSubjects(tx, null), feePaymentsOf(tx, null)]);
  const out: { id: string; debt: number; charged: boolean }[] = [];
  for (const s of subjects.values()) {
    const { debt, months } = contractorFees(s, payments.get(s.id) ?? [], today);
    const charged = months.some((m) => m.charge > 0);
    if (debt > 0 || charged) out.push({ id: s.id, debt, charged });
  }
  return sql`jsonb_to_recordset(${JSON.stringify(out)}::jsonb) as fd(id uuid, debt bigint, charged boolean)`;
}

/** Куда поступили деньги (прототип `fpTo`): счета организации для обслуживания, иначе «Счёт организации»; «Владельцу». */
export interface FeeToOption {
  /** `acc:<номер счёта>`, `org` (счетов нет) или `owner`. */
  key: string;
  label: string;
  main: boolean;
}

/**
 * Варианты «Куда поступили деньги» (прототип `fpTo`): счета организации с назначением «Обслуживание»
 * (основной — первым), если их нет — «Счёт организации»; последним — «Владельцу организации».
 */
export async function feeToOptions(tx: Tx, t: Translate): Promise<FeeToOption[]> {
  const [accounts, codes] = await Promise.all([
    tx
      .select({
        id: orgAccounts.id,
        kind: orgAccounts.kind,
        purpose: orgAccounts.purpose,
        mainTax: orgAccounts.mainTax,
        mainFee: orgAccounts.mainFee,
        phone: orgAccounts.phone,
        phoneBanks: orgAccounts.phoneBanks,
        bankName: banks.name,
      })
      .from(orgAccounts)
      .leftJoin(banks, eq(banks.code, orgAccounts.bankCode))
      .orderBy(asc(orgAccounts.createdAt), asc(orgAccounts.id)),
    phoneCodeList(tx),
  ]);
  const bankNames = await bankNamesOf(
    tx,
    accounts.flatMap((a) => a.phoneBanks),
  );
  const serving = accounts.filter((a) => purposeServes(a.purpose, 'fee'));
  const main = orgMainAccount(serving, 'fee');
  const ordered = main ? [main, ...serving.filter((a) => a !== main)] : serving;
  const options: FeeToOption[] = ordered.map((a) => {
    const bank =
      a.kind === 'phone'
        ? a.phoneBanks.map((c) => bankNames.get(c) ?? c).join(', ')
        : (a.bankName ?? '');
    const text =
      a.kind === 'phone' && a.phone
        ? t('fee.to.account_phone', { bank, phone: localPhoneText(a.phone, codes) })
        : t('fee.to.account', { bank });
    return {
      key: `acc:${a.id}`,
      label: a.id === main?.id ? t('fee.to.main', { text }) : text,
      main: a.id === main?.id,
    };
  });
  if (!options.length) options.push({ key: 'org', label: t('fee.to.org'), main: false });
  options.push({ key: 'owner', label: t('fee.to.owner'), main: false });
  return options;
}

/** Названия банков и кошельков по кодам справочника платформы. */
export async function bankNamesOf(tx: Tx, codes: readonly string[]): Promise<Map<string, string>> {
  const list = [...new Set(codes)];
  if (!list.length) return new Map();
  const rows = await tx
    .select({ code: banks.code, name: banks.name })
    .from(banks)
    .where(inArray(banks.code, list));
  return new Map(rows.map((r) => [r.code, r.name]));
}

/**
 * Основной счёт организации для обслуживания строкой для сообщения контрагенту (прототип `rqTxt` у
 * `orgMain('fee')`); null — счетов для обслуживания нет.
 */
export async function mainFeeRequisite(
  tx: Tx,
  t: Translate,
): Promise<{ text: string; bank: string; number: string; phone: boolean; holder: string } | null> {
  const accounts = await tx
    .select({
      id: orgAccounts.id,
      kind: orgAccounts.kind,
      purpose: orgAccounts.purpose,
      mainTax: orgAccounts.mainTax,
      mainFee: orgAccounts.mainFee,
      accountNo: orgAccounts.accountNo,
      bik: orgAccounts.bik,
      phone: orgAccounts.phone,
      phoneBanks: orgAccounts.phoneBanks,
      holderName: orgAccounts.holderName,
      bankName: banks.name,
    })
    .from(orgAccounts)
    .leftJoin(banks, eq(banks.code, orgAccounts.bankCode))
    .orderBy(asc(orgAccounts.createdAt), asc(orgAccounts.id));
  const a = orgMainAccount(accounts, 'fee');
  if (!a) return null;
  const [codes, names] = await Promise.all([phoneCodeList(tx), bankNamesOf(tx, a.phoneBanks)]);
  const bankNames =
    a.kind === 'phone' ? a.phoneBanks.map((c) => names.get(c) ?? c) : [a.bankName ?? ''];
  const phoneText = a.phone ? localPhoneText(a.phone, codes) : '';
  return {
    text: requisiteText(
      {
        kind: a.kind,
        bankNames,
        accountNo: a.accountNo,
        bik: a.bik,
        phoneText,
        holderName: a.holderName,
      },
      'org',
      t,
    ),
    bank: bankNames.join(', '),
    number: a.kind === 'phone' ? phoneText : (a.accountNo ?? ''),
    phone: a.kind === 'phone',
    holder: a.holderName,
  };
}

/**
 * Контрагент заблокирован до конца транзакции (как у денег по отчётам, `no key update`): оплаты и
 * ставки по нему пишет одно действие, долг считается под блокировкой.
 */
async function lockFeeSubject(
  tx: Tx,
  contractorId: string,
  scope: SQL | undefined,
): Promise<{ subject: FeeSubject; payments: FeePaymentRow[] }> {
  if (!UUID.test(contractorId)) throw new RecordNotFoundError('contractor', contractorId);
  const [locked] = await tx
    .select({ id: contractors.id })
    .from(contractors)
    .where(and(eq(contractors.id, contractorId), scope))
    .for('no key update');
  const found = locked ? await feeSubject(tx, contractorId, scope) : null;
  if (!found) throw new RecordNotFoundError('contractor', contractorId);
  return found;
}

/** Ввод окна «Новая ставка обслуживания». */
export interface TariffInput {
  amount: Tyiyn;
  period: TariffPeriod;
  from: YearMonth;
  note: string;
}

/**
 * «Добавить в журнал» (прототип `tariffDlg`): ставка не меньше 0, месяц не прошлый, если ставка уже есть —
 * со следующего месяца, не чаще раза в месяц; у разового ставок не вносят (у архивного — можно, как в
 * прототипе). Запись журнала
 * не меняется и не удаляется; в истории контрагента — «Новая ставка …».
 */
export async function addTariff(
  tx: Tx,
  contractorId: string,
  input: TariffInput,
  ctx: { today: IsoDate; scope: SQL | undefined },
): Promise<{ id: string }> {
  const { subject } = await lockFeeSubject(tx, contractorId, ctx.scope);
  // У архивного ставку внести можно, как в прототипе (`tariffDlg` — по одному праву); начислений по ней
  // нет, пока контрагент в архиве.
  if (subject.oneOff) throw new FeeRefusedError('tariff_oneoff');
  const problem = tariffProblem(subject.tariffs, input.amount, input.from, ctx.today);
  if (problem) {
    throw new FeeRefusedError(
      tariffErrorCode(problem),
      400,
      problem === 'amount_required' ? 'amount' : 'from',
    );
  }
  const note = input.note.trim().slice(0, MONEY_NOTE_MAX);
  const [row] = await tx
    .insert(contractorTariffs)
    .values({
      orgId: sql`app.current_org_id()`,
      contractorId,
      amount: input.amount,
      period: input.period,
      validFrom: dateOfMonth(input.from),
      note,
      createdBy: sql`app.current_user_id()`,
    })
    .returning({ id: contractorTariffs.id });
  await writeHistory(tx, {
    entity: 'contractor',
    entityId: contractorId,
    action: 'update',
    changes: [
      {
        field: 'tariffAdded',
        to: {
          amount: input.amount,
          period: input.period,
          validFrom: dateOfMonth(input.from),
          note,
        },
      },
    ],
    contractorId,
  });
  return { id: row!.id };
}

/** Окно «Принять оплату за обслуживание»: строки месяцев, сумма и распределение по умолчанию. */
export async function feePaymentFormOf(
  tx: Tx,
  contractorId: string,
  o: { today: IsoDate; scope: SQL | undefined },
): Promise<{ subject: FeeSubject; fees: ContractorFees; form: FeePaymentForm } | null> {
  const found = await feeSubject(tx, contractorId, o.scope);
  if (!found) return null;
  const fees = contractorFees(found.subject, found.payments, o.today);
  return {
    subject: found.subject,
    fees,
    form: feePaymentForm(found.subject, found.payments, fees.debt, o.today),
  };
}

/** Ввод окна «Принять оплату за обслуживание». */
export interface FeePaymentInput {
  amount: Tyiyn;
  date: IsoDate;
  /** `acc:<номер счёта>`, `org` или `owner` — из `feeToOptions`. */
  to: string;
  allocation: Allocation;
  note: string;
}

/**
 * «Принять оплату» (прототип `feePayDlg`, ТЗ «Принять оплату за обслуживание»): у контрагента есть
 * начисления, он не разовый и не в архиве; сумма больше 0, строки — неоплаченные месяцы, каждая не
 * больше долга за месяц, сумма строк не больше суммы (остальное — аванс), дата не позже сегодня; деньги —
 * только организации (её счёт для обслуживания или владельцу). В истории — «Оплата за обслуживание …».
 */
export async function createFeePayment(
  tx: Tx,
  contractorId: string,
  input: FeePaymentInput,
  ctx: { today: IsoDate; scope: SQL | undefined; t: Translate },
): Promise<{ id: string }> {
  const { subject, payments } = await lockFeeSubject(tx, contractorId, ctx.scope);
  const fees = contractorFees(subject, payments, ctx.today);
  if (!canAcceptFeePayment(subject, subject.archived, fees)) {
    throw new FeeRefusedError('fee_not_accepted');
  }
  const form = feePaymentForm(subject, payments, fees.debt, ctx.today);
  const allocation = savedAllocation(input.allocation);
  if (new Set(allocation.map((x) => x.month)).size !== allocation.length) {
    throw new FeeRefusedError('fee_month_invalid', 400, 'allocation');
  }
  const open = new Set(form.months.map((m) => m.month));
  if (allocation.some((x) => !open.has(x.month))) {
    throw new FeeRefusedError('fee_month_invalid', 400, 'allocation');
  }
  const problem = feePaymentProblem(form.months, input.amount, allocation, input.date, ctx.today);
  if (problem) {
    throw new FeeRefusedError(
      feePaymentErrorCode(problem.problem),
      400,
      problem.field === 'date'
        ? 'date'
        : problem.problem === 'row_over_debt'
          ? 'allocation'
          : 'amount',
      problem.over !== undefined ? { amount: formatSomWithUnit(problem.over) } : undefined,
    );
  }
  const to = (await feeToOptions(tx, ctx.t)).find((x) => x.key === input.to);
  if (!to) throw new FeeRefusedError('fee_to_invalid', 400, 'to');
  const toKind: FeeToKind = to.key === 'owner' ? 'owner' : 'org';
  const [row] = await tx
    .insert(feePayments)
    .values({
      contractorId,
      amount: input.amount,
      paidOn: input.date,
      toKind,
      toAccountId: to.key.startsWith('acc:') ? to.key.slice(4) : null,
      toLabel: to.label,
      note: input.note.trim().slice(0, MONEY_NOTE_MAX),
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: feePayments.id });
  await insertAllocations(tx, row!.id, allocation);
  await writeHistory(tx, {
    entity: 'fee_payment',
    entityId: row!.id,
    action: 'create',
    changes: [
      { field: 'amount', to: input.amount },
      { field: 'paidOn', to: input.date },
      { field: 'allocation', to: allocation.map((x) => ({ month: x.month, amount: x.amount })) },
      { field: 'to', to: to.label },
    ],
    contractorId,
  });
  return { id: row!.id };
}

async function insertAllocations(tx: Tx, paymentId: string, allocation: Allocation) {
  if (!allocation.length) return;
  await tx.insert(feeAllocations).values(
    allocation.map((x) => ({
      paymentId,
      month: dateOfMonth(x.month),
      amount: x.amount,
    })),
  );
}

/**
 * Месяцы с недоплатой для части за обслуживание в окне поступления (прототип inDlg: `fms`, `fLeft`);
 * у разового контрагента — пусто.
 */
export async function receiptFeeRows(
  tx: Tx,
  contractorId: string,
  today: IsoDate,
  editOperation?: string,
): Promise<ReceiptFeeMonth[]> {
  const found = await feeSubject(tx, contractorId, undefined, editOperation);
  if (!found) return [];
  const months = receiptFeeMonths(found.subject, found.payments, today);
  if (!editOperation) return months;
  // Изменение поступления (задача 2.22; прототип inDlg: `fms` — и месяцы, которые оно уже закрывало).
  const own = await receiptFeeParts(tx, editOperation);
  const all = contractorFees(found.subject, found.payments, today).months;
  const listed = new Set(months.map((m) => m.month));
  for (const p of own) {
    if (listed.has(p.month)) continue;
    const m = all.find((x) => x.month === p.month);
    if (!m) continue;
    months.push({ month: m.month, charge: m.charge, got: m.got, left: 0, due: m.due });
    listed.add(m.month);
  }
  return months.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

/** Сколько осталось получить за месяц — для проверки поступления; контрагент уже заблокирован. */
export async function receiptFeeLeft(
  tx: Tx,
  contractorId: string,
  today: IsoDate,
  editOperation?: string,
): Promise<Map<YearMonth, Tyiyn>> {
  return new Map(
    (await receiptFeeRows(tx, contractorId, today, editOperation)).map((m) => [m.month, m.left]),
  );
}

/** Части за обслуживание поступления (не удалённые): по месяцу на оплату. */
export async function receiptFeeParts(
  tx: Tx,
  operationId: string,
): Promise<{ id: string; month: YearMonth; amount: Tyiyn }[]> {
  const rows = await tx
    .select({ id: feePayments.id, month: feeAllocations.month, amount: feeAllocations.amount })
    .from(feePayments)
    .innerJoin(feeAllocations, eq(feeAllocations.paymentId, feePayments.id))
    .where(and(eq(feePayments.operationId, operationId), isNull(feePayments.deletedAt)))
    .orderBy(asc(feeAllocations.month));
  return rows.map((r) => ({ id: r.id, month: monthOfDate(r.month), amount: Number(r.amount) }));
}

/**
 * Часть за обслуживание из поступления от контрагента (прототип inDlg: на каждый месяц `feeAlloc` —
 * своя запись `FEEPAYS` со ссылкой на поступление): по оплате на месяц, на счёт организации. Строки
 * уже проверены вызывающим (`receiptFeeLeft`).
 */
export async function insertReceiptFeePayments(
  tx: Tx,
  contractorId: string,
  input: { operationId: string; date: IsoDate; rows: Allocation },
  t: Translate,
): Promise<void> {
  for (const x of input.rows) {
    const [row] = await tx
      .insert(feePayments)
      .values({
        contractorId,
        amount: x.amount,
        paidOn: input.date,
        toKind: 'org',
        toLabel: t('fee.to.org'),
        operationId: input.operationId,
        createdBy: sql`app.current_user_id()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .returning({ id: feePayments.id });
    await insertAllocations(tx, row!.id, [x]);
  }
}

/** Строка обслуживания в окне поступления (прототип inDlg, `fms`): месяц, начислено, уже получено, осталось. */
export interface ReceiptFeeMonth {
  month: YearMonth;
  charge: Tyiyn;
  got: Tyiyn;
  left: Tyiyn;
  due: IsoDate;
}

/** Месяцы с недоплатой — для части за обслуживание в поступлении (прототип inDlg: `fLeft(mm) > 0`). */
export function receiptFeeMonths(
  subject: FeeSubject,
  payments: readonly FeePayment[],
  today: IsoDate,
): ReceiptFeeMonth[] {
  return contractorFees(subject, payments, today)
    .months.filter((m) => m.charge - m.got > 0)
    .map((m) => ({
      month: m.month,
      charge: m.charge,
      got: m.got,
      left: m.charge - m.got,
      due: m.due,
    }));
}

/**
 * «Напомнить в WhatsApp» нажато (прототип waDlg с `fee`: «Напоминание в WhatsApp о долге за
 * обслуживание»): запись в истории контрагента.
 */
export async function logFeeReminder(tx: Tx, contractorId: string): Promise<void> {
  await writeHistory(tx, {
    entity: 'contractor',
    entityId: contractorId,
    action: 'remind',
    changes: [{ field: 'feeReminder' }],
    contractorId,
  });
}

/** «Платит одной суммой» (прототип contractor-card.js, `cp-one`): с версией и историей контрагента. */
export function oneSumHistory(on: boolean) {
  return { field: 'oneSum', from: !on, to: on };
}

/** Есть ли оплаты за обслуживание у контрагента: его можно только отправить в архив. */
export async function contractorHasFeePayments(tx: Tx, contractorId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: feePayments.id })
    .from(feePayments)
    .where(eq(feePayments.contractorId, contractorId))
    .limit(1);
  return !!row;
}

/** «Оплата за обслуживание 30 000 сом: октябрь 2026 — 30 000» — для сообщений и проверок. */
export function feePaymentLogText(t: Translate, total: Tyiyn, allocation: Allocation): string {
  return t('fee.hist.payment', {
    amount: formatSomWithUnit(total),
    what: allocationText(t, total, allocation),
  });
}

/** «Новая ставка 40 000 сом в месяц с сентября 2026». */
export function tariffLogText(t: Translate, x: Tariff): string {
  return t('fee.hist.tariff', {
    amount: formatSomWithUnit(x.amount),
    per: t(x.period === 'Y' ? 'fee.tariffs.per_year' : 'fee.tariffs.per_month'),
    month: monthLabelGen(x.from),
  });
}

/**
 * Оплата за обслуживание как источник файлов (скрин перевода, квитанция): контрагент в области `scope`
 * и включена ли «Плата за обслуживание»; null — нет такой оплаты или контрагент вне области.
 */
export async function feePaymentFileSource(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<{
  contractor: { id: string; responsibleEmployeeId: string | null; archived: boolean };
  /** «Плата за обслуживание» включена в учётной политике. */
  feeOn: boolean;
} | null> {
  if (!UUID.test(id)) return null;
  const [row] = await tx
    .select({
      id: contractors.id,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
      feeOn: sql<boolean>`coalesce((select (${orgSettings.features} ->> 'fee')::boolean from ${orgSettings} where ${orgSettings.orgId} = app.current_org_id()), false)`,
    })
    .from(feePayments)
    .innerJoin(contractors, eq(contractors.id, feePayments.contractorId))
    .where(and(eq(feePayments.id, id), scope));
  if (!row) return null;
  return {
    contractor: {
      id: row.id,
      responsibleEmployeeId: row.responsibleEmployeeId,
      archived: row.archived,
    },
    feeOn: row.feeOn,
  };
}
