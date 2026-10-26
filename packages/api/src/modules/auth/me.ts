import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  currentOrganization,
  loadEmployeeAccess,
  orgFeatures,
  telegramChat,
  withOrgContext,
  type EmployeeAccess,
  type TelegramChat,
} from '@buhuchet/db';
import {
  ADMIN_MENU_MODULES,
  effectivePermissions,
  menuModules,
  SCOPE_GROUPS,
  scopeOf,
  telegramName,
  type Feature,
} from '@buhuchet/domain';
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
  organization: MeResponse['organization'],
  telegram: TelegramChat | null,
  features: Record<Feature, boolean> | null,
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
    telegram: telegram && {
      name: telegramName(telegram),
      linkedAt: telegram.linkedAt.toISOString(),
    },
    permissions: access ? effectivePermissions(access.subject) : [],
    scopes: access
      ? Object.fromEntries(SCOPE_GROUPS.map((g) => [g, scopeOf(access.subject, g)]))
      : {},
    features: features ?? {},
    modules: user.isPlatformAdmin
      ? [...ADMIN_MENU_MODULES]
      : access && features
        ? menuModules(access.subject, features)
        : [],
  };
}

/**
 * «Кто я» для ответа входа и GET /api/auth/me: сотрудник, роль, права, организация, функции учётной
 * политики и модули меню — в контексте организации пользователя (RLS); привязан ли Telegram. Уже
 * загруженные права (`access`) повторно не читаются. Администратору платформы — модули Админки.
 */
export async function loadMe(
  deps: ApiDeps,
  user: MeUser & { employeeId: string | null },
  loaded?: EmployeeAccess | null,
): Promise<MeResponse> {
  const telegram = await telegramChat(deps.db, user.userId);
  if (!user.orgId) return meBody(user, null, null, telegram, null);
  const orgId = user.orgId;
  const { access, organization, features } = await withOrgContext(
    deps.db,
    { orgId, userId: user.userId },
    async (tx) => ({
      access: loaded ?? (user.employeeId ? await loadEmployeeAccess(tx, user.employeeId) : null),
      organization: await currentOrganization(tx, orgId),
      features: await orgFeatures(tx, orgId),
    }),
  );
  return meBody(user, access, organization, telegram, features);
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
