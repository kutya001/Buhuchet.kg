import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { verifyAgainstDummy, verifyPassword } from '@buhuchet/adapters/password';
import {
  clearLoginAttempts,
  findLogin,
  notifyAccountLocked,
  recordLoginFailure,
  reserveLoginAttempt,
  type LoginRecord,
} from '@buhuchet/db';
import {
  ACCOUNT_LOCK_FAILURES,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  loginDenial,
  normalizeLogin,
} from '@buhuchet/domain';
import { AdminCodeRequiredResponse, ApiError, LoginRequest, MeResponse } from '@buhuchet/shared';
import { denialError, lockedError } from '../../auth-errors';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { botText } from '../telegram/bot';
import { ADMIN_CODE_SENT_DESCRIPTION, adminSecondFactorOn, startAdminCode } from './admin-code';
import { AUTH_IP_LIMITED_DESCRIPTION, authIpLimited } from './ip-limit';
import { openSession } from './open-session';

const error = { 'application/json': { schema: ApiError } };

export const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Вход по логину и паролю',
  request: { body: { required: true, content: { 'application/json': { schema: LoginRequest } } } },
  responses: {
    200: {
      description: 'Вошёл: cookie сеанса выставлена',
      content: { 'application/json': { schema: MeResponse } },
    },
    202: {
      description: ADMIN_CODE_SENT_DESCRIPTION,
      content: { 'application/json': { schema: AdminCodeRequiredResponse } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    401: {
      description: 'Неверный логин или пароль: одно сообщение для любого логина',
      content: error,
    },
    403: {
      description: `Пароль верный, но сотрудник, учётная запись или организация заблокированы, или вход закрыт после ${ACCOUNT_LOCK_FAILURES} неверных паролей подряд (\`account_locked\`), или у администратора платформы не привязан Telegram (\`telegram_required\`, в details — ссылка привязки)`,
      content: error,
    },
    429: {
      description: `После ${LOGIN_MAX_FAILURES} неверных паролей подряд вход по этому логину закрыт на ${LOGIN_LOCK_MINUTES} минут, есть такой логин или нет; или ${AUTH_IP_LIMITED_DESCRIPTION}; или у администратора платформы слишком много кодов для входа (\`admin_code_limited\`)`,
      content: error,
    },
    503: {
      description:
        'Очередь проверки паролей переполнена (`server_busy`); администратору платформы — бот не подключён (`telegram_unavailable`) или не отправил код (`telegram_send_failed`)',
      content: error,
    },
  },
});

/** Одно сообщение для неизвестного логина и неверного пароля (docs/deviations.md, п. 4, решение Б). */
export const INVALID_CREDENTIALS_MESSAGE = 'Неверный логин или пароль';

/**
 * Вход (прототип core/login.js). Сначала — попытка с адреса (предел по адресу, п. О-12), затем попытка
 * по набранному логину, обе до проверки пароля, есть такой логин или нет: на пятой неверной подряд
 * вход по этому логину закрывается на 15 минут. Неизвестный логин и неверный пароль — одно сообщение
 * и одно время ответа (пароль неизвестного логина сверяется с подставным хешем). Неверный пароль
 * настоящей учётной записи идёт и в её счёт: на десятом подряд вход в неё закрыт, пока не выдадут
 * новый пароль (п. О-11). О блокировке сотрудника, учётной записи, организации и о закрытом входе
 * сообщается только после верного пароля. Верный пароль снимает счёт неверных.
 */
// docs/deviations.md п. 4, решение Б (с v59 так же в ТЗ и прототипе core/login.js): одно «Неверный
// логин или пароль», о блокировке — только после верного пароля.
export function loginHandler(deps: ApiDeps): RouteHandler<typeof loginRoute, AppEnv> {
  return async (c) => {
    const { login: typed, password } = c.req.valid('json');
    const ipLimited = await authIpLimited(c, deps);
    if (ipLimited) return c.json(ipLimited, 429);
    const login = normalizeLogin(typed);
    // Попытка занимается до проверки пароля: одновременные запросы не проверят больше пяти паролей.
    const attempt = await reserveLoginAttempt(deps.db, login);
    if (!attempt.allowed) return c.json(lockedError(c, attempt.lockedUntil), 429);
    const account = await findLogin(deps.db, login);
    const valid = account
      ? await verifyPassword(account.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!account || !valid) {
      // Счёт учётной записи, на десятом подряд вход закрыт.
      // Неизвестный логин — тот же запрос к базе впустую, чтобы время ответа почти не отличалось.
      if (await recordLoginFailure(deps.db, account?.userId ?? null)) {
        await announceAccountLocked(deps, account!);
      }
      if (attempt.locked) return c.json(lockedError(c, attempt.lockedUntil), 429);
      return c.json(apiError('invalid_credentials', INVALID_CREDENTIALS_MESSAGE), 401);
    }
    await clearLoginAttempts(deps.db, login);
    const denial = loginDenial(account);
    if (denial) return c.json(denialError(denial, account), 403);
    // Администратору платформы сеанс только после кода из Telegram.
    if (account.isPlatformAdmin && adminSecondFactorOn(deps)) {
      return startAdminCode(c, deps, account);
    }
    const me = await openSession(c, deps, account);
    if (me) return c.json(me, 200);
    // Вход закрыли, пока проверялся пароль («Это не я» из Telegram или десятый неверный пароль):
    // сеанса нет, ответ — как у закрытого входа, причина — по свежей записи.
    const closed = (await findLogin(deps.db, login)) ?? account;
    return c.json(denialError(loginDenial(closed) ?? 'account_locked', closed), 403);
  };
}

/**
 * Вход только что закрыт после ACCOUNT_LOCK_FAILURES неверных паролей: запись в историю и сообщения в
 * очередь Telegram — самому пользователю и тем, кто снимает блокировку (владельцу о сотруднике,
 * администраторам платформы о владельце). Сбой здесь не меняет ответ на попытку входа: блокировка
 * уже стоит, ошибка — в журнал сервера.
 */
async function announceAccountLocked(deps: ApiDeps, account: LoginRecord): Promise<void> {
  deps.logger.warn(
    { userId: account.userId, failures: ACCOUNT_LOCK_FAILURES },
    'вход закрыт после неверных паролей подряд',
  );
  try {
    const values = {
      логин: account.login,
      попыток: ACCOUNT_LOCK_FAILURES,
      организация: account.orgName ?? '',
      кто: account.isOwner ? 'администратор платформы' : 'владелец организации',
    };
    await notifyAccountLocked(deps.db, {
      userId: account.userId,
      userText: deps.telegram ? await botText(deps, 'tgLoginLocked', values) : null,
      unlockerText: deps.telegram
        ? await botText(deps, account.isOwner ? 'tgLoginLockedOwner' : 'tgLoginLockedStaff', values)
        : null,
      now: deps.clock.now(),
    });
  } catch (err) {
    deps.logger.error({ err, userId: account.userId }, 'вход закрыт: сообщения не поставлены');
  }
}
