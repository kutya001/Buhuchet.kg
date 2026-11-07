import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import { newTemporaryPassword } from '@buhuchet/adapters/tokens';
import {
  activeOwnerUserIds,
  adminFindUser,
  currentOrganization,
  setTemporaryPassword,
  telegramChat,
  withOrgContext,
  withUserContext,
  writeHistory,
} from '@buhuchet/db';
import { RecordNotFoundError, withOrganization } from '@buhuchet/domain';
import { ApiError, TemporaryPasswordResponse, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { requirePlatformAdmin } from '../../middleware/access';
import { botText, notifyPasswordChanged, sendNow } from '../telegram/bot';

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
 * пишется в её историю; если пароль сброшен сотруднику, владельцам организации — сообщение в Telegram.
 * Пароль другого администратора платформы здесь не сбрасывается.
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
      const reset = await setTemporaryPassword(tx, { userId: target.userId, passwordHash });
      if (!reset) throw new RecordNotFoundError('user', id);
      await writeHistory(tx, {
        entity: 'user',
        entityId: target.userId,
        action: 'update',
        changes: [
          { field: 'passwordHash' },
          { field: 'mustChangePassword', from: reset.mustChangePasswordBefore, to: true },
          // Новый пароль снимает блокировку входа после 10 неверных паролей (docs/deviations.md п. О-11).
          ...(reset.loginLockedBefore ? [{ field: 'loginLocked', from: true, to: false }] : []),
        ],
        reason: 'Пароль сброшен администратором платформы: выдан временный пароль',
      });
      return {
        org: await currentOrganization(tx, orgId),
        owners: await activeOwnerUserIds(tx, orgId, target.userId),
      };
    });
    const orgName = org.org?.name ?? null;
    const telegramNotified = await notifyPasswordChanged(
      deps,
      { userId: target.userId, login: target.login, orgName },
      'администратор платформы',
    );
    await notifyOwners(deps, org.owners, target.login, orgName);
    return c.json({ temporaryPassword, telegramNotified }, 200);
  };
}

/**
 * Администратор платформы сбросил пароль сотрудника — владельцам организации сообщение в Telegram
 * (ревью безопасности 06.11.2026, п. Р-2): владелец видит, что в его организации кто-то получил
 * временный пароль не от него. Пароль самого владельца — ему же сообщает `notifyPasswordChanged`.
 * Сбой отправки не меняет ответ: пароль уже сброшен, ошибка — в журнал сервера.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-13 — в прототипе (accResetPass) бот сообщает только самому пользователю.
async function notifyOwners(
  deps: ApiDeps,
  owners: readonly string[],
  login: string,
  orgName: string | null,
): Promise<void> {
  if (!deps.telegram || owners.length === 0) return;
  const text = await botText(deps, 'tgPassResetByAdmin', { логин: login });
  for (const ownerId of owners) {
    try {
      const chat = await telegramChat(deps.db, ownerId);
      if (!chat) continue;
      await sendNow(
        deps,
        chat.chatId,
        withOrganization(text, orgName, chat.shared),
        'password_reset_owner',
        {},
        { userId: ownerId, kind: 'pass_reset' },
      );
    } catch (err) {
      deps.logger.warn({ err, ownerId }, 'сброс пароля администратором: владелец не оповещён');
    }
  }
}
