import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  assignableType,
  assignmentDefaultFrom,
  assignmentPreview,
  compatibilitySubject,
  contractorGkedDicts,
  createAssignment,
  endAssignment,
  findAssignment,
  listAssignments,
  lockAssignee,
  orgMenuSettings,
  singleTaxRateRows,
  singleTaxSubject,
  updateAssignment,
  withOrgContext,
  type AssignableType,
  type Tx,
} from '@buhuchet/db';
import {
  ASSIGNMENT_MESSAGES,
  assignmentProblem,
  defaultSingleTaxRates,
  incompatibilityText,
  isSingleTaxType,
  ORG_REPORT_TYPE_MESSAGES,
  periodLabel,
  RecordNotFoundError,
  REPORT_MESSAGES,
  typeIncompatibility,
  type AssignmentFields,
} from '@buhuchet/domain';
import {
  AssignmentCreate,
  AssignmentEnd,
  AssignmentEnded,
  AssignmentIdParam,
  AssignmentList,
  AssignmentPreview,
  AssignmentPreviewRequest,
  AssignmentSaved,
  AssignmentUpdate,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import {
  checkResponsible,
  scopeSqlOf,
  subjectOf,
  todayOf,
  translateOf,
} from '../contractors/common';
import { assigneeScopeOf, assignmentTexts, error, withReportErrors } from './common';

/*
 * Назначения отчётов контрагентам (ТЗ «Назначение отчётов контрагентам»; прототип
 * modules/contractors.js: assignDlg, asgDlg, unassignDlg): список в карточке контрагента, предпросмотр
 * прошлых периодов, назначить, «Изменить», «Снять назначение». Экраны — карточка контрагента (2.11) и
 * «Кто что сдаёт» (2.15); подбор отчётов — 2.07.
 */

const noAssign = { description: 'Нет права «Назначать отчёты контрагентам»', content: error };
const badInput = { description: 'Неверные данные назначения', content: error };

/**
 * Вид для назначения: есть в каталоге, подключён в организации; новое назначение — только действующего
 * вида (у прежнего назначения вид, отключённый в каталоге, остаётся).
 */
export async function typeFor(tx: Tx, code: string, isNew: boolean): Promise<AssignableType> {
  const type = await assignableType(tx, code);
  if (!type)
    apiFail(400, 'validation_failed', 'Нет такого вида отчёта', { field: 'reportTypeCode' });
  if (!type.enabled) {
    apiFail(409, 'report_type_not_connected', ORG_REPORT_TYPE_MESSAGES.report_type_not_connected, {
      field: 'reportTypeCode',
    });
  }
  if (isNew && !type.active) {
    apiFail(409, 'report_type_inactive', ORG_REPORT_TYPE_MESSAGES.report_type_inactive, {
      field: 'reportTypeCode',
    });
  }
  return type;
}

/** Поля назначения по правилам вида; ошибка — 400 у поля. */
export async function checkFields(
  tx: Tx,
  fields: AssignmentFields,
  type: AssignableType,
): Promise<void> {
  const problem = assignmentProblem(fields, type, await singleTaxRateRows(tx));
  if (problem) {
    apiFail(400, problem.problem, ASSIGNMENT_MESSAGES[problem.problem], { field: problem.field });
  }
}

export const listAssignmentsRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/assignments',
  tags: ['reports'],
  summary: 'Назначения отчётов контрагента',
  middleware: [requirePermission('cpView')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Назначения: сначала действующие, со ставкой словами и ответственным',
      content: { 'application/json': { schema: AssignmentList } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать контрагентов»', content: error },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/** Блок «Сдаёт отчёты» карточки контрагента: область — как у карточки («Контрагенты»). */
export function listAssignmentsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listAssignmentsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await translateOf(deps);
    const items = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listAssignments(tx, id, { scope: scopeSqlOf(subjectOf(c)), today: todayOf(deps), t }),
    );
    return c.json({ items }, 200);
  };
}

export const assignmentPreviewRoute = createRoute({
  method: 'post',
  path: '/assignments/preview',
  tags: ['reports'],
  summary: 'Что сделает назначение с прошлыми периодами',
  middleware: [requirePermission('assign')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: AssignmentPreviewRequest } },
    },
  },
  responses: {
    200: {
      description: '«С какого периода» по умолчанию и закончившиеся периоды без отчётов',
      content: { 'application/json': { schema: AssignmentPreview } },
    },
    400: badInput,
    401: { description: 'Нет входа', content: error },
    403: noAssign,
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
    409: { description: 'Вид не подключён или отключён в каталоге', content: error },
  },
});

