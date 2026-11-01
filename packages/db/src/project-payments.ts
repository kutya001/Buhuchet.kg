import {
  auditActorName,
  formatSomWithUnit,
  MONEY_NOTE_MAX,
  opAmountLimit,
  projectLeft,
  projectPaymentProblem,
  projectPayRefusal,
  RecordChangedError,
  RecordNotFoundError,
  type IsoDate,
  type ProjectStatus,
  type Tyiyn,
} from '@buhuchet/domain';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import type { FileListPart } from './files';
import { writeHistory, type HistoryEntry } from './history';
import { MoneyRefusedError } from './money-tax';
import { orgMenuSettings } from './org';
import {
  projectOf,
  projectPaid,
  projectVisibility,
  type LockedProject,
  type ProjectContractor,
  type ProjectViewer,
} from './projects';
import { auditLog, contractors, employees, files, projectPayments, projects } from './schema';

/*
 * Оплаты по проекту — транши (задача 2.26, часть 2; ТЗ «Оплата по проекту траншами», «Окно оплаты»;
 * прототип modules/projects.js — `projPay` → `tranchDlg`, «Оплаты (транши)» в `openProject`;
 * modules/fin-op.js — `opWin`, `opEditDlg`, `opDelDlg` с `src: 'pt'`). Права, область и видимость
 * проекта проверяет API; здесь — правила записи, блокировки и история. Транш не стирают: «Удалить» —
 * отметка с причиной. История транша — запись `project_payment`; в карточке проекта она видна вместе с
 * записями проекта (прототип: `log('p', p.id, …, {sub})`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PaymentRecord = typeof projectPayments.$inferSelect;

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

/* ───────────── Новый транш ───────────── */

export interface ProjectPaymentInput {
  amount: Tyiyn;
  date: IsoDate;
  note: string;
}

/**
 * «Записать оплату» (прототип `projPay` → `tranchDlg`): у отменённого проекта — нельзя; при заданной
 * стоимости, полученной целиком, — «Получена вся планируемая стоимость», сумма — не больше остатка; без
 * стоимости — любая. Дата — не позже сегодняшней. История: «Оплата … (комментарий)».
 */
export async function addProjectPayment(
  tx: Tx,
  { project, contractor }: LockedProject,
  input: ProjectPaymentInput,
  ctx: { today: IsoDate },
): Promise<{ id: string }> {
  const plan = project.plan === null ? null : Number(project.plan);
  const paid = await projectPaid(tx, project.id);
  const refusal = projectPayRefusal({ status: project.status as ProjectStatus, plan, paid });
  if (refusal) throw refuse(refusal, 409);
  const problem = projectPaymentProblem(input.amount, plan ? projectLeft(plan, paid) : null);
  if (problem) throw refuse(problem.problem, 400, 'amount', problem.amount);
  if (input.date > ctx.today) throw refuse('money_date_future', 400, 'date');
  const note = input.note.trim().slice(0, MONEY_NOTE_MAX);
  const [row] = await tx
    .insert(projectPayments)
    .values({
      projectId: project.id,
      amount: input.amount,
      paidOn: input.date,
      note,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: projectPayments.id });
  await writeHistory(tx, {
    entity: 'project_payment',
    entityId: row!.id,
    action: 'create',
    changes: [
      { field: 'amount', to: input.amount },
      { field: 'paidOn', to: input.date },
      ...(note ? [{ field: 'note', to: note }] : []),
    ],
    contractorId: contractor.id,
  });
  return { id: row!.id };
}

/* ───────────── Транш ───────────── */

export interface LockedProjectPayment extends LockedProject {
  payment: PaymentRecord;
}

/**
 * Транш проекта, который сотрудник видит (`where` — видимость проекта и область над `contractors`);
 * `lock` — заблокировать проект и транш (изменение и удаление не обгоняют новые транши и смену
 * стоимости). Нет такого или проект не виден — `RecordNotFoundError`.
 */
export async function projectPaymentOf(
  tx: Tx,
  id: string,
  where: SQL | undefined,
  lock: boolean,
): Promise<LockedProjectPayment> {
  if (!UUID.test(id)) throw new RecordNotFoundError('project_payment', id);
  const [row] = await tx
    .select({ projectId: projectPayments.projectId })
    .from(projectPayments)
    .where(eq(projectPayments.id, id));
  if (!row) throw new RecordNotFoundError('project_payment', id);
  let found: LockedProject;
  try {
    found = await projectOf(tx, row.projectId, where, lock);
  } catch (e) {
    if (e instanceof RecordNotFoundError) throw new RecordNotFoundError('project_payment', id);
    throw e;
  }
  const q = tx.select().from(projectPayments).where(eq(projectPayments.id, id));
  const [payment] = lock ? await q.for('no key update') : await q;
  if (!payment) throw new RecordNotFoundError('project_payment', id);
  return { ...found, payment };
}

