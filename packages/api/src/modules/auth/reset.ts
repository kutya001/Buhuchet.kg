import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '@buhuchet/adapters/password';
import { newResetCode } from '@buhuchet/adapters/tokens';
import {
  completePasswordReset,
  findLogin,
  isOrgOwner,
  requestPasswordReset,
  reservePasswordResetAttempt,
  telegramChat,
  withOrgContext,
  withUserContext,
  writeHistory,
  type Tx,
} from '@buhuchet/db';
import {
  loginDenial,
  normalizeLogin,
  RESET_CODE_MAX_PER_HOUR,
  RESET_CODE_TTL_MINUTES,
  telegramName,
  withOrganization,
} from '@buhuchet/domain';
import {
  ApiError,
  OkResponse,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  PasswordResetSentResponse,
} from '@buhuchet/shared';
import { bishkekTime, denialError } from '../../auth-errors';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { botText, notifyPasswordChanged, sendNow } from '../telegram/bot';

const error = { 'application/json': { schema: ApiError } };

/** Кто сбросит пароль, если Telegram не привязан (прототип core/login.js). */
function notLinkedError(resetByAdmin: boolean) {
  return apiError(
    'telegram_not_linked',
    resetByAdmin
      ? 'Telegram не привязан. Пароль сбросит администратор платформы.'
      : 'Telegram не привязан. Пароль сбросит владелец организации.',
  );
}

