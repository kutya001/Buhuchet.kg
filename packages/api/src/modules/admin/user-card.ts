import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  ADMIN_CARD_ROWS,
  adminAccountCard,
  adminEmployeeCard,
  adminEndUserSessions,
  adminGetUser,
  adminUserIdByLogin,
  adminUserSessions,
  logAdminCardView,
  logUserCardView,
  permissionCatalog,
  withOrgContext,
  withUserContext,
  type AdminUserCardRecord,
  type CardList,
} from '@buhuchet/db';
import {
  ACCOUNT_LOCK_FAILURES,
  accountActionRefusal,
  accountStates,
  LOGIN_MAX_LENGTH,
  normalizeLogin,
  PERMISSION_GROUPS,
  permissionGroup,
  RecordNotFoundError,
} from '@buhuchet/domain';
import {
  AdminSessionsEnded,
  AdminUserCard,
  AdminUserLookup,
  ApiError,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { progressBody } from '../kb/state';
import { adminUserBody } from './users';

// Карточка пользователя в Админке (ТЗ «Админка» → «Карточка пользователя», решение заказчика
// 09.11.2026; прототип admin/admin-cards.js, accCard). Только администратор платформы; данные
// сотрудника читаются в контексте его организации от имени администратора.

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const notFound = { 404: { description: 'Такой учётной записи нет', content: error } } as const;

const iso = (d: Date) => d.toISOString();
const listOf = <Row, Out>(list: CardList<Row>, row: (r: Row) => Out) => ({
  count: list.count,
  rows: list.rows.map(row),
});

type Work = NonNullable<AdminUserCardRecord['work']>;
const reportBody = (r: Work['due']['rows'][number]) => r;

/** Права роли по группам формы роли: названия прав — из справочника, область — у групп с областью. */
function roleGroups(
  role: NonNullable<AdminUserCardRecord['employee']>['role'],
  names: ReadonlyMap<string, string>,
): NonNullable<AdminUserCard['employee']>['roleGroups'] {
  if (!role) return [];
  return PERMISSION_GROUPS.flatMap((g) => {
    const own = role.permissions.filter((p) => permissionGroup(p) === g.id);
    if (!own.length) return [];
    return [
      {
        group: g.id,
        scope: 'scope' in g && g.scope ? role.scopes[g.id as keyof typeof role.scopes] : null,
        permissions: own.map((p) => names.get(p) ?? p),
      },
    ];
  });
}

type CardHistory = AdminUserCard['history'];

/**
 * «Учётная запись создана» есть в истории всегда (прототип acHist: запись из «Создано»): у записей
 * без неё — созданных наполнением или служебной командой — строка собирается из «Кто и когда создал».
 * Если история обрезана пределом карточки, старейшая запись в ответ не попала — строку не добавляем.
 */
function withCreation(history: CardHistory, audit: AdminUserCard['user']['audit']): CardHistory {
  if (history.length >= ADMIN_CARD_ROWS) return history;
  if (history.some((h) => h.entity === 'user' && h.action === 'create')) return history;
  return [
    ...history,
    {
      id: 'user-created',
      at: audit.createdAt,
      actor: audit.createdBy,
      actorAdmin: false,
      entity: 'user',
      action: 'create',
      fields: [],
      reason: null,
    },
  ];
}

export const userCardRoute = createRoute({
  method: 'get',
  path: '/admin/users/{id}/card',
  tags: ['admin'],
  summary: 'Карточка пользователя: вся информация по одной учётной записи',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: z.object({ id: Uuid }),
    // Перечитывание открытой карточки (после действия, при возврате на вкладку) — не новое открытие.
    query: z.object({ refresh: z.enum(['1']).optional() }),
  },
  responses: {
    200: {
      description:
        'Карточка: основное, работа, сеансы, обучение и видео, Telegram, история. Открытие пишется в историю учётной записи',
      content: { 'application/json': { schema: AdminUserCard } },
    },
    400: { description: 'Неверный параметр', content: error },
    ...denied,
    ...notFound,
  },
});

/**
 * Карточка пользователя (прототип accCard): только просмотр. Каждое открытие пишется в историю этой
 * учётной записи (у администратора платформы — в историю платформы) и видно на вкладке «История».
 */
