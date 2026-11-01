import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  addServicePayment,
  contractorScope,
  createOneOffService,
  deleteOneOffService,
  deleteServicePayment,
  editOneOffService,
  editServicePayment,
  listSourceFiles,
  oneOffServiceCard,
  oneOffServiceFormData,
  oneOffServiceOf,
  orgMenuSettings,
  servicePaymentCard,
  servicePaymentOf,
  withOrgContext,
  type ServiceHistoryRow,
  type Tx,
} from '@buhuchet/db';
import {
  canSeeContractor,
  hasPermission,
  opAmountLimit,
  opLock,
  scopeOf,
  type AccessSubject,
  type Feature,
  type HistoryAction,
  type Translate,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  OkResponse,
  OperationDeleteRequest,
  OperationEdited,
  ServiceCard,
  ServiceEditRequest,
  ServiceForm,
  ServiceFormQuery,
  ServiceIdParam,
  ServicePaymentEditRequest,
  ServicePaymentRequest,
  ServicePaymentWindow,
  ServiceRequest,
  ServiceSaved,
} from '@buhuchet/shared';
import { and, type SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { subjectOf, todayOf, translateOf } from '../contractors/common';
import { finScopeOf, moneyFail, withMoneyErrors } from '../money/common';
import { error } from '../reports/common';
import {
  historyFilesSeen,
  lockFail,
  moneyFilesSeen,
  viewOnlyLock,
  type OpLockInfo,
} from './common';

/*
 * Разовые услуги (задача 2.22; ТЗ «Финансовые операции по контрагентам» → «Ручная операция «Разовая
 * услуга»», «Окно оплаты»; прототип modules/services.js — `serviceDlg`, `svcActions`, `svcPay`,
 * `serviceCard`; modules/fin-op.js — `opWin`, `opEditDlg`, `opDelDlg` с `sp` и `svc`).
 *
 * Видит услугу тот, кому видна вкладка «Проекты и услуги» (прототип `moneyVis`: «Видеть плату за
 * обслуживание» при включённой плате или «Вести проекты и разовые услуги»), — по контрагентам области
 * группы «Финансовые операции», как журнал. Вносит, изменяет, оплачивает и удаляет — право «Вести проекты и разовые услуги» в
 * области группы «Проекты контрагентов» (ТЗ «Окно оплаты» → «Права»: «в пределах области группы»;
 * прототип проверяет только право, docs/deviations.md п. В-31). Всё — при включённых «Финансовых
 * операциях по контрагентам».
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });
const body = <S>(schema: S) => ({ required: true, content: json(schema) });

const unauthorized = { description: 'Нет входа', content: error };
const noRight = (what: string) => ({
  description: `«Финансовые операции по контрагентам» выключены или нет права ${what}`,
  content: error,
});
const svcNotFound = {
  description: 'Нет такой услуги или её контрагент вне области',
  content: error,
};
const payNotFound = {
  description: 'Нет такой оплаты или контрагент её услуги вне области',
  content: error,
};

/** Область «Свои контрагенты» группы «Проекты контрагентов». */
export const projScopeOf = (subject: AccessSubject): SQL | undefined =>
  contractorScope(scopeOf(subject, 'projects') === 'own' ? subject.employeeId : null);

/** Вкладка «Проекты и услуги» видна (прототип `moneyVis`). */
export const servicesVisible = (subject: AccessSubject, features: { fee: boolean }) =>
  (features.fee && hasPermission(subject, 'fee')) || hasPermission(subject, 'projects');

/** Может вести услуги контрагента: право «Вести проекты» и контрагент в области группы «Проекты». */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-31
export const canKeepServices = (
  subject: AccessSubject,
  c: { responsibleEmployeeId: string | null },
) => hasPermission(subject, 'projects') && canSeeContractor(subject, 'projects', c);

/**
 * Где сотрудник видит услугу: область группы «Финансовые операции», как журнал (прототип finRows:
 * `visCps(true,'fin')`). Внести услугу можно и контрагенту вне её — по области «Проектов», как в
 * прототипе (`serviceDlg`: `visCps(false,'projects')`).
 */
export const serviceReadScope = (subject: AccessSubject): SQL | undefined => finScopeOf(subject);

/**
 * Где сотрудник меняет услугу и её оплаты: в области «Проектов» (п. В-31) и там, где он её видит, —
 * иначе «не найдено», без остатка и версии чужой для него записи.
 */
const writeScopeOf = (subject: AccessSubject): SQL | undefined =>
  and(projScopeOf(subject), serviceReadScope(subject));

/** Замки «нет права» — ответ 403, остальные — 409. */
const NO_RIGHT_LOCKS: ReadonlySet<string> = new Set(['op_view_only', 'service_pay_right']);

/**
 * Транзакция услуг: «Финансовые операции по контрагентам» выключены — 403 `finops_off`; отказы слоя
 * данных — ответом API с кодом, полем и подстановками.
 */
function inServices<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, features: Record<Feature, boolean>) => Promise<T>,
): Promise<T> {
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, ctx, async (tx) => {
    const { features } = await orgMenuSettings(tx, ctx.orgId);
    if (!features.finops) moneyFail(403, 'finops_off');
    return withMoneyErrors(() => fn(tx, features));
  });
}