const ptCreated = alias(employees, 'pt_created');
const ptUpdated = alias(employees, 'pt_updated');
const ptDeleted = alias(employees, 'pt_deleted');
const ptActor = alias(employees, 'pt_hist_actor');

export interface ProjectPaymentHistoryRow {
  id: number;
  at: Date;
  actorName: string | null;
  action: string;
  changes: unknown;
  reason: string | null;
}

/** Окно транша (прототип opWin с `src: 'pt'`). */
export interface ProjectPaymentCard extends LockedProjectPayment {
  /** Получено по проекту (действующие транши). */
  paid: Tyiyn;
  createdName: string | null;
  updatedName: string | null;
  deletedName: string | null;
  /** История транша (прототип `opHistHtml` с `sub`), сначала новые. */
  history: ProjectPaymentHistoryRow[];
}

export async function projectPaymentCard(
  tx: Tx,
  id: string,
  where: SQL | undefined,
): Promise<ProjectPaymentCard | null> {
  let found: LockedProjectPayment;
  try {
    found = await projectPaymentOf(tx, id, where, false);
  } catch (e) {
    if (e instanceof RecordNotFoundError) return null;
    throw e;
  }
  const [names, paid, history] = await Promise.all([
    tx
      .select({
        created: ptCreated.shortName,
        updated: ptUpdated.shortName,
        deleted: ptDeleted.shortName,
      })
      .from(projectPayments)
      .leftJoin(ptCreated, eq(ptCreated.userId, projectPayments.createdBy))
      .leftJoin(ptUpdated, eq(ptUpdated.userId, projectPayments.updatedBy))
      .leftJoin(ptDeleted, eq(ptDeleted.userId, projectPayments.deletedBy))
      .where(eq(projectPayments.id, id)),
    projectPaid(tx, found.project.id),
    tx
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorUserId: auditLog.actorUserId,
        actorName: ptActor.shortName,
        action: auditLog.action,
        changes: auditLog.changes,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .leftJoin(ptActor, eq(ptActor.userId, auditLog.actorUserId))
      .where(and(eq(auditLog.entity, 'project_payment'), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.at), desc(auditLog.id)),
  ]);
  const n = names[0];
  return {
    ...found,
    paid,
    createdName: n?.created ?? null,
    updatedName: n?.updated ?? null,
    deletedName: n?.deleted ?? null,
    history: history.map(({ actorUserId, actorName, ...h }) => ({
      ...h,
      actorName: auditActorName(actorUserId, actorName),
    })),
  };
}

/** Транш в карточке проекта (прототип: таблица «Оплаты (транши)»). */
export interface ProjectPaymentLine {
  id: string;
  date: IsoDate;
  amount: Tyiyn;
  note: string;
  edited: boolean;
  /** Кто записал (прототип «Записал»: `whoName(x.by)`). */
  by: string | null;
  /** Названия файлов транша (прототип: столбец «Файлы»). */
  files: string[];
}

const ptBy = alias(employees, 'pt_by');

/** Действующие транши проекта по дате, сначала ранние (прототип: `p.pays.filter(x => !x.del)`). */
export async function projectPaymentLines(
  tx: Tx,
  projectId: string,
): Promise<ProjectPaymentLine[]> {
  const rows = await tx
    .select({
      id: projectPayments.id,
      date: projectPayments.paidOn,
      amount: projectPayments.amount,
      note: projectPayments.note,
      edited: projectPayments.edited,
      by: ptBy.shortName,
      files: sql<
        string[]
      >`array(select pf.name from ${files} pf where pf.source_kind = 'project_payment' and pf.source_id = ${projectPayments.id} and pf.state = 'ready' order by pf.created_at, pf.id)`,
    })
    .from(projectPayments)
    .leftJoin(ptBy, eq(ptBy.userId, projectPayments.createdBy))
    .where(and(eq(projectPayments.projectId, projectId), sql`${projectPayments.deletedAt} is null`))
    .orderBy(asc(projectPayments.paidOn), asc(projectPayments.createdAt));
  return rows.map((r) => ({ ...r, amount: Number(r.amount), files: r.files ?? [] }));
}

