import { createRoute, type RouteHandler, type z } from '@hono/zod-openapi';
import {
  confirmReport,
  confirmReports,
  orgMenuSettings,
  returnReportForFix,
  rollbackReport,
  setReportAmount,
  setReportStep,
  submitReport,
  submitReports,
  withOrgContext,
  type ReportConfirmContext,
  type ReportStep,
  type Tx,
} from '@buhuchet/db';
import { formatText, hasPermission, type PermissionId, type Translate } from '@buhuchet/domain';
import {
  ReportAmountRequest,
  ReportBatchConfirmRequest,
  ReportBatchResult,
  ReportBatchSubmitRequest,
  ReportBatchSubmitResult,
  ReportConfirmRequest,
  ReportFixRequest,
  ReportIdParam,
  ReportRollbackRequest,
  ReportSaved,
  ReportStepRequest,
  ReportSubmitRequest,
  ReportSubmitted,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { subjectOf, todayOf } from '../contractors/common';
import { assigneeScopeOf, error, reportScopeOf, withReportErrors } from './common';

/*
 * Сдача и подтверждение отчёта (задача 2.14; ТЗ «Отчеты для сдачи» → «Сдача отчёта», «Подтверждение
 * сдачи», «Откат статуса», «Сумма к уплате»; прототип modules/reports.js reportActions, ui/status-scale.js
 * submitDlg, repConfDlg, repFixDlg, sumDlg, rollbackDlg, setStatus). Что можно — правила @buhuchet/domain
 * в слое данных; здесь — права, учётная политика (подтверждение сдачи, «Файлы в карточках») и ответ.
 * Отчёт блокируется до конца транзакции; версия в теле — «запись изменена другим пользователем».
 */

/** Учётная политика, область «Свои», кто подтверждает и тексты словаря. */
async function actionContext(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tx: Tx,
  t: Translate,
): Promise<ReportConfirmContext> {
  const subject = subjectOf(c);
  const org = orgContextOf(c);
  const { features, reportConfirm, payFirst } = await orgMenuSettings(tx, org.orgId);
  return {
    today: todayOf(deps),
    scope: reportScopeOf(subject),
    contractorScope: assigneeScopeOf(subject),
    confirmOn: reportConfirm,
    filesOn: features.files,
    payFirst,
    t,
    confirmer: {
      canConfirm: hasPermission(subject, 'repConfirm'),
      userId: org.userId ?? null,
      isOwner: subject.isOwner,
    },
  };
}

/** Действие в транзакции организации с отказами модуля ответом API. */
async function run<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  act: (tx: Tx, ctx: ReportConfirmContext) => Promise<T>,
): Promise<T> {
  const texts = await serverTexts(deps);
  const t: Translate = (key, params) => formatText(texts(key), params);
  return withOrgContext(deps.db, orgContextOf(c), async (tx) =>
    withReportErrors(async () => act(tx, await actionContext(deps, c, tx, t))),
  );
}

const repeatTexts = (ctx: ReportConfirmContext) => ({
  repeat: ctx.t('report.amount.repeat'),
  afterPayment: ctx.t('report.reason.after_payment'),
});

const saved = { 'application/json': { schema: ReportSaved } };
const batch = { 'application/json': { schema: ReportBatchResult } };
const body = <S extends z.ZodType>(schema: S) => ({
  required: true,
  content: { 'application/json': { schema } },
});

/** Ответы действия с одним отчётом. */
function oneResponses(right: string, refused: string) {
  return {
    200: { description: 'Сделано: новая версия отчёта', content: saved },
    400: { description: 'Неверные данные', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: right, content: error },
    404: { description: 'Нет такого отчёта или он вне области сотрудника', content: error },
    409: {
      description: `Отчёт изменён другим пользователем; ${refused}`,
      content: error,
    },
  } as const;
}

const batchResponses = (right: string) =>
  ({
    200: { description: 'Сколько сделано и сколько пропущено', content: batch },
    400: { description: 'Неверные данные', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: right, content: error },
    404: { description: 'Нет такого отчёта или он вне области сотрудника', content: error },
    409: { description: 'Отчёт изменён другим пользователем', content: error },
  }) as const;

const STATUS_RIGHT = 'Нет права «Менять статус сдачи»';
const CONFIRM_RIGHT = 'Нет права «Подтверждать сдачу отчётов» или это свой сданный отчёт';

