import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  getOrgProfile,
  schema,
  uniqueViolation,
  updateWithHistory,
  withOrgContext,
  type OrgProfileRecord,
} from '@buhuchet/db';
import {
  isValidOrgInn,
  ORG_PROFILE_MESSAGES,
  RecordNotFoundError,
  SLUG_MESSAGES,
  slugProblem,
} from '@buhuchet/domain';
import { ApiError, OrgProfile, UpdateOrgProfileRequest } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { checkPhone } from '../staff/create';

const { organizations } = schema;

export const error = { 'application/json': { schema: ApiError } };

/** Последняя часть ключа логотипа — номер загрузки: по нему браузер не берёт старую картинку из кэша. */
export function logoVersion(logoKey: string): string {
  return logoKey.slice(logoKey.lastIndexOf('/') + 1);
}

/** «Основное» для ответа API: ключ хранилища наружу не уходит, только адрес картинки. */
export function orgProfileBody(p: OrgProfileRecord): OrgProfile {
  return {
    id: p.id,
    name: p.name,
    inn: p.inn,
    address: p.address,
    phone: p.phone,
    head: p.head,
    slug: p.slug,
    logoUrl: p.logoKey ? `/api/org/logo?v=${logoVersion(p.logoKey)}` : null,
    audit: {
      createdAt: p.audit.createdAt.toISOString(),
      createdBy: p.audit.createdBy,
      updatedAt: p.audit.updatedAt.toISOString(),
      updatedBy: p.audit.updatedBy,
    },
    version: p.version,
  };
}

export const getOrgProfileRoute = createRoute({
  method: 'get',
  path: '/org',
  tags: ['org'],
  summary: '«Моя организация» → «Основное»',
  middleware: [requireEmployee] as const,
  responses: {
    200: { description: 'Основное', content: { 'application/json': { schema: OrgProfile } } },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

/**
 * «Основное» видят все сотрудники организации; кто без права «Настройки и учётная политика», видит его
 * только для просмотра (прототип: «Редактировать может только владелец организации…»).
 */
export function getOrgProfileHandler(
  deps: ApiDeps,
): RouteHandler<typeof getOrgProfileRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const profile = await withOrgContext(deps.db, ctx, (tx) => getOrgProfile(tx, ctx.orgId));
    if (!profile) throw new RecordNotFoundError('organization', ctx.orgId);
    return c.json(orgProfileBody(profile), 200);
  };
}

export const updateOrgProfileRoute = createRoute({
  method: 'patch',
  path: '/org',
  tags: ['org'],
  summary: 'Сохранить «Основное»: название, ИНН, адрес, телефон, руководитель, адрес страницы',
  middleware: [requirePermission('org')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: UpdateOrgProfileRequest } } },
  },
  responses: {
    200: {
      description: '«Основное» после правки',
      content: { 'application/json': { schema: OrgProfile } },
    },
    400: {
      description:
        'Нет названия, ИНН не из 14 цифр или уже есть у другой организации, неверный телефон, ' +
        'адрес страницы не по формату, занят программой или другой организацией',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Настройки и учётная политика»', content: error },
    ...versionedSaveResponses,
  },
});

/** Пустая строка в необязательном поле — очистить его. */
const optional = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

/**
 * «Основное» (прототип modules/org.js, og-save): проверки и тексты прототипа — «Введите название»,
 * «ИНН — 14 цифр», адрес страницы (формат, занятые слова программы — v58, занят другой организацией).
 * Смена адреса страницы — отдельная запись в истории «было → стало»: ссылки, отправленные
 * контрагентам, перестают открываться (интерфейс спрашивает подтверждение до сохранения).
 */
export function updateOrgProfileHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateOrgProfileRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    if (body.name !== undefined && !body.name) {
      return c.json(apiError('name_required', ORG_PROFILE_MESSAGES.name_required), 400);
    }
    if (body.inn !== undefined && !isValidOrgInn(body.inn)) {
      return c.json(apiError('inn_invalid', ORG_PROFILE_MESSAGES.inn_invalid), 400);
    }
    const slug = body.slug === undefined ? null : slugProblem(body.slug);
    if (slug) return c.json(apiError(slug, SLUG_MESSAGES[slug]), 400);
    const ctx = orgContextOf(c);
    try {
      const profile = await withOrgContext(deps.db, ctx, async (tx) => {
        const phone = body.phone === undefined ? undefined : await checkPhone(tx, body.phone);
        await updateWithHistory(tx, {
          table: organizations,
          entity: 'organization',
          id: ctx.orgId,
          version: body.version,
          patch: {
            name: body.name,
            inn: body.inn,
            address: optional(body.address),
            phone,
            head: optional(body.head),
            slug: body.slug,
          },
        });
        return (await getOrgProfile(tx, ctx.orgId))!;
      });
      return c.json(orgProfileBody(profile), 200);
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === 'organizations_slug_unique') {
        return c.json(apiError('slug_taken', SLUG_MESSAGES.slug_taken), 400);
      }
      if (constraint === 'organizations_inn_unique') {
        return c.json(apiError('inn_taken', ORG_PROFILE_MESSAGES.inn_taken), 400);
      }
      throw err;
    }
  };
}
