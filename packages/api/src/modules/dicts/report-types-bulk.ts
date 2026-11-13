import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  activeAssignmentCounts,
  catalogTypes,
  createOrgReportType,
  lockOrgReportTypes,
  updateOrgReportType,
  withOrgContext,
} from '@buhuchet/db';
import {
  bulkConnectStep,
  bulkDisconnectStep,
  bulkSetupEmpty,
  bulkSetupStep,
  isValidRemindDays,
  normalizeRemindDays,
  RecordNotFoundError,
  type OrgReportTypeBulkSetup,
  type OrgReportTypeBulkStep,
} from '@buhuchet/domain';
import { ApiError, OrgReportTypesBulk, OrgReportTypesBulkResult } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { policyDays, refuse } from './report-types';

/*
 * Массовые изменения видов отчётов (прототип v84 modules/dicts.js: typesBulkOn, typesBulkDlg;
 * docs/deviations.md п. О-74): галочки в списке «Виды отчётов» и действия «Подключить», «Настроить»,
 * «Отключить» — право «Вести справочники организации». Вид, которому действие не подходит (уже
 * подключён, назначен действующим контрагентам, «только оплата» для «Файла при сдаче»), пропускается,
 * остальные меняются одной транзакцией; каждое изменение — своя запись истории вида, у «Настроить» —
 * с пометкой `bulk` («массовое изменение»).
 */

const error = { 'application/json': { schema: ApiError } };

export const bulkOrgReportTypesRoute = createRoute({
  method: 'post',
  path: '/org-report-types/bulk',
  tags: ['dicts'],
  summary: 'Массовые изменения видов отчётов: подключить, настроить или отключить отмеченные',
  middleware: [requirePermission('dicts')] as const,
  request: {
    body: { content: { 'application/json': { schema: OrgReportTypesBulk } }, required: true },
  },
  responses: {
    200: {
      description: 'Сколько видов выбрано, изменено и осталось подключёнными из-за назначений',
      content: { 'application/json': { schema: OrgReportTypesBulkResult } },
    },
    400: {
      description:
        'Неверные дни напоминаний, настройки не у действия «Настроить» или в окне ничего не выбрано',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Вести справочники организации»', content: error },
    404: { description: 'Нет такого вида в каталоге', content: error },
    409: {
      description: 'Вид только что подключил или изменил другой пользователь',
      content: error,
    },
  },
});

export function bulkOrgReportTypesHandler(
  deps: ApiDeps,
): RouteHandler<typeof bulkOrgReportTypesRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    // Один порядок видов у всех запросов: два одновременных действия не ждут строки друг друга.
    const codes = [...new Set(body.codes)].sort();
    const hasSettings =
      body.needFile !== undefined ||
      body.needReceipt !== undefined ||
      body.remindDays !== undefined ||
      body.connect !== undefined;
    if (body.action !== 'setup' && hasSettings) {
      apiFail(400, 'validation_failed', 'Настройки задаются только действием «Настроить»');
    }
    const setup: OrgReportTypeBulkSetup = {
      needFile: body.needFile,
      needReceipt: body.needReceipt,
      remindDays: body.remindDays && normalizeRemindDays(body.remindDays),
      connect: body.connect ?? false,
    };
    if (body.action === 'setup') {
      if (bulkSetupEmpty(setup)) {
        apiFail(400, 'types_bulk_empty', 'Ничего не выбрано для изменения');
      }
      if (setup.remindDays && !isValidRemindDays(setup.remindDays)) refuse('remind_days_invalid');
    }
    const ctx = orgContextOf(c);
    const result = await withOrgContext(deps.db, ctx, async (tx) => {
      const types = new Map((await catalogTypes(tx, codes)).map((x) => [x.code, x]));
      const missing = codes.find((code) => !types.has(code));
      if (missing) throw new RecordNotFoundError('org_report_type', missing);
      const rows = new Map((await lockOrgReportTypes(tx, codes)).map((r) => [r.code, r]));
      const assigned =
        body.action === 'disconnect' ? await activeAssignmentCounts(tx) : new Map<string, number>();
      const days = body.action === 'disconnect' ? [] : await policyDays(tx, ctx.orgId);
      const mark = { bulk: body.action === 'setup' };
      let changed = 0;
      let busy = 0;
      for (const code of codes) {
        const type = types.get(code)!;
        const row = rows.get(code) ?? null;
        const step: OrgReportTypeBulkStep =
          body.action === 'connect'
            ? bulkConnectStep(type, row, days)
            : body.action === 'disconnect'
              ? bulkDisconnectStep(row, assigned.get(code) ?? 0)
              : bulkSetupStep(type, row, setup, days);
        if (!step) continue;
        if (step.kind === 'busy') {
          busy++;
          continue;
        }
        if (step.kind === 'create') {
          await createOrgReportType(
            tx,
            code,
            { ...step.values, remindDays: [...step.values.remindDays] },
            mark,
          );
        } else {
          const { remindDays, ...rest } = step.patch;
          await updateOrgReportType(
            tx,
            code,
            row!.version,
            { ...rest, ...(remindDays ? { remindDays: [...remindDays] } : {}) },
            mark,
          );
        }
        changed++;
      }
      return { total: codes.length, changed, busy };
    });
    return c.json(result, 200);
  };
}
