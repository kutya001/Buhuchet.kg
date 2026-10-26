import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  getOrgPolicy,
  getRole,
  orgPolicyHistory,
  schema,
  updateWithHistory,
  withOrgContext,
  type OrgPolicyRecord,
} from '@buhuchet/db';
import {
  CONFIRM_WAIT_DAYS_MESSAGE,
  featureChangeProblem,
  isValidConfirmWaitDays,
  isValidRemindDays,
  normalizePageSections,
  normalizeRemindDays,
  RecordNotFoundError,
  REMIND_DAYS_MESSAGE,
  sameHistoryValue,
  toHistoryValue,
  type Feature,
} from '@buhuchet/domain';
import { OrgPolicy, OrgPolicyHistory, UpdateOrgPolicyRequest } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { error } from './profile';

const { orgSettings } = schema;

/** Учётная политика для ответа API: моменты — строкой ISO. */
function orgPolicyBody(p: OrgPolicyRecord): OrgPolicy {
  return {
    features: p.features,
    taskConfirm: p.taskConfirm,
    reportConfirm: p.reportConfirm,
    confirmWaitDays: p.confirmWaitDays,
    payBeforeSubmit: p.payBeforeSubmit,
    remindDays: p.remindDays,
    pageSections: p.pageSections,
    timezone: p.timezone,
    overdueRepeat: p.overdueRepeat,
    digestTime: p.digestTime,
    defaultRoleId: p.defaultRoleId,
    audit: {
      createdAt: p.audit.createdAt.toISOString(),
      createdBy: p.audit.createdBy,
      updatedAt: p.audit.updatedAt.toISOString(),
      updatedBy: p.audit.updatedBy,
    },
    version: p.version,
  };
}

export const getOrgPolicyRoute = createRoute({
  method: 'get',
  path: '/org/policy',
  tags: ['org'],
  summary: 'Учётная политика и настройки организации',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Учётная политика',
      content: { 'application/json': { schema: OrgPolicy } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

/** Учётную политику видят все сотрудники; менять её может только владелец (ТЗ «Моя организация»). */
export function getOrgPolicyHandler(deps: ApiDeps): RouteHandler<typeof getOrgPolicyRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const policy = await withOrgContext(deps.db, ctx, (tx) => getOrgPolicy(tx, ctx.orgId));
    if (!policy) throw new RecordNotFoundError('org_settings', ctx.orgId);
    return c.json(orgPolicyBody(policy), 200);
  };
}

export const updateOrgPolicyRoute = createRoute({
  method: 'patch',
  path: '/org/policy',
  tags: ['org'],
  summary: 'Сохранить учётную политику и настройки: функции, подтверждения, дни напоминаний, …',
  middleware: [requirePermission('org')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: UpdateOrgPolicyRequest } } },
  },
  responses: {
    200: {
      description: 'Учётная политика после правки',
      content: { 'application/json': { schema: OrgPolicy } },
    },
    400: {
      description:
        'Функция нужна другой, включённой, или требует выключенную; дни вне 1–60 или 1–30; ' +
        'роль по умолчанию — не роль организации или роль владельца',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Настройки и учётная политика»', content: error },
    ...versionedSaveResponses,
  },
});

/** Новое значение, только если оно отличается от текущего (иначе — не трогать и не писать в историю). */
function changed<T>(next: T | undefined, current: T): T | undefined {
  if (next === undefined) return undefined;
  return sameHistoryValue(toHistoryValue(next), toHistoryValue(current)) ? undefined : next;
}

/**
 * Учётная политика и настройки (прототип modules/org.js, renderOrg → policy и settings). Функции
 * включаются и выключаются по правилам прототипа: нельзя выключить нужную другой включённой функции и
 * включить функцию без той, что ей нужна (`featureChangeProblem`); отключённая функция пропадает из
 * меню у всех со следующего запроса, данные не удаляются. Каждое изменение — в историю учётной
 * политики: что изменено, было → стало, кто, когда.
 *
 * Пока не сделано (появится вместе с отчётами): при выключении «Сдача отчётов требует подтверждения»
 * ждущие подтверждения отчёты считаются подтверждёнными с записью в их истории (прототип repConfSet).
 */
export function updateOrgPolicyHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateOrgPolicyRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    if (body.remindDays && !isValidRemindDays(body.remindDays)) {
      return c.json(apiError('remind_days_invalid', REMIND_DAYS_MESSAGE), 400);
    }
    if (body.confirmWaitDays !== undefined && !isValidConfirmWaitDays(body.confirmWaitDays)) {
      return c.json(apiError('confirm_wait_days_invalid', CONFIRM_WAIT_DAYS_MESSAGE), 400);
    }
    const ctx = orgContextOf(c);
    const policy = await withOrgContext(deps.db, ctx, async (tx) => {
      const current = await getOrgPolicy(tx, ctx.orgId);
      if (!current) throw new RecordNotFoundError('org_settings', ctx.orgId);
      // Правила проверяются по прочитанной записи; если её успели изменить, updateWithHistory ниже
      // ответит 409 по версии и правка не сохранится.
      const features: Record<Feature, boolean> | undefined = body.features && {
        ...current.features,
        ...body.features,
      };
      if (features) {
        const problem = featureChangeProblem(current.features, features);
        if (problem) apiFail(400, problem.code, problem.message, { feature: problem.feature });
      }
      if (body.defaultRoleId !== undefined && body.defaultRoleId !== current.defaultRoleId) {
        const role = await getRole(tx, body.defaultRoleId);
        if (!role) apiFail(400, 'role_not_found', 'Роль не найдена');
        if (role.isOwner) {
          apiFail(400, 'default_role_owner', 'Роль владельца не бывает ролью по умолчанию');
        }
      }
      await updateWithHistory(tx, {
        table: orgSettings,
        entity: 'org_settings',
        key: orgSettings.orgId,
        id: ctx.orgId,
        version: body.version,
        patch: {
          features: changed(features, current.features),
          taskConfirm: body.taskConfirm,
          reportConfirm: body.reportConfirm,
          confirmWaitDays: body.confirmWaitDays,
          payBeforeSubmit: body.payBeforeSubmit,
          remindDays: changed(
            body.remindDays && normalizeRemindDays(body.remindDays),
            current.remindDays,
          ),
          pageSections: changed(
            body.pageSections && normalizePageSections(body.pageSections),
            current.pageSections,
          ),
          timezone: body.timezone,
          overdueRepeat: body.overdueRepeat,
          digestTime: changed(body.digestTime, current.digestTime),
          defaultRoleId: body.defaultRoleId,
        },
      });
      return (await getOrgPolicy(tx, ctx.orgId))!;
    });
    return c.json(orgPolicyBody(policy), 200);
  };
}

export const orgPolicyHistoryRoute = createRoute({
  method: 'get',
  path: '/org/policy/history',
  tags: ['org'],
  summary: '«История изменений учётной политики»: что изменено, было → стало, кто, когда',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Записи истории, сначала новые',
      content: { 'application/json': { schema: OrgPolicyHistory } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

/** История учётной политики — как блок прототипа: последние 100 записей и общее число. */
export function orgPolicyHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgPolicyHistoryRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const { total, items } = await withOrgContext(deps.db, ctx, (tx) =>
      orgPolicyHistory(tx, ctx.orgId),
    );
    const body: OrgPolicyHistory = {
      total,
      items: items.map((h) => ({
        at: h.at.toISOString(),
        actor: h.actor,
        action: h.action,
        changes: h.changes,
        reason: h.reason,
      })),
    };
    return c.json(body, 200);
  };
}
