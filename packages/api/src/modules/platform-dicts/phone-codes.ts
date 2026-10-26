import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { phoneCodeList } from '@buhuchet/db';
import { ApiError, PhoneCodes } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { asSessionUser } from '../../middleware/access';

const error = { 'application/json': { schema: ApiError } };

export const phoneCodesRoute = createRoute({
  method: 'get',
  path: '/phone-codes',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Коды телефонов» для поля ввода телефона',
  responses: {
    200: {
      description: 'Страны с кодом и маской номера по порядку справочника',
      content: { 'application/json': { schema: PhoneCodes } },
    },
    401: { description: 'Нет входа', content: error },
  },
});

/**
 * Коды телефонов (прототип ui/popups.js, phoneInput): выбор кода страны и маска номера в полях
 * телефона — у сотрудника, организации, контрагента. Справочник платформы общий, его читает любой
 * вошедший; меняет только администратор платформы (Админка).
 */
export function phoneCodesHandler(deps: ApiDeps): RouteHandler<typeof phoneCodesRoute, AppEnv> {
  return async (c) => {
    const items = await asSessionUser(deps, c.get('session')!, (tx) => phoneCodeList(tx));
    return c.json({ items }, 200);
  };
}