// Путь — литералом: по нему клиент API (`hc`) строит методы, `string` ломает типы всего клиента.
// Права — все нужные: право группы «Отчёты» уже требует «Просматривать отчёты», право из «Общих» — нет.
const route = <P extends string, B extends z.ZodType>(
  path: P,
  summary: string,
  permissions: readonly PermissionId[],
  schema: B,
  responses: ReturnType<typeof oneResponses>,
) =>
  createRoute({
    method: 'post',
    path,
    tags: ['reports'],
    summary,
    middleware: permissions.map((p) => requirePermission(p)),
    request: { params: ReportIdParam, body: body(schema) },
    responses,
  });

export const submitReportRoute = createRoute({
  method: 'post',
  path: '/reports/{id}/submit',
  tags: ['reports'],
  summary: '«Отметить сданным»',
  middleware: [requirePermission('changeStatus')] as const,
  request: { params: ReportIdParam, body: body(ReportSubmitRequest) },
  responses: {
    ...oneResponses(STATUS_RIGHT, 'отчёт уже сдан, это прежняя версия или вид «Уплата»'),
    200: {
      description:
        'Сделано: новая версия отчёта; `waitsPayment` — «Сдан» ждёт оплаты, сумма и файлы сохранены',
      content: { 'application/json': { schema: ReportSubmitted } },
    },
  },
});

/**
 * «Отметить сданным» (ТЗ «При отметке «Сдан» указывается дата сдачи, сумма к уплате и можно
 * прикрепить файлы»): сумма и строки вводятся в том же окне, как в прототипе, по праву «Менять статус
 * сдачи»; файлы загружены в окне заранее (блок «Файлы» отчёта).
 */
export function submitReportHandler(deps: ApiDeps): RouteHandler<typeof submitReportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...input } = c.req.valid('json');
    const { report: r, waitsPayment } = await run(deps, c, (tx, ctx) =>
      submitReport(tx, id, input, { ...ctx, version, texts: repeatTexts(ctx) }),
    );
    return c.json({ id: r.id, version: r.version, waitsPayment }, 200);
  };
}

export const submitReportsRoute = createRoute({
  method: 'post',
  path: '/reports/submit',
  tags: ['reports'],
  summary: 'Массово «Отметить сданными»',
  middleware: [requirePermission('changeStatus')] as const,
  request: { body: body(ReportBatchSubmitRequest) },
  responses: {
    ...batchResponses(STATUS_RIGHT),
    200: {
      description: 'Сколько сделано и сколько пропущено (без файла, без оплаты, по статусу)',
      content: { 'application/json': { schema: ReportBatchSubmitResult } },
    },
  },
});

/**
 * Массово «Отметить сданными» (ТЗ «Массово: выбрать несколько отчётов и отметить сданными одной датой,
 * суммы вписать в том же окне»): отчёты, которым нужен файл, и уже сданные пропускаются.
 */
export function submitReportsHandler(
  deps: ApiDeps,
): RouteHandler<typeof submitReportsRoute, AppEnv> {
  return async (c) => {
    const { date, items } = c.req.valid('json');
    const result = await run(deps, c, (tx, ctx) =>
      submitReports(tx, items, date, { ...ctx, texts: repeatTexts(ctx) }),
    );
    return c.json(result, 200);
  };
}

export const confirmReportRoute = route(
  '/reports/{id}/confirm',
  '«Подтвердить» сдачу отчёта',
  ['repConfirm'],
  ReportConfirmRequest,
  oneResponses(CONFIRM_RIGHT, 'отчёт не ждёт подтверждения'),
);

/** «Подтвердить» (ТЗ «Подтверждение сдачи»): отметка «Подтверждено», кто и когда. */
export function confirmReportHandler(
  deps: ApiDeps,
): RouteHandler<typeof confirmReportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...input } = c.req.valid('json');
    const r = await run(deps, c, (tx, ctx) => confirmReport(tx, id, input, { ...ctx, version }));
    return c.json({ id: r.id, version: r.version }, 200);
  };
}

export const confirmReportsRoute = createRoute({
  method: 'post',
  path: '/reports/confirm',
  tags: ['reports'],
  summary: 'Массово «Подтвердить» во вкладке «Ожидают подтверждения»',
  middleware: [requirePermission('repConfirm')] as const,
  request: { body: body(ReportBatchConfirmRequest) },
  responses: batchResponses('Нет права «Подтверждать сдачу отчётов»'),
});

