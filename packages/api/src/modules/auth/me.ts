import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  currentOrganization,
  loadEmployeeAccess,
  withOrgContext,
  type EmployeeAccess,
} from '@buhuchet/db';
import { effectivePermissions, SCOPE_GROUPS, scopeOf } from '@buhuchet/domain';
import { ApiError, MeResponse } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';

interface MeUser {
  userId: string;
  orgId: string | null;
  login: string;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
}

function meBody(
  user: MeUser,
  access: EmployeeAccess | null,
  organization: { id: string; name: string; slug: string } | null,
): MeResponse {
  return {
    user: {
      id: user.userId,
      login: user.login,
      isPlatformAdmin: user.isPlatformAdmin,
      mustChangePassword: user.mustChangePassword,
    },
    employee: access && {
      id: access.subject.employeeId,
      fullName: access.fullName,
      shortName: access.shortName,
      roleId: access.roleId,
      roleName: access.roleName,
      isOwner: access.subject.isOwner,
    },
    organization,
    permissions: access ? effectivePermissions(access.subject) : [],
    scopes: access
      ? Object.fromEntries(SCOPE_GROUPS.map((g) => [g, scopeOf(access.subject, g)]))
      : {},
  };
}

/**
 * «Кто я» для ответа входа и GET /api/auth/me: сотрудник, роль, права и организация — в контексте
 * организации пользователя (RLS). Уже загруженные права (`access`) повторно не читаются.
 */
export async function loadMe(
  deps: ApiDeps,
  user: MeUser & { employeeId: string | null },
  loaded?: EmployeeAccess | null,
): Promise<MeResponse> {
  if (!user.orgId) return meBody(user, null, null);
  const orgId = user.orgId;
  const { access, organization } = await withOrgContext(
    deps.db,
    { orgId, userId: user.userId },
    async (tx) => ({
      access: loaded ?? (user.employeeId ? await loadEmployeeAccess(tx, user.employeeId) : null),
      organization: await currentOrganization(tx, orgId),
    }),
  );
  return meBody(user, access, organization);
}

export const meRoute = createRoute({
  method: 'get',
  path: '/auth/me',
  tags: ['auth'],
  summary: 'Кто вошёл: сотрудник, организация, права и области',
  responses: {
    200: {
      description: 'Вошедший пользователь',
      content: { 'application/json': { schema: MeResponse } },
    },
    401: { description: 'Нет входа', content: { 'application/json': { schema: ApiError } } },
    403: {
      description: 'Учётная запись или организация заблокирована',
      content: { 'application/json': { schema: ApiError } },
    },
  },
});

export function meHandler(deps: ApiDeps): RouteHandler<typeof meRoute, AppEnv> {
  return async (c) => {
    const session = c.get('session')!;
    return c.json(await loadMe(deps, session, c.get('access')), 200);
  };
}
