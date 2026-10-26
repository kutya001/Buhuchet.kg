import { randomUUID } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { orgFileKey } from '@buhuchet/adapters';
import {
  getOrgProfile,
  lockOrgLogoKey,
  schema,
  updateWithHistory,
  withOrgContext,
} from '@buhuchet/db';
import {
  LOGO_MAX_BYTES,
  logoImageType,
  logoProblem,
  ORG_PROFILE_MESSAGES,
  RecordNotFoundError,
} from '@buhuchet/domain';
import { OrgLogoLink, OrgProfile, OrgVersionQuery } from '@buhuchet/shared';
import { bodyLimit } from 'hono/body-limit';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { logoLink, ownLogoKey } from './logo-link';
import { error, orgProfileBody } from './profile';

const { organizations } = schema;

/** Путь загрузки логотипа: общий предел тела API (1 МиБ) здесь заменён своим — 2 МБ. */
export const LOGO_PATH = '/api/org/logo';

const tooLarge = () => apiError('logo_too_large', ORG_PROFILE_MESSAGES.logo_too_large);

/** Ключ хранилища в историю не пишется — только факт «Загружен логотип» или «Убран». */
const LOGO_HISTORY_SECRET = ['logoKey'];

/** Предел тела загрузки логотипа — сам файл до 2 МБ (прототип: «Файл больше 2 МБ»). */
const logoBodyLimit = bodyLimit({
  maxSize: LOGO_MAX_BYTES,
  onError: (c) => c.json(tooLarge(), 413),
});

const image = {
  'image/png': { schema: z.string().openapi({ format: 'binary' }) },
  'image/jpeg': { schema: z.string().openapi({ format: 'binary' }) },
};

export const getLogoRoute = createRoute({
  method: 'get',
  path: '/org/logo',
  tags: ['org'],
  summary: 'Новая ссылка на логотип организации на 15 минут',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Подписанная ссылка на картинку в хранилище',
      content: { 'application/json': { schema: OrgLogoLink } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
    404: { description: 'Логотипа нет', content: error },
  },
});

/**
 * Логотип видят все сотрудники организации: после проверки сеанса выдаётся временная подписанная
 * ссылка на картинку в хранилище (ТЗ; решение заказчика по п. 20 расхождений). Ссылка из «Основного»
 * живёт 15 минут — когда срок выходит, экран берёт здесь новую.
 */
export function getLogoHandler(deps: ApiDeps): RouteHandler<typeof getLogoRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const profile = await withOrgContext(deps.db, ctx, (tx) => getOrgProfile(tx, ctx.orgId));
    const link = profile && (await logoLink(deps, ctx.orgId, profile.logoKey));
    if (!link) return c.json(apiError('not_found', 'Логотипа нет'), 404);
    return c.json(link, 200);
  };
}

export const uploadLogoRoute = createRoute({
  method: 'put',
  path: '/org/logo',
  tags: ['org'],
  summary: 'Загрузить логотип: картинка PNG или JPG до 2 МБ телом запроса',
  middleware: [requirePermission('org'), logoBodyLimit] as const,
  request: {
    query: OrgVersionQuery,
    body: { required: true, content: image },
  },
  responses: {
    200: {
      description: '«Основное» с новым логотипом',
      content: { 'application/json': { schema: OrgProfile } },
    },
    400: { description: 'Не PNG и не JPG', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Настройки и учётная политика»', content: error },
    413: { description: 'Файл больше 2 МБ', content: error },
    ...versionedSaveResponses,
  },
});

/** Удалить файл из хранилища, не роняя метод: запись в базе уже верная, лишний файл не опасен. */
async function dropFile(deps: ApiDeps, key: string): Promise<void> {
  try {
    await deps.storage.delete(key);
  } catch (err) {
    deps.logger.error({ err }, 'логотип: не удалось удалить файл из хранилища');
  }
}

/**
 * Логотип (прототип modules/org.js, og-save: «Загружен логотип»). Файл кладётся в хранилище под новым
 * ключом org/<org_id>/logo/<id>, затем ключ записывается в организацию с историей и версией; прежний
 * файл (ключ из заблокированной строки) удаляется после сохранения. Если сохранить не удалось (версия
 * устарела), новый файл удаляется.
 */
export function uploadLogoHandler(deps: ApiDeps): RouteHandler<typeof uploadLogoRoute, AppEnv> {
  return async (c) => {
    const { version } = c.req.valid('query');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const problem = logoProblem(bytes);
    if (problem === 'logo_too_large') return c.json(tooLarge(), 413);
    if (problem) return c.json(apiError(problem, ORG_PROFILE_MESSAGES[problem]), 400);
    const ctx = orgContextOf(c);
    const key = orgFileKey(ctx.orgId, 'logo', randomUUID());
    await deps.storage.put(key, bytes, { contentType: logoImageType(bytes)! });
    let previous: string | null;
    try {
      previous = await withOrgContext(deps.db, ctx, async (tx) => {
        const before = await lockOrgLogoKey(tx, ctx.orgId);
        if (!before) throw new RecordNotFoundError('organization', ctx.orgId);
        await updateWithHistory(tx, {
          table: organizations,
          entity: 'organization',
          id: ctx.orgId,
          version,
          patch: { logoKey: key },
          secretFields: LOGO_HISTORY_SECRET,
        });
        return before.logoKey;
      });
    } catch (err) {
      await dropFile(deps, key);
      throw err;
    }
    if (ownLogoKey(previous, ctx.orgId)) await dropFile(deps, previous);
    const profile = await withOrgContext(deps.db, ctx, (tx) => getOrgProfile(tx, ctx.orgId));
    return c.json(await orgProfileBody(deps, profile!), 200);
  };
}

export const deleteLogoRoute = createRoute({
  method: 'delete',
  path: '/org/logo',
  tags: ['org'],
  summary: 'Убрать логотип',
  middleware: [requirePermission('org')] as const,
  request: { query: OrgVersionQuery },
  responses: {
    200: {
      description: '«Основное» без логотипа',
      content: { 'application/json': { schema: OrgProfile } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Настройки и учётная политика»', content: error },
    ...versionedSaveResponses,
  },
});

/** Убрать логотип: ключ стирается с историей и версией, файл удаляется из хранилища после сохранения. */
export function deleteLogoHandler(deps: ApiDeps): RouteHandler<typeof deleteLogoRoute, AppEnv> {
  return async (c) => {
    const { version } = c.req.valid('query');
    const ctx = orgContextOf(c);
    const { previous, profile } = await withOrgContext(deps.db, ctx, async (tx) => {
      const before = await lockOrgLogoKey(tx, ctx.orgId);
      if (!before) throw new RecordNotFoundError('organization', ctx.orgId);
      await updateWithHistory(tx, {
        table: organizations,
        entity: 'organization',
        id: ctx.orgId,
        version,
        patch: { logoKey: null },
        secretFields: LOGO_HISTORY_SECRET,
      });
      return { previous: before.logoKey, profile: (await getOrgProfile(tx, ctx.orgId))! };
    });
    if (ownLogoKey(previous, ctx.orgId)) await dropFile(deps, previous);
    return c.json(await orgProfileBody(deps, profile), 200);
  };
}
