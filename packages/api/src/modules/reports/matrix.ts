import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  activeAssignments,
  assignmentDefaultFrom,
  assignmentEndPreview,
  compatibilitySubject,
  contractorGkedDicts,
  createAssignment,
  lockAssignee,
  massAssignOptions,
  orgMenuSettings,
  reportMatrix,
  responsibleOptions,
  singleTaxRateRows,
  singleTaxSubject,
  withOrgContext,
} from '@buhuchet/db';
import { defaultSingleTaxRates, isSingleTaxType, typeIncompatibility } from '@buhuchet/domain';
import {
  AssignmentBulkCreate,
  AssignmentBulkResult,
  AssignmentEndPreview,
  AssignmentIdParam,
  AssignmentMassOptions,
  AssignmentMassQuery,
  ReportMatrix,
  ReportMatrixQuery,
  ResponsibleOptions,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { subjectOf, todayOf, translateOf } from '../contractors/common';
import { checkFields, typeFor } from './assignments';
import { assigneeScopeOf, assignmentTexts, error, withReportErrors } from './common';

/*
 * «Кто что сдаёт» и массовое назначение (задача 2.15; ТЗ «Назначение отчётов контрагентам» → «Массово:
 * «НДС сдают вот эти компании»» и «Вкладка «Кто что сдаёт»»; прототип modules/reports.js `renderMatrix`,
 * modules/contractors.js `massAssignDlg`, `unassignDlg`): сетка, окно массового назначения и его
 * «Назначить», число отчётов, которые получат «Не требуется» при снятии, и сотрудники для «сменить»
 * ответственного. Галочка сетки назначает `POST /api/assignments` и снимает
 * `POST /api/assignments/{id}/end` (задача 2.06).
 */

const noAssign = { description: 'Нет права «Назначать отчёты контрагентам»', content: error };

export const reportMatrixRoute = createRoute({
  method: 'get',
  path: '/reports/matrix',
  tags: ['reports'],
  summary: 'Сетка «Кто что сдаёт»',
  middleware: [requirePermission('repView')] as const,
  request: { query: ReportMatrixQuery },
  responses: {
    200: {
      description:
        'Контрагенты в области сотрудника без архивных × подключённые виды: действующие назначения и почему вид не подходит',
      content: { 'application/json': { schema: ReportMatrix } },
    },
    400: { description: 'Неверный поиск', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать отчёты»', content: error },
  },
});

/** Область — как у назначений («Свои» — свои контрагенты): галочка сетки назначает и снимает. */
export function reportMatrixHandler(deps: ApiDeps): RouteHandler<typeof reportMatrixRoute, AppEnv> {
  return async (c) => {
    const { q } = c.req.valid('query');
    const t = await translateOf(deps);
    const body = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      reportMatrix(tx, {
        scope: assigneeScopeOf(subjectOf(c)),
        ...(q ? { q } : {}),
        today: todayOf(deps),
        t,
      }),
    );
    return c.json(body, 200);
  };
}

export const massAssignOptionsRoute = createRoute({
  method: 'get',
  path: '/assignments/mass',
  tags: ['reports'],
  summary: 'Окно «Назначить отчёт нескольким контрагентам»',
  middleware: [requirePermission('assign')] as const,
  request: { query: AssignmentMassQuery },
  responses: {
    200: {
      description:
        'Подключённые действующие виды, выбранный вид и контрагенты в области: уже сдаёт, не подходит, ставка по ГКЭД',
      content: { 'application/json': { schema: AssignmentMassOptions } },
    },
    400: { description: 'Неверный вид', content: error },
    401: { description: 'Нет входа', content: error },
    403: noAssign,
  },
});

export function massAssignOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof massAssignOptionsRoute, AppEnv> {
  return async (c) => {
    const { type } = c.req.valid('query');
    const t = await translateOf(deps);
    const body = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      massAssignOptions(tx, type, {
        scope: assigneeScopeOf(subjectOf(c)),
        today: todayOf(deps),
        t,
      }),
    );
    return c.json(body, 200);
  };
}

export const bulkAssignRoute = createRoute({
  method: 'post',
  path: '/assignments/bulk',
  tags: ['reports'],
  summary: 'Назначить вид нескольким контрагентам',
  middleware: [requirePermission('assign')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: AssignmentBulkCreate } } },
  },
  responses: {
    200: {
      description: 'Скольким назначено, сколько отчётов создано и скольких пропустили',
      content: { 'application/json': { schema: AssignmentBulkResult } },
    },
    400: { description: 'Неверные данные: вид, ставка или список контрагентов', content: error },
    401: { description: 'Нет входа', content: error },
    403: noAssign,
    404: { description: 'Контрагента нет или он вне области сотрудника', content: error },
    409: { description: 'Вид не подключён или отключён в каталоге', content: error },
  },
});