/**
 * Предупреждение формы назначения (прототип asgDlg): «Назначение начинается в прошлом: нет отчётов за
 * N прошлых периодов (…). Они будут созданы» и галочка «Сразу отметить прошлые периоды сданными».
 */
export function assignmentPreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof assignmentPreviewRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const t = await translateOf(deps);
    const result = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await typeFor(tx, body.reportTypeCode, false);
      return assignmentPreview(tx, body, {
        today: todayOf(deps),
        scope: assigneeScopeOf(subjectOf(c)),
      });
    });
    return c.json(
      {
        defaultFrom: result.defaultFrom,
        fromMonth: result.fromMonth,
        missing: result.missing.map((m) => ({
          periodStart: m.start,
          label: periodLabel({ period: m.period, start: m.start }, t),
        })),
      },
      200,
    );
  };
}

export const createAssignmentRoute = createRoute({
  method: 'post',
  path: '/assignments',
  tags: ['reports'],
  summary: 'Назначить вид отчёта контрагенту',
  middleware: [requirePermission('assign')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: AssignmentCreate } } },
  },
  responses: {
    201: {
      description: 'Назначение и что оно сделало с отчётами',
      content: { 'application/json': { schema: AssignmentSaved } },
    },
    400: {
      description: 'Неверные данные назначения или вид не подходит контрагенту (форма, режим, ЕНД)',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: noAssign,
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
    409: {
      description:
        'Вид уже назначен, не подключён или отключён в каталоге; контрагент в архиве или разовый',
      content: error,
    },
  },
});

/**
 * Назначить (ТЗ: один вид — одно действующее назначение; отчёты на сегодня создаются сразу; прошлые
 * периоды — если «с какого периода» в прошлом, с галочкой — сразу «Сдан» и, если сдача требует
 * подтверждения, «Подтверждено»; ответственный по умолчанию — ответственный контрагента).
 */
export function createAssignmentHandler(
  deps: ApiDeps,
): RouteHandler<typeof createAssignmentRoute, AppEnv> {
  return async (c) => {
    const { markPast, ...input } = c.req.valid('json');
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    const tt = await translateOf(deps);
    const today = todayOf(deps);
    const scope = assigneeScopeOf(subjectOf(c));
    const saved = await withOrgContext(deps.db, ctx, async (tx) => {
      const type = await typeFor(tx, input.reportTypeCode, true);
      const cp = await lockAssignee(tx, input.contractorId, scope);
      if (cp.serviceStatus === 'archived') {
        apiFail(409, 'contractor_archived', REPORT_MESSAGES.contractor_archived);
      }
      if (cp.kind === 'oneoff')
        apiFail(409, 'contractor_oneoff', REPORT_MESSAGES.contractor_oneoff);
      // Неподходящий вид не назначается (прототип compatible: в подборе и массовом назначении он недоступен).
      const why = typeIncompatibility(
        type,
        await compatibilitySubject(tx, input.contractorId),
        await singleTaxRateRows(tx),
        today,
        tt,
      );
      if (why) {
        apiFail(400, 'report_type_incompatible', incompatibilityText(why, tt), {
          field: 'reportTypeCode',
        });
      }
      // Строки единого налога не заданы — по основному и дополнительным ГКЭД, статусам и месту
      // деятельности (ТЗ «ставка … подставляется по основному ГКЭД»; прототип enAuto). Ставку других
      // видов выбирает экран назначения (п. А-2 docs/decisions.md).
      if (isSingleTaxType(input.reportTypeCode) && input.enRates.length === 0) {
        const subject = await singleTaxSubject(tx, input.contractorId);
        const dicts = await contractorGkedDicts(
          tx,
          [subject.gked, ...subject.gkedExtra].filter((c): c is string => !!c),
        );
        input.enRates = defaultSingleTaxRates(subject, dicts.rates, dicts.index);
      }
      const fromMonth = input.fromMonth ?? (await assignmentDefaultFrom(tx, input, today));
      await checkFields(tx, { ...input, fromMonth }, type);
      if (input.responsibleEmployeeId) await checkResponsible(tx, input.responsibleEmployeeId);
      const { reportConfirm } = await orgMenuSettings(tx, ctx.orgId);
      return withReportErrors(() =>
        createAssignment(
          tx,
          { ...input, fromMonth },
          {
            today,
            scope,
            markPast,
            confirm: reportConfirm,
            texts: assignmentTexts(t),
          },
        ),
      );
    });
    return c.json(
      { id: saved.assignment.id, version: saved.assignment.version, ...saved.effect },
      201,
    );
  };
}

