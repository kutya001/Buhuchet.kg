import {
  formatSomWithUnit,
  MONEY_NOTE_MAX,
  opAmountLimit,
  RecordChangedError,
  RecordNotFoundError,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_NAME_MAX,
  serviceChangesMoney,
  servicePaid,
  servicePaymentProblem,
  serviceProblems,
  serviceStatus,
  type IsoDate,
  type Tyiyn,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory, type HistoryEntry } from './history';
import { MoneyRefusedError } from './money-tax';
import {
  auditLog,
  contractors,
  employees,
  files,
  oneOffServicePayments,
  oneOffServices,
  orgSettings,
} from './schema';

/*
 * Разовые услуги и их оплаты (задача 2.22; ТЗ «Финансовые операции по контрагентам» → «Ручная операция
 * «Разовая услуга»», «Окно оплаты»; прототип modules/services.js — `serviceDlg`, `svcPay`, `serviceCard`,
 * modules/fin-op.js — `opWin`, `opEditDlg`, `opDelDlg` с `src: 'sp'` и `'svc'`). Права и область
 * проверяет API; здесь — правила записи, блокировки и история. Услугу и оплату не стирают: «Удалить» —
 * отметка с причиной.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceRecord = typeof oneOffServices.$inferSelect;
type PaymentRecord = typeof oneOffServicePayments.$inferSelect;

export interface ServiceContractor {
  id: string;
  name: string;
  archived: boolean;
  responsibleEmployeeId: string | null;
}

const contractorFields = {
  id: contractors.id,
  name: contractors.name,
  archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
  responsibleEmployeeId: contractors.responsibleEmployeeId,
};

/** Отказ с полем и суммой для текста (`{amount}`). */
const refuse = (
  code: ConstructorParameters<typeof MoneyRefusedError>[0],
  status: 400 | 409,
  field?: string,
  amount?: Tyiyn,
) =>
  new MoneyRefusedError(
    code,
    status,
    field,
    amount !== undefined ? { amount: formatSomWithUnit(amount) } : {},
  );

/** Получено по услуге: действующие оплаты. */
async function paidOf(tx: Tx, serviceId: string): Promise<Tyiyn> {
  const rows = await tx
    .select({
      amount: oneOffServicePayments.amount,
      deleted: sql<boolean>`${oneOffServicePayments.deletedAt} is not null`,
    })
    .from(oneOffServicePayments)
    .where(eq(oneOffServicePayments.serviceId, serviceId));
  return servicePaid(rows.map((r) => ({ amount: Number(r.amount), deleted: r.deleted })));
}

/**
 * Исполнитель: действующий сотрудник организации (прототип: выбор из `EMP.filter(x => x.active)`); при
 * изменении можно оставить прежнего, даже если он уже не работает.
 */
async function checkPerformer(tx: Tx, id: string | null, keep: string | null): Promise<void> {
  if (id === null || id === keep) return;
  if (!UUID.test(id)) throw refuse('service_responsible_invalid', 400, 'performer');
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.active, true)));
  if (!row) throw refuse('service_responsible_invalid', 400, 'performer');
}

/** Название и описание: без пробелов по краям; длина — как у ограничений таблицы. */
function cleanText(name: string, description: string) {
  const n = name.trim();
  const d = description.trim();
  if (n.length > SERVICE_NAME_MAX) throw refuse('service_name_required', 400, 'name');
  return { name: n, description: d.slice(0, SERVICE_DESCRIPTION_MAX) };
}

/** Первый отказ правил окна услуги — ошибкой у своего поля. */
function throwProblems(problems: ReturnType<typeof serviceProblems>): void {
  const p = problems[0];
  if (p) throw refuse(p.problem as never, 400, p.field, p.amount);
}

/* ───────────── Услуга ───────────── */

