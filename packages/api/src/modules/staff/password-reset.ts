import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import { newTemporaryPassword } from '@buhuchet/adapters/tokens';
import { employeeAccount, setTemporaryPassword, withOrgContext, writeHistory } from '@buhuchet/db';
import { RecordNotFoundError } from '@buhuchet/domain';
import { ApiError, TemporaryPasswordResponse, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { notifyPasswordChanged } from '../telegram/bot';

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
    403: { description: 'Нет права «Сотрудники и роли» или это владелец', content: error },
    404: { description: 'Сотрудника нет', content: error },
  },
});

/**
 * «Сбросить пароль» в действиях сотрудника (прототип modules/staff.js, empActions): временный пароль
 * показывается один раз и передаётся сотруднику лично; при первом входе нужно задать свой, все
 * прежние сеансы завершены. Так пароль восстанавливают, если Telegram не привязан (ТЗ «Восстановление
 * пароля через Telegram»). Пароль владельца сбрасывает только администратор платформы.
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
      const employee = await employeeAccount(tx, id);
      if (!employee) throw new RecordNotFoundError('employee', id);
      if (employee.isOwner) return null;
      await setTemporaryPassword(tx, { userId: employee.userId, passwordHash });
      await writeHistory(tx, {
        entity: 'user',
        entityId: employee.userId,
        action: 'update',
        changes: [{ field: 'passwordHash' }, { field: 'mustChangePassword', to: true }],
        reason: 'Пароль сброшен: выдан временный пароль',
      });
      return employee;
    });
    if (!target) {
      return c.json(
        apiError('owner_password_reset', 'Пароль владельца сбрасывает администратор платформы'),
        403,
      );
    }
    const telegramNotified = await notifyPasswordChanged(deps, {
      userId: target.userId,
      login: target.login,
      orgName: session.orgName,
    });
    return c.json({ temporaryPassword, telegramNotified }, 200);
  };
}
