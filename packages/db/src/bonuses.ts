import { createHash } from 'node:crypto';
import {
  BONUS_NOTE_MAX,
  bonusBalance,
  bonusOutProblems,
  EMPTY_BONUS_BALANCE,
  formatSomWithUnit,
  formatText,
  RecordChangedError,
  RecordNotFoundError,
  serviceBonusEditBlock,
  serviceBonusOn,
  serviceBonusProblem,
  SERVICE_BONUS_LINES_MAX,
  type BonusBalance,
  type BonusLogKind,
  type IsoDate,
  type ListQuery,
  type ListSort,
  type ServiceBonusLine,
  type Tyiyn,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory } from './history';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import { MoneyRefusedError } from './money-tax';
import {
  bonusWriteoffs,
  contractors,
  employees,
  moneyOperations,
  oneOffServiceBonuses,
  oneOffServicePayments,
  oneOffServices,
  roles,
} from './schema';

/*
 * Бонусы сотрудников (прототип v84 и v87, просьба заказчика 12.11.2026: modules/services.js —
 * `bonusLog`, `bonusSum`, `svcBonusOn`, `serviceDlg`, `bonusOutDlg`, `bonusUndo`; modules/staff.js —
 * вкладка «Бонусы»; docs/deviations.md п. О-75). Начисления — списания остатков контрагентов в бонус со
 * счёта сотрудника (`money_operations`, вид `bonus`) и строки бонусов разовых услуг
 * (`one_off_service_bonuses`): за услугу — когда она оплачена полностью, датой последней оплаты, до
 * этого «Ожидает оплаты услуги». Выплата — списание (`bonus_writeoffs`), отменяется отметкой. Права
 * проверяет API; здесь — правила записи, блокировки и история.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Кому видны контрагент и основание записи журнала: условие по таблице `contractors` (область «Свои»),
 * `undefined` — все контрагенты, `null` — права видеть нет совсем.
 */
export type BonusSee = SQL | undefined | null;

export interface BonusVisibility {
  /** Списания остатков контрагентов: кто видит деньги контрагентов, в своей области. */
  ops: BonusSee;
  /** Разовые услуги: кому видны услуги, в своей области. */
  services: BonusSee;
}

const seen = (see: BonusSee): SQL<boolean> =>
  see === null ? sql<boolean>`false` : sql<boolean>`coalesce(${see ?? sql`true`}, false)`;

/* ───────────── Строки бонусов услуги ───────────── */

export interface ServiceBonusRow extends ServiceBonusLine {
  /** Краткое имя сотрудника. */
  name: string;
  fullName: string;
}