/**
 * «Назначить» (прототип massAssignDlg → assignTypes каждому отмеченному): одним сохранением; с какого
 * периода — первый, за который сегодня должен быть отчёт; ставка — выбранная для отмеченных, у единого
 * налога — строки ЕНС по ГКЭД каждого; ответственный — ответственный контрагента. Контрагент вне
 * области — 404 на всё; уже назначенный, неподходящий, разовый или ушедший в архив — пропускается.
 */
export function bulkAssignHandler(deps: ApiDeps): RouteHandler<typeof bulkAssignRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    const tt = await translateOf(deps);
    const today = todayOf(deps);
    const scope = assigneeScopeOf(subjectOf(c));
    const single = isSingleTaxType(body.reportTypeCode);
    const result = await withOrgContext(deps.db, ctx, async (tx) => {
      const type = await typeFor(tx, body.reportTypeCode, true);
      const [rates, { reportConfirm }] = await Promise.all([
        singleTaxRateRows(tx),
        orgMenuSettings(tx, ctx.orgId),
      ]);
      const out = { done: 0, created: 0, skipped: 0 };
      // По порядку номеров: два одновременных назначения блокируют контрагентов в одном порядке.
      for (const contractorId of [...new Set(body.contractorIds)].sort()) {
        const cp = await lockAssignee(tx, contractorId, scope);
        const blocked =
          cp.serviceStatus === 'archived' ||
          cp.kind === 'oneoff' ||
          (await activeAssignments(tx, contractorId)).codes.includes(body.reportTypeCode) ||
          !!typeIncompatibility(
            type,
            await compatibilitySubject(tx, contractorId),
            rates,
            today,
            tt,
          );
        if (blocked) {
          out.skipped++;
          continue;
        }
        let enRates: { code: string; variant: number | null }[] = [];
        if (single) {
          const subject = await singleTaxSubject(tx, contractorId);
          const dicts = await contractorGkedDicts(
            tx,
            [subject.gked, ...subject.gkedExtra].filter((x): x is string => !!x),
          );
          enRates = defaultSingleTaxRates(subject, dicts.rates, dicts.index);
        }
        const input = {
          contractorId,
          reportTypeCode: body.reportTypeCode,
          untilMonth: null,
          responsibleEmployeeId: null,
          rate: single ? null : body.rate,
          enRates,
          rateAdditions: [],
          dueDay: null,
          ownPeriod: null,
          ownDay: null,
          ownMonth: null,
          fixedAmount: null,
          note: '',
        };
        const fromMonth = await assignmentDefaultFrom(tx, input, today);
        await checkFields(tx, { ...input, fromMonth }, type);
        const saved = await withReportErrors(() =>
          createAssignment(
            tx,
            { ...input, fromMonth },
            {
              today,
              scope,
              markPast: false,
              confirm: reportConfirm,
              texts: assignmentTexts(t),
            },
          ),
        );
        out.done++;
        out.created += saved.effect.created + saved.effect.past + saved.effect.restored;
      }
      return out;
    });
    return c.json(result, 200);
  };
}

export const assignmentEndPreviewRoute = createRoute({
  method: 'get',
  path: '/assignments/{id}/end-preview',
  tags: ['reports'],
  summary: 'Что сделает «Снять назначение»',
  middleware: [requirePermission('assign')] as const,
  request: { params: AssignmentIdParam },
  responses: {
    200: {
      description: 'Сколько будущих несданных отчётов получат «Не требуется»',
      content: { 'application/json': { schema: AssignmentEndPreview } },
    },
    400: { description: 'Неверный номер назначения', content: error },
    401: { description: 'Нет входа', content: error },
    403: noAssign,
    404: { description: 'Нет такого назначения или оно вне области сотрудника', content: error },
  },
});

/** Окно «Снять назначение: НДС?» (прототип unassignDlg): «Будущих несданных отчётов: N». */
export function assignmentEndPreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof assignmentEndPreviewRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const notRequired = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      assignmentEndPreview(tx, id, {
        scope: assigneeScopeOf(subjectOf(c)),
        today: todayOf(deps),
      }),
    );
    return c.json({ notRequired }, 200);
  };
}

export const responsibleOptionsRoute = createRoute({
  method: 'get',
  path: '/assignments/responsible-options',
  tags: ['reports'],
  summary: 'Сотрудники, которых можно сделать ответственными',
  middleware: [requirePermission('assign')] as const,
  responses: {
    200: {
      description: 'Действующие сотрудники организации по имени',
      content: { 'application/json': { schema: ResponsibleOptions } },
    },
    401: { description: 'Нет входа', content: error },
    403: noAssign,
  },
});

/** «сменить» ответственного в карточке отчёта (прототип: меню `EMP.filter(e => e.active)`). */
export function responsibleOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof responsibleOptionsRoute, AppEnv> {
  return async (c) => {
    const employees = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      responsibleOptions(tx),
    );
    return c.json({ employees }, 200);
  };
}
