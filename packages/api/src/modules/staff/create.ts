import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import { newTemporaryPassword } from '@buhuchet/adapters/tokens';
import {
  createEmployee,
  getEmployee,
  phoneCodes,
  roleAccess,
  uniqueViolation,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  isFullName,
  isValidLogin,
  newEmployeeRoleRefusal,
  normalizeLogin,
  phoneProblem,
  shortName,
} from '@buhuchet/domain';
import { CreatedEmployee, CreateEmployeeRequest } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { employeeBody, error, refuse, staffActor } from './employees';

export const createEmployeeRoute = createRoute({
  method: 'post',
  path: '/staff',
  tags: ['staff'],
  summary: 'Новый сотрудник: логин и временный пароль, без почты',
  middleware: [requirePermission('staff')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateEmployeeRequest } } },
  },
  responses: {
    201: {
      description: 'Сотрудник создан; временный пароль показывается один раз',
      content: { 'application/json': { schema: CreatedEmployee } },
    },
    400: { description: 'Неверные данные, логин занят или нет такой роли', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Сотрудники и роли» или роль может назначить только владелец',
      content: error,
    },
  },
});

/** ФИО: фамилия и имя (прототип: «Введите фамилию и имя»). */
export function checkFullName(fullName: string): string {
  const name = fullName.trim().replace(/\s+/g, ' ');
  if (!isFullName(name)) apiFail(400, 'invalid_full_name', 'Введите фамилию и имя');
  return name;
}

/** Телефон по справочнику «Коды телефонов»; пустой — не указан. */
export async function checkPhone(tx: Tx, phone: string | null | undefined): Promise<string | null> {
  const value = phone?.trim() || null;
  if (value === null) return null;
  const problem = phoneProblem(value, await phoneCodes(tx));
  if (problem) apiFail(400, 'invalid_phone', problem);
  return value;
}

/**
 * «Новый сотрудник» (прототип modules/staff.js, empAddDlg): ФИО, логин, уникальный на всей
 * платформе, временный пароль, телефон и роль. Временный пароль задаёт владелец или сервер (как при
 * сбросе, docs/deviations.md, п. 7); при первом входе сотрудник обязан его сменить.
 */
export function createEmployeeHandler(
  deps: ApiDeps,
): RouteHandler<typeof createEmployeeRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const actor = staffActor(c);
    const fullName = checkFullName(body.fullName);
    const login = normalizeLogin(body.login);
    if (!isValidLogin(login)) {
      return c.json(
        apiError('invalid_login', 'Логин: латиница, цифры, точка, дефис; от 3 символов'),
        400,
      );
    }
    const temporaryPassword = body.temporaryPassword ?? newTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    try {
      const employee = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
        const phone = await checkPhone(tx, body.phone);
        const role = await roleAccess(tx, body.roleId);
        if (!role) apiFail(400, 'role_not_found', 'Нет такой роли');
        const refusal = newEmployeeRoleRefusal(actor, role);
        if (refusal) refuse(refusal, 'create');
        const id = await createEmployee(tx, {
          fullName,
          shortName: shortName(fullName),
          login,
          passwordHash,
          phone,
          role,
        });
        return (await getEmployee(tx, id))!;
      });
      return c.json({ employee: employeeBody(employee), temporaryPassword }, 201);
    } catch (err) {
      if (uniqueViolation(err) === 'users_login_unique') {
        return c.json(apiError('login_taken', 'Такой логин уже занят на платформе'), 400);
      }
      throw err;
    }
  };
}
