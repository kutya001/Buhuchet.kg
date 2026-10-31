import type { IsoDate } from '../common/dates';
import { formatSomWithUnit, type Tyiyn } from '../common/money';
import { addMonths, monthOf, type YearMonth } from '../common/months';
import { MONEY_OP_KINDS, type MoneyHolderKind, type MoneyOpKind } from './tax';

/*
 * Окно финансовой операции и операции со свободным остатком (задачи 2.20 и 2.22; ТЗ «Финансовые
 * операции по контрагентам» → «Окно оплаты», «Остаток после оплаты», «Счёт организации», «Отчёт по
 * списаниям»; прототип modules/fin-op.js `opLock`, `opMax`, `opEditDlg`, `inBlock`, `opDelDlg`,
 * modules/finance.js `orgHeld`, `empBal`, `corrDlg`, `inMin`, modules/staff.js — вкладки «Счёт» и
 * «Списания в бонус», modules/services.js — разовые услуги). Все суммы — целые тыйыны.
 */

/**
 * Запись, которую открывает окно операции (прототип `opKind`): операция по счёту контрагента, оплата за
 * обслуживание (`fee`), оплата разовой услуги (`sp`) и сама разовая услуга (`svc`).
 */
export const FIN_OP_KINDS = [...MONEY_OP_KINDS, 'fee', 'sp', 'svc'] as const;
export type FinOpKind = (typeof FIN_OP_KINDS)[number];

/** Право, с которым операцию изменяют и удаляют (прототип `opPerm`, ТЗ «Окно оплаты» → «Права»). */
export type OpRight = 'money' | 'bonus' | 'tariff' | 'projects';

export function opRight(kind: FinOpKind): OpRight {
  if (kind === 'bonus') return 'bonus';
  if (kind === 'fee') return 'tariff';
  if (kind === 'sp' || kind === 'svc') return 'projects';
  return 'money';
}

/** Списание в бонус и возврат остатка: «Отменить списание», «Отменить возврат». */
export const isWriteOff = (kind: FinOpKind): kind is 'bonus' | 'refund' =>
  kind === 'bonus' || kind === 'refund';

/** Виды, которые закрытый месяц фиксирует (ТЗ «Отчёт по списаниям»; прототип `opLock`). */
export const closesWithMonth = (kind: FinOpKind): boolean => kind === 'pay' || isWriteOff(kind);

/** Почему «Изменить» или «Удалить» нельзя — код текста `MONEY_MESSAGES`. */
export const OP_LOCKS = [
  'op_deleted',
  'service_deleted',
  'op_system',
  'op_view_only',
  'op_archived',
  'month_closed',
  'fee_part_delete',
  'fee_part_money',
] as const;
export type OpLock = (typeof OP_LOCKS)[number];

/** Что известно об операции и сотруднике для `opLock`. */
export interface OpLockFacts {
  kind: FinOpKind;
  /** Операция удалена (отменена). */
  deleted: boolean;
  /** Оплата разовой услуги, а сама услуга удалена. */
  ownerDeleted?: boolean;
  /** Есть право `opRight(kind)` и контрагент в его области. */
  canKind: boolean;
  /** Право «Решать, что делать с остатком у архивных» (archiveRest). */
  canArchiveRest: boolean;
  /** Право «Учёт денег и оплата налогов». */
  canMoney: boolean;
  archived: boolean;
  /** Месяц даты операции закрыт отчётом о списаниях. */
  monthClosed: boolean;
  /** Оплата за обслуживание — часть общего поступления. */
  receiptPart: boolean;
}

/**
 * Почему операцию нельзя изменить (`edit`) или удалить (`del`), null — можно (прототип `opLock`):
 * удалённая; созданная системой (возврат по уточнённому расчёту); без права — только просмотр; у
 * архивного контрагента — только списание и возврат остатка с правом «Остаток при архивировании»;
 * оплата налога, списание и возврат в закрытом месяце; часть общего поступления удаляют и меняют в
 * самом поступлении.
 */
export function opLock(f: OpLockFacts, act: 'edit' | 'del'): OpLock | null {
  if (f.ownerDeleted) return 'service_deleted';
  if (f.deleted) return 'op_deleted';
  if (f.kind === 'back') return 'op_system';
  const wo = isWriteOff(f.kind);
  if (!(f.canKind || (f.archived && wo && f.canArchiveRest))) return 'op_view_only';
  if (f.archived && !wo) return 'op_archived';
  if (closesWithMonth(f.kind) && f.monthClosed) return 'month_closed';
  if (f.kind === 'fee' && f.receiptPart) {
    if (act === 'del') return 'fee_part_delete';
    if (!f.canMoney) return 'fee_part_money';
  }
  return null;
}

