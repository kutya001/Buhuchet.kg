import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import { newTemporaryPassword } from '@buhuchet/adapters/tokens';
import {
  getEmployee,
  lockEmployee,
  roleAccess,
  setTemporaryPassword,
  withOrgContext,
  writeHistory,
} from '@buhuchet/db';
import { RecordNotFoundError, staffActionRefusal } from '@buhuchet/domain';
import { ApiError, TemporaryPasswordResponse, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { notifyPasswordChanged } from '../telegram/bot';
import { refuse, staffActor } from './employees';

const error = { 'application/json': { schema: ApiError } };

export const resetEmployeePasswordRoute = createRoute({
  method: 'post',
  path: '/staff/{id}/password-reset',
  tags: ['staff'],
  summary: 'Сбросить пароль сотрудника: временный пароль, при входе его нужно сменить',
  middleware: [requirePermission('staff')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Временный пароль (показывается один раз); все сеансы сотрудника завершены',
      content: { 'application/json': { schema: TemporaryPasswordResponse } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Сотрудники и роли»; это владелец; у сотрудника права, которые выдаёт только владелец, или шире ваших',
      content: error,
    },
    404: { description: 'Сотрудника нет', content: error },
  },
});

/**
 * «Сбросить пароль» в действиях сотрудника (прототип modules/staff.js, empActions): временный пароль
 * показывается один раз и передаётся сотруднику лично; при первом входе нужно задать свой, все
 * прежние сеансы завершены. Так пароль восстанавливают, если Telegram не привязан (ТЗ «Восстановление
 * пароля через Telegram»). Пароль владельца сбрасывает только администратор платформы, а пароль
 * сотрудника с правами, которые выдаёт только владелец, или с правами шире, чем у того, кто
 * сбрасывает, — только владелец (ОТКЛОНЕНИЕ: docs/deviations.md#15). Сотрудник и его роль
 * заблокированы до конца транзакции: роль не сменится между проверкой и сбросом.
 */
export function resetEmployeePasswordHandler(
  deps: ApiDeps,
): RouteHandler<typeof resetEmployeePasswordRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const session = c.get('session')!;
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const target = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      if (!(await lockEmployee(tx, id))) throw new RecordNotFoundError('employee', id);
      const employee = (await getEmployee(tx, id))!;
      const role = (await roleAccess(tx, employee.role.id))!;
      const refusal = staffActionRefusal(staffActor(c), { employeeId: id, role }, 'resetPassword');
      if (refusal) refuse(refusal, 'resetPassword');
      const reset = await setTemporaryPassword(tx, { userId: employee.userId, passwordHash });
      if (!reset) throw new RecordNotFoundError('employee', id);
      await writeHistory(tx, {
        entity: 'user',
        entityId: employee.userId,
        action: 'update',
        changes: [
          { field: 'passwordHash' },
          { field: 'mustChangePassword', from: reset.mustChangePasswordBefore, to: true },
        ],
        reason: 'Пароль сброшен: выдан временный пароль',
      });
      return employee;
    });
    const telegramNotified = await notifyPasswordChanged(
      deps,
      { userId: target.userId, login: target.login, orgName: session.orgName },
      c.get('access')!.fullName,
    );
    return c.json({ temporaryPassword, telegramNotified }, 200);
  };
}