export interface OneOffServiceInput {
  contractorId: string;
  name: string;
  date: IsoDate;
  amount: Tyiyn;
  performerEmployeeId: string | null;
  description: string;
  /** «Оплачено сразу»: оплата на всю сумму сегодняшним днём. */
  paidNow: boolean;
}

/**
 * «Добавить услугу» (прототип `serviceDlg`): контрагент в области `scope`, не в архиве; название, дата,
 * стоимость больше нуля; «Оплачено сразу» — оплата на всю сумму сегодняшним днём. История: «Разовая
 * услуга «…» на …[, оплачена]».
 */
export async function createOneOffService(
  tx: Tx,
  input: OneOffServiceInput,
  ctx: { today: IsoDate; scope: SQL | undefined },
): Promise<{ id: string }> {
  if (!UUID.test(input.contractorId)) throw refuse('service_contractor_invalid', 400, 'contractor');
  const [c] = await tx
    .select(contractorFields)
    .from(contractors)
    .where(and(eq(contractors.id, input.contractorId), ctx.scope))
    .for('no key update');
  if (!c) throw refuse('service_contractor_invalid', 400, 'contractor');
  if (c.archived) throw refuse('contractor_archived', 409);
  throwProblems(serviceProblems({ name: input.name, date: input.date, amount: input.amount }));
  const text = cleanText(input.name, input.description);
  await checkPerformer(tx, input.performerEmployeeId, null);
  const [row] = await tx
    .insert(oneOffServices)
    .values({
      contractorId: c.id,
      name: text.name,
      serviceDate: input.date,
      amount: input.amount,
      performerEmployeeId: input.performerEmployeeId,
      description: text.description,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: oneOffServices.id });
  const id = row!.id;
  if (input.paidNow) {
    await tx.insert(oneOffServicePayments).values({
      serviceId: id,
      amount: input.amount,
      paidOn: ctx.today,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    });
  }
  await writeHistory(tx, {
    entity: 'one_off_service',
    entityId: id,
    action: 'create',
    changes: [
      { field: 'name', to: text.name },
      { field: 'amount', to: input.amount },
      { field: 'serviceDate', to: input.date },
      { field: 'paid', to: input.paidNow },
    ],
    contractorId: c.id,
  });
  return { id };
}

export interface LockedOneOffService {
  service: ServiceRecord;
  contractor: ServiceContractor;
}

/**
 * Услуга контрагента в области `scope`; `lock` — заблокировать её (изменение, оплата, удаление: оплаты
 * не обгоняют друг друга и стоимость). Нет такой или контрагент вне области — `RecordNotFoundError`.
 */
export async function oneOffServiceOf(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
  lock: boolean,
): Promise<LockedOneOffService> {
  if (!UUID.test(id)) throw new RecordNotFoundError('one_off_service', id);
  const q = tx
    .select({ service: oneOffServices, contractor: contractorFields })
    .from(oneOffServices)
    .innerJoin(contractors, eq(contractors.id, oneOffServices.contractorId))
    .where(and(eq(oneOffServices.id, id), scope));
  const [row] = lock ? await q.for('no key update', { of: oneOffServices }) : await q;
  if (!row) throw new RecordNotFoundError('one_off_service', id);
  return row;
}

const hActor = alias(employees, 'svc_hist_actor');
const svcCreated = alias(employees, 'svc_created');
const svcUpdated = alias(employees, 'svc_updated');
const svcDeleted = alias(employees, 'svc_deleted');
const svcPerformer = alias(employees, 'svc_performer');

export interface ServiceHistoryRow {
  id: number;
  at: Date;
  actorName: string | null;
  entity: string;
  /** Оплата, к которой относится запись (`one_off_service_payment`); у самой услуги — null. */
  paymentId: string | null;
  action: string;
  changes: unknown;
  reason: string | null;
}

