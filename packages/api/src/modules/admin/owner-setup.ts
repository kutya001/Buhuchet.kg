import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  adminGetOrganization,
  issuePasswordSetup,
  orgOwnerUserId,
  withOrgContext,
  withUserContext,
  writeHistory,
} from '@buhuchet/db';
import { OWNER_SETUP_DAYS, RecordNotFoundError } from '@buhuchet/domain';
import { ApiError, OkResponse, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { newSetupKey, sendSetupMessage } from '../telegram/lead-link';

/*
 * Карточка организации в Админке → «Отправить новую ссылку для пароля» (доработки 14.11.2026, блок 1,
 * пункт 3; прототип v113 ownerSetupAct): владельцу организации, созданной по заявке, пока он не задал
 * пароль, — новая ссылка «Задать пароль» на 7 дней в Telegram, привязанный к нему сейчас; прежняя
 * перестаёт действовать. Только администратор платформы; запись — в истории организации.
 */

const error = { 'application/json': { schema: ApiError } };

export const ownerSetupRoute = createRoute({
  method: 'post',
  path: '/admin/organizations/{id}/owner-setup',
  tags: ['admin'],
  summary: 'Отправить владельцу новую ссылку, чтобы задать пароль',
  middleware: [requirePlatformAdmin] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Ссылка отправлена в Telegram владельца; прежняя больше не действует',
      content: { 'application/json': { schema: OkResponse } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не администратор платформы или запрос с другого сайта', content: error },
    404: { description: 'Такой организации нет', content: error },
    409: {
      description:
        'Пароль уже задан или ссылка не положена (`owner_setup_unavailable`); у владельца не привязан Telegram (`owner_no_telegram`)',
      content: error,
    },
    503: {
      description: 'Telegram не принял сообщение (`owner_setup_send_failed`)',
      content: error,
    },
  },
});

export function ownerSetupHandler(deps: ApiDeps): RouteHandler<typeof ownerSetupRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const adminId = c.get('session')!.userId;
    const found = await withUserContext(deps.db, adminId, (tx) => adminGetOrganization(tx, id));
    if (!found) throw new RecordNotFoundError('organization', id);
    const { token, hash } = newSetupKey();
    const now = deps.clock.now();
    const result = await withOrgContext(deps.db, { orgId: id, userId: adminId }, async (tx) => {
      const ownerId = await orgOwnerUserId(tx);
      if (!ownerId) return null;
      const issued = await issuePasswordSetup(tx, {
        userId: ownerId,
        hash,
        now,
        days: OWNER_SETUP_DAYS,
      });
      return issued ? { ownerId, issued } : null;
    });
    if (!result) {
      return c.json(
        apiError('owner_setup_unavailable', 'Владелец уже задал пароль или ссылка ему не положена'),
        409,
      );
    }
    if (result.issued.outcome === 'no_telegram') {
      return c.json(apiError('owner_no_telegram', 'У владельца не привязан Telegram'), 409);
    }
    const { issued } = result;
    const sent = await sendSetupMessage(deps, result.ownerId, issued, token);
    if (sent !== 'sent') {
      // Прежняя ссылка уже не действует, новую Telegram не принял: в истории — ничего, повтор выдаст
      // следующую (docs/deviations.md п. Т-18).
      return c.json(
        apiError(
          'owner_setup_send_failed',
          'Telegram не принял сообщение. Попробуйте ещё раз через минуту.',
        ),
        503,
      );
    }
    // В историю организации — после отправки (прототип: log('porg', …), вкладка «История» карточки).
    await withOrgContext(deps.db, { orgId: id, userId: adminId }, (tx) =>
      writeHistory(tx, {
        entity: 'organization',
        entityId: id,
        action: 'update',
        changes: [],
        reason: `Владельцу ${issued.login} отправлена новая ссылка, чтобы задать пароль; прежняя больше не действует`,
      }),
    );
    return c.json({ ok: true as const }, 200);
  };
}