export const updateAssignmentRoute = createRoute({
  method: 'patch',
  path: '/assignments/{id}',
  tags: ['reports'],
  summary: '«Изменить» назначение',
  middleware: [requirePermission('assign')] as const,
  request: {
    params: AssignmentIdParam,
    body: { required: true, content: { 'application/json': { schema: AssignmentUpdate } } },
  },
  responses: {
    200: {
      description: 'Назначение и что сохранение сделало с отчётами',
      content: { 'application/json': { schema: AssignmentSaved } },
    },
    400: badInput,
    401: { description: 'Нет входа', content: error },
    403: noAssign,
    ...versionedSaveResponses,
    409: {
      description: 'Назначение изменено другим пользователем или снято; контрагент в архиве',
      content: error,
    },
  },
});

/**
 * «Изменить» (прототип asgDlg): несданные отчёты получают нового ответственного и сроки по новому
 * правилу (кроме изменённых вручную и разовых); позже «до какого периода» — «Не требуется»; прошлые
 * периоды — если «с какого периода» сдвинуто в прошлое.
 */
export function updateAssignmentHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateAssignmentRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { markPast, version, ...patch } = c.req.valid('json');
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    const today = todayOf(deps);
    const scope = assigneeScopeOf(subjectOf(c));
    const saved = await withOrgContext(deps.db, ctx, async (tx) => {
      const before = await findAssignment(tx, id, scope);
      if (!before) throw new RecordNotFoundError('assignment', id);
      const type = await typeFor(tx, before.reportTypeCode, false);
      const next = { ...before, ...patch };
      await checkFields(tx, next, type);
      if (
        patch.responsibleEmployeeId &&
        patch.responsibleEmployeeId !== before.responsibleEmployeeId
      ) {
        await checkResponsible(tx, patch.responsibleEmployeeId);
      }
      const { reportConfirm } = await orgMenuSettings(tx, ctx.orgId);
      return withReportErrors(() =>
        updateAssignment(tx, id, patch, {
          version,
          today,
          scope,
          markPast,
          confirm: reportConfirm,
          texts: assignmentTexts(t),
        }),
      );
    });
    return c.json(
      { id: saved.assignment.id, version: saved.assignment.version, ...saved.effect },
      200,
    );
  };
}

export const endAssignmentRoute = createRoute({
  method: 'post',
  path: '/assignments/{id}/end',
  tags: ['reports'],
  summary: '«Снять назначение» с сегодняшнего дня',
  middleware: [requirePermission('assign')] as const,
  request: {
    params: AssignmentIdParam,
    body: { required: true, content: { 'application/json': { schema: AssignmentEnd } } },
  },
  responses: {
    200: {
      description: 'Снято; сколько будущих несданных отчётов получили «Не требуется»',
      content: { 'application/json': { schema: AssignmentEnded } },
    },
    400: badInput,
    401: { description: 'Нет входа', content: error },
    403: noAssign,
    ...versionedSaveResponses,
    409: { description: 'Назначение изменено другим пользователем или уже снято', content: error },
  },
});

/** «Снять назначение» (прототип unassignDlg): сданные остаются, будущие несданные — «Не требуется». */
export function endAssignmentHandler(
  deps: ApiDeps,
): RouteHandler<typeof endAssignmentRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const t = await serverTexts(deps);
    const result = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      withReportErrors(() =>
        endAssignment(tx, id, {
          version,
          today: todayOf(deps),
          scope: assigneeScopeOf(subjectOf(c)),
          texts: assignmentTexts(t),
        }),
      ),
    );
    return c.json(
      {
        id: result.assignment.id,
        version: result.assignment.version,
        notRequired: result.notRequired,
      },
      200,
    );
  };
}
