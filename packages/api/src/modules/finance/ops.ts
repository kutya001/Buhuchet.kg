import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorFunds,
  correctReceipt,
  deleteOperation,
  lockMoneyContractor,
  lockOperation,
  operationCard,
  transferTargets,
  transferToEmployee,
  writeOff,
} from '@buhuchet/db';
import { canSeeContractor, hasPermission, scopeOf, type HistoryAction } from '@buhuchet/domain';
import {
  CorrectionRequest,
  MoneyContractorParam,
  OkResponse,
  OperationDeleteRequest,
  OperationIdParam,
  OperationSaved,
  OperationWindow,
  TransferForm,
  TransferRequest,
  WriteOffRequest,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireAnyPermission, requirePermission } from '../../middleware/access';
import { feeVisible, subjectOf, todayOf, translateOf } from '../contractors/common';
import { finScopeOf, inTaxpay, moneyFail } from '../money/common';
import { error } from '../reports/common';
import { canBonus, canRefund, canTransfer, forbidden, lockFail, operationLock } from './common';

/*
 * Остаток контрагента и окно операции (задача 2.20; ТЗ «Виртуальные счета сотрудников» → «Остаток
 * после оплаты»; «Финансовые операции по контрагентам» → «Окно оплаты», «Обратные записи», «Счёт
 * организации»; прототип modules/contractors.js `moneyOpDlg`, modules/finance.js `xferDlg`, `corrDlg`,
 * modules/fin-op.js `opWin`, `opLock`, `opDelDlg`). Всё — при «Учёте оплаты налогов»; контрагент — в
 * области группы «Финансовые операции»; правила и запись — слой данных (`@buhuchet/db` finance).
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });
const body = <S>(schema: S) => ({ required: true, content: json(schema) });

const unauthorized = { description: 'Нет входа', content: error };
const cpNotFound = { description: 'Нет такого контрагента или он вне области', content: error };
const opNotFound = {
  description: 'Нет такой операции или её контрагент вне области',
  content: error,
};
const offOrNoRight = (right: string) => ({
  description: `Нет права ${right} или «Учёт оплаты налогов» выключен`,
  content: error,
});

const allFinOf = (c: Context<AppEnv>) => scopeOf(subjectOf(c), 'fin') === 'all';

export const writeOffRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/write-offs',
  tags: ['finance'],
  summary: '«Списать в бонус» и «Вернуть остаток»',
  middleware: [requireAnyPermission('bonus', 'money', 'archiveRest')] as const,
  request: { params: MoneyContractorParam, body: body(WriteOffRequest) },
  responses: {
    201: { description: 'Записано: операция по счёту контрагента', content: json(OperationSaved) },
    400: {
      description: 'Сумма больше свободного остатка, дата позже сегодня',
      content: error,
    },
    401: unauthorized,
    403: offOrNoRight(
      '«Списывать остаток в бонус», «Учёт денег» или (у архивного) «Распоряжаться остатком»',
    ),
    404: cpNotFound,
    409: { description: 'Остаток на счёте организации в бонус не списывается', content: error },
  },
});

/**
 * «Списать в бонус» и «Вернуть остаток» (прототип moneyOpDlg и кнопки вкладки «Деньги»): списание — с
 * «Виртуальными счетами» у контрагента, который переводит деньги ответственному, с правом «Списывать
 * остаток в бонус»; возврат — с правом «Учёт денег»; у архивного — оба с правом «Распоряжаться
 * остатком при архивировании».
 */
export function writeOffHandler(deps: ApiDeps): RouteHandler<typeof writeOffRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const saved = await inTaxpay(deps, c, async (tx, settings) => {
      const cp = await lockMoneyContractor(tx, id, finScopeOf(subject));
      const ok =
        input.kind === 'bonus'
          ? canBonus(subject, cp, settings.features.accounts)
          : canRefund(subject, cp);
      if (!ok) forbidden();
      return writeOff(tx, cp, { ...input, note: input.note ?? '' }, { today: todayOf(deps) });
    });
    return c.json(saved, 201);
  };
}

export const transferFormRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/transfer-form',
  tags: ['finance'],
  summary: 'Окно «Перевод на счёт сотрудника»',
  middleware: [requirePermission('money')] as const,
  request: { params: MoneyContractorParam },
  responses: {
    200: { description: 'Сколько можно перевести и кому', content: json(TransferForm) },
    401: unauthorized,
    403: offOrNoRight('«Учёт денег» или области «Все» финансовых операций'),
    404: cpNotFound,
    409: {
      description: 'Контрагент в архиве, нет ответственного или денег на счёте организации',
      content: error,
    },
  },
});

export function transferFormHandler(deps: ApiDeps): RouteHandler<typeof transferFormRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const out = await inTaxpay(deps, c, async (tx) => {
      const cp = await lockMoneyContractor(tx, id, finScopeOf(subject));
      const funds = await contractorFunds(tx, cp.id);
      if (!allFinOf(c)) forbidden();
      if (!canTransfer(subject, cp, true, funds.orgHeld)) {
        moneyFail(409, 'xfer_not_allowed');
      }
      return { cp, funds, targets: await transferTargets(tx) };
    });
    const body: TransferForm = {
      contractor: { id: out.cp.id, name: out.cp.name },
      max: Math.min(out.funds.orgHeld, out.funds.available),
      targets: out.targets.map((e) => ({
        id: e.id,
        name: e.fullName,
        responsible: e.id === out.cp.responsibleEmployeeId,
      })),
      today: todayOf(deps),
    };
    return c.json(body, 200);
  };
}

