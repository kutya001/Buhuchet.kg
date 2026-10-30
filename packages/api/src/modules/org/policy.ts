import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  confirmSubmittedWhileOff,
  confirmWaitingReports,
  countWaitingReports,
  getOrgPolicy,
  getRole,
  orgPolicyHistory,
  orgRoleOptions,
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
  RecordChangedError,
  RecordNotFoundError,
  REMIND_DAYS_MESSAGE,
  sameHistoryValue,
  toHistoryValue,
  type Feature,
} from '@buhuchet/domain';
import {
  OrgPolicy,
  OrgPolicyHistory,
  OrgRoleOptions,
  OrgWaitingReports,
  UpdateOrgPolicyRequest,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
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
    defaultRoleName: p.defaultRoleName,
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

export const orgRoleOptionsRoute = createRoute({
  method: 'get',
  path: '/org/role-options',
  tags: ['org'],
  summary: 'Роли для поля «Роль по умолчанию для новых сотрудников»',
  middleware: [requirePermission('org')] as const,
  responses: {
    200: {
      description: 'Роли организации без роли владельца',
      content: { 'application/json': { schema: OrgRoleOptions } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Настройки и учётная политика»', content: error },
  },
});

/**
 * Варианты «Роли по умолчанию» (прототип modules/org.js, st-role) — тому, кто меняет настройки; без
 * права «Сотрудники и роли» список ролей ему иначе не получить. Остальные видят только выбранную роль
 * (`defaultRoleName` в учётной политике).
 */
export function orgRoleOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgRoleOptionsRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const items = await withOrgContext(deps.db, ctx, (tx) => orgRoleOptions(tx));
    return c.json({ items }, 200);
  };
}

export const orgWaitingReportsRoute = createRoute({
  method: 'get',
  path: '/org/policy/waiting-reports',
  tags: ['org'],
  summary: 'Сколько отчётов ждут подтверждения — для вопроса «Выключить подтверждение сдачи?»',
  middleware: [requirePermission('org')] as const,
  responses: {
    200: {
      description: 'Число отчётов организации, ждущих подтверждения',
      content: { 'application/json': { schema: OrgWaitingReports } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Настройки и учётная политика»', content: error },
  },
});

/**
 * Число для вопроса «Выключить подтверждение сдачи?» (прототип modules/org.js, repConfSet) — тому, кто
 * меняет учётную политику: выключение подтверждает все ждущие отчёты организации, поэтому и число — по
 * всем, а не по области «Свои».
 */
export function orgWaitingReportsHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgWaitingReportsRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const count = await withOrgContext(deps.db, ctx, (tx) => countWaitingReports(tx));
    return c.json({ count }, 200);
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
 * политики: что изменено, было → стало, кто, когда. При выключении «Сдача отчётов требует
 * подтверждения» ждущие подтверждения отчёты считаются подтверждёнными с записью в их «Истории
 * статусов», а в истории политики — сколько их (ТЗ; прототип repConfSet; задача 2.14); при включении
 * сданные без подтверждения отмечаются «Сдан, когда подтверждение было выключено» и его не ждут.
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
      // Устаревшая версия — 409 сразу, до подтверждения ждущих отчётов, которые всё равно откатятся.
      if (current.version !== body.version) {
        throw new RecordChangedError('org_settings', ctx.orgId, current.version);
      }
      // Правила проверяются по прочитанной записи; если её успели изменить, updateWithHistory ниже
      // ответит 409 по версии под блокировкой и правка не сохранится.
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
      // Выключили подтверждение — ждущие отчёты считаются подтверждёнными, число — в той же записи
      // истории политики: «…: выключено; считаются подтверждёнными: N» (прототип repConfSet).
      const confirmed =
        current.reportConfirm && body.reportConfirm === false
          ? await confirmWaitingReports(tx, (await serverTexts(deps))('report.reason.confirm_off'))
          : 0;
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
        changes: confirmed ? [{ field: 'confirmedReports', to: confirmed }] : [],
      });
      // Включили — сданные без подтверждения его не ждут (прототип repConfSet).
      if (!current.reportConfirm && body.reportConfirm === true) {
        await confirmSubmittedWhileOff(
          tx,
          (await serverTexts(deps))('report.reason.confirm_was_off'),
        );
      }
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