/** История услуги и её оплат или одной оплаты (прототип `histBox('s', id)`, `opHistHtml` с `sub`). */
async function historyOf(
  tx: Tx,
  service: string | null,
  payments: readonly string[],
): Promise<ServiceHistoryRow[]> {
  const conds = [
    service
      ? and(eq(auditLog.entity, 'one_off_service'), eq(auditLog.entityId, service))
      : undefined,
    payments.length
      ? and(
          eq(auditLog.entity, 'one_off_service_payment'),
          inArray(auditLog.entityId, [...payments]),
        )
      : undefined,
  ].filter(Boolean) as SQL[];
  if (!conds.length) return [];
  const rows = await tx
    .select({
      id: auditLog.id,
      at: auditLog.at,
      actorName: hActor.shortName,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      action: auditLog.action,
      changes: auditLog.changes,
      reason: auditLog.reason,
    })
    .from(auditLog)
    .leftJoin(hActor, eq(hActor.userId, auditLog.actorUserId))
    .where(or(...conds))
    .orderBy(desc(auditLog.at), desc(auditLog.id));
  return rows.map(({ entityId, ...r }) => ({
    ...r,
    paymentId: r.entity === 'one_off_service_payment' ? entityId : null,
  }));
}

/** Оплата в карточке услуги. */
export interface ServicePaymentLine {
  id: string;
  date: IsoDate;
  amount: Tyiyn;
  note: string;
  edited: boolean;
  by: string | null;
  createdBy: string | null;
  /** Файлов у оплаты. */
  files: number;
}

/** Карточка услуги (прототип `serviceCard`). */
export interface OneOffServiceCard extends LockedOneOffService {
  paid: Tyiyn;
  status: 'paid' | 'partial' | 'unpaid';
  performerName: string | null;
  createdName: string | null;
  updatedName: string | null;
  deletedName: string | null;
  /** Действующие оплаты по дате, сначала ранние (прототип: `s.pays.filter(p => !p.del)`). */
  payments: ServicePaymentLine[];
  /** Удалённые оплаты — для отметки «удалена» в истории. */
  deletedPayments: string[];
  history: ServiceHistoryRow[];
}

const payBy = alias(employees, 'svc_pay_by');