export const transferRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/transfers',
  tags: ['finance'],
  summary: '«Перевести»: со счёта организации на счёт сотрудника',
  middleware: [requirePermission('money')] as const,
  request: { params: MoneyContractorParam, body: body(TransferRequest) },
  responses: {
    201: { description: 'Перевод записан', content: json(OperationSaved) },
    400: {
      description: 'Больше, чем есть на счёте организации, не тот сотрудник, дата позже сегодня',
      content: error,
    },
    401: unauthorized,
    403: offOrNoRight('«Учёт денег» или области «Все» финансовых операций'),
    404: cpNotFound,
    409: {
      description: 'Контрагент в архиве, нет ответственного или денег на счёте организации',
      content: error,
    },
  },
});

/**
 * «Перевод» (прототип xferDlg): с правом «Учёт денег» и областью «Все» финансовых операций (прототип:
 * `seeAll('fin')`); остаток контрагента не меняется.
 */
export function transferHandler(deps: ApiDeps): RouteHandler<typeof transferRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const saved = await inTaxpay(deps, c, async (tx) => {
      const cp = await lockMoneyContractor(tx, id, finScopeOf(subject));
      if (!allFinOf(c)) forbidden();
      return transferToEmployee(
        tx,
        cp,
        { ...input, note: input.note ?? '' },
        { today: todayOf(deps), t },
      );
    });
    return c.json(saved, 201);
  };
}

export const operationRoute = createRoute({
  method: 'get',
  path: '/money-operations/{id}',
  tags: ['finance'],
  summary: 'Окно финансовой операции',
  middleware: [requireAnyPermission('finView', 'money')] as const,
  request: { params: OperationIdParam },
  responses: {
    200: {
      description:
        'Поля операции, детализация, обратные записи, кто внёс, что можно сделать, история',
      content: json(OperationWindow),
    },
    401: unauthorized,
    403: offOrNoRight('«Просматривать финансовые операции» или «Учёт денег»'),
    404: opNotFound,
  },
});

/** Окно операции: тому, кто видит вкладку «Деньги» контрагента (прототип opWin). */
export function operationHandler(deps: ApiDeps): RouteHandler<typeof operationRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inTaxpay(deps, c, async (tx, settings) => {
      const card = await operationCard(tx, id, finScopeOf(subject), t);
      if (!card) return null;
      // ОТКЛОНЕНИЕ: docs/deviations.md#В-19 — часть за обслуживание видит тот, кто видит плату.
      const fee =
        (await feeVisible(tx, orgContextOf(c).orgId, subject)) &&
        canSeeContractor(subject, 'cps', card.contractor);
      if (!fee && card.op.kind === 'in' && card.op.amount === 0) return null;
      const op = { kind: card.op.kind, deleted: !!card.op.cancelledAt };
      const [edit, del] = await Promise.all([
        operationLock(tx, t, subject, op, card.contractor, 'edit'),
        operationLock(tx, t, subject, op, card.contractor, 'del'),
      ]);
      return { card, fee, edit, del, filesOn: settings.features.files };
    });
    if (!out) apiFail(404, 'not_found', 'Операция не найдена');
    c.header('Cache-Control', 'no-store');
    return c.json(operationWindow(out, subject), 200);
  };
}

