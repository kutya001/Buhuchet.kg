import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  deleteFeePayment,
  editFeePayment,
  editOperation,
  editReceipt,
  feePaymentCard,
  feePaymentEditForm,
  feePaymentOf,
  holderKeyOf,
  listSourceFiles,
  lockOperation,
  moneyContractor,
  operationEditForm,
  operationMonthClosed,
  receiptEditForm,
  type Tx,
} from '@buhuchet/db';
import {
  hasPermission,
  opLock,
  periodLabel,
  type AccessSubject,
  type HistoryAction,
  type Translate,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  FeePaymentEditForm,
  FeePaymentEditRequest,
  FeePaymentIdParam,
  FeePaymentWindow,
  OkResponse,
  OperationDeleteRequest,
  OperationEditForm,
  OperationEditRequest,
  OperationEdited,
  OperationIdParam,
  ReceiptEditForm,
  ReceiptEditRequest,
} from '@buhuchet/shared';
import { or, type SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireAnyPermission, requirePermission } from '../../middleware/access';
import { feeVisible, scopeSqlOf, subjectOf, todayOf, translateOf } from '../contractors/common';
import { feeFail, inFee } from '../fees/common';
import { finScopeOf, inTaxpay } from '../money/common';
import { error } from '../reports/common';
import { lockFail, operationLock, viewOnlyLock, type OpLockInfo } from './common';
import { hiddenFeeReceipt } from './ops';

/*
 * «Изменить» операции и окно оплаты за обслуживание (задача 2.22; ТЗ «Финансовые операции по
 * контрагентам» → «Окно оплаты»: «Изменить» и «Удалить» с причиной, было → стало; прототип
 * modules/fin-op.js `opEditDlg`, `opLock`, `opWin` с `src:'fee'`, modules/contractors.js `inDlg` с
 * `edit`, modules/contractor-card.js `feePayDlg` с `edit`). Замок операции — `opLock` (право своего
 * вида, архив, закрытый месяц, часть общего поступления); правила изменения — слой данных
 * (`@buhuchet/db` finance-edit).
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });
const body = <S>(schema: S) => ({ required: true, content: json(schema) });

const unauthorized = { description: 'Нет входа', content: error };
const opNotFound = {
  description: 'Нет такой операции или её контрагент вне области',
  content: error,
};
const feeNotFound = {
  description: 'Нет такой оплаты или её контрагент вне области',
  content: error,
};

/** Замок «Изменить» операции по счёту контрагента: права, архив, закрытый месяц. */
async function editLock(
  tx: Tx,
  t: Translate,
  subject: AccessSubject,
  locked: Awaited<ReturnType<typeof lockOperation>>,
): Promise<OpLockInfo | null> {
  return operationLock(
    tx,
    t,
    subject,
    {
      kind: locked.op.kind,
      deleted: !!locked.op.cancelledAt,
      monthClosed: await operationMonthClosed(tx, locked.op),
    },
    locked.c,
    'edit',
  );
}

export const operationEditFormRoute = createRoute({
  method: 'get',
  path: '/money-operations/{id}/edit-form',
  tags: ['finance'],
  summary: 'Окно «Изменить: …» операции',
  middleware: [requireAnyPermission('money', 'bonus', 'archiveRest')] as const,
  request: { params: OperationIdParam },
  responses: {
    200: {
      description: 'Поля, как их вводили, предел суммы и счета',
      content: json(OperationEditForm),
    },
    401: unauthorized,
    403: { description: 'Нет права на операции этого вида', content: error },
    404: opNotFound,
    409: {
      description: 'Операция удалена, создана системой, контрагент в архиве или месяц закрыт',
      content: error,
    },
  },
});