export async function oneOffServiceCard(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<OneOffServiceCard | null> {
  let found: LockedOneOffService;
  try {
    found = await oneOffServiceOf(tx, id, scope, false);
  } catch (e) {
    if (e instanceof RecordNotFoundError) return null;
    throw e;
  }
  const [names, pays] = await Promise.all([
    tx
      .select({
        performer: svcPerformer.shortName,
        created: svcCreated.shortName,
        updated: svcUpdated.shortName,
        deleted: svcDeleted.shortName,
      })
      .from(oneOffServices)
      .leftJoin(svcPerformer, eq(svcPerformer.id, oneOffServices.performerEmployeeId))
      .leftJoin(svcCreated, eq(svcCreated.userId, oneOffServices.createdBy))
      .leftJoin(svcUpdated, eq(svcUpdated.userId, oneOffServices.updatedBy))
      .leftJoin(svcDeleted, eq(svcDeleted.userId, oneOffServices.deletedBy))
      .where(eq(oneOffServices.id, id)),
    tx
      .select({
        id: oneOffServicePayments.id,
        date: oneOffServicePayments.paidOn,
        amount: oneOffServicePayments.amount,
        note: oneOffServicePayments.note,
        edited: oneOffServicePayments.edited,
        deleted: sql<boolean>`${oneOffServicePayments.deletedAt} is not null`,
        createdBy: oneOffServicePayments.createdBy,
        by: payBy.shortName,
        files: sql<number>`(select count(*)::int from ${files} pf where pf.source_kind = 'one_off_service_payment' and pf.source_id = ${oneOffServicePayments.id} and pf.state = 'ready')`,
      })
      .from(oneOffServicePayments)
      .leftJoin(payBy, eq(payBy.userId, oneOffServicePayments.createdBy))
      .where(eq(oneOffServicePayments.serviceId, id))
      .orderBy(
        asc(oneOffServicePayments.paidOn),
        asc(oneOffServicePayments.createdAt),
        asc(oneOffServicePayments.id),
      ),
  ]);
  const n = names[0];
  const live = pays.filter((p) => !p.deleted);
  const paid = servicePaid(pays.map((p) => ({ amount: Number(p.amount), deleted: p.deleted })));
  const amount = Number(found.service.amount);
  return {
    ...found,
    paid,
    status: serviceStatus(amount, paid),
    performerName: n?.performer ?? null,
    createdName: n?.created ?? null,
    updatedName: n?.updated ?? null,
    deletedName: n?.deleted ?? null,
    payments: live.map((p) => ({
      id: p.id,
      date: p.date,
      amount: Number(p.amount),
      note: p.note,
      edited: p.edited,
      by: p.by,
      createdBy: p.createdBy,
      files: Number(p.files),
    })),
    deletedPayments: pays.filter((p) => p.deleted).map((p) => p.id),
    history: await historyOf(
      tx,
      id,
      pays.map((p) => p.id),
    ),
  };
}

export interface OneOffServiceEditInput {
  version: number;
  name: string;
  date: IsoDate;
  amount: Tyiyn;
  performerEmployeeId: string | null;
  description: string;
  reason: string;
}

/**
 * «Сохранить» в окне «Изменить разовую услугу» (прототип `serviceDlg` с `s0`): стоимость не меньше уже
 * полученного; причина — если меняются стоимость или дата, тогда же отметка «Изменена». История: было
 * → стало по каждому полю, причина.
 */
export async function editOneOffService(
  tx: Tx,
  { service, contractor }: LockedOneOffService,
  input: OneOffServiceEditInput,
): Promise<{ changed: boolean }> {
  if (service.deletedAt) throw refuse('service_deleted', 409);
  if (service.version !== input.version)
    throw new RecordChangedError('one_off_service', service.id, service.version);
  const paid = await paidOf(tx, service.id);
  const amount0 = Number(service.amount);
  throwProblems(
    serviceProblems(
      { name: input.name, date: input.date, amount: input.amount },
      { paid, amount: amount0, date: service.serviceDate, reason: input.reason },
    ),
  );
  const text = cleanText(input.name, input.description);
  await checkPerformer(tx, input.performerEmployeeId, service.performerEmployeeId);
  const changes: NonNullable<HistoryEntry['changes']> = [];
  if (text.name !== service.name)
    changes.push({ field: 'name', from: service.name, to: text.name });
  if (input.amount !== amount0) changes.push({ field: 'amount', from: amount0, to: input.amount });
  if (input.date !== service.serviceDate)
    changes.push({ field: 'serviceDate', from: service.serviceDate, to: input.date });
  if (input.performerEmployeeId !== service.performerEmployeeId)
    changes.push({
      field: 'performer',
      from: service.performerEmployeeId,
      to: input.performerEmployeeId,
    });
  if (text.description !== service.description)
    changes.push({ field: 'description', from: service.description, to: text.description });
  const money = serviceChangesMoney(
    { amount: amount0, date: service.serviceDate },
    { amount: input.amount, date: input.date },
  );
  await tx
    .update(oneOffServices)
    .set({
      name: text.name,
      serviceDate: input.date,
      amount: input.amount,
      performerEmployeeId: input.performerEmployeeId,
      description: text.description,
      ...(money ? { edited: true } : {}),
      version: sql`${oneOffServices.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(oneOffServices.id, service.id));
  // Прототип: без смены стоимости и даты — «Услуга изменена» без причины.
  await writeHistory(tx, {
    entity: 'one_off_service',
    entityId: service.id,
    action: 'update',
    changes,
    reason: money ? input.reason.trim() : null,
    contractorId: contractor.id,
  });
  return { changed: changes.length > 0 };
}

/**
 * «Удалить» услугу (прототип opDelDlg с `src: 'svc'`): отметка с причиной; услуга и её оплаты уходят из
 * итогов. В истории — сумма, дата и сколько оплат ушло вместе с ней.
 */
export async function deleteOneOffService(
  tx: Tx,
  { service, contractor }: LockedOneOffService,
  reason: string,
): Promise<void> {
  if (service.deletedAt) throw refuse('service_deleted', 409);
  const why = reason.trim();
  if (!why) throw refuse('op_reason_required', 400, 'reason');
  const pays = await tx
    .select({ amount: oneOffServicePayments.amount })
    .from(oneOffServicePayments)
    .where(
      and(
        eq(oneOffServicePayments.serviceId, service.id),
        sql`${oneOffServicePayments.deletedAt} is null`,
      ),
    );
  await tx
    .update(oneOffServices)
    .set({
      deletedAt: sql`now()`,
      deletedBy: sql`app.current_user_id()`,
      deleteReason: why,
      version: sql`${oneOffServices.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(oneOffServices.id, service.id));
  await writeHistory(tx, {
    entity: 'one_off_service',
    entityId: service.id,
    action: 'delete',
    changes: [
      { field: 'amount', from: Number(service.amount) },
      { field: 'serviceDate', from: service.serviceDate },
      { field: 'payments', from: pays.length },
      { field: 'paid', from: pays.reduce((s, p) => s + Number(p.amount), 0) },
    ],
    reason: why,
    contractorId: contractor.id,
  });
}

/* ───────────── Оплаты ───────────── */

export interface ServicePaymentInput {
  amount: Tyiyn;
  date: IsoDate;
  note: string;
}

/**
 * «Записать оплату» (прототип `svcPay` → `tranchDlg`): сумма больше нуля и не больше остатка, дата не
 * позже сегодняшней; оплаченную полностью и удалённую — нельзя. История оплаты: «Оплата …».
 */
export async function addServicePayment(
  tx: Tx,
  { service, contractor }: LockedOneOffService,
  input: ServicePaymentInput,
  ctx: { today: IsoDate },
): Promise<{ id: string }> {
  if (service.deletedAt) throw refuse('service_deleted', 409);
  const left = Number(service.amount) - (await paidOf(tx, service.id));
  if (left <= 0) throw refuse('service_paid_full', 409);
  const problem = servicePaymentProblem(input.amount, left);
  if (problem) throw refuse(problem.problem as never, 400, 'amount', problem.amount);
  if (input.date > ctx.today) throw refuse('money_date_future', 400, 'date');
  const [row] = await tx
    .insert(oneOffServicePayments)
    .values({
      serviceId: service.id,
      amount: input.amount,
      paidOn: input.date,
      note: input.note.trim().slice(0, MONEY_NOTE_MAX),
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: oneOffServicePayments.id });
  await writeHistory(tx, {
    entity: 'one_off_service_payment',
    entityId: row!.id,
    action: 'create',
    changes: [
      { field: 'amount', to: input.amount },
      { field: 'paidOn', to: input.date },
    ],
    contractorId: contractor.id,
  });
  return { id: row!.id };
}

export interface LockedServicePayment extends LockedOneOffService {
  payment: PaymentRecord;
}

/**
 * Оплата услуги контрагента в области `scope`; `lock` — заблокировать услугу и оплату. Нет такой или
 * контрагент вне области — `RecordNotFoundError`.
 */
export async function servicePaymentOf(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
  lock: boolean,
): Promise<LockedServicePayment> {
  if (!UUID.test(id)) throw new RecordNotFoundError('one_off_service_payment', id);
  const [row] = await tx
    .select({ serviceId: oneOffServicePayments.serviceId })
    .from(oneOffServicePayments)
    .where(eq(oneOffServicePayments.id, id));
  if (!row) throw new RecordNotFoundError('one_off_service_payment', id);
  let found: LockedOneOffService;
  try {
    found = await oneOffServiceOf(tx, row.serviceId, scope, lock);
  } catch (e) {
    if (e instanceof RecordNotFoundError)
      throw new RecordNotFoundError('one_off_service_payment', id);
    throw e;
  }
  const p = tx.select().from(oneOffServicePayments).where(eq(oneOffServicePayments.id, id));
  const [payment] = lock ? await p.for('no key update') : await p;
  if (!payment) throw new RecordNotFoundError('one_off_service_payment', id);
  return { ...found, payment };
}

const spCreated = alias(employees, 'sp_created');
const spUpdated = alias(employees, 'sp_updated');
const spDeleted = alias(employees, 'sp_deleted');

/** Окно оплаты услуги (прототип opWin с `src: 'sp'`). */
export interface ServicePaymentCard extends LockedServicePayment {
  /** Получено по услуге (действующие оплаты). */
  paid: Tyiyn;
  createdName: string | null;
  updatedName: string | null;
  deletedName: string | null;
  history: ServiceHistoryRow[];
}

export async function servicePaymentCard(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<ServicePaymentCard | null> {
  let found: LockedServicePayment;
  try {
    found = await servicePaymentOf(tx, id, scope, false);
  } catch (e) {
    if (e instanceof RecordNotFoundError) return null;
    throw e;
  }
  const [names, paid, history] = await Promise.all([
    tx
      .select({
        created: spCreated.shortName,
        updated: spUpdated.shortName,
        deleted: spDeleted.shortName,
      })
      .from(oneOffServicePayments)
      .leftJoin(spCreated, eq(spCreated.userId, oneOffServicePayments.createdBy))
      .leftJoin(spUpdated, eq(spUpdated.userId, oneOffServicePayments.updatedBy))
      .leftJoin(spDeleted, eq(spDeleted.userId, oneOffServicePayments.deletedBy))
      .where(eq(oneOffServicePayments.id, id)),
    paidOf(tx, found.service.id),
    historyOf(tx, null, [id]),
  ]);
  const n = names[0];
  return {
    ...found,
    paid,
    createdName: n?.created ?? null,
    updatedName: n?.updated ?? null,
    deletedName: n?.deleted ?? null,
    history,
  };
}

export interface ServicePaymentEditInput {
  version: number;
  amount: Tyiyn;
  date: IsoDate;
  note: string;
  reason: string;
}

/**
 * «Сохранить» в окне «Изменить: оплата разовой услуги» (прототип opEditDlg с `sp`): сумма больше нуля и
 * не больше стоимости без остальных оплат (`opMax`), дата не позже сегодняшней, причина — если меняются
 * сумма или дата. Любое изменение ставит «Изменена».
 */
export async function editServicePayment(
  tx: Tx,
  { payment, service, contractor }: LockedServicePayment,
  input: ServicePaymentEditInput,
  ctx: { today: IsoDate },
): Promise<{ changed: boolean }> {
  if (service.deletedAt) throw refuse('service_deleted', 409);
  if (payment.deletedAt) throw refuse('op_deleted', 409);
  if (payment.version !== input.version)
    throw new RecordChangedError('one_off_service_payment', payment.id, payment.version);
  const amount0 = Number(payment.amount);
  if (!(Number.isInteger(input.amount) && input.amount > 0))
    throw refuse('op_amount_required', 400, 'amount');
  const limit = opAmountLimit('sp', amount0, {
    available: 0,
    free: 0,
    orgHeld: 0,
    service: { amount: Number(service.amount), paid: await paidOf(tx, service.id) },
  });
  if (limit && input.amount > limit.max)
    throw new MoneyRefusedError(limit.code, 400, 'amount', limit.params);
  if (input.date > ctx.today) throw refuse('money_date_future', 400, 'date');
  const note = input.note.trim().slice(0, MONEY_NOTE_MAX);
  const changes: NonNullable<HistoryEntry['changes']> = [];
  if (input.amount !== amount0) changes.push({ field: 'amount', from: amount0, to: input.amount });
  if (input.date !== payment.paidOn)
    changes.push({ field: 'paidOn', from: payment.paidOn, to: input.date });
  if (note !== payment.note) changes.push({ field: 'note', from: payment.note, to: note });
  const reason = input.reason.trim();
  if (changes.some((x) => x.field !== 'note') && !reason)
    throw refuse('op_reason_required', 400, 'reason');
  if (!changes.length) return { changed: false };
  await tx
    .update(oneOffServicePayments)
    .set({
      amount: input.amount,
      paidOn: input.date,
      note,
      edited: true,
      version: sql`${oneOffServicePayments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(oneOffServicePayments.id, payment.id));
  await writeHistory(tx, {
    entity: 'one_off_service_payment',
    entityId: payment.id,
    action: 'update',
    changes,
    reason: reason || null,
    contractorId: contractor.id,
  });
  return { changed: true };
}

/** «Удалить» оплату услуги (прототип opDelDlg с `src: 'sp'`): отметка с причиной, статус пересчитается. */
export async function deleteServicePayment(
  tx: Tx,
  { payment, service, contractor }: LockedServicePayment,
  reason: string,
): Promise<void> {
  if (service.deletedAt) throw refuse('service_deleted', 409);
  if (payment.deletedAt) throw refuse('op_deleted', 409);
  const why = reason.trim();
  if (!why) throw refuse('op_reason_required', 400, 'reason');
  await tx
    .update(oneOffServicePayments)
    .set({
      deletedAt: sql`now()`,
      deletedBy: sql`app.current_user_id()`,
      deleteReason: why,
      version: sql`${oneOffServicePayments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(oneOffServicePayments.id, payment.id));
  await writeHistory(tx, {
    entity: 'one_off_service_payment',
    entityId: payment.id,
    action: 'delete',
    changes: [
      { field: 'amount', from: Number(payment.amount) },
      { field: 'paidOn', from: payment.paidOn },
    ],
    reason: why,
    contractorId: contractor.id,
  });
}

/* ───────────── Файлы ───────────── */

/**
 * Услуга или оплата — источник файлов (прототип: `filesBox` карточки услуги, «Файлы: акт, договор, чек»;
 * оплата — «Файлы: платёжка, чек»): контрагент в области `scope`, удалена ли запись, включены ли
 * «Финансовые операции».
 */
export async function oneOffServiceFileSource(
  tx: Tx,
  kind: 'one_off_service' | 'one_off_service_payment',
  id: string,
  scope: SQL | undefined,
): Promise<{
  contractor: ServiceContractor;
  serviceId: string;
  deleted: boolean;
  finops: boolean;
} | null> {
  if (!UUID.test(id)) return null;
  const serviceId =
    kind === 'one_off_service'
      ? id
      : (
          await tx
            .select({ id: oneOffServicePayments.serviceId })
            .from(oneOffServicePayments)
            .where(eq(oneOffServicePayments.id, id))
        )[0]?.id;
  if (!serviceId) return null;
  const [row] = await tx
    .select({
      contractor: contractorFields,
      deleted: sql<boolean>`${oneOffServices.deletedAt} is not null${
        kind === 'one_off_service_payment'
          ? sql` or exists (select 1 from ${oneOffServicePayments} dp where dp.id = ${id}::uuid and dp.deleted_at is not null)`
          : sql``
      }`,
      finops: sql<boolean>`coalesce((select (${orgSettings.features} ->> 'finops')::boolean from ${orgSettings} where ${orgSettings.orgId} = app.current_org_id()), false)`,
    })
    .from(oneOffServices)
    .innerJoin(contractors, eq(contractors.id, oneOffServices.contractorId))
    .where(and(eq(oneOffServices.id, serviceId), scope));
  if (!row) return null;
  return { ...row, serviceId };
}