/** Окно операции для ответа API. */
function operationWindow(
  out: {
    card: NonNullable<Awaited<ReturnType<typeof operationCard>>>;
    fee: boolean;
    edit: Awaited<ReturnType<typeof operationLock>>;
    del: Awaited<ReturnType<typeof operationLock>>;
    filesOn: boolean;
  },
  subject: ReturnType<typeof subjectOf>,
): OperationWindow {
  const { card, fee } = out;
  const { op } = card;
  const feeSum = card.fee.reduce((a, x) => a + x.amount, 0);
  const allocated = card.allocations.reduce((a, x) => a + x.amount, 0);
  const at = (d: Date | null) => (d ?? op.createdAt).toISOString();
  const filesKind = op.kind === 'in' ? 'receipt' : op.kind === 'pay' ? 'tax_payment' : null;
  return {
    id: op.id,
    kind: op.kind,
    self: op.self,
    date: op.opDate,
    amount: op.kind === 'in' ? (fee ? (op.total ?? op.amount) : op.amount) : op.amount,
    receiptParts:
      op.kind === 'in'
        ? {
            tax: op.amount,
            fee: fee ? feeSum : 0,
            advance: Math.max(0, op.amount - allocated),
          }
        : null,
    contractor: {
      id: card.contractor.id,
      name: card.contractor.name,
      archived: card.contractor.archived,
    },
    report: card.report,
    holder: { kind: op.holderKind, name: card.holderName },
    note: op.note,
    allocations: card.allocations.map((x) => ({
      reportId: x.reportId,
      label: x.report,
      amount: x.amount,
    })),
    feeAllocations: fee ? card.fee : [],
    receipt: card.receipt && {
      id: card.receipt.id,
      date: card.receipt.date,
      total: fee ? card.receipt.total : card.receipt.amount,
    },
    corrections: card.corrections,
    created: { name: card.createdName, at: at(op.createdAt) },
    updated: { name: card.updatedName ?? card.createdName, at: at(op.updatedAt) },
    deleted: op.cancelledAt
      ? {
          name: card.cancelledName,
          at: op.cancelledAt.toISOString(),
          reason: op.cancelReason ?? '',
        }
      : null,
    locks: { edit: out.edit, del: out.del },
    deleteBlock: card.deleteBlock && {
      code: card.deleteBlock.code,
      available: card.deleteBlock.available,
      amount: card.deleteBlock.amount,
      payments: card.deleteBlock.payments.map((p) => ({
        id: p.id,
        report: p.report,
        date: p.date,
        amount: p.amount,
      })),
    },
    files:
      filesKind && out.filesOn && hasPermission(subject, 'filesView') ? { kind: filesKind } : null,
    history: card.history
      .map((h) => ({
        id: h.id,
        at: h.at.toISOString(),
        actor: h.actorName,
        action: h.action as HistoryAction,
        // Без права на плату — без полей платы (как история контрагента).
        changes: (h.changes as { field: string; from?: unknown; to?: unknown }[]).filter(
          (x) => fee || (x.field !== 'feeTotal' && x.field !== 'feeAllocations'),
        ),
        reason: h.reason,
      }))
      // Как в прототипе (`opHistHtml`): создание — в «Создал», в истории — изменения и удаление.
      .filter((h) => h.action !== 'create')
      .filter((h) => h.changes.length || h.reason || h.action !== 'update'),
  };
}

export const deleteOperationRoute = createRoute({
  method: 'post',
  path: '/money-operations/{id}/delete',
  tags: ['finance'],
  summary: '«Удалить», «Отменить списание», «Отменить возврат»',
  middleware: [requireAnyPermission('money', 'bonus', 'archiveRest')] as const,
  request: { params: OperationIdParam, body: body(OperationDeleteRequest) },
  responses: {
    200: { description: 'Операция отменена с причиной', content: json(OkResponse) },
    400: { description: 'Нет причины', content: error },
    401: unauthorized,
    403: offOrNoRight('на операции этого вида'),
    404: opNotFound,
    409: {
      description:
        'Операция уже удалена, создана системой, контрагент в архиве или деньги уже потрачены',
      content: error,
    },
  },
});

/**
 * «Удалить» (прототип opDelDlg): замок операции (`opLock`) — по правам и архиву; потраченное
 * поступление и обратную запись «+» не удаляют.
 */
export function deleteOperationHandler(
  deps: ApiDeps,
): RouteHandler<typeof deleteOperationRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    await inTaxpay(deps, c, async (tx) => {
      const scope = finScopeOf(subject);
      const locked = await lockOperation(tx, id, scope);
      const lock = await operationLock(
        tx,
        t,
        subject,
        { kind: locked.op.kind, deleted: !!locked.op.cancelledAt },
        locked.c,
        'del',
      );
      if (lock) lockFail(lock);
      // Оплату налога удаляют по отчёту в области «Отчётов для сдачи» не шире финансовой.
      await deleteOperation(tx, locked, reason, { scope: undefined, t });
    });
    return c.json({ ok: true as const }, 200);
  };
}

export const correctionRoute = createRoute({
  method: 'post',
  path: '/money-operations/{id}/corrections',
  tags: ['finance'],
  summary: '«Обратная запись» к поступлению',
  middleware: [requirePermission('money')] as const,
  request: { params: OperationIdParam, body: body(CorrectionRequest) },
  responses: {
    201: { description: 'Обратная запись сделана', content: json(OperationSaved) },
    400: {
      description: 'Нет причины, дата позже сегодня, «Уменьшить» больше, чем можно',
      content: error,
    },
    401: unauthorized,
    403: offOrNoRight('«Учёт денег»'),
    404: { description: 'Нет такого поступления или его контрагент вне области', content: error },
    409: { description: 'Поступление удалено или контрагент в архиве', content: error },
  },
});

/** «Обратная запись» (прототип corrDlg, в окне поступления и в меню его строки). */
export function correctionHandler(deps: ApiDeps): RouteHandler<typeof correctionRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const saved = await inTaxpay(deps, c, async (tx) => {
      const locked = await lockOperation(tx, id, finScopeOf(subject));
      if (locked.op.kind !== 'in') apiFail(404, 'not_found', 'Поступление не найдено');
      const lock = await operationLock(
        tx,
        t,
        subject,
        { kind: 'in', deleted: !!locked.op.cancelledAt },
        locked.c,
        'edit',
      );
      if (lock) lockFail(lock);
      return correctReceipt(tx, locked, input, { today: todayOf(deps) });
    });
    return c.json(saved, 201);
  };
}
