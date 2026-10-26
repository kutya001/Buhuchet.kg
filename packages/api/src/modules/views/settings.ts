import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { listViewSettings, resetViewSettings, saveViewSettings } from '@buhuchet/db';
import { isGridKey } from '@buhuchet/domain';
import {
  ApiError,
  GridKeyParam,
  ViewSettings,
  ViewSettingsMap,
  ViewSettingsResponse,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { asSessionUser } from '../../middleware/access';

const error = { 'application/json': { schema: ApiError } };
const params = z.object({ gridKey: GridKeyParam });

/** Список из `GRID_KEYS`: настройки других ключей сервер не хранит (их нельзя накопить без меры). */
function knownGrid(gridKey: string): string {
  if (!isGridKey(gridKey)) apiFail(404, 'not_found', 'Список не найден');
  return gridKey;
}

export const listViewSettingsRoute = createRoute({
  method: 'get',
  path: '/view-settings',
  tags: ['views'],
  summary: 'Мои настройки вида списков',
  responses: {
    200: {
      description: 'Сохранённые настройки вида по ключам списков; списков без настроек нет',
      content: { 'application/json': { schema: ViewSettingsMap } },
    },
    401: { description: 'Нет входа', content: error },
  },
});

/**
 * Все настройки вида пользователя одним ответом: экран берёт их один раз и показывает списки сразу
 * в сохранённом виде. Строки, которые не проходят схему (список убран, схема изменилась), не
 * отдаются — список покажется по умолчанию.
 */
export function listViewSettingsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listViewSettingsRoute, AppEnv> {
  return async (c) => {
    const stored = await asSessionUser(deps, c.get('session')!, listViewSettings);
    const items: Record<string, ViewSettings> = {};
    for (const [key, value] of Object.entries(stored)) {
      const parsed = ViewSettings.safeParse(value);
      if (isGridKey(key) && parsed.success) items[key] = parsed.data;
    }
    return c.json({ items }, 200);
  };
}

export const saveViewSettingsRoute = createRoute({
  method: 'put',
  path: '/view-settings/{gridKey}',
  tags: ['views'],
  summary: 'Сохранить вид списка',
  request: {
    params,
    body: { required: true, content: { 'application/json': { schema: ViewSettings } } },
  },
  responses: {
    200: {
      description: 'Вид сохранён',
      content: { 'application/json': { schema: ViewSettingsResponse } },
    },
    400: { description: 'Неверные настройки', content: error },
    401: { description: 'Нет входа', content: error },
    404: { description: 'Такого списка нет', content: error },
  },
});

/**
 * Столбцы, порядок, ширины, плотность, сортировка, «Таблица / Карточки» и записей на странице —
 * для этого пользователя и этого списка (ТЗ «Настройки вида»). Сохраняется целиком: последнее
 * сохранение побеждает, в историю не пишется — это вид экрана, а не данные организации.
 */
export function saveViewSettingsHandler(
  deps: ApiDeps,
): RouteHandler<typeof saveViewSettingsRoute, AppEnv> {
  return async (c) => {
    const gridKey = knownGrid(c.req.valid('param').gridKey);
    const settings = c.req.valid('json');
    await asSessionUser(deps, c.get('session')!, (tx) => saveViewSettings(tx, gridKey, settings));
    return c.json({ settings }, 200);
  };
}

export const resetViewSettingsRoute = createRoute({
  method: 'delete',
  path: '/view-settings/{gridKey}',
  tags: ['views'],
  summary: '«Сбросить вид» списка',
  request: { params },
  responses: {
    200: {
      description: 'Настройки удалены: список — по умолчанию',
      content: { 'application/json': { schema: ViewSettingsResponse } },
    },
    401: { description: 'Нет входа', content: error },
    404: { description: 'Такого списка нет', content: error },
  },
});

/** «Сбросить вид» возвращает всё как было: столбцы, порядок, ширины, сортировку, плотность. */
export function resetViewSettingsHandler(
  deps: ApiDeps,
): RouteHandler<typeof resetViewSettingsRoute, AppEnv> {
  return async (c) => {
    const gridKey = knownGrid(c.req.valid('param').gridKey);
    await asSessionUser(deps, c.get('session')!, (tx) => resetViewSettings(tx, gridKey));
    return c.json({ settings: null }, 200);
  };
}