/** Без права видеть услуги — 403 (как у проверки права в начале метода). */
function requireVisible(subject: AccessSubject, features: Record<Feature, boolean>): void {
  if (!servicesVisible(subject, features)) apiFail(403, 'forbidden', 'Нет права на это действие');
}

type Lock = OpLockInfo | { code: string; text: string } | null;

/**
 * Замки услуги (прототип svcActions, `opLock`): «Изменить» и «Записать оплату» — с правом «Вести
 * проекты» (у оплаты — ещё «Услуга оплачена полностью»), «Удалить» — как у операции: удалена, контрагент
 * в архиве, нет права.
 */
export async function serviceLocks(
  t: Translate,
  subject: AccessSubject,
  s: {
    deleted: boolean;
    left: number;
    contractor: { archived: boolean; responsibleEmployeeId: string | null };
  },
  viewOnlyOf: ViewOnly,
): Promise<{ edit: Lock; del: Lock; pay: Lock }> {
  const can = canKeepServices(subject, s.contractor);
  const viewOnly = can ? null : await viewOnlyOf();
  const deleted = { code: 'service_deleted', text: t('err.service_deleted') };
  const delCode = opLock(
    {
      kind: 'svc',
      deleted: s.deleted,
      canKind: can,
      canArchiveRest: false,
      canMoney: false,
      archived: s.contractor.archived,
      monthClosed: false,
      receiptPart: false,
    },
    'del',
  );
  const del =
    delCode === null
      ? null
      : delCode === 'op_view_only'
        ? viewOnly
        : { code: delCode, text: t(`err.${delCode}` as UiTextKey) };
  // «Записать оплату» (прототип svcActions): оплачена полностью — так и сказано, иначе без права —
  // «Нужно право «Вести проекты и разовые услуги»».
  return {
    edit: s.deleted ? deleted : viewOnly,
    del,
    pay: s.deleted
      ? deleted
      : s.left <= 0
        ? { code: 'service_paid_full', text: t('err.service_paid_full') }
        : viewOnly
          ? { code: 'service_pay_right', text: t('err.service_pay_right') }
          : null,
  };
}

/** «Только просмотр: нужно право «Вести проекты…»» — по запросу, из каталога прав не больше раза. */
export type ViewOnly = () => Promise<OpLockInfo>;

/**
 * Текст «Только просмотр» для замков услуг и оплат: каталог прав читается один раз на запрос, а не на
 * каждую строку журнала или оплату карточки (как `journalLocks`).
 */
export function viewOnlyOnce(tx: Tx, t: Translate): ViewOnly {
  let lock: Promise<OpLockInfo> | undefined;
  return () => (lock ??= viewOnlyLock(tx, t, 'projects'));
}

/** Замок оплаты услуги (прототип opLock с `sp`): услуга или оплата удалена, нет права, архив. */
export async function servicePaymentLock(
  t: Translate,
  subject: AccessSubject,
  p: {
    deleted: boolean;
    serviceDeleted: boolean;
    contractor: { archived: boolean; responsibleEmployeeId: string | null };
  },
  act: 'edit' | 'del',
  viewOnlyOf: ViewOnly,
): Promise<Lock> {
  const code = opLock(
    {
      kind: 'sp',
      deleted: p.deleted,
      ownerDeleted: p.serviceDeleted,
      canKind: canKeepServices(subject, p.contractor),
      canArchiveRest: false,
      canMoney: false,
      archived: p.contractor.archived,
      monthClosed: false,
      receiptPart: false,
    },
    act,
  );
  if (!code) return null;
  if (code === 'op_view_only') return viewOnlyOf();
  return { code, text: t(`err.${code}` as UiTextKey) };
}

