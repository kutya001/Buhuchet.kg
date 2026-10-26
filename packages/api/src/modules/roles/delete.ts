import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  deleteRole,
  foreignKeyViolation,
  lockRole,
  roleInUse,
  rolePermissionIds,
  withOrgContext,
} from '@buhuchet/db';
import { RecordChangedError, RecordNotFoundError, roleDeleteRefusal } from '@buhuchet/domain';
import { DeleteRoleQuery, OkResponse, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { staffActor } from '../staff/employees';
import { error } from './roles';

const DELETE_REFUSALS = {
  owner_role: 'Роль владельца не удаляется',
  owner_granted_role: 'Роль с правами, которые выдаёт только владелец, удаляет владелец',
} as const;

const ROLE_IN_USE = apiError('role_in_use', 'Роль назначена сотрудникам: сначала смените им роль');

export const deleteRoleRoute = createRoute({
  method: 'delete',
  path: '/roles/{id}',
  tags: ['roles'],
  summary: 'Удалить роль, которая никому не назначена',
  middleware: [requirePermission('staff')] as const,
  request: { params: z.object({ id: Uuid }), query: DeleteRoleQuery },
  responses: {
    200: { description: 'Роль удалена', content: { 'application/json': { schema: OkResponse } } },
    400: {
      description: 'Роль назначена сотрудникам или её получают новые сотрудники',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права; роль владельца или роль с правами, которые выдаёт только владелец',
      content: error,
    },
    ...versionedSaveResponses,
  },
});

/**
 * Удаление неиспользуемой роли (задача #7; в прототипе кнопки нет — docs/deviations.md, п. 16): не
 * роль владельца, нет сотрудников с ней, даже заблокированных, и её не получают новые сотрудники по
 * учётной политике. Роль с правами, которые выдаёт только владелец, удаляет только владелец — как и
 * меняет (docs/deviations.md, п. 15). Права и область удаляются вместе с ролью, удаление — в истории.
 */
export function deleteRoleHandler(deps: ApiDeps): RouteHandler<typeof deleteRoleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const actor = staffActor(c);
    try {
      await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
        const role = await lockRole(tx, id);
        if (!role) throw new RecordNotFoundError('role', id);
        if (role.version !== version) throw new RecordChangedError('role', id, role.version);
        const permissions = role.isOwner ? [] : await rolePermissionIds(tx, id);
        const refusal = roleDeleteRefusal(actor, { isOwner: role.isOwner, permissions });
        if (refusal) apiFail(403, refusal, DELETE_REFUSALS[refusal]);
        const inUse = await roleInUse(tx, id);
        if (inUse === 'employees') apiFail(400, ROLE_IN_USE.error.code, ROLE_IN_USE.error.message);
        if (inUse === 'default') {
          apiFail(
            400,
            'role_is_default',
            'Эту роль получают новые сотрудники: сначала выберите другую в учётной политике',
          );
        }
        await deleteRole(tx, role);
      });
    } catch (err) {
      // Роль назначили в ту же минуту: внешний ключ не дал удалить.
      if (foreignKeyViolation(err) !== null) return c.json(ROLE_IN_USE, 400);
      throw err;
    }
    return c.json({ ok: true as const }, 200);
  };
}