export function confirmReportsHandler(
  deps: ApiDeps,
): RouteHandler<typeof confirmReportsRoute, AppEnv> {
  return async (c) => {
    const { note, items } = c.req.valid('json');
    const result = await run(deps, c, (tx, ctx) => confirmReports(tx, items, note, ctx));
    return c.json(result, 200);
  };
}

export const fixReportRoute = route(
  '/reports/{id}/fix',
  '«На исправление»',
  ['repConfirm'],
  ReportFixRequest,
  oneResponses(CONFIRM_RIGHT, 'отчёт не ждёт подтверждения'),
);

/** «На исправление» (ТЗ: старший бухгалтер возвращает отчёт с обязательной причиной). */
export function fixReportHandler(deps: ApiDeps): RouteHandler<typeof fixReportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, reason } = c.req.valid('json');
    const r = await run(deps, c, (tx, ctx) =>
      returnReportForFix(tx, id, reason, { ...ctx, version }),
    );
    return c.json({ id: r.id, version: r.version }, 200);
  };
}

/** Шаг без окна из меню и шкалы. */
function stepRoute<P extends string>(path: P, summary: string, refused: string) {
  return route(
    path,
    summary,
    ['changeStatus'],
    ReportStepRequest,
    oneResponses(STATUS_RIGHT, refused),
  );
}

export const startReportRoute = stepRoute(
  '/reports/{id}/start',
  '«Взять в работу»',
  'отчёт не в «К сдаче»',
);
export const rejectReportRoute = stepRoute(
  '/reports/{id}/reject',
  '«Требует исправления»: орган не принял отчёт',
  'отчёт не сдан',
);
export const notRequiredReportRoute = stepRoute(
  '/reports/{id}/not-required',
  '«Не требуется»',
  'отчёт уже «Не требуется» или сдан и подтверждён',
);

/** Шаг отчёта по версии: новая версия записи. */
async function stepOf(
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
  version: number,
  to: ReportStep,
) {
  const r = await run(deps, c, (tx, ctx) => setReportStep(tx, id, to, { ...ctx, version }));
  return { id: r.id, version: r.version };
}

export const startReportHandler =
  (deps: ApiDeps): RouteHandler<typeof startReportRoute, AppEnv> =>
  async (c) =>
    c.json(
      await stepOf(deps, c, c.req.valid('param').id, c.req.valid('json').version, 'in_progress'),
      200,
    );
export const rejectReportHandler =
  (deps: ApiDeps): RouteHandler<typeof rejectReportRoute, AppEnv> =>
  async (c) =>
    c.json(
      await stepOf(deps, c, c.req.valid('param').id, c.req.valid('json').version, 'needs_fix'),
      200,
    );
export const notRequiredReportHandler =
  (deps: ApiDeps): RouteHandler<typeof notRequiredReportRoute, AppEnv> =>
  async (c) =>
    c.json(
      await stepOf(deps, c, c.req.valid('param').id, c.req.valid('json').version, 'not_required'),
      200,
    );

export const rollbackReportRoute = route(
  '/reports/{id}/rollback',
  'Откат статуса отчёта на шаг назад',
  ['repView', 'rollback'],
  ReportRollbackRequest,
  oneResponses(
    'Нет права «Просматривать отчёты» или «Откат статусов»',
    'откатывать некуда или сначала — уточнённая версия',
  ),
);

/** Откат (ТЗ «Откат статуса»: право «Откат статусов», причина обязательна, запись в историю). */
export function rollbackReportHandler(
  deps: ApiDeps,
): RouteHandler<typeof rollbackReportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, to, reason } = c.req.valid('json');
    const r = await run(deps, c, (tx, ctx) =>
      rollbackReport(tx, id, { to, reason }, { ...ctx, version }),
    );
    return c.json({ id: r.id, version: r.version }, 200);
  };
}

export const reportAmountRoute = route(
  '/reports/{id}/amount',
  '«Указать сумму»',
  ['changeSum'],
  ReportAmountRequest,
  oneResponses('Нет права «Менять сумму к уплате»', 'у вида нет суммы или отчёт «Не требуется»'),
);

/** «Указать сумму» (ТЗ «Сумма к уплате»: вручную, 0 — нулевой отчёт, «Повторять эту сумму»). */
export function reportAmountHandler(deps: ApiDeps): RouteHandler<typeof reportAmountRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...input } = c.req.valid('json');
    const r = await run(deps, c, (tx, ctx) =>
      setReportAmount(tx, id, input, { ...ctx, version, texts: repeatTexts(ctx) }),
    );
    return c.json({ id: r.id, version: r.version }, 200);
  };
}