/**
 * Предел суммы при изменении (прототип `opMax`): оплата налога — не больше денег контрагента на
 * счетах, списание и возврат — не больше свободного остатка, перевод — не больше денег контрагента на
 * счёте организации, оплата услуги — не больше её стоимости. `current` — сумма операции сейчас; остальные
 * суммы — без неё.
 */
export type OpLimit = {
  max: Tyiyn;
  code: 'op_pay_over' | 'op_free_over' | 'op_xfer_over' | 'op_service_over';
  params: Record<string, string>;
} | null;

export function opAmountLimit(
  kind: FinOpKind,
  current: Tyiyn,
  m: {
    /** Деньги контрагента на счетах (`fundsBalance`). */
    available: Tyiyn;
    /** Свободный остаток (`contractorMoney().free`). */
    free: Tyiyn;
    /** Деньги контрагента на счёте организации (`orgHeld`). */
    orgHeld: Tyiyn;
    self?: boolean;
    /** Разовая услуга: стоимость и получено по ней. */
    service?: { amount: Tyiyn; paid: Tyiyn };
  },
): OpLimit {
  const som = formatSomWithUnit;
  if (kind === 'pay' && !m.self) {
    const max = current + m.available;
    return { max, code: 'op_pay_over', params: { left: som(m.available), max: som(max) } };
  }
  if (isWriteOff(kind)) {
    const max = current + m.free;
    return { max, code: 'op_free_over', params: { free: som(m.free), max: som(max) } };
  }
  if (kind === 'xfer') {
    const max = m.orgHeld + current;
    return { max, code: 'op_xfer_over', params: { held: som(m.orgHeld), max: som(max) } };
  }
  if (kind === 'sp' && m.service) {
    const max = m.service.amount - (m.service.paid - current);
    return { max, code: 'op_service_over', params: { max: som(max) } };
  }
  return null;
}

/** Операция для подсчёта денег по счетам: вид, сумма, счёт, «Оплатил контрагент сам». */
export interface HeldOp {
  kind: MoneyOpKind;
  amount: Tyiyn;
  holderKind: MoneyHolderKind;
  holderEmployeeId: string | null;
  self?: boolean;
}

/**
 * Деньги контрагента на счёте организации (прототип `orgHeld`): поступления, возвраты по уточнённому и
 * обратные записи на счёт организации прибавляют, оплаты, списания и возвраты с него — вычитают, каждый
 * перевод на счёт сотрудника — вычитает; не меньше 0.
 */
export function orgHeld(ops: readonly HeldOp[]): Tyiyn {
  let b = 0;
  for (const o of ops) {
    if (o.kind === 'xfer') {
      b -= o.amount;
      continue;
    }
    if (o.holderKind !== 'org') continue;
    b += o.kind === 'in' || o.kind === 'back' || o.kind === 'corr' ? o.amount : -o.amount;
  }
  return Math.max(0, b);
}

/** Строка «В разрезе контрагентов» вкладки «Счёт» сотрудника. */
export interface AccountRow {
  contractorId: string;
  /** «Поступило»: поступления, возвраты по уточнённому, обратные записи и переводы на счёт. */
  received: Tyiyn;
  /** «Оплачено»: оплаты налогов с этого счёта. */
  paid: Tyiyn;
  /** «Бонус»: списания в бонус. */
  bonus: Tyiyn;
  /** Возвраты контрагенту. */
  out: Tyiyn;
  /** «Остаток». */
  rest: Tyiyn;
}

export interface EmployeeAccount {
  /** «Баланс счёта». */
  balance: Tyiyn;
  /** «Поступления». */
  received: Tyiyn;
  /** «Оплаты налогов». */
  paid: Tyiyn;
  /** «Накоплено бонусов». */
  bonus: Tyiyn;
  rows: AccountRow[];
}

/**
 * Виртуальный счёт сотрудника (прототип staff.js, вкладка `acc`; `empBal`): операции на его счёте по
 * контрагентам в порядке первого появления; поступления, возвраты по уточнённому, обратные записи и
 * переводы — приход, оплаты, бонусы и возвраты контрагенту — расход.
 */