/** Окно «Изменить: …» (прототип opEditDlg): поступление изменяет своё окно (`receipt-form`). */
export function operationEditFormHandler(
  deps: ApiDeps,
): RouteHandler<typeof operationEditFormRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inTaxpay(deps, c, async (tx, settings) => {
      const locked = await lockOperation(tx, id, finScopeOf(subject));
      if (locked.op.kind === 'in') apiFail(404, 'not_found', 'Операция не найдена');
      const lock = await editLock(tx, t, subject, locked);
      if (lock) lockFail(lock);
      // «Добавить файлы» — как блок «Файлы» окна операции: у оплаты налога — её источник.
      const files = settings.features.files
        ? (
            await listSourceFiles(
              tx,
              locked.op.kind === 'pay' ? 'tax_payment' : 'money_operation',
              id,
            )
          ).length
        : null;
      return { locked, form: await operationEditForm(tx, locked), files };
    });
    const { op, c: cp } = out.locked;
    const amount = Number(op.amount);
    const res: OperationEditForm = {
      id: op.id,
      version: op.version,
      kind: op.kind,
      self: op.self,
      contractor: { id: cp.id, name: cp.name },
      sign: op.kind === 'corr' ? (amount < 0 ? '-' : '+') : null,
      amount: Math.abs(amount),
      date: op.opDate,
      holder: holderKeyOf(op),
      note: op.note,
      accounts: out.form.accounts,
      max: out.form.max,
      available: out.form.available,
      files: out.files,
      today: todayOf(deps),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(res, 200);
  };
}

export const operationEditRoute = createRoute({
  method: 'put',
  path: '/money-operations/{id}',
  tags: ['finance'],
  summary: '«Сохранить» в окне «Изменить: …»',
  middleware: [requireAnyPermission('money', 'bonus', 'archiveRest')] as const,
  request: { params: OperationIdParam, body: body(OperationEditRequest) },
  responses: {
    200: { description: 'Сохранено (или без изменений)', content: json(OperationEdited) },
    400: {
      description:
        'Сумма больше предела, дата позже сегодня или в закрытом месяце, нет причины, не тот счёт',
      content: error,
    },
    401: unauthorized,
    403: { description: 'Нет права на операции этого вида', content: error },
    404: opNotFound,
    409: {
      description:
        'Операция удалена, создана системой, контрагент в архиве, месяц закрыт или запись изменена другим пользователем',
      content: error,
    },
  },
});

/** «Сохранить» (прототип opEditDlg): было → стало в истории с причиной. */
export function operationEditHandler(
  deps: ApiDeps,
): RouteHandler<typeof operationEditRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inTaxpay(deps, c, async (tx) => {
      const locked = await lockOperation(tx, id, finScopeOf(subject));
      if (locked.op.kind === 'in') apiFail(404, 'not_found', 'Операция не найдена');
      const lock = await editLock(tx, t, subject, locked);
      if (lock) lockFail(lock);
      return editOperation(
        tx,
        locked,
        {
          version: input.version,
          amount: input.amount,
          sign: input.sign,
          date: input.date,
          holder: input.holder,
          note: input.note ?? '',
          reason: input.reason ?? '',
        },
        { today: todayOf(deps), t },
      );
    });
    return c.json(out, 200);
  };
}

