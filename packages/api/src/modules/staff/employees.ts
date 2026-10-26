import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { getEmployee, listEmployeesPage, withOrgContext, type EmployeeRecord } from '@buhuchet/db';
import {
  RecordNotFoundError,
  telegramName,
  type RoleSaveEditor,
  type StaffAction,
  type StaffActor,
  type StaffRefusal,
} from '@buhuchet/domain';
import { ApiError, Employee, EmployeeList, ListQueryParams, Uuid } from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';

export const error = { 'application/json': { schema: ApiError } };

/** Сотрудник для ответа API: только поля схемы, моменты — строкой ISO. */
export function employeeBody(e: EmployeeRecord): Employee {
  return {
    id: e.id,
    fullName: e.fullName,
    shortName: e.shortName,
    login: e.login,
    phone: e.phone,
    phoneText: e.phoneText,
    role: e.role,
    active: e.active,
    telegram: e.telegram && {
      name: telegramName(e.telegram),
      linkedAt: e.telegram.linkedAt.toISOString(),
    },
    lastLoginAt: e.lastLoginAt?.toISOString() ?? null,
    audit: {
      createdAt: e.audit.createdAt.toISOString(),
      createdBy: e.audit.createdBy,
      updatedAt: e.audit.updatedAt.toISOString(),
      updatedBy: e.audit.updatedBy,
    },
    version: e.version,
  };
}

/**
 * Кто действует в методах модуля: сотрудник из общего слоя (право метода уже проверено) — его права
 * и область для правил сотрудников и своя роль для правил ролей.
 */
export function staffActor(c: Context<AppEnv>): StaffActor & RoleSaveEditor {
  const { subject, roleId } = c.get('access')!;
  return { ...subject, roleId, subject };
}

const REFUSAL_MESSAGES: Record<StaffRefusal, string> = {
  owner_employee: 'Роль, блокировку и пароль владельца организации ведёт администратор платформы',
  own_role: 'Свою роль меняет владелец',
  own_account: 'Нельзя заблокировать себя',
  owner_role: 'Роль владельца организации не назначается',
  owner_granted: 'Роль с правами, которые выдаёт только владелец, назначает и снимает владелец',
  beyond_own: 'Роль с правами шире ваших назначает и снимает владелец',
};

/**
 * Отказ 403 в действии над сотрудником (`staffActionRefusal`, `newEmployeeRoleRefusal`); внутри
 * транзакции откатывает её.
 */
export function refuse(refusal: StaffRefusal, action: StaffAction | 'create'): never {
  if (refusal === 'owner_employee' && action === 'edit') {
    apiFail(403, refusal, 'ФИО и телефон владельца меняет сам владелец');
  }
  if (refusal === 'owner_employee' && action === 'resetPassword') {
    apiFail(403, 'owner_password_reset', 'Пароль владельца сбрасывает администратор платформы');
  }
  if (refusal === 'owner_granted' && action === 'resetPassword') {
    apiFail(
      403,
      refusal,
      'Пароль сотрудника с правами, которые выдаёт только владелец, сбрасывает владелец',
    );
  }
  if (refusal === 'owner_granted' && (action === 'block' || action === 'unblock')) {
    apiFail(
      403,
      refusal,
      'Сотрудника с правами, которые выдаёт только владелец, блокирует и разблокирует владелец',
    );
  }
  if (refusal === 'beyond_own' && action === 'resetPassword') {
    apiFail(403, refusal, 'Пароль сотрудника с правами шире ваших сбрасывает владелец');
  }
  if (refusal === 'beyond_own' && (action === 'block' || action === 'unblock')) {
    apiFail(403, refusal, 'Сотрудника с правами шире ваших блокирует и разблокирует владелец');
  }
  apiFail(403, refusal, REFUSAL_MESSAGES[refusal]);
}

export const listEmployeesRoute = createRoute({
  method: 'get',
  path: '/staff',
  tags: ['staff'],
  summary: 'Сотрудники организации: страница списка',
  middleware: [requirePermission('staffView')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Страница списка сотрудников (и заблокированных): сортировка, страница и фильтры — на сервере',
      content: { 'application/json': { schema: EmployeeList } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать сотрудников»', content: error },
  },
});

/**
 * Список сотрудников (прототип modules/staff.js, renderStaff, вкладка «Сотрудники»): в ответе только
 * текущая страница, всего записей по фильтру и итоги.
 */
export function listEmployeesHandler(
  deps: ApiDeps,
): RouteHandler<typeof listEmployeesRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const page = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listEmployeesPage(tx, query),
    );
    return c.json(
      {
        items: page.rows.map(employeeBody),
        total: page.total,
        page: page.page,
        size: query.size,
        totals: page.totals,
      },
      200,
    );
  };
}

export const getEmployeeRoute = createRoute({
  method: 'get',
  path: '/staff/{id}',
  tags: ['staff'],
  summary: 'Карточка сотрудника',
  middleware: [requirePermission('staffView')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'Сотрудник', content: { 'application/json': { schema: Employee } } },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать сотрудников»', content: error },
    404: { description: 'Сотрудника нет', content: error },
  },
});

/** Карточка сотрудника (прототип modules/staff.js, empCard, вкладка «Основное»). */
export function getEmployeeHandler(deps: ApiDeps): RouteHandler<typeof getEmployeeRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const employee = await withOrgContext(deps.db, orgContextOf(c), (tx) => getEmployee(tx, id));
    if (!employee) throw new RecordNotFoundError('employee', id);
    return c.json(employeeBody(employee), 200);
  };
}