export function employeeAccount(
  ops: readonly (HeldOp & { contractorId: string })[],
  employeeId: string,
): EmployeeAccount {
  const by = new Map<string, AccountRow>();
  for (const o of ops) {
    if (o.holderKind !== 'employee' || o.holderEmployeeId !== employeeId) continue;
    let x = by.get(o.contractorId);
    if (!x) {
      x = { contractorId: o.contractorId, received: 0, paid: 0, bonus: 0, out: 0, rest: 0 };
      by.set(o.contractorId, x);
    }
    if (o.kind === 'in' || o.kind === 'back' || o.kind === 'corr' || o.kind === 'xfer')
      x.received += o.amount;
    else if (o.kind === 'pay') x.paid += o.amount;
    else if (o.kind === 'bonus') x.bonus += o.amount;
    else x.out += o.amount;
  }
  const rows = [...by.values()].map((x) => ({
    ...x,
    rest: x.received - x.paid - x.bonus - x.out,
  }));
  const sum = (k: 'received' | 'paid' | 'bonus' | 'out') => rows.reduce((a, x) => a + x[k], 0);
  return {
    balance: sum('received') - sum('paid') - sum('bonus') - sum('out'),
    received: sum('received'),
    paid: sum('paid'),
    bonus: sum('bonus'),
    rows,
  };
}

/**
 * Сколько из поступления уже потрачено на налоги (прототип `inMin`): на налоги должно остаться не
 * меньше; у удалённого — 0. `available` — деньги контрагента на счетах вместе с этим поступлением.
 */
export const receiptMinimum = (taxAmount: Tyiyn, available: Tyiyn): Tyiyn =>
  Math.max(0, taxAmount - available);

/**
 * Обратная запись «Уменьшить» (прототип `corrDlg`): не больше денег контрагента на счетах и не больше
 * самого поступления с его обратными записями.
 */
export const correctionMinusLimit = (
  available: Tyiyn,
  receiptTax: Tyiyn,
  corrections: Tyiyn,
): Tyiyn => Math.max(0, Math.min(available, receiptTax + corrections));

/**
 * Удалить нельзя (прототип `opDelDlg`): поступление, деньги которого уже потрачены на налоги, и
 * обратную запись «+», если эти деньги уже потрачены. null — можно.
 */
export function deleteBlock(
  kind: FinOpKind,
  amount: Tyiyn,
  available: Tyiyn,
): 'receipt_spent' | 'correction_spent' | null {
  if (kind === 'in' && amount - available > 0) return 'receipt_spent';
  if (kind === 'corr' && amount > 0 && amount > available) return 'correction_spent';
  return null;
}

/** Оплата налога для таблицы «Удалить нельзя» (прототип `inBlock`). */
export interface BlockingPayment {
  id: string;
  reportId: string;
  date: IsoDate;
  amount: Tyiyn;
  createdAt: number;
}

/**
 * Оплаты, которые мешают уменьшить или удалить поступление (прототип `inBlock`): сначала оплаты
 * отчётов из его детализации, потом остальные — от новых к старым; не больше 8.
 */
export function blockingPayments<P extends BlockingPayment>(
  pays: readonly P[],
  receiptReports: ReadonlySet<string>,
): P[] {
  return [...pays]
    .sort(
      (a, b) =>
        Number(receiptReports.has(b.reportId)) - Number(receiptReports.has(a.reportId)) ||
        (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt),
    )
    .slice(0, 8);
}

/** Прошлый месяц: его закрывает «Закрыть <месяц>» во вкладке «Списания в бонус». */
export const monthToClose = (today: IsoDate): YearMonth => addMonths(monthOf(today), -1);

/** Месяц операции закрыт. */
export const inClosedMonth = (date: IsoDate, closed: ReadonlySet<YearMonth>): boolean =>
  closed.has(monthOf(date));

/** Статус оплаты разовой услуги — шкала `payment` (прототип `svcStatus`). */
export function serviceStatus(amount: Tyiyn, paid: Tyiyn): 'paid' | 'partial' | 'unpaid' {
  if (paid >= amount) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

/** Название разовой услуги и описание — не длиннее. */
export const SERVICE_NAME_MAX = 300;
export const SERVICE_DESCRIPTION_MAX = 2000;

/** Причина изменения и удаления операции — не длиннее. */
export const OP_REASON_MAX = 500;

/**
 * Что изменилось в операции (прототип `opEditDlg`, `ch`): сумма, дата, счёт — для них нужна причина;
 * примечание и файлы причины не требуют.
 */
export function needsReason(changed: readonly string[]): boolean {
  return changed.some((f) =>
    ['amount', 'opDate', 'holder', 'total', 'allocations', 'feeAllocations', 'to'].includes(f),
  );
}
