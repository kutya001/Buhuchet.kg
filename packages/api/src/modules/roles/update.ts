import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  getRole,
  lockRole,
  replaceRolePermissions,
  rolePermissionIds,
  roleScopeMap,
  schema,
  setRoleScopes,
  uniqueViolation,
  updateWithHistory,
  withOrgContext,
} from '@buhuchet/db';
import {
  PERMISSION_IDS,
  RecordChangedError,
  RecordNotFoundError,
  ROLE_CHANGE_MESSAGES,
  roleChangeProblem,
  type HistoryChange,
  type Scope,
  type ScopeGroupId,
} from '@buhuchet/domain';
import { Role, UpdateRoleRequest, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { staffActor } from '../staff/employees';
import { ROLE_NAME_TAKEN } from './create';
import { error, roleBody } from './roles';

const { roles } = schema;

export const updateRoleRoute = createRoute({
  method: 'patch',
  path: '/roles/{id}',
  tags: ['roles'],
  summary: 'Сохранить роль: название, права и область групп',
  middleware: [requirePermission('staff')] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, content: { 'application/json': { schema: UpdateRoleRequest } } },
  },
  responses: {
    200: { description: 'Роль после правки', content: { 'application/json': { schema: Role } } },
    400: {
      description: 'Такая роль уже есть или право группы без «Просматривать …»',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права; роль владельца, своя роль, роль с правами, которые выдаёт только владелец, или шире ваших; ' +
        'право только владельца или выдаёт только владелец; право или область шире ваших',
      content: error,
    },
    ...versionedSaveResponses,
  },
});

/**
 * Форма роли (прототип modules/staff.js, roleForm): название, галочки прав и область «Свои / Все
 * контрагенты» по группам. Сервер проверяет те же правила, что и галочки формы (`roleChangeProblem`):
 * права только владельца, права, которые выдаёт только владелец, своя роль, «Сначала дайте просмотр»;
 * не владелец не трогает роль с правами, которые выдаёт только владелец, и роль шире своей и не выдаёт
 * права и область «Все» шире своих (docs/deviations.md, п. 15).
 * Изменения прав и области поднимают версию роли и пишутся в её историю. Новые права действуют со
 * следующего запроса сотрудников с этой ролью.
 */
export function updateRoleHandler(deps: ApiDeps): RouteHandler<typeof updateRoleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const actor = staffActor(c);
    try {
      const role = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
        const current = await lockRole(tx, id);
        if (!current) throw new RecordNotFoundError('role', id);
        if (current.version !== body.version) {
          throw new RecordChangedError('role', id, current.version);
        }
        const before = current.isOwner ? [...PERMISSION_IDS] : await rolePermissionIds(tx, id);
        const wanted = new Set(body.permissions ?? before);
        const after = PERMISSION_IDS.filter((p) => wanted.has(p));
        const scopesBefore = await roleScopeMap(tx, id);
        const scopes: Partial<Record<ScopeGroupId, Scope>> = {};
        for (const [group, scope] of Object.entries(body.scopes ?? {}) as [ScopeGroupId, Scope][]) {
          if (scopesBefore[group] !== scope) scopes[group] = scope;
        }
        const name = body.name !== undefined && body.name !== current.name ? body.name : undefined;
        const permissionsChanged =
          after.length !== before.length || after.some((p) => !before.includes(p));
        const scopesChanged = Object.keys(scopes).length > 0;
        if (name === undefined && !permissionsChanged && !scopesChanged) {
          return (await getRole(tx, id))!;
        }

        const problem = roleChangeProblem(
          actor,
          current,
          { permissions: new Set(before), scopes: scopesBefore },
          { permissions: new Set(after), scopes: { ...scopesBefore, ...scopes } },
        );
        if (problem) {
          const { lock, ...details } = problem;
          apiFail(
            lock === 'view_required' ? 400 : 403,
            lock,
            ROLE_CHANGE_MESSAGES[lock],
            Object.keys(details).length > 0 ? details : undefined,
          );
        }

        const changes: HistoryChange[] = [];
        if (permissionsChanged) {
          await replaceRolePermissions(tx, id, before, after);
          changes.push({ field: 'permissions', from: before, to: after });
        }
        if (scopesChanged) {
          await setRoleScopes(tx, id, scopes);
          changes.push({
            field: 'scopes',
            from: Object.fromEntries(
              Object.keys(scopes).map((g) => [g, scopesBefore[g as ScopeGroupId]]),
            ),
            to: scopes,
          });
        }
        await updateWithHistory(tx, {
          table: roles,
          entity: 'role',
          id,
          version: body.version,
          patch: name === undefined ? {} : { name },
          changes,
        });
        return (await getRole(tx, id))!;
      });
      return c.json(roleBody(role, actor), 200);
    } catch (err) {
      if (uniqueViolation(err) === 'roles_org_name_unique') return c.json(ROLE_NAME_TAKEN, 400);
      throw err;
    }
  };
}