const historyOut = (rows: readonly ServiceHistoryRow[]) =>
  rows.map((h) => ({
    id: h.id,
    at: h.at.toISOString(),
    actor: h.actorName,
    action: h.action as HistoryAction,
    paymentId: h.paymentId,
    changes: h.changes as { field: string; from?: unknown; to?: unknown }[],
    reason: h.reason,
  }));

/** Файлы к записи окно загрузит после ответа — значит, загружать их должно быть можно. */
function checkUpload(
  subject: AccessSubject,
  features: Record<Feature, boolean>,
  count: number | undefined,
) {
  if ((count ?? 0) > 0 && !(features.files && hasPermission(subject, 'filesUpload')))
    apiFail(403, 'forbidden', 'Нет права на это действие');
}

/* ───────────── Окно «Разовая услуга» ───────────── */

export const serviceFormRoute = createRoute({
  method: 'get',
  path: '/one-off-services/form',
  tags: ['finance'],
  summary: 'Окно «Разовая услуга»: контрагенты, исполнители',
  middleware: [requirePermission('projects')] as const,
  request: { query: ServiceFormQuery },
  responses: {
    200: {
      description: 'Контрагенты области, исполнители, кто по умолчанию',
      content: json(ServiceForm),
    },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги»'),
  },
});

export function serviceFormHandler(deps: ApiDeps): RouteHandler<typeof serviceFormRoute, AppEnv> {
  return async (c) => {
    const { contractorId } = c.req.valid('query');
    const subject = subjectOf(c);
    const data = await inServices(deps, c, (tx) =>
      oneOffServiceFormData(tx, projScopeOf(subject), contractorId ?? null),
    );
    // Прототип serviceDlg: исполнитель — ответственный контрагента, иначе сам сотрудник.
    const performer = data.responsible ?? subject.employeeId ?? null;
    const res: ServiceForm = {
      contractors: data.contractors,
      performers: data.performers,
      performer: data.performers.some((p) => p.id === performer) ? performer : null,
      today: todayOf(deps),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(res, 200);
  };
}

export const serviceCreateRoute = createRoute({
  method: 'post',
  path: '/one-off-services',
  tags: ['finance'],
  summary: '«Добавить услугу»',
  middleware: [requirePermission('projects')] as const,
  request: { body: body(ServiceRequest) },
  responses: {
    201: { description: 'Услуга записана; файлы окно загрузит к ней', content: json(ServiceSaved) },
    400: {
      description: 'Нет контрагента, названия, даты или стоимости; исполнитель не из организации',
      content: error,
    },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги» или «Загружать файлы»'),
    409: { description: 'Контрагент в архиве', content: error },
  },
});

export function serviceCreateHandler(
  deps: ApiDeps,
): RouteHandler<typeof serviceCreateRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const saved = await inServices(deps, c, (tx, features) => {
      checkUpload(subject, features, input.files);
      return createOneOffService(
        tx,
        {
          contractorId: input.contractorId,
          name: input.name,
          date: input.date,
          amount: input.amount,
          performerEmployeeId: input.performerId,
          description: input.description ?? '',
          paidNow: input.paidNow ?? false,
        },
        { today: todayOf(deps), scope: projScopeOf(subject) },
      );
    });
    return c.json(saved, 201);
  };
}

/* ───────────── Карточка услуги ───────────── */

export const serviceCardRoute = createRoute({
  method: 'get',
  path: '/one-off-services/{id}',
  tags: ['finance'],
  summary: 'Карточка разовой услуги',
  middleware: [requireEmployee] as const,
  request: { params: ServiceIdParam },
  responses: {
    200: {
      description: 'Стоимость, получено, оплаты, кто внёс, что можно сделать, история',
      content: json(ServiceCard),
    },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги» или «Видеть плату за обслуживание»'),
    404: svcNotFound,
  },
});