/* ───────────── Изменить и удалить ───────────── */

export interface ProjectPaymentEditInput {
  version: number;
  amount: Tyiyn;
  date: IsoDate;
  note: string;
  reason: string;
}

/**
 * «Сохранить» в окне «Изменить: оплата по проекту» (прототип opEditDlg с `pt`): сумма больше нуля и при
 * заданной стоимости — не больше неё без остальных траншей (`opMax`), дата не позже сегодняшней,
 * причина — если меняются сумма или дата. Любое изменение ставит «изменён».
 */
export async function editProjectPayment(
  tx: Tx,
  { payment, project, contractor }: LockedProjectPayment,
  input: ProjectPaymentEditInput,
  ctx: { today: IsoDate },
): Promise<{ changed: boolean }> {
  if (payment.deletedAt) throw refuse('op_deleted', 409);
  if (payment.version !== input.version)
    throw new RecordChangedError('project_payment', payment.id, payment.version);
  const amount0 = Number(payment.amount);
  if (!(Number.isInteger(input.amount) && input.amount > 0))
    throw refuse('op_amount_required', 400, 'amount');
  const limit = opAmountLimit('pt', amount0, {
    available: 0,
    free: 0,
    orgHeld: 0,
    project: {
      plan: project.plan === null ? null : Number(project.plan),
      paid: await projectPaid(tx, project.id),
    },
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
    .update(projectPayments)
    .set({
      amount: input.amount,
      paidOn: input.date,
      note,
      edited: true,
      version: sql`${projectPayments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(projectPayments.id, payment.id));
  await writeHistory(tx, {
    entity: 'project_payment',
    entityId: payment.id,
    action: 'update',
    changes,
    reason: reason || null,
    contractorId: contractor.id,
  });
  return { changed: true };
}

/** «Удалить» транш (прототип opDelDlg с `pt`): отметка с причиной, «получено» по проекту уменьшится. */
export async function deleteProjectPayment(
  tx: Tx,
  { payment, contractor }: LockedProjectPayment,
  reason: string,
): Promise<void> {
  if (payment.deletedAt) throw refuse('op_deleted', 409);
  const why = reason.trim();
  if (!why) throw refuse('op_reason_required', 400, 'reason');
  await tx
    .update(projectPayments)
    .set({
      deletedAt: sql`now()`,
      deletedBy: sql`app.current_user_id()`,
      deleteReason: why,
      version: sql`${projectPayments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(projectPayments.id, payment.id));
  await writeHistory(tx, {
    entity: 'project_payment',
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
 * Транш — источник файлов («Файлы: платёжка, чек»): виден ли его проект сотруднику (`where`), удалён ли
 * транш, контрагент и ответственные проекта, включены ли «Проекты контрагентов» и «Плата за
 * обслуживание» (от неё зависит, видны ли деньги проектов).
 */
export async function projectPaymentFileSource(
  tx: Tx,
  id: string,
  where: SQL | undefined,
): Promise<{
  contractor: ProjectContractor;
  members: string[];
  projectId: string;
  deleted: boolean;
  projectsOn: boolean;
  feeOn: boolean;
} | null> {
  try {
    const p = await projectPaymentOf(tx, id, where, false);
    const { features } = await orgMenuSettings(tx, p.payment.orgId);
    return {
      contractor: p.contractor,
      members: p.members,
      projectId: p.project.id,
      deleted: !!p.payment.deletedAt,
      projectsOn: features.projects,
      feeOn: features.fee,
    };
  } catch (e) {
    if (e instanceof RecordNotFoundError) return null;
    throw e;
  }
}

/**
 * Файлы траншей в Файловом менеджере (прототип `allFiles`: вместе с файлами проекта — вид «Проект»,
 * источник — название проекта, «Перейти к источнику» — карточка проекта): проект, который сотрудник
 * видит (`projectVisibility`); `ref` — номер проекта.
 */
export function projectPaymentFilesPart(viewer: ProjectViewer): FileListPart {
  const projectId = sql`(select ${projectPayments.projectId} from ${projectPayments} where ${projectPayments.id} = ${files.sourceId})`;
  return {
    visible: sql`exists (select 1 from ${projects} join ${contractors} on ${contractors.id} = ${projects.contractorId} where ${projects.id} = ${projectId} and ${projectVisibility(viewer) ?? sql`true`})`,
    source: sql`(select ${projects.name} from ${projects} where ${projects.id} = ${projectId})`,
    ref: sql`(${projectId})::text`,
  };
}
