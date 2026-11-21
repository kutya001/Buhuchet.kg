import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { withOrgContext } from '@buhuchet/db';
import { ContractorSeats } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { currentSeats, error, subjectOf, todayOf } from './common';

export const contractorSeatsRoute = createRoute({
  method: 'get',
  path: '/contractors/seats',
  tags: ['contractors'],
  summary: 'Места в пакете',
  middleware: [requirePermission('cpView')] as const,
  responses: {
    200: {
      description:
        'Занято и свободно мест в пакете организации (null — предела нет: демо-организация или нет подписки) и владелец ли спрашивает',
      content: { 'application/json': { schema: ContractorSeats } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать контрагентов»', content: error },
  },
});

/**
 * Места в пакете (доработки 20.11.2026, блок 3, пункт 1; прототип v152 seatOk): экран спрашивает их
 * до формы «Новый контрагент» и «Вернуть из архива» — пакет заполнен, вместо формы окно «В пакете нет
 * свободных мест». Само правило держит сервер при сохранении (`requireSeats`).
 */
export function contractorSeatsHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorSeatsRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const seats = await withOrgContext(deps.db, ctx, (tx) => currentSeats(tx, todayOf(deps)));
    return c.json({ seats, owner: subject.isOwner }, 200);
  };
}
