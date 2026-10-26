import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  endUserSessions,
  getEmployee,
  lockEmployee,
  roleAccess,
  schema,
  updateWithHistory,
  withOrgContext,
  type EmployeeRecord,
  type Tx,
} from '@buhuchet/db';
import {
  RecordChangedError,
  RecordNotFoundError,
  shortName,
  staffActionRefusal,
  type HistoryChange,
  type StaffActor,
} from '@buhuchet/domain';
import { Employee, EmployeeVersionRequest, UpdateEmployeeRequest, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { checkFullName, checkPhone } from './create';
import { employeeBody, error, refuse, staffActor } from './employees';

const { employees } = schema;

/**
 * Сотрудник для правки: запись заблокирована до конца транзакции, версия совпадает с той, что видел
 * пользователь, — иначе 404 или 409 до проверки правил. Права его роли — для проверки правил.
 */
async function employeeForChange(tx: Tx, id: string, version: number) {
  if (!(await lockEmployee(tx, id))) throw new RecordNotFoundError('employee', id);
  const employee = (await getEmployee(tx, id))!;
  if (employee.version !== version) {
    throw new RecordChangedError('employee', id, employee.version);
  }
  const role = (await roleAccess(tx, employee.role.id))!;
  return { employee, target: { employeeId: id, role } };
}

export const updateEmployeeRoute = createRoute({
  method: 'patch',
  path: '/staff/{id}',
  tags: ['staff'],
  summary: 'Изменить сотрудника: ФИО, телефон, роль',
  middleware: [requirePermission('staff')] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, content: { 'application/json': { schema: UpdateEmployeeRequest } } },
  },
  responses: {
    200: {
      description: 'Сотрудник после правки',
      content: { 'application/json': { schema: Employee } },
    },
    400: { description: 'Неверные данные или нет такой роли', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права или правка запрещена правилами ролей', content: error },
    ...versionedSaveResponses,
  },
});

/**
 * Правка сотрудника: ФИО и телефон, «Сменить роль» (прототип modules/staff.js, empActions). Свою роль
 * и роль с правами, которые выдаёт только владелец, меняет владелец (`staffActionRefusal`). Новая роль
 * действует со следующего запроса сотрудника: права загружаются при каждом запросе.
 */
export function updateEmployeeHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateEmployeeRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const actor = staffActor(c);
    const fullName = body.fullName === undefined ? undefined : checkFullName(body.fullName);
    const updated = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { employee, target } = await employeeForChange(tx, id, body.version);
      const patch: Partial<typeof employees.$inferInsert> = {};
      const changes: HistoryChange[] = [];
      if (fullName !== undefined && fullName !== employee.fullName) {
        patch.fullName = fullName;
        patch.shortName = shortName(fullName);
      }
      if (body.phone !== undefined) {
        const phone = await checkPhone(tx, body.phone);
        if (phone !== employee.phone) patch.phone = phone;
      }
      if (Object.keys(patch).length > 0) {
        const refusal = staffActionRefusal(actor, target, 'edit');
        if (refusal) refuse(refusal, 'edit');
      }
      if (body.roleId !== undefined && body.roleId !== employee.role.id) {
        const role = await roleAccess(tx, body.roleId);
        if (!role) apiFail(400, 'role_not_found', 'Нет такой роли');
        const refusal = staffActionRefusal(actor, target, 'changeRole', role);
        if (refusal) refuse(refusal, 'changeRole');
        patch.roleId = role.id;
        changes.push({ field: 'roleName', from: employee.role.name, to: role.name });
      }
      await updateWithHistory(tx, {
        table: employees,
        entity: 'employee',
        id,
        version: body.version,
        patch,
        changes,
      });
      return (await getEmployee(tx, id))!;
    });
    return c.json(employeeBody(updated), 200);
  };
}

/** Заблокировать или разблокировать: одна и та же правка `active` с разными правилами. */
async function setActive(
  tx: Tx,
  actor: StaffActor,
  id: string,
  version: number,
  active: boolean,
): Promise<EmployeeRecord> {
  const { employee, target } = await employeeForChange(tx, id, version);
  const action = active ? 'unblock' : 'block';
  const refusal = staffActionRefusal(actor, target, action);
  if (refusal) refuse(refusal, action);
  await updateWithHistory(tx, {
    table: employees,
    entity: 'employee',
    id,
    version,
    patch: { active },
  });
  // Заблокированный не входит: сеансы закрываются сразу, а не при следующем запросе.
  if (!active) await endUserSessions(tx, employee.userId);
  return (await getEmployee(tx, id))!;
}

const activeRoute = (action: 'block' | 'unblock') =>
  createRoute({
    method: 'post',
    path: `/staff/{id}/${action}`,
    tags: ['staff'],
    summary:
      action === 'block'
        ? 'Заблокировать сотрудника: не входит, сеансы закрыты'
        : 'Разблокировать сотрудника',
    middleware: [requirePermission('staff')] as const,
    request: {
      params: z.object({ id: Uuid }),
      body: { required: true, content: { 'application/json': { schema: EmployeeVersionRequest } } },
    },
    responses: {
      200: {
        description: 'Сотрудник после правки',
        content: { 'application/json': { schema: Employee } },
      },
      401: { description: 'Нет входа', content: error },
      403: { description: 'Нет права, это владелец или вы сами', content: error },
      ...versionedSaveResponses,
    },
  });

export const blockEmployeeRoute = activeRoute('block');
export const unblockEmployeeRoute = activeRoute('unblock');

/**
 * «Заблокировать» (прототип modules/staff.js, blockDlg): сотрудник не входит, его сеансы закрыты,
 * история сохраняется. Передача его контрагентов перед блокировкой появится вместе с контрагентами
 * (поток А).
 */
export function blockEmployeeHandler(
  deps: ApiDeps,
): RouteHandler<typeof blockEmployeeRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const employee = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      setActive(tx, staffActor(c), id, version, false),
    );
    return c.json(employeeBody(employee), 200);
  };
}

/** «Разблокировать»: сотрудник снова входит своим паролем. */
export function unblockEmployeeHandler(
  deps: ApiDeps,
): RouteHandler<typeof unblockEmployeeRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const employee = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      setActive(tx, staffActor(c), id, version, true),
    );
    return c.json(employeeBody(employee), 200);
  };
}