export function serviceCardHandler(deps: ApiDeps): RouteHandler<typeof serviceCardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const res = await inServices(deps, c, async (tx, features) => {
      requireVisible(subject, features);
      const card = await oneOffServiceCard(tx, id, serviceReadScope(subject));
      if (!card) return null;
      const s = card.service;
      const amount = Number(s.amount);
      const viewOnly = viewOnlyOnce(tx, t);
      const locks = await serviceLocks(
        t,
        subject,
        { deleted: !!s.deletedAt, left: amount - card.paid, contractor: card.contractor },
        viewOnly,
      );
      // Замки действующих оплат одинаковы: услуга и контрагент у них общие.
      const facts = { deleted: false, serviceDeleted: !!s.deletedAt, contractor: card.contractor };
      const payLock = {
        edit: await servicePaymentLock(t, subject, facts, 'edit', viewOnly),
        del: await servicePaymentLock(t, subject, facts, 'del', viewOnly),
      };
      // Файлы и записи о них в истории — тому, кто видит файлы контрагента (как модуль файлов).
      const filesSeen = moneyFilesSeen(subject, features.files, card.contractor);
      const out: ServiceCard = {
        id: s.id,
        version: s.version,
        contractor: {
          id: card.contractor.id,
          name: card.contractor.name,
          archived: card.contractor.archived,
        },
        name: s.name,
        date: s.serviceDate,
        amount,
        paid: card.paid,
        status: card.status,
        performer: s.performerEmployeeId
          ? { id: s.performerEmployeeId, name: card.performerName }
          : null,
        description: s.description,
        edited: s.edited,
        created: { name: card.createdName, at: s.createdAt.toISOString() },
        updated: {
          name: card.updatedName ?? card.createdName,
          at: (s.updatedAt ?? s.createdAt).toISOString(),
        },
        deleted: s.deletedAt
          ? { name: card.deletedName, at: s.deletedAt.toISOString(), reason: s.deleteReason ?? '' }
          : null,
        payments: card.payments.map((p) => ({
          id: p.id,
          date: p.date,
          amount: p.amount,
          edited: p.edited,
          by: p.by,
          files: filesSeen ? p.files : [],
          locks: payLock,
        })),
        locks,
        files: filesSeen,
        history: historyOut(historyFilesSeen(card.history, filesSeen)),
      };
      return out;
    });
    if (!res) apiFail(404, 'not_found', 'Услуга не найдена');
    c.header('Cache-Control', 'no-store');
    return c.json(res, 200);
  };
}

/** Услуга под блокировкой для действия: в области «Проектов», замок — отказом. */
async function lockedService(
  tx: Tx,
  t: Translate,
  subject: AccessSubject,
  id: string,
  act: 'edit' | 'del' | 'pay',
) {
  const locked = await oneOffServiceOf(tx, id, writeScopeOf(subject), true);
  const card = await oneOffServiceCard(tx, id, undefined);
  const locks = await serviceLocks(
    t,
    subject,
    {
      deleted: !!locked.service.deletedAt,
      left: Number(locked.service.amount) - (card?.paid ?? 0),
      contractor: locked.contractor,
    },
    viewOnlyOnce(tx, t),
  );
  const lock = locks[act];
  if (lock) apiFail(NO_RIGHT_LOCKS.has(lock.code) ? 403 : 409, lock.code, lock.text);
  return locked;
}

export const serviceEditRoute = createRoute({
  method: 'put',
  path: '/one-off-services/{id}',
  tags: ['finance'],
  summary: '«Сохранить» в окне «Изменить разовую услугу»',
  middleware: [requirePermission('projects')] as const,
  request: { params: ServiceIdParam, body: body(ServiceEditRequest) },
  responses: {
    200: { description: 'Сохранено', content: json(OperationEdited) },
    400: {
      description:
        'Нет названия, даты или стоимости; стоимость меньше полученного; нет причины при смене стоимости или даты',
      content: error,
    },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги»'),
    404: svcNotFound,
    409: { description: 'Услуга удалена или изменена другим пользователем', content: error },
  },
});

