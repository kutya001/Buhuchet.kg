import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { createRole, getRole, roleAccess, uniqueViolation, withOrgContext } from '@buhuchet/db';
import { copiedRolePermissions } from '@buhuchet/domain';
import { CreateRoleRequest, Role } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { staffActor } from '../staff/employees';
import { error, roleBody } from './roles';

export const ROLE_NAME_TAKEN = apiError('role_name_taken', 'Такая роль уже есть');

export const createRoleRoute = createRoute({
  method: 'post',
  path: '/roles',
  tags: ['roles'],
  summary: 'Новая роль: название и права, скопированные из другой роли',
  middleware: [requirePermission('staff')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateRoleRequest } } },
  },
  responses: {
    201: { description: 'Роль создана', content: { 'application/json': { schema: Role } } },
    400: { description: 'Такая роль уже есть или нет роли-образца', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли»', content: error },
  },
});

/**
 * «Новая роль» (прототип modules/staff.js, roleAddDlg): название и «Скопировать права из» — права
 * роли-образца, а если создаёт не владелец — без тех, что выдаёт только владелец, и без тех, которых
 * нет у него самого (`copiedRolePermissions`); область — «Свои» везде. Дальше права отмечают в форме
 * роли.
 */
export function createRoleHandler(deps: ApiDeps): RouteHandler<typeof createRoleRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const actor = staffActor(c);
    try {
      const role = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
        let permissions: ReturnType<typeof copiedRolePermissions> = [];
        if (body.copyFromRoleId) {
          const source = await roleAccess(tx, body.copyFromRoleId);
          if (!source) apiFail(400, 'role_not_found', 'Нет такой роли');
          permissions = copiedRolePermissions(actor, source);
        }
        const id = await createRole(tx, {
          name: body.name,
          permissions,
          copiedFrom: body.copyFromRoleId ?? null,
        });
        return (await getRole(tx, id))!;
      });
      return c.json(roleBody(role), 201);
    } catch (err) {
      if (uniqueViolation(err) === 'roles_org_name_unique') return c.json(ROLE_NAME_TAKEN, 400);
      throw err;
    }
  };
}
