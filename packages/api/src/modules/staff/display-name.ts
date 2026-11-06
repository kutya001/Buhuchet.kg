import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { getEmployee, lockEmployee, schema, updateWithHistory, withOrgContext } from '@buhuchet/db';
import { RecordNotFoundError } from '@buhuchet/domain';
import { DisplayNameRequest, DisplayNameSaved } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireEmployee } from '../../middleware/access';
import { checkDisplayName } from './create';
import { error } from './employees';

export const displayNameRoute = createRoute({
  method: 'patch',
  path: '/profile/display-name',
  tags: ['staff'],
  summary: '«Мой профиль»: своё отображаемое имя',
  middleware: [requireEmployee] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: DisplayNameRequest } } },
  },
  responses: {
    200: {
      description: 'Отображаемое имя сохранено',
      content: { 'application/json': { schema: DisplayNameSaved } },
    },
    400: {
      description: 'Отображаемое имя не 2–40 знаков или уже у другого сотрудника',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации (администратор платформы)', content: error },
  },
});

/**
 * «Мой профиль» → «Отображаемое имя» → «Изменить» (решение заказчика 06.11.2026, прототип v74
 * modules/profile.js shortDlg): сотрудник меняет своё имя сам, без права «Сотрудники и роли»; те же
 * правила, что в карточке сотрудника. Смена пишется в историю сотрудника.
 */
export function displayNameHandler(deps: ApiDeps): RouteHandler<typeof displayNameRoute, AppEnv> {
  return async (c) => {
    const employeeId = c.get('session')?.employeeId;
    if (!employeeId) apiFail(403, 'forbidden', 'Нет права на это действие');
    const body = c.req.valid('json');
    const shortName = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      if (!(await lockEmployee(tx, employeeId))) {
        throw new RecordNotFoundError('employee', employeeId);
      }
      const employee = (await getEmployee(tx, employeeId))!;
      const short = await checkDisplayName(tx, body.shortName, employee.fullName, employeeId);
      if (short !== employee.shortName) {
        await updateWithHistory(tx, {
          table: schema.employees,
          entity: 'employee',
          id: employeeId,
          version: employee.version,
          patch: { shortName: short },
        });
      }
      return short;
    });
    return c.json({ shortName }, 200);
  };
}