export function serviceEditHandler(deps: ApiDeps): RouteHandler<typeof serviceEditRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inServices(deps, c, async (tx) =>
      editOneOffService(tx, await lockedService(tx, t, subject, id, 'edit'), {
        version: input.version,
        name: input.name,
        date: input.date,
        amount: input.amount,
        performerEmployeeId: input.performerId,
        description: input.description ?? '',
        reason: input.reason ?? '',
      }),
    );
    return c.json(out, 200);
  };
}

export const serviceDeleteRoute = createRoute({
  method: 'post',
  path: '/one-off-services/{id}/delete',
  tags: ['finance'],
  summary: '«Удалить» разовую услугу',
  middleware: [requirePermission('projects')] as const,
  request: { params: ServiceIdParam, body: body(OperationDeleteRequest) },
  responses: {
    200: { description: 'Услуга удалена с причиной', content: json(OkResponse) },
    400: { description: 'Нет причины', content: error },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги»'),
    404: svcNotFound,
    409: { description: 'Услуга уже удалена или контрагент в архиве', content: error },
  },
});

export function serviceDeleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof serviceDeleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    await inServices(deps, c, async (tx) =>
      deleteOneOffService(tx, await lockedService(tx, t, subject, id, 'del'), reason),
    );
    return c.json({ ok: true as const }, 200);
  };
}

/* ───────────── Оплаты ───────────── */

export const servicePayRoute = createRoute({
  method: 'post',
  path: '/one-off-services/{id}/payments',
  tags: ['finance'],
  summary: '«Записать оплату» разовой услуги',
  middleware: [requirePermission('projects')] as const,
  request: { params: ServiceIdParam, body: body(ServicePaymentRequest) },
  responses: {
    201: { description: 'Оплата записана; файлы окно загрузит к ней', content: json(ServiceSaved) },
    400: {
      description: 'Сумма не больше нуля или больше остатка; дата позже сегодня',
      content: error,
    },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги» или «Загружать файлы»'),
    404: svcNotFound,
    409: { description: 'Услуга удалена или оплачена полностью', content: error },
  },
});

export function servicePayHandler(deps: ApiDeps): RouteHandler<typeof servicePayRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const saved = await inServices(deps, c, async (tx, features) => {
      checkUpload(subject, features, input.files);
      return addServicePayment(
        tx,
        await lockedService(tx, t, subject, id, 'pay'),
        { amount: input.amount, date: input.date, note: input.note ?? '' },
        { today: todayOf(deps) },
      );
    });
    return c.json(saved, 201);
  };
}

export const servicePaymentWindowRoute = createRoute({
  method: 'get',
  path: '/one-off-service-payments/{id}',
  tags: ['finance'],
  summary: 'Окно оплаты разовой услуги',
  middleware: [requireEmployee] as const,
  request: { params: ServiceIdParam },
  responses: {
    200: {
      description: 'Сумма, дата, услуга, кто внёс, что можно сделать, история',
      content: json(ServicePaymentWindow),
    },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги» или «Видеть плату за обслуживание»'),
    404: payNotFound,
  },
});

export function servicePaymentWindowHandler(
  deps: ApiDeps,
): RouteHandler<typeof servicePaymentWindowRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const res = await inServices(deps, c, async (tx, features) => {
      requireVisible(subject, features);
      const card = await servicePaymentCard(tx, id, serviceReadScope(subject));
      if (!card) return null;
      const { payment: p, service: s } = card;
      const facts = {
        deleted: !!p.deletedAt,
        serviceDeleted: !!s.deletedAt,
        contractor: card.contractor,
      };
      const viewOnly = viewOnlyOnce(tx, t);
      const [edit, del] = await Promise.all([
        servicePaymentLock(t, subject, facts, 'edit', viewOnly),
        servicePaymentLock(t, subject, facts, 'del', viewOnly),
      ]);
      const amount = Number(p.amount);
      const limit = opAmountLimit('sp', amount, {
        available: 0,
        free: 0,
        orgHeld: 0,
        service: { amount: Number(s.amount), paid: card.paid },
      });
      const filesSeen = moneyFilesSeen(subject, features.files, card.contractor);
      const files = filesSeen
        ? (await listSourceFiles(tx, 'one_off_service_payment', id)).length
        : null;
      const out: ServicePaymentWindow = {
        id: p.id,
        version: p.version,
        contractor: {
          id: card.contractor.id,
          name: card.contractor.name,
          archived: card.contractor.archived,
        },
        service: { id: s.id, name: s.name, amount: Number(s.amount), paid: card.paid },
        date: p.paidOn,
        amount,
        note: p.note,
        edited: p.edited,
        created: { name: card.createdName, at: p.createdAt.toISOString() },
        updated: {
          name: card.updatedName ?? card.createdName,
          at: (p.updatedAt ?? p.createdAt).toISOString(),
        },
        // Прототип opWin (`opDelOf`): у оплаты удалённой услуги — отметка удаления самой услуги.
        deleted: p.deletedAt
          ? { name: card.deletedName, at: p.deletedAt.toISOString(), reason: p.deleteReason ?? '' }
          : s.deletedAt
            ? {
                name: card.serviceDeletedName,
                at: s.deletedAt.toISOString(),
                reason: s.deleteReason ?? '',
              }
            : null,
        serviceDeleted: !!s.deletedAt,
        locks: { edit, del },
        max: Math.max(0, limit?.max ?? amount),
        files,
        today: todayOf(deps),
        history: historyOut(historyFilesSeen(card.history, filesSeen)),
      };
      return out;
    });
    if (!res) apiFail(404, 'not_found', 'Оплата не найдена');
    c.header('Cache-Control', 'no-store');
    return c.json(res, 200);
  };
}