export function userCardHandler(deps: ApiDeps): RouteHandler<typeof userCardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const refresh = c.req.valid('query').refresh === '1';
    const adminId = c.get('session')!.userId;
    const now = new Date();
    const found = await withUserContext(deps.db, adminId, (tx) => adminGetUser(tx, id));
    if (!found) throw new RecordNotFoundError('user', id);
    const orgId = found.orgId;
    const card = orgId
      ? await withOrgContext(deps.db, { orgId, userId: adminId }, async (tx) => {
          await logUserCardView(tx, id, refresh);
          return adminEmployeeCard(tx, deps.db, { userId: id, orgId, now });
        })
      : await withUserContext(deps.db, adminId, async (tx) => {
          await logAdminCardView(tx, id, refresh);
          return adminAccountCard(tx, id);
        });
    if (!card) throw new RecordNotFoundError('user', id);
    const sessions = await withUserContext(deps.db, adminId, (tx) =>
      adminUserSessions(tx, id, now),
    );
    const names = new Map((await permissionCatalog(deps.db)).map((p) => [p.id as string, p.name]));
    const e = card.employee;
    const body0 = adminUserBody(card.user);
    const body: AdminUserCard = {
      user: body0,
      states: accountStates({
        isPlatformAdmin: card.user.isPlatformAdmin,
        blocked: card.user.blocked,
        employeeActive: card.user.employeeActive,
        loginLocked: e?.loginLocked ?? false,
        mustChangePassword: e?.mustChangePassword ?? false,
      }),
      employee: e
        ? {
            id: e.id,
            shortName: e.shortName,
            phone: e.phone,
            isOwner: e.isOwner,
            loginFailures: e.loginFailures,
            loginFailuresMax: ACCOUNT_LOCK_FAILURES,
            createdAt: iso(e.createdAt),
            telegram: e.telegram
              ? {
                  name: e.telegram.username
                    ? `@${e.telegram.username}`
                    : (e.telegram.firstName ?? ''),
                  linkedAt: iso(e.telegram.linkedAt),
                }
              : null,
            roleGroups: roleGroups(e.role, names),
          }
        : null,
      work: card.work
        ? {
            contractors: card.work.contractors,
            due: listOf(card.work.due, reportBody),
            inWork: listOf(card.work.inWork, reportBody),
            overdue: listOf(card.work.overdue, reportBody),
            done: listOf(card.work.done, reportBody),
            tasks: card.work.tasks,
            kpi: listOf(card.work.kpi, (v) => ({ ...v, at: iso(v.at) })),
            kpiMonth: card.work.kpiMonth,
          }
        : null,
      sessions: {
        open: sessions.open,
        total: sessions.total,
        self: id === adminId,
        rows: sessions.rows.map((s) => ({
          id: s.id,
          startedAt: iso(s.startedAt),
          lastAt: iso(s.lastAt),
          till: s.till ? iso(s.till) : null,
          device: s.device,
          open: s.open,
          endReason: s.endReason,
        })),
      },
      kb: card.kb
        ? {
            progress: card.kb.progress
              ? progressBody(
                  card.kb.progress.stats,
                  card.kb.progress.levels,
                  card.kb.progress.reached,
                )
              : null,
            articles: listOf(card.kb.articles, (a) => ({ ...a, readAt: iso(a.readAt) })),
            videos: listOf(card.kb.videos, (v) => ({
              ...v,
              lastAt: v.lastAt ? iso(v.lastAt) : null,
            })),
          }
        : null,
      telegram: card.telegram ? listOf(card.telegram, (m) => ({ ...m, at: iso(m.at) })) : null,
      history: withCreation(
        card.history.map((h) => ({ ...h, at: iso(h.at) })),
        body0.audit,
      ),
    };
    return c.json(body, 200);
  };
}

export const userLookupRoute = createRoute({
  method: 'get',
  path: '/admin/users/lookup',
  tags: ['admin'],
  summary: 'Учётная запись по логину — для ссылки на карточку #accounts/<логин>',
  middleware: [requirePlatformAdmin] as const,
  request: { query: z.object({ login: z.string().min(1).max(LOGIN_MAX_LENGTH) }) },
  responses: {
    200: {
      description: 'Номер учётной записи',
      content: { 'application/json': { schema: AdminUserLookup } },
    },
    400: { description: 'Логин не задан или слишком длинный', content: error },
    ...denied,
    ...notFound,
  },
});

export function userLookupHandler(deps: ApiDeps): RouteHandler<typeof userLookupRoute, AppEnv> {
  return async (c) => {
    const login = normalizeLogin(c.req.valid('query').login);
    const adminId = c.get('session')!.userId;
    const id = await withUserContext(deps.db, adminId, (tx) => adminUserIdByLogin(tx, login));
    if (!id) throw new RecordNotFoundError('user', login);
    return c.json({ id }, 200);
  };
}

export const endUserSessionsRoute = createRoute({
  method: 'post',
  path: '/admin/users/{id}/sessions/end',
  tags: ['admin'],
  summary: 'Завершить все сеансы пользователя',
  middleware: [requirePlatformAdmin] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Пользователь вышел на всех устройствах; запись — в истории учётной записи',
      content: { 'application/json': { schema: AdminSessionsEnded } },
    },
    400: {
      description: 'Своя учётная запись или учётная запись администратора платформы',
      content: error,
    },
    ...denied,
    ...notFound,
  },
});

/**
 * «Завершить все сеансы» (прототип accCard, `#ac-end`): пользователь выходит на всех устройствах и
 * может войти снова со своим паролем. Свои сеансы администратор так не завершает (выход — через
 * меню профиля), учётные записи администраторов платформы из Админки не меняются.
 */
export function endUserSessionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof endUserSessionsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const adminId = c.get('session')!.userId;
    const found = await withUserContext(deps.db, adminId, (tx) => adminGetUser(tx, id));
    if (!found) throw new RecordNotFoundError('user', id);
    const refusal = accountActionRefusal(adminId, found);
    if (refusal === 'self') apiFail(400, 'account_self', 'Это ваша учётная запись');
    if (refusal === 'platform_admin' || !found.orgId) {
      apiFail(
        400,
        'account_platform_admin',
        'Учётные записи администраторов платформы здесь не меняются',
      );
    }
    const ended = await withOrgContext(deps.db, { orgId: found.orgId, userId: adminId }, (tx) =>
      adminEndUserSessions(tx, id),
    );
    return c.json({ ended }, 200);
  };
}