export const resetRequestRoute = createRoute({
  method: 'post',
  path: '/auth/password-reset',
  tags: ['auth'],
  summary: '«Забыли пароль?»: код в привязанный Telegram',
  request: {
    body: { required: true, content: { 'application/json': { schema: PasswordResetRequest } } },
  },
  responses: {
    200: {
      description: `Код отправлен, действует ${RESET_CODE_TTL_MINUTES} минут`,
      content: { 'application/json': { schema: PasswordResetSentResponse } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    403: { description: 'Учётная запись или организация заблокирована', content: error },
    404: { description: 'Нет такого логина', content: error },
    409: { description: 'Telegram не привязан: пароль сбросит владелец', content: error },
    429: { description: `Больше ${RESET_CODE_MAX_PER_HOUR} кодов за час`, content: error },
    502: { description: 'Telegram не принял сообщение', content: error },
    503: { description: 'Telegram-бот не подключён', content: error },
  },
});

/**
 * Шаг 1 «Забыли пароль?» (ТЗ «Восстановление пароля через Telegram», прототип core/login.js): логин →
 * одноразовый код из 6 цифр в привязанный Telegram, сразу, мимо очереди; действует 10 минут, не
 * больше 3 кодов в час на логин, прежний код перестаёт действовать. В базе — хеш кода.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#4 — «Нет такого логина», «Telegram не привязан» и имя Telegram в
// ответе, как в прототипе, пока заказчик не выбрал вариант.
export function resetRequestHandler(deps: ApiDeps): RouteHandler<typeof resetRequestRoute, AppEnv> {
  return async (c) => {
    const account = await findLogin(deps.db, normalizeLogin(c.req.valid('json').login));
    if (!account) return c.json(apiError('unknown_login', 'Нет такого логина'), 404);
    const denial = loginDenial(account);
    if (denial) return c.json(denialError(denial, account), 403);
    const notLinked = async () =>
      c.json(
        notLinkedError(account.isPlatformAdmin || (await isOrgOwner(deps.db, account.userId))),
        409,
      );
    if (!(await telegramChat(deps.db, account.userId))) return notLinked();
    if (!deps.telegram) {
      return c.json(
        apiError('telegram_unavailable', 'Telegram-бот пока не подключён к платформе'),
        503,
      );
    }

    const code = newResetCode();
    const request = await requestPasswordReset(deps.db, {
      userId: account.userId,
      codeHash: await hashPassword(code),
    });
    if (request.status === 'limited') {
      const seconds = Math.max(1, Math.ceil((request.retryAt.getTime() - Date.now()) / 1000));
      c.header('retry-after', String(seconds));
      return c.json(
        apiError(
          'reset_limited',
          `Код уже запрашивали ${RESET_CODE_MAX_PER_HOUR} раза за час. Запросите новый после ${bishkekTime(request.retryAt)}.`,
          { retryAt: request.retryAt.toISOString() },
        ),
        429,
      );
    }
    if (request.status !== 'sent') return notLinked();

    const text = withOrganization(
      await botText(deps, 'tgCode', { код: code }),
      account.orgName,
      request.chat.shared,
    );
    if (!(await sendNow(deps, request.chat.chatId, text, 'reset_code'))) {
      return c.json(
        apiError(
          'telegram_send_failed',
          'Не удалось отправить код в Telegram. Откройте бота, нажмите «Запустить» и запросите код снова.',
        ),
        502,
      );
    }
    return c.json(
      { telegram: telegramName(request.chat), expiresAt: request.expiresAt.toISOString() },
      200,
    );
  };
}

export const resetConfirmRoute = createRoute({
  method: 'post',
  path: '/auth/password-reset/confirm',
  tags: ['auth'],
  summary: '«Забыли пароль?»: код из Telegram и новый пароль',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: PasswordResetConfirmRequest } },
    },
  },
  responses: {
    200: {
      description: 'Пароль изменён, все прежние сеансы завершены; войти нужно новым паролем',
      content: { 'application/json': { schema: OkResponse } },
    },
    400: { description: 'Код неверный или истёк, или новый пароль не подходит', content: error },
    403: { description: 'Учётная запись или организация заблокирована', content: error },
  },
});

/**
 * Шаг 2 «Забыли пароль?»: верный код → новый пароль, все прежние сеансы завершаются, блокировка
 * входа после неверных паролей снимается, бот сообщает о смене пароля. Ввод кода занимается до его
 * проверки (не больше 5 на код), неверный, истёкший и чужой код — одно сообщение «Код неверный или
 * истёк» (прототип core/login.js). Войти нужно новым паролем: сеанс здесь не создаётся.
 */
export function resetConfirmHandler(deps: ApiDeps): RouteHandler<typeof resetConfirmRoute, AppEnv> {
  return async (c) => {
    const { login, code, newPassword } = c.req.valid('json');
    const invalid = () => c.json(apiError('reset_code_invalid', 'Код неверный или истёк'), 400);
    const account = await findLogin(deps.db, normalizeLogin(login));
    if (!account) {
      await verifyAgainstDummy(code);
      return invalid();
    }
    const denial = loginDenial(account);
    if (denial) return c.json(denialError(denial, account), 403);
    const attempt = await reservePasswordResetAttempt(deps.db, account.userId);
    if (!attempt) {
      await verifyAgainstDummy(code);
      return invalid();
    }
    if (!(await verifyPassword(attempt.codeHash, code))) return invalid();

    const passwordHash = await hashPassword(newPassword);
    const complete = (tx: Tx) =>
      completePasswordReset(tx, { resetId: attempt.resetId, passwordHash });
    const done = account.orgId
      ? await withOrgContext(
          deps.db,
          { orgId: account.orgId, userId: account.userId },
          async (tx) => {
            if (!(await complete(tx))) return false;
            await writeHistory(tx, {
              entity: 'user',
              entityId: account.userId,
              action: 'update',
              changes: [
                { field: 'passwordHash' },
                ...(account.mustChangePassword
                  ? [{ field: 'mustChangePassword', from: true, to: false }]
                  : []),
              ],
              reason: 'Восстановление пароля кодом из Telegram',
            });
            return true;
          },
        )
      : // История администратора платформы — в Админке (#18); у его записи нет организации.
        await withUserContext(deps.db, account.userId, complete);
    if (!done) return invalid();
    await notifyPasswordChanged(deps, account);
    return c.json({ ok: true as const }, 200);
  };
}
