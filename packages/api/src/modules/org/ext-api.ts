import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { orgIsDemo, withOrgContext } from '@buhuchet/db';
import { OrgExtApi } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requireEmployee } from '../../middleware/access';
import { activeTokenCount } from '../datamart/tokens';
import { error } from './profile';

export const orgExtApiRoute = createRoute({
  method: 'get',
  path: '/org/ext-api',
  tags: ['org'],
  summary: '«Внешний доступ по API» на вкладке «Настройки»: демо-организация и действующие токены',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Демо-организация и сколько её токенов «Действует»',
      content: { 'application/json': { schema: OrgExtApi } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

/**
 * Блок «Внешний доступ по API» (доработки 20.11.2026: Витрина данных, блок 5, пункт 9; прототип v155
 * `dmApiBox`): виден всем сотрудникам, как вкладка «Настройки»; подпись «· действующих токенов: N» и
 * вопрос «Выключить внешний доступ?» — по токенам организации в состоянии «Действует» (прототип
 * `dmLive`). Сам выключатель — поле `extApi` учётной политики (`PATCH /api/org/policy`). Только число:
 * ни названий, ни авторов токенов — их видит право «Управлять API-токенами».
 */
export function orgExtApiHandler(deps: ApiDeps): RouteHandler<typeof orgExtApiRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const at = deps.clock.now();
    const body = await withOrgContext(deps.db, ctx, async (tx) => ({
      demo: await orgIsDemo(tx, ctx.orgId),
      activeTokens: await activeTokenCount(tx, at),
    }));
    return c.json(body, 200);
  };
}