/** Бонусы услуги в порядке окна. */
export async function serviceBonusesOf(tx: Tx, serviceId: string): Promise<ServiceBonusRow[]> {
  const rows = await tx
    .select({
      employeeId: oneOffServiceBonuses.employeeId,
      amount: oneOffServiceBonuses.amount,
      name: employees.shortName,
      fullName: employees.fullName,
    })
    .from(oneOffServiceBonuses)
    .innerJoin(employees, eq(employees.id, oneOffServiceBonuses.employeeId))
    .where(eq(oneOffServiceBonuses.serviceId, serviceId))
    .orderBy(asc(oneOffServiceBonuses.position), asc(oneOffServiceBonuses.id));
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** Запись истории услуги о бонусах: кому и сколько (имя — на момент записи). */
export const bonusHistoryValue = (rows: readonly ServiceBonusRow[]) =>
  rows.map((b) => ({ employeeId: b.employeeId, name: b.name, amount: b.amount }));

const refuse = (
  code: ConstructorParameters<typeof MoneyRefusedError>[0],
  status: 400 | 409,
  field?: string,
  params: Record<string, string> = {},
) => new MoneyRefusedError(code, status, field, params);

/** Действующие оплаты услуги: для даты начисления бонуса. */
async function servicePayments(tx: Tx, serviceId: string) {
  const rows = await tx
    .select({
      amount: oneOffServicePayments.amount,
      date: oneOffServicePayments.paidOn,
      deleted: sql<boolean>`${oneOffServicePayments.deletedAt} is not null`,
    })
    .from(oneOffServicePayments)
    .where(eq(oneOffServicePayments.serviceId, serviceId));
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/**
 * Сотрудники строк: действующие сотрудники организации; при изменении можно оставить того, кто уже был
 * в бонусах услуги, даже если он больше не работает (прототип: `EMP.filter(x => x.active || …)`). Строки
 * сотрудников блокируются по порядку — списание бонуса и правка услуги не обгоняют друг друга.
 */
async function lockBonusEmployees(tx: Tx, ids: readonly string[], keep: ReadonlySet<string>) {
  const list = [...new Set(ids)].sort();
  if (list.some((id) => !UUID.test(id))) throw refuse('bonus_employee_invalid', 400, 'bonuses');
  if (!list.length) return new Map<string, { name: string; fullName: string }>();
  const rows = await tx
    .select({
      id: employees.id,
      active: employees.active,
      name: employees.shortName,
      fullName: employees.fullName,
    })
    .from(employees)
    .where(inArray(employees.id, list))
    .orderBy(asc(employees.id))
    .for('no key update');
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of list) {
    const e = byId.get(id);
    if (!e || (!e.active && !keep.has(id))) throw refuse('bonus_employee_invalid', 400, 'bonuses');
  }
  return byId;
}

/**
 * Записать бонусы услуги (прототип `serviceDlg`): сотрудник и сумма в каждой строке, сотрудники не
 * повторяются, в сумме не больше стоимости; правка не уводит уже списанный бонус в минус. `cost` —
 * стоимость услуги после правки, `wasCost` — до неё (null — услуга только что создана). Возвращает
 * «было» и «стало» для истории; null — строки не изменились.
 */
export async function saveServiceBonuses(
  tx: Tx,
  serviceId: string,
  lines: readonly ServiceBonusLine[],
  o: { cost: Tyiyn; wasCost: Tyiyn | null },
): Promise<{ from: ServiceBonusRow[]; to: ServiceBonusRow[] } | null> {
  if (lines.length > SERVICE_BONUS_LINES_MAX) throw refuse('bonus_over_cost', 400, 'bonuses');
  const problem = serviceBonusProblem(lines, o.cost);
  if (problem)
    throw refuse(
      problem.problem as never,
      400,
      'bonuses',
      problem.amount !== undefined ? { amount: formatSomWithUnit(problem.amount) } : {},
    );
  const prev = o.wasCost === null ? [] : await serviceBonusesOf(tx, serviceId);
  const names = await lockBonusEmployees(
    tx,
    [...prev.map((b) => b.employeeId), ...lines.map((b) => b.employeeId)],
    new Set(prev.map((b) => b.employeeId)),
  );
  if (prev.length) {
    // Оплаты правка услуги не меняет: «был начислен» — по прежней стоимости, «останется» — по новой.
    const pays = await servicePayments(tx, serviceId);
    const was = serviceBonusOn(o.wasCost ?? o.cost, pays) !== null;
    const will = serviceBonusOn(o.cost, pays) !== null;
    const balances = await bonusBalances(
      tx,
      prev.map((b) => b.employeeId),
    );
    const block = serviceBonusEditBlock({
      was,
      will,
      prev,
      next: lines,
      balanceOf: (id) => (balances.get(id) ?? EMPTY_BONUS_BALANCE).bal,
    });
    if (block)
      throw refuse('bonus_spent', 409, 'bonuses', {
        name: names.get(block.employeeId)?.name ?? '',
        amount: formatSomWithUnit(block.balance),
        ...(block.variant === 'wait' ? { variant: 'wait' } : {}),
      });
  }
  const same =
    prev.length === lines.length &&
    prev.every((b, i) => b.employeeId === lines[i]!.employeeId && b.amount === lines[i]!.amount);
  if (same) return null;
  if (prev.length)
    await tx.delete(oneOffServiceBonuses).where(eq(oneOffServiceBonuses.serviceId, serviceId));
  if (lines.length)
    await tx.insert(oneOffServiceBonuses).values(
      lines.map((b, position) => ({
        serviceId,
        employeeId: b.employeeId,
        amount: b.amount,
        position,
        createdBy: sql`app.current_user_id()`,
      })),
    );
  const to = lines.map((b) => ({
    ...b,
    name: names.get(b.employeeId)!.name,
    fullName: names.get(b.employeeId)!.fullName,
  }));
  return { from: prev, to };
}

/**
 * Стоимость услуги меняют без блока бонусов — у сотрудника нет права на бонусы или поле не передано
 * (строже прототипа, docs/deviations.md п. О-75): прежние бонусы в сумме остаются не больше новой
 * стоимости, а уже списанный бонус не уходит в минус, когда услуга перестаёт быть оплаченной. Отказ —
 * общий, без имён и сумм: строки бонусов такому сотруднику не показаны.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-75
export async function checkServiceBonusCost(
  tx: Tx,
  serviceId: string,
  o: { cost: Tyiyn; wasCost: Tyiyn },
): Promise<void> {
  const prev = await serviceBonusesOf(tx, serviceId);
  if (!prev.length) return;
  if (serviceBonusProblem(prev, o.cost)) throw refuse('bonus_cost', 409, 'amount');
  const ids = prev.map((b) => b.employeeId);
  await lockBonusEmployees(tx, ids, new Set(ids));
  const pays = await servicePayments(tx, serviceId);
  const balances = await bonusBalances(tx, ids);
  const block = serviceBonusEditBlock({
    was: serviceBonusOn(o.wasCost, pays) !== null,
    will: serviceBonusOn(o.cost, pays) !== null,
    prev,
    next: prev,
    balanceOf: (id) => (balances.get(id) ?? EMPTY_BONUS_BALANCE).bal,
  });
  if (block) throw refuse('bonus_cost', 409, 'amount');
}

/* ───────────── Журнал начислений и списаний ───────────── */

/** Запись журнала «Начисления и списания» (прототип `bonusLog`). */
export interface BonusLogRow {
  /** `o:<операция>`, `s:<строка бонуса услуги>`, `w:<списание>`. */
  id: string;
  kind: BonusLogKind;
  date: IsoDate;
  employeeId: string;
  employeeName: string;
  /** Со знаком: списание — с минусом. */
  amount: Tyiyn;
  /** Контрагент и основание — только тому, кто видит запись-источник (`BonusVisibility`). */
  contractor: { id: string; name: string } | null;
  /** ИНН контрагента — для «Название или ИНН» фильтра столбца; виден тому же, кто видит контрагента. */
  contractorInn: string | null;
  what: string;
  /** У ожидающего бонуса: сколько оплачено по услуге и её стоимость. */
  paid: Tyiyn | null;
  cost: Tyiyn | null;
  by: string | null;
  createdAt: string;
  serviceId: string | null;
  operationId: string | null;
  writeoff: { id: string; version: number } | null;
}

const logBy = alias(employees, 'bonus_log_by');
const logEmp = alias(employees, 'bonus_log_emp');
const stamp = (column: unknown) => sql<string>`to_json(${column}) #>> '{}'`;

/**
 * Все записи журнала организации (или одного сотрудника): списания остатков контрагентов в бонус со
 * счёта сотрудника, бонусы за неудалённые услуги (начисленные и ожидающие оплаты), действующие списания.
 */
export async function bonusLogRows(
  tx: Tx,
  see: BonusVisibility,
  employeeIds?: readonly string[],
): Promise<BonusLogRow[]> {
  if (employeeIds && !employeeIds.length) return [];
  const only = (column: Parameters<typeof inArray>[0]) =>
    employeeIds ? inArray(column, [...employeeIds]) : undefined;
  const [ops, lines, outs] = await Promise.all([
    tx
      .select({
        id: moneyOperations.id,
        date: moneyOperations.opDate,
        employeeId: sql<string>`${moneyOperations.holderEmployeeId}`,
        employeeName: logEmp.shortName,
        amount: moneyOperations.amount,
        contractorId: contractors.id,
        contractorName: contractors.name,
        contractorInn: contractors.inn,
        note: moneyOperations.note,
        by: logBy.shortName,
        createdAt: stamp(moneyOperations.createdAt),
        seen: seen(see.ops),
      })
      .from(moneyOperations)
      .innerJoin(contractors, eq(contractors.id, moneyOperations.contractorId))
      .innerJoin(logEmp, eq(logEmp.id, moneyOperations.holderEmployeeId))
      .leftJoin(logBy, eq(logBy.userId, moneyOperations.createdBy))
      .where(
        and(
          eq(moneyOperations.kind, 'bonus'),
          isNull(moneyOperations.cancelledAt),
          eq(moneyOperations.holderKind, 'employee'),
          only(moneyOperations.holderEmployeeId),
        ),
      ),
    tx
      .select({
        id: oneOffServiceBonuses.id,
        serviceId: oneOffServices.id,
        serviceDate: oneOffServices.serviceDate,
        cost: oneOffServices.amount,
        name: oneOffServices.name,
        employeeId: oneOffServiceBonuses.employeeId,
        employeeName: logEmp.shortName,
        amount: oneOffServiceBonuses.amount,
        contractorId: contractors.id,
        contractorName: contractors.name,
        contractorInn: contractors.inn,
        by: logBy.shortName,
        createdAt: stamp(oneOffServices.createdAt),
        seen: seen(see.services),
        pays: sql<
          { amount: number; date: IsoDate }[]
        >`coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount, 'date', p.paid_on)) from ${oneOffServicePayments} p where p.service_id = ${oneOffServices.id} and p.deleted_at is null), '[]'::jsonb)`,
      })
      .from(oneOffServiceBonuses)
      .innerJoin(oneOffServices, eq(oneOffServices.id, oneOffServiceBonuses.serviceId))
      .innerJoin(contractors, eq(contractors.id, oneOffServices.contractorId))
      .innerJoin(logEmp, eq(logEmp.id, oneOffServiceBonuses.employeeId))
      .leftJoin(logBy, eq(logBy.userId, oneOffServices.createdBy))
      .where(and(isNull(oneOffServices.deletedAt), only(oneOffServiceBonuses.employeeId))),
    tx
      .select({
        id: bonusWriteoffs.id,
        version: bonusWriteoffs.version,
        date: bonusWriteoffs.paidOn,
        employeeId: bonusWriteoffs.employeeId,
        employeeName: logEmp.shortName,
        amount: bonusWriteoffs.amount,
        note: bonusWriteoffs.note,
        by: logBy.shortName,
        createdAt: stamp(bonusWriteoffs.createdAt),
      })
      .from(bonusWriteoffs)
      .innerJoin(logEmp, eq(logEmp.id, bonusWriteoffs.employeeId))
      .leftJoin(logBy, eq(logBy.userId, bonusWriteoffs.createdBy))
      .where(and(isNull(bonusWriteoffs.deletedAt), only(bonusWriteoffs.employeeId))),
  ]);
  const base = { paid: null, cost: null, serviceId: null, operationId: null, writeoff: null };
  return [
    ...ops.map((o): BonusLogRow => ({
      ...base,
      // Кому операция не видна, её номер не отдаётся: ключ строки — отпечаток номера.
      id: `o:${o.seen ? o.id : createHash('sha256').update(o.id).digest('hex').slice(0, 32)}`,
      kind: 'cp',
      date: o.date,
      employeeId: o.employeeId,
      employeeName: o.employeeName,
      amount: Number(o.amount),
      contractor: o.seen ? { id: o.contractorId, name: o.contractorName } : null,
      contractorInn: o.seen ? o.contractorInn : null,
      what: o.seen ? o.note : '',
      by: o.by,
      createdAt: o.createdAt,
      operationId: o.seen ? o.id : null,
    })),
    ...lines.map((b): BonusLogRow => {
      const cost = Number(b.cost);
      const pays = b.pays.map((p) => ({ amount: Number(p.amount), date: p.date, deleted: false }));
      const on = serviceBonusOn(cost, pays);
      return {
        ...base,
        id: `s:${b.id}`,
        kind: on ? 'svc' : 'wait',
        date: on ?? b.serviceDate,
        employeeId: b.employeeId,
        employeeName: b.employeeName,
        amount: Number(b.amount),
        contractor: b.seen ? { id: b.contractorId, name: b.contractorName } : null,
        contractorInn: b.seen ? b.contractorInn : null,
        what: b.seen ? b.name : '',
        paid: on ? null : pays.reduce((sum, p) => sum + p.amount, 0),
        cost: on ? null : cost,
        by: b.by,
        createdAt: b.createdAt,
        serviceId: b.seen ? b.serviceId : null,
      };
    }),
    ...outs.map((x): BonusLogRow => ({
      ...base,
      id: `w:${x.id}`,
      kind: 'out',
      date: x.date,
      employeeId: x.employeeId,
      employeeName: x.employeeName,
      amount: -Number(x.amount),
      contractor: null,
      contractorInn: null,
      what: x.note,
      by: x.by,
      createdAt: x.createdAt,
      writeoff: { id: x.id, version: x.version },
    })),
  ];
}

/** Накопления по сотрудникам из записей журнала (прототип `bonusSum`). */
export function bonusBalancesOf(rows: readonly BonusLogRow[]): Map<string, BonusBalance> {
  const sums = new Map<string, { cp: Tyiyn; svc: Tyiyn; wait: Tyiyn; out: Tyiyn }>();
  for (const r of rows) {
    const s = sums.get(r.employeeId) ?? { cp: 0, svc: 0, wait: 0, out: 0 };
    s[r.kind] += Math.abs(r.amount);
    sums.set(r.employeeId, s);
  }
  return new Map([...sums].map(([id, s]) => [id, bonusBalance(s)]));
}

const NOBODY: BonusVisibility = { ops: null, services: null };

/** Накопления сотрудников (все или названные): суммы не зависят от того, кто смотрит. */
export async function bonusBalances(
  tx: Tx,
  employeeIds?: readonly string[],
): Promise<Map<string, BonusBalance>> {
  return bonusBalancesOf(await bonusLogRows(tx, NOBODY, employeeIds));
}

/** Строка «Остатки»: сотрудник, роль и его накопления. */
export interface BonusBalanceRow extends BonusBalance {
  id: string;
  fullName: string;
  name: string;
  role: string;
  active: boolean;
}

/**
 * «Остатки» (прототип: `EMP.filter(x => x.e.active || x.cp || x.svc || x.out || x.wait)`): действующие
 * сотрудники и те, у кого были начисления или списания.
 */
export async function bonusBalanceRows(tx: Tx): Promise<BonusBalanceRow[]> {
  const [staff, balances] = await Promise.all([
    tx
      .select({
        id: employees.id,
        fullName: employees.fullName,
        name: employees.shortName,
        role: roles.name,
        active: employees.active,
      })
      .from(employees)
      .innerJoin(roles, eq(roles.id, employees.roleId))
      .orderBy(asc(employees.createdAt), asc(employees.id)),
    bonusBalances(tx),
  ]);
  return staff
    .map((e) => ({ ...e, ...(balances.get(e.id) ?? EMPTY_BONUS_BALANCE) }))
    .filter((r) => r.active || r.cp || r.svc || r.out || r.wait);
}

/* ───────────── Списки: общий механизм над посчитанными строками ───────────── */

const field = (key: string) => sql.raw(`"r"."${key.replace(/[^a-z0-9_]/gi, '')}"`);
const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();
const recordset = (rows: readonly object[], defs: readonly (readonly [string, string])[]) =>
  sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(${sql.raw(
    defs.map(([k, type]) => `"${k}" ${type}`).join(', '),
  )})`;

const BALANCE_MONEY = ['cp', 'svc', 'wait', 'out', 'bal'] as const;

/** Столбцы «Остатков» (прототип: сетка `bonus-bal`). */
const BALANCE_COLUMNS: ListColumns = {
  fio: { type: 'text', label: 'staff.bonus.col.fio', value: field('fio') },
  role: { type: 'enum', label: 'staff.bonus.col.role', value: field('role') },
  ...Object.fromEntries(
    BALANCE_MONEY.map((k) => [
      k,
      { type: 'money', label: `staff.bonus.col.${k}`, value: field(k), total: true },
    ]),
  ),
  // «Списание» — столбец кнопки «Списать» (прототип: `val: () => ''`): в поиске и выгрузке пустой.
  act: { type: 'text', label: 'staff.bonus.col.act', value: sql`''::text` },
};
/** По умолчанию — по остатку, от больших (прототип: `sort: {key: 'bal', dir: -1}`). */
const BALANCE_SORT: ListSort = { key: 'bal', dir: 'desc' };
const NATURAL = [field('pos')];

const balanceSource = (rows: readonly BonusBalanceRow[]) =>
  recordset(
    rows.map((r, pos) => ({
      id: r.id,
      pos,
      fio: r.fullName,
      role: r.role,
      cp: r.cp,
      svc: r.svc,
      wait: r.wait,
      out: r.out,
      bal: r.bal,
    })),
    [
      ['id', 'text'],
      ['pos', 'integer'],
      ['fio', 'text'],
      ['role', 'text'],
      ...BALANCE_MONEY.map((k) => [k, 'bigint'] as const),
    ],
  );

export async function listBonusBalancePage(
  tx: Tx,
  query: ListQuery,
  rows: readonly BonusBalanceRow[],
) {
  const source = balanceSource(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const page = await selectListPage({
    query,
    columns: BALANCE_COLUMNS,
    natural: NATURAL,
    defaultSort: BALANCE_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${field('id')}`, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

export const listBonusBalanceValues = (
  tx: Tx,
  key: string,
  rows: readonly BonusBalanceRow[],
  q?: string,
) =>
  selectListValues({
    columns: BALANCE_COLUMNS,
    key,
    scope: undefined,
    from: fromOf(tx, balanceSource(rows)),
    q,
  });

export const exportBonusBalances = (
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  rows: readonly BonusBalanceRow[],
) =>
  selectListExport({
    query,
    columns: BALANCE_COLUMNS,
    keys,
    natural: NATURAL,
    defaultSort: BALANCE_SORT,
    scope: undefined,
    from: fromOf(tx, balanceSource(rows)),
  });

/** Основание ожидающего бонуса: «<услуга> · оплачено X из Y» (прототип `bonusLog`). */
export const bonusWhat = (r: BonusLogRow, t: ListTexts): string =>
  r.kind === 'wait' && r.what
    ? formatText(t('staff.bonus.wait_what'), {
        name: r.what,
        paid: formatSomWithUnit(r.paid ?? 0),
        amount: formatSomWithUnit(r.cost ?? 0),
      })
    : r.what;

/**
 * Столбцы журнала (прототип: сетки `bonus-log` и `bonus-emp`): дата, сотрудник, вид, контрагент,
 * основание, сумма (ожидающий бонус в итог не входит), кто записал.
 */
const LOG_COLUMNS: ListColumns = {
  date: { type: 'date', label: 'staff.bonus.col.date', value: field('date') },
  emp: { type: 'enum', label: 'staff.bonus.col.emp', value: field('emp') },
  kind: {
    type: 'enum',
    label: 'staff.bonus.col.kind',
    value: field('kind'),
    display: field('kind_text'),
  },
  cp: {
    type: 'enum',
    label: 'staff.bonus.col.contractor',
    value: field('cp'),
    digits: field('cp_inn'),
  },
  what: { type: 'text', label: 'staff.bonus.col.what', value: field('what') },
  sum: { type: 'money', label: 'staff.bonus.col.sum', value: field('sum'), total: true },
  by: { type: 'enum', label: 'staff.bonus.col.by', value: field('by') },
};
/** По умолчанию — по дате, сначала новые (прототип: `sort: {key: 'date', dir: -1}`). */
const LOG_SORT: ListSort = { key: 'date', dir: 'desc' };

const logSource = (rows: readonly BonusLogRow[], t: ListTexts) =>
  recordset(
    rows.map((r, pos) => ({
      id: r.id,
      pos,
      date: r.date,
      emp: r.employeeName,
      kind: r.kind,
      kind_text: t(`staff.bonus.kind.${r.kind}`),
      cp: r.contractor?.name ?? '',
      cp_inn: r.contractorInn ?? '',
      what: bonusWhat(r, t),
      // Ожидающий бонус в итог не входит (прототип: `val: x => x.wait ? 0 : x.amount`).
      sum: r.kind === 'wait' ? 0 : r.amount,
      by: r.by ?? '',
    })),
    [
      ['id', 'text'],
      ['pos', 'integer'],
      ['date', 'date'],
      ['emp', 'text'],
      ['kind', 'text'],
      ['kind_text', 'text'],
      ['cp', 'text'],
      ['cp_inn', 'text'],
      ['what', 'text'],
      ['sum', 'bigint'],
      ['by', 'text'],
    ],
  );

/** Записи журнала в порядке создания — постоянный порядок при равной дате. */
const ordered = (rows: readonly BonusLogRow[]) =>
  [...rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

export async function listBonusLogPage(
  tx: Tx,
  query: ListQuery,
  all: readonly BonusLogRow[],
  t: ListTexts,
) {
  const rows = ordered(all);
  const source = logSource(rows, t);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const page = await selectListPage({
    query,
    columns: LOG_COLUMNS,
    natural: NATURAL,
    defaultSort: LOG_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${field('id')}`, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

export const listBonusLogValues = (
  tx: Tx,
  key: string,
  rows: readonly BonusLogRow[],
  t: ListTexts,
  q?: string,
) =>
  selectListValues({
    columns: LOG_COLUMNS,
    key,
    scope: undefined,
    from: fromOf(tx, logSource(ordered(rows), t)),
    q,
  });

export const exportBonusLog = (
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  rows: readonly BonusLogRow[],
  t: ListTexts,
) =>
  selectListExport({
    query,
    columns: LOG_COLUMNS,
    keys,
    natural: NATURAL,
    defaultSort: LOG_SORT,
    scope: undefined,
    from: fromOf(tx, logSource(ordered(rows), t)),
  });

/* ───────────── Списание бонуса ───────────── */

/** Сотрудник организации: его строка блокируется — списания одного сотрудника идут по очереди. */
async function lockEmployee(tx: Tx, id: string) {
  if (!UUID.test(id)) throw new RecordNotFoundError('employee', id);
  const [e] = await tx
    .select({ id: employees.id, name: employees.shortName, fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.id, id))
    .for('no key update');
  if (!e) throw new RecordNotFoundError('employee', id);
  return e;
}

export interface BonusOutInput {
  employeeId: string;
  amount: Tyiyn;
  date: IsoDate;
  note: string;
}

/**
 * «Списать бонус» (прототип `bonusOutDlg`): сумма не больше накопленного остатка, дата не позже
 * сегодняшней, основание обязательно. История сотрудника: «Списан бонус …: основание. Остаток бонусов …».
 */
export async function writeOffBonus(
  tx: Tx,
  input: BonusOutInput,
  ctx: { today: IsoDate },
): Promise<{ id: string; balance: Tyiyn }> {
  const e = await lockEmployee(tx, input.employeeId);
  const balance = ((await bonusBalances(tx, [e.id])).get(e.id) ?? EMPTY_BONUS_BALANCE).bal;
  if (balance <= 0) throw refuse('bonus_none', 409);
  const note = input.note.trim();
  const [p] = bonusOutProblems(
    { amount: input.amount, date: input.date, note },
    { balance, today: ctx.today },
  );
  if (p)
    throw refuse(
      p.problem as never,
      400,
      p.field,
      p.amount !== undefined ? { amount: formatSomWithUnit(p.amount) } : {},
    );
  const [row] = await tx
    .insert(bonusWriteoffs)
    .values({
      employeeId: e.id,
      amount: input.amount,
      paidOn: input.date,
      note: note.slice(0, BONUS_NOTE_MAX),
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: bonusWriteoffs.id });
  await writeHistory(tx, {
    entity: 'employee',
    entityId: e.id,
    action: 'update',
    changes: [
      { field: 'bonusOut', to: input.amount },
      { field: 'bonusOutDate', to: input.date },
      { field: 'bonusBalance', from: balance, to: balance - input.amount },
    ],
    reason: note,
  });
  return { id: row!.id, balance: balance - input.amount };
}

/**
 * «Отменить списание» (прототип `bonusUndo`): отметка, сумма возвращается в накопленный остаток. Уже
 * отменённое — отказ; устаревшая версия — «запись изменена другим пользователем».
 */
export async function undoBonusWriteoff(
  tx: Tx,
  id: string,
  version: number,
): Promise<{ employeeId: string; amount: Tyiyn; date: IsoDate }> {
  if (!UUID.test(id)) throw new RecordNotFoundError('bonus_writeoff', id);
  const [found] = await tx
    .select({ employeeId: bonusWriteoffs.employeeId })
    .from(bonusWriteoffs)
    .where(eq(bonusWriteoffs.id, id));
  if (!found) throw new RecordNotFoundError('bonus_writeoff', id);
  await lockEmployee(tx, found.employeeId);
  const [x] = await tx
    .select()
    .from(bonusWriteoffs)
    .where(eq(bonusWriteoffs.id, id))
    .for('no key update');
  if (!x) throw new RecordNotFoundError('bonus_writeoff', id);
  if (x.deletedAt) throw refuse('bonus_out_undone', 409);
  if (x.version !== version) throw new RecordChangedError('bonus_writeoff', id, x.version);
  await tx
    .update(bonusWriteoffs)
    .set({
      deletedAt: sql`now()`,
      deletedBy: sql`app.current_user_id()`,
      version: sql`${bonusWriteoffs.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(bonusWriteoffs.id, id));
  const amount = Number(x.amount);
  await writeHistory(tx, {
    entity: 'employee',
    entityId: x.employeeId,
    action: 'update',
    changes: [
      { field: 'bonusOutUndo', to: amount },
      { field: 'bonusOutDate', to: x.paidOn },
    ],
  });
  return { employeeId: x.employeeId, amount, date: x.paidOn };
}
