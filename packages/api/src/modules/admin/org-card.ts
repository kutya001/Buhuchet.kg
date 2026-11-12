import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  ADMIN_CARD_ROWS,
  adminGetOrganization,
  adminOrgCard,
  adminOrgIdBySlug,
  logOrgCardView,
  withOrgContext,
  withUserContext,
} from '@buhuchet/db';
import { accountStates, RecordNotFoundError } from '@buhuchet/domain';
import { AdminOrgCard, AdminOrgLookup, ApiError, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { translateOf } from '../contractors/common';
import { adminOrganizationBody } from './organizations';

// Карточка организации в Админке (ТЗ «Админка» → «Карточка организации», решение заказчика
// 09.11.2026; прототип admin/admin-cards.js, orgCard). Только администратор платформы и только
// просмотр: данные организации читаются в её контексте от имени администратора.

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const notFound = { 404: { description: 'Такой организации нет', content: error } } as const;

const iso = (d: Date) => d.toISOString();

type CardHistory = AdminOrgCard['history'];

/**
 * «Организация создана вместе с владельцем» есть в истории всегда (прототип ocHist: запись из
 * «Создано»): у организаций без неё строка собирается из «Кто и когда создал». Если история обрезана
 * пределом карточки, старейшая запись в ответ не попала — строку не добавляем.
 */
function withCreation(history: CardHistory, audit: AdminOrgCard['org']['audit']): CardHistory {
  if (history.length >= ADMIN_CARD_ROWS) return history;
  if (history.some((h) => h.entity === 'organization' && h.action === 'create')) return history;
  return [
    ...history,
    {
      id: 'organization-created',
      at: audit.createdAt,
      actor: audit.createdBy,
      actorAdmin: false,
      entity: 'organization',
      action: 'create',
      subject: null,
      changes: [],
      reason: null,
    },
  ];
}

export const orgCardRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/card',
  tags: ['admin'],
  summary: 'Карточка организации: вся информация по одной организации-клиенту',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: z.object({ id: Uuid }),
    // Перечитывание открытой карточки (после действия, при возврате на вкладку) — не новое открытие.
    query: z.object({ refresh: z.enum(['1']).optional() }),
  },
  responses: {
    200: {
      description:
        'Карточка: основное, сводка, сотрудники, контрагенты, отчёты, деньги, настройки, файлы, история. Открытие пишется в историю организации',
      content: { 'application/json': { schema: AdminOrgCard } },
    },
    400: { description: 'Неверный параметр', content: error },
    ...denied,
    ...notFound,
  },
});

/**
 * Карточка организации (прототип orgCard): только просмотр. Каждое открытие пишется в историю этой
 * организации и видно на вкладке «История».
 */
export function orgCardHandler(deps: ApiDeps): RouteHandler<typeof orgCardRoute, AppEnv> {
  return async (c) => {
    // Чтение карточки пишет в историю, а проверка Origin идёт только у изменяющих методов: запрос,
    // который браузер сделал с чужого сайта, записи не оставляет.
    if (c.req.header('sec-fetch-site') === 'cross-site') {
      apiFail(403, 'origin_mismatch', 'Запрос с другого сайта отклонён');
    }
    const { id } = c.req.valid('param');
    const refresh = c.req.valid('query').refresh === '1';
    const adminId = c.get('session')!.userId;
    const now = new Date();
    const found = await withUserContext(deps.db, adminId, (tx) => adminGetOrganization(tx, id));
    if (!found) throw new RecordNotFoundError('organization', id);
    const t = await translateOf(deps);
    const card = await withOrgContext(deps.db, { orgId: id, userId: adminId }, async (tx) => {
      await logOrgCardView(tx, id, refresh);
      return adminOrgCard(tx, { orgId: id, now, t });
    });
    if (!card) throw new RecordNotFoundError('organization', id);
    const org = adminOrganizationBody(card.org);
    const body: AdminOrgCard = {
      org,
      profile: card.profile,
      owner: card.owner,
      lead: card.lead ? { ...card.lead, at: iso(card.lead.at) } : null,
      summary: card.summary,
      staff: {
        count: card.staff.count,
        rows: card.staff.rows.map((u) => ({
          userId: u.userId,
          fullName: u.fullName,
          login: u.login,
          role: u.role,
          telegram: u.telegram,
          lastLoginAt: u.lastLoginAt ? iso(u.lastLoginAt) : null,
          states: accountStates({ ...u, isPlatformAdmin: false }),
        })),
      },
      contractors: card.contractors,
      reports: card.reports,
      money: card.money,
      settings: card.settings,
      files: {
        byKind: card.files.byKind,
        recent: card.files.recent.map((f) => ({ ...f, at: iso(f.at) })),
      },
      history: withCreation(
        card.history.map((h) => ({ ...h, at: iso(h.at) })),
        org.audit,
      ),
      blocks: card.blocks.map((h) => ({ ...h, at: iso(h.at) })),
    };
    return c.json(body, 200);
  };
}

export const orgLookupRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/lookup',
  tags: ['admin'],
  summary: 'Организация по адресу страницы — для ссылки на карточку #orgs/<адрес>',
  middleware: [requirePlatformAdmin] as const,
  request: { query: z.object({ slug: z.string().trim().toLowerCase().min(1).max(64) }) },
  responses: {
    200: {
      description: 'Номер организации',
      content: { 'application/json': { schema: AdminOrgLookup } },
    },
    400: { description: 'Адрес не задан или слишком длинный', content: error },
    ...denied,
    ...notFound,
  },
});

export function orgLookupHandler(deps: ApiDeps): RouteHandler<typeof orgLookupRoute, AppEnv> {
  return async (c) => {
    const { slug } = c.req.valid('query');
    const adminId = c.get('session')!.userId;
    const id = await withUserContext(deps.db, adminId, (tx) => adminOrgIdBySlug(tx, slug));
    if (!id) throw new RecordNotFoundError('organization', slug);
    return c.json({ id }, 200);
  };
}