/**
 * Часть за обслуживание в окне изменения поступления — как при записи (docs/deviations.md п. В-19):
 * плата видна, право «Менять журнал тарифов», контрагент в области «Контрагенты».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-19
async function receiptFeeEditable(
  tx: Tx,
  c: Context<AppEnv>,
  cp: { id: string; paysTo: 'emp' | 'org'; oneOff: boolean },
): Promise<boolean> {
  if (cp.paysTo !== 'org' || cp.oneOff) return false;
  const subject = subjectOf(c);
  if (!hasPermission(subject, 'tariff')) return false;
  if (!(await feeVisible(tx, orgContextOf(c).orgId, subject))) return false;
  return !!(await moneyContractor(tx, cp.id, scopeSqlOf(subject)));
}

export const receiptEditFormRoute = createRoute({
  method: 'get',
  path: '/money-operations/{id}/receipt-form',
  tags: ['finance'],
  summary: 'Окно «Изменить поступление»',
  middleware: [requirePermission('money')] as const,
  request: { params: OperationIdParam },
  responses: {
    200: {
      description:
        'Форма поступления с его детализацией, частью за обслуживание (тому, кто видит плату) и потраченным на налоги',
      content: json(ReceiptEditForm),
    },
    401: unauthorized,
    403: { description: 'Нет права «Учёт денег»', content: error },
    404: opNotFound,
    409: { description: 'Поступление удалено или контрагент в архиве', content: error },
  },
});

export function receiptEditFormHandler(
  deps: ApiDeps,
): RouteHandler<typeof receiptEditFormRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const today = todayOf(deps);
    const out = await inTaxpay(deps, c, async (tx, settings) => {
      const locked = await lockOperation(tx, id, finScopeOf(subject));
      if (locked.op.kind !== 'in' || (await hiddenFeeReceipt(tx, c, locked)))
        apiFail(404, 'not_found', 'Поступление не найдено');
      const lock = await editLock(tx, t, subject, locked);
      if (lock) lockFail(lock);
      const fee = await receiptFeeEditable(tx, c, locked.c);
      const form = await receiptEditForm(tx, locked, { today, fee, t });
      const files = settings.features.files ? (await listSourceFiles(tx, 'receipt', id)).length : 0;
      return { locked, form, fee, files };
    });
    const { op, c: cp } = out.locked;
    const { form } = out;
    const tax = Number(op.amount);
    const res: ReceiptEditForm = {
      contractor: {
        id: cp.id,
        name: cp.name,
        paysTo: cp.paysTo,
        holder: cp.responsibleName,
        needReceiptFile: cp.needReceiptFile,
        oneSum: false,
      },
      rows: form.rows.rows.map((r) => ({
        reportId: r.reportId,
        typeShort: r.typeShort,
        periodLabel: periodLabel({ period: r.period, start: r.periodStart, event: r.eventDate }, t),
        payDue: r.payDue,
        sum: r.sum,
        already: r.already,
        left: r.left,
      })),
      unpaid: form.rows.unpaid,
      fee: form.fee ? { months: form.fee.months } : null,
      today,
      edit: {
        id: op.id,
        version: op.version,
        // Без права на плату — только часть на налоги (ТЗ: плата скрыта везде).
        total: out.fee ? Number(op.total ?? tax) : tax,
        date: op.opDate,
        rows: form.allocations,
        fee: form.fee ? [...form.fee.parts] : null,
        holder: holderKeyOf(op),
        accounts: form.accounts,
        spent: form.spent && {
          min: form.spent.min,
          payments: form.spent.payments.map((p) => ({
            id: p.id,
            report: p.report,
            date: p.date,
            amount: p.amount,
          })),
        },
        files: out.files,
      },
    };
    c.header('Cache-Control', 'no-store');
    return c.json(res, 200);
  };
}

export const receiptEditRoute = createRoute({
  method: 'put',
  path: '/money-operations/{id}/receipt',
  tags: ['finance'],
  summary: '«Сохранить» в окне «Изменить поступление»',
  middleware: [requirePermission('money')] as const,
  request: { params: OperationIdParam, body: body(ReceiptEditRequest) },
  responses: {
    200: { description: 'Сохранено (или без изменений)', content: json(OperationEdited) },
    400: {
      description:
        'Меньше потраченного на налоги, детализация больше общей суммы или «Осталось», дата позже сегодня, нет причины',
      content: error,
    },
    401: unauthorized,
    403: { description: 'Нет права «Учёт денег»', content: error },
    404: opNotFound,
    409: {
      description:
        'Поступление удалено, контрагент в архиве или запись изменена другим пользователем',
      content: error,
    },
  },
});

export function receiptEditHandler(deps: ApiDeps): RouteHandler<typeof receiptEditRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inTaxpay(deps, c, async (tx) => {
      const locked = await lockOperation(tx, id, finScopeOf(subject));
      if (locked.op.kind !== 'in' || (await hiddenFeeReceipt(tx, c, locked)))
        apiFail(404, 'not_found', 'Поступление не найдено');
      const lock = await editLock(tx, t, subject, locked);
      if (lock) lockFail(lock);
      const fee = await receiptFeeEditable(tx, c, locked.c);
      return editReceipt(
        tx,
        locked,
        {
          version: input.version,
          total: input.total,
          date: input.date,
          rows: input.rows ?? [],
          fee: fee ? (input.fee ?? []) : undefined,
          holder: input.holder,
          reason: input.reason ?? '',
        },
        { today: todayOf(deps), fee, t },
      );
    });
    return c.json(out, 200);
  };
}

/* ───────────── Окно оплаты за обслуживание ───────────── */

/**
 * Оплата за обслуживание видна в «Финансовых операциях» (область группы «Финансовые операции») и на
 * вкладке «Обслуживание» карточки (область «Контрагенты»): окно — в любой из них.
 */
function feeScopeOf(subject: AccessSubject): SQL | undefined {
  const fin = finScopeOf(subject);
  const cps = scopeSqlOf(subject);
  return fin && cps ? or(fin, cps) : undefined;
}

