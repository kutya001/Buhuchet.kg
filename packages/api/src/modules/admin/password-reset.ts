import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import { newTemporaryPassword } from '@buhuchet/adapters/tokens';
import {
  adminFindUser,
  currentOrganization,
  setTemporaryPassword,
  withOrgContext,
  withUserContext,
  writeHistory,
} from '@buhuchet/db';
import { RecordNotFoundError } from '@buhuchet/domain';
import { ApiError, TemporaryPasswordResponse, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { requirePlatformAdmin } from '../../middleware/access';
import { notifyPasswordChanged } from '../telegram/bot';

const error = { 'application/json': { schema: ApiError } };

export const adminResetPasswordRoute = createRoute({
  method: 'post',
  path: '/admin/users/{id}/password-reset',
  tags: ['admin'],
  summary: 'Сбросить пароль пользователя организации: временный пароль',
  middleware: [requirePlatformAdmin] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Временный пароль (показывается один раз); все сеансы пользователя завершены',
      content: { 'application/json': { schema: TemporaryPasswordResponse } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не администратор платформы', content: error },
    404: { description: 'Нет такого пользователя организации', content: error },
  },
});

/**
 * «Сбросить пароль» в Админке → «Учётные записи» (прототип admin/accounts-orgs.js): временный пароль,
 * все сеансы завершены, бот сообщает о смене пароля. Так восстанавливается пароль владельца без
 * Telegram (ТЗ). Действие идёт в контексте организации пользователя от имени администратора и
 * пишется в её историю. Пароль другого администратора платформы здесь не сбрасывается.
 */
export function adminResetPasswordHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminResetPasswordRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const admin = c.get('session')!;
    const target = await withUserContext(deps.db, admin.userId, (tx) => adminFindUser(tx, id));
    if (!target?.orgId) throw new RecordNotFoundError('user', id);
    const orgId = target.orgId;
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const org = await withOrgContext(deps.db, { orgId, userId: admin.userId }, async (tx) => {
      if (!(await setTemporaryPassword(tx, { userId: target.userId, passwordHash }))) {
        throw new RecordNotFoundError('user', id);
      }
      await writeHistory(tx, {
        entity: 'user',
        entityId: target.userId,
        action: 'update',
        changes: [{ field: 'passwordHash' }, { field: 'mustChangePassword', to: true }],
        reason: 'Пароль сброшен администратором платформы: выдан временный пароль',
      });
      return currentOrganization(tx, orgId);
    });
    const telegramNotified = await notifyPasswordChanged(deps, {
      userId: target.userId,
      login: target.login,
      orgName: org?.name ?? null,
    });
    return c.json({ temporaryPassword, telegramNotified }, 200);
  };
}
