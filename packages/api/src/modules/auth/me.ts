import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  currentOrganization,
  loadEmployeeAccess,
  orgMenuSettings,
  orgUsage,
  phoneCodes,
  telegramChat,
  telegramPlainText,
  telegramPreviousChat,
  withOrgContext,
  type EmployeeAccess,
  type TelegramChat,
} from '@buhuchet/db';
import {
  ADMIN_MENU_MODULES,
  effectivePermissions,
  formatPhone,
  menuModules,
  SCOPE_GROUPS,
  scopeOf,
  telegramName,
  type Feature,
} from '@buhuchet/domain';
import { ApiError, MeResponse } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { subscriptionToday } from '../../subscription-access';

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
  telegram: (TelegramChat & { plain: boolean }) | null,
  previous: { username: string | null; firstName: string | null } | null,
  settings: {
    features: Record<Feature, boolean>;
    reportConfirm: boolean;
    payFirst: boolean;
  } | null,
  phone: string | null = null,
  subscription: MeResponse['subscription'] = null,
): MeResponse {
  const features = settings?.features ?? null;
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
      phone,
      roleId: access.roleId,
      roleName: access.roleName,
      isOwner: access.subject.isOwner,
    },
    organization,
    telegram: telegram && {
      name: telegramName(telegram),
      linkedAt: telegram.linkedAt.toISOString(),
      plain: telegram.plain,
    },
    telegramPrevious: previous && {
      name: previous.username || previous.firstName?.trim() ? telegramName(previous) : null,
    },
    permissions: access ? effectivePermissions(access.subject) : [],
    scopes: access
      ? Object.fromEntries(SCOPE_GROUPS.map((g) => [g, scopeOf(access.subject, g)]))
      : {},
    features: features ?? {},
    reportConfirm: settings?.reportConfirm ?? false,
    payFirst: settings?.payFirst ?? false,
    // Доступ закрыт по подписке: так входит только владелец, и ему — только «Моя организация» с
    // «Подпиской» (доработки 20.11.2026, блок 4, пункты 4–5; прототип subLockMods).
    modules: user.isPlatformAdmin
      ? [...ADMIN_MENU_MODULES]
      : access && subscription?.closed
        ? ['org']
        : access && features
          ? menuModules(access.subject, features)
          : [],
    subscription,
    subClosed: subscription?.closed ?? false,
  };
}

/**
 * «Кто я» для ответа входа и GET /api/auth/me: сотрудник (с телефоном для «Мой профиль»), роль, права,
 * организация, функции учётной политики, «Сдача отчётов требует подтверждения» и модули меню — в контексте организации пользователя (RLS); привязан ли Telegram. Уже
 * загруженные права (`access`) повторно не читаются. Администратору платформы — модули Админки.
 */
export async function loadMe(
  deps: ApiDeps,
  user: MeUser & { employeeId: string | null },
  loaded?: EmployeeAccess | null,
): Promise<MeResponse> {
  const chat = await telegramChat(deps.db, user.userId);
  // «Сообщения простым текстом» — переключатель в «Мой профиль» (поток Т, задача Т1).
  const telegram = chat && { ...chat, plain: await telegramPlainText(deps.db, user.userId) };
  // Подсказка «Прежний Telegram …» в «Мой профиль» — только когда Telegram не привязан.
  const previous = telegram ? null : await telegramPreviousChat(deps.db, user.userId);
  if (!user.orgId) return meBody(user, null, null, telegram, previous, null);
  const orgId = user.orgId;
  const today = subscriptionToday(deps);
  const { access, organization, settings, phone, usage } = await withOrgContext(
    deps.db,
    { orgId, userId: user.userId },
    async (tx) => {
      const access =
        loaded ?? (user.employeeId ? await loadEmployeeAccess(tx, user.employeeId) : null);
      return {
        access,
        organization: await currentOrganization(tx, orgId),
        settings: await orgMenuSettings(tx, orgId),
        // Телефон в «Мой профиль» — по маске страны из справочника «Коды телефонов».
        phone: access?.phone ? formatPhone(access.phone, await phoneCodes(tx)) : null,
        // Подписка: полоса «Продлите подписку» и «Доступ закрыт» (блок 4); память не считается.
        usage: await orgUsage(tx, today, { bytes: false }),
      };
    },
  );
  const subscription = usage && {
    status: usage.status,
    paidUntil: usage.paidUntil,
    closed: usage.closed,
  };
  return meBody(user, access, organization, telegram, previous, settings, phone, subscription);
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
      description:
        'Учётная запись или организация заблокирована, или доступ организации закрыт по подписке (`sub_closed`: сеанс сотрудника закрыт)',
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