/** Замок оплаты за обслуживание (прототип `opLock` для `fee`): право «Менять журнал тарифов». */
async function feeLock(
  tx: Tx,
  t: Translate,
  subject: AccessSubject,
  p: { deleted: boolean; receiptPart: boolean },
  archived: boolean,
  act: 'edit' | 'del',
): Promise<OpLockInfo | null> {
  const code = opLock(
    {
      kind: 'fee',
      deleted: p.deleted,
      canKind: hasPermission(subject, 'tariff'),
      canArchiveRest: false,
      canMoney: hasPermission(subject, 'money'),
      archived,
      monthClosed: false,
      receiptPart: p.receiptPart,
    },
    act,
  );
  if (!code) return null;
  if (code === 'op_view_only') return viewOnlyLock(tx, t, 'tariff');
  return { code, text: t(`err.${code}` as UiTextKey) };
}

export const feePaymentWindowRoute = createRoute({
  method: 'get',
  path: '/fee-payments/{id}',
  tags: ['finance'],
  summary: 'Окно оплаты за обслуживание',
  middleware: [requirePermission('fee')] as const,
  request: { params: FeePaymentIdParam },
  responses: {
    200: {
      description: 'Сумма, месяцы, куда поступили, кто внёс, что можно сделать, история',
      content: json(FeePaymentWindow),
    },
    401: unauthorized,
    403: {
      description: '«Плата за обслуживание» выключена или нет права «Видеть плату»',
      content: error,
    },
    404: feeNotFound,
  },
});

export function feePaymentWindowHandler(
  deps: ApiDeps,
): RouteHandler<typeof feePaymentWindowRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inFee(deps, c, async (tx, settings) => {
      const card = await feePaymentCard(tx, id, feeScopeOf(subject));
      if (!card) return null;
      const facts = { deleted: !!card.payment.deletedAt, receiptPart: !!card.payment.operationId };
      const [edit, del] = await Promise.all([
        feeLock(tx, t, subject, facts, card.contractor.archived, 'edit'),
        feeLock(tx, t, subject, facts, card.contractor.archived, 'del'),
      ]);
      return { card, edit, del, files: settings.features.files };
    });
    if (!out) apiFail(404, 'not_found', 'Оплата не найдена');
    const { card } = out;
    const p = card.payment;
    const res: FeePaymentWindow = {
      id: p.id,
      version: p.version,
      contractor: card.contractor,
      date: p.paidOn,
      amount: Number(p.amount),
      allocation: [...card.allocation],
      to: p.toLabel,
      toOwner: p.toKind === 'owner',
      note: p.note,
      edited: p.edited,
      receipt: card.receipt,
      created: { name: card.createdName, at: p.createdAt.toISOString() },
      updated: {
        name: card.updatedName ?? card.createdName,
        at: (p.updatedAt ?? p.createdAt).toISOString(),
      },
      deleted: p.deletedAt
        ? { name: card.deletedName, at: p.deletedAt.toISOString(), reason: p.deleteReason ?? '' }
        : null,
      locks: { edit: out.edit, del: out.del },
      // «Изменить» у части поступления — окно поступления (прототип opEditDlg: `x.op ? inDlg(…)`).
      editReceipt: !!p.operationId && !out.edit,
      files: out.files && hasPermission(subject, 'filesView') && !p.operationId,
      history: card.history.map((h) => ({
        id: h.id,
        at: h.at.toISOString(),
        actor: h.actorName,
        action: h.action as HistoryAction,
        changes: h.changes as { field: string; from?: unknown; to?: unknown }[],
        reason: h.reason,
      })),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(res, 200);
  };
}

export const feePaymentEditFormRoute = createRoute({
  method: 'get',
  path: '/fee-payments/{id}/edit-form',
  tags: ['finance'],
  summary: 'Окно «Изменить оплату за обслуживание»',
  middleware: [requirePermission('fee'), requirePermission('tariff')] as const,
  request: { params: FeePaymentIdParam },
  responses: {
    200: { description: 'Месяцы окна и что было введено', content: json(FeePaymentEditForm) },
    401: unauthorized,
    403: { description: 'Нет права «Менять журнал тарифов»', content: error },
    404: feeNotFound,
    409: {
      description: 'Оплата удалена, часть общего поступления или контрагент в архиве',
      content: error,
    },
  },
});