/** Оплата под блокировкой для действия: в области «Проектов», замок — отказом. */
async function lockedPayment(
  tx: Tx,
  t: Translate,
  subject: AccessSubject,
  id: string,
  act: 'edit' | 'del',
) {
  const locked = await servicePaymentOf(tx, id, writeScopeOf(subject), true);
  const lock = await servicePaymentLock(
    t,
    subject,
    {
      deleted: !!locked.payment.deletedAt,
      serviceDeleted: !!locked.service.deletedAt,
      contractor: locked.contractor,
    },
    act,
    viewOnlyOnce(tx, t),
  );
  if (lock) lockFail(lock as OpLockInfo);
  return locked;
}

export const servicePaymentEditRoute = createRoute({
  method: 'put',
  path: '/one-off-service-payments/{id}',
  tags: ['finance'],
  summary: '«Сохранить» в окне «Изменить: оплата разовой услуги»',
  middleware: [requirePermission('projects')] as const,
  request: { params: ServiceIdParam, body: body(ServicePaymentEditRequest) },
  responses: {
    200: { description: 'Сохранено (или без изменений)', content: json(OperationEdited) },
    400: {
      description:
        'Сумма больше стоимости услуги без остальных оплат; дата позже сегодня; нет причины',
      content: error,
    },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги»'),
    404: payNotFound,
    409: {
      description:
        'Оплата или услуга удалена, контрагент в архиве или запись изменена другим пользователем',
      content: error,
    },
  },
});

export function servicePaymentEditHandler(
  deps: ApiDeps,
): RouteHandler<typeof servicePaymentEditRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inServices(deps, c, async (tx) =>
      editServicePayment(
        tx,
        await lockedPayment(tx, t, subject, id, 'edit'),
        {
          version: input.version,
          amount: input.amount,
          date: input.date,
          note: input.note ?? '',
          reason: input.reason ?? '',
        },
        { today: todayOf(deps) },
      ),
    );
    return c.json(out, 200);
  };
}

export const servicePaymentDeleteRoute = createRoute({
  method: 'post',
  path: '/one-off-service-payments/{id}/delete',
  tags: ['finance'],
  summary: '«Удалить» оплату разовой услуги',
  middleware: [requirePermission('projects')] as const,
  request: { params: ServiceIdParam, body: body(OperationDeleteRequest) },
  responses: {
    200: { description: 'Оплата удалена с причиной', content: json(OkResponse) },
    400: { description: 'Нет причины', content: error },
    401: unauthorized,
    403: noRight('«Вести проекты и разовые услуги»'),
    404: payNotFound,
    409: { description: 'Оплата или услуга уже удалена, контрагент в архиве', content: error },
  },
});

export function servicePaymentDeleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof servicePaymentDeleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    await inServices(deps, c, async (tx) =>
      deleteServicePayment(tx, await lockedPayment(tx, t, subject, id, 'del'), reason),
    );
    return c.json({ ok: true as const }, 200);
  };
}
