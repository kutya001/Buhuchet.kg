import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import { newTemporaryPassword } from '@buhuchet/adapters/tokens';
import {
  adminFindUser,
  currentOrganization,
  resetNoticeOwnerIds,
  setTemporaryPassword,
  telegramChat,
  withOrgContext,
  withUserContext,
  writeHistory,
} from '@buhuchet/db';
import { RecordNotFoundError, telegramName, withOrganization } from '@buhuchet/domain';
import { AdminTemporaryPasswordResponse, ApiError, Uuid } from '@buhuchet/shared';
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
      description:
        'Временный пароль (показывается один раз); все сеансы пользователя завершены; кому из владельцев организации бот сообщил о сбросе',
      content: { 'application/json': { schema: AdminTemporaryPasswordResponse } },
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
 * пишется в её историю; если пароль сброшен сотруднику, владельцам организации — сообщение в Telegram,
 * а в ответе — кому и какое (окно «Пароль сброшен» показывает его, как прототип). Пароль другого
 * администратора платформы здесь не сбрасывается.
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
        owners: await resetNoticeOwnerIds(tx, orgId, target.userId),
      };
    });
    const orgName = org.org?.name ?? null;
    const telegramNotified = await notifyPasswordChanged(
      deps,
      { userId: target.userId, login: target.login, orgName },
      'администратор платформы',
    );
    const ownersNotice = await notifyOwners(deps, org.owners, target.login, orgName);
    return c.json({ temporaryPassword, telegramNotified, ownersNotice }, 200);
  };
}

/**
 * Администратор платформы сбросил пароль сотрудника — владельцам организации сообщение в Telegram
 * (ревью безопасности 06.11.2026, п. Р-2; прототип accResetPass): владелец видит, что в его
 * организации кто-то получил временный пароль не от него. Пароль самого владельца — ему же сообщает
 * `notifyPasswordChanged`. Сбой отправки не меняет ответ: пароль уже сброшен, ошибка — в журнал
 * сервера, а владельца нет среди тех, кому сообщили.
 */
async function notifyOwners(
  deps: ApiDeps,
  owners: readonly string[],
  login: string,
  orgName: string | null,
): Promise<AdminTemporaryPasswordResponse['ownersNotice']> {
  if (!deps.telegram || owners.length === 0) return null;
  let text: string;
  try {
    text = await botText(deps, 'tgPassResetByAdmin', { логин: login });
  } catch (err) {
    // Пароль уже сброшен: администратор должен увидеть временный пароль, а не ошибку.
    deps.logger.warn(
      { err },
      'сброс пароля администратором: шаблон сообщения владельцам не прочитан',
    );
    return null;
  }
  const to: string[] = [];
  for (const ownerId of owners) {
    try {
      const chat = await telegramChat(deps.db, ownerId);
      if (!chat) continue;
      const sent = await sendNow(
        deps,
        chat.chatId,
        withOrganization(text, orgName, chat.shared),
        'password_reset_owner',
        {},
        { userId: ownerId, kind: 'pass_reset' },
      );
      if (sent) to.push(telegramName(chat));
    } catch (err) {
      deps.logger.warn({ err, ownerId }, 'сброс пароля администратором: владелец не оповещён');
    }
  }
  return to.length ? { to, text } : null;
}