export function feePaymentEditFormHandler(
  deps: ApiDeps,
): RouteHandler<typeof feePaymentEditFormRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inFee(deps, c, async (tx, settings) => {
      const locked = await feePaymentOf(tx, id, feeScopeOf(subject), false);
      const facts = {
        deleted: !!locked.payment.deletedAt,
        receiptPart: !!locked.payment.operationId,
      };
      const lock = await feeLock(tx, t, subject, facts, locked.contractor.archived, 'edit');
      if (lock) lockFail(lock);
      if (locked.payment.operationId) feeFail(409, 'fee_payment_receipt_part');
      const form = await feePaymentEditForm(tx, locked, { today: todayOf(deps), t });
      const files = settings.features.files
        ? (await listSourceFiles(tx, 'fee_payment', id)).length
        : 0;
      return { locked, form, files };
    });
    const { payment } = out.locked;
    const { subject: cp, fees, form, to, current } = out.form;
    const res: FeePaymentEditForm = {
      contractor: { id: cp.id, name: cp.name },
      debt: fees.debt,
      advance: fees.advance,
      unpaid: form.unpaid,
      amount: form.amount,
      months: form.months.map((m) => ({
        month: m.month,
        charge: m.charge,
        got: m.got,
        left: m.left,
        overdue: m.overdue,
      })),
      order: form.order,
      allocation: form.allocation.map((x) => ({ month: x.month, amount: x.amount })),
      to,
      edit: {
        id: payment.id,
        version: payment.version,
        date: payment.paidOn,
        to: current,
        note: payment.note,
        files: out.files,
      },
    };
    c.header('Cache-Control', 'no-store');
    return c.json(res, 200);
  };
}

export const feePaymentEditRoute = createRoute({
  method: 'put',
  path: '/fee-payments/{id}',
  tags: ['finance'],
  summary: '«Сохранить» в окне «Изменить оплату за обслуживание»',
  middleware: [requirePermission('fee'), requirePermission('tariff')] as const,
  request: { params: FeePaymentIdParam, body: body(FeePaymentEditRequest) },
  responses: {
    200: { description: 'Сохранено (или без изменений)', content: json(OperationEdited) },
    400: {
      description:
        'Сумма, дата позже сегодня, месяц не из окна, строка больше долга, распределено больше суммы, нет причины',
      content: error,
    },
    401: unauthorized,
    403: { description: 'Нет права «Менять журнал тарифов»', content: error },
    404: feeNotFound,
    409: {
      description:
        'Оплата удалена, часть общего поступления, контрагент в архиве или запись изменена другим пользователем',
      content: error,
    },
  },
});

export function feePaymentEditHandler(
  deps: ApiDeps,
): RouteHandler<typeof feePaymentEditRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inFee(deps, c, async (tx) => {
      const locked = await feePaymentOf(tx, id, feeScopeOf(subject), true);
      const facts = {
        deleted: !!locked.payment.deletedAt,
        receiptPart: !!locked.payment.operationId,
      };
      const lock = await feeLock(tx, t, subject, facts, locked.contractor.archived, 'edit');
      if (lock) lockFail(lock);
      return editFeePayment(
        tx,
        locked,
        {
          version: input.version,
          amount: input.amount,
          date: input.date,
          to: input.to,
          allocation: input.allocation ?? [],
          note: input.note ?? '',
          reason: input.reason ?? '',
        },
        { today: todayOf(deps), t },
      );
    });
    return c.json(out, 200);
  };
}

export const feePaymentDeleteRoute = createRoute({
  method: 'post',
  path: '/fee-payments/{id}/delete',
  tags: ['finance'],
  summary: '«Удалить» оплату за обслуживание',
  middleware: [requirePermission('fee'), requirePermission('tariff')] as const,
  request: { params: FeePaymentIdParam, body: body(OperationDeleteRequest) },
  responses: {
    200: { description: 'Оплата удалена с причиной', content: json(OkResponse) },
    400: { description: 'Нет причины', content: error },
    401: unauthorized,
    403: { description: 'Нет права «Менять журнал тарифов»', content: error },
    404: feeNotFound,
    409: {
      description: 'Оплата уже удалена, часть общего поступления или контрагент в архиве',
      content: error,
    },
  },
});

export function feePaymentDeleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof feePaymentDeleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    await inFee(deps, c, async (tx) => {
      const locked = await feePaymentOf(tx, id, feeScopeOf(subject), true);
      const facts = {
        deleted: !!locked.payment.deletedAt,
        receiptPart: !!locked.payment.operationId,
      };
      const lock = await feeLock(tx, t, subject, facts, locked.contractor.archived, 'del');
      if (lock) lockFail(lock);
      await deleteFeePayment(tx, locked, reason);
    });
    return c.json({ ok: true as const }, 200);
  };
}
