import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  hashPassword,
  PasswordBusyError,
  passwordQueueFull,
  verifyAgainstDummy,
  verifyPassword,
} from '@buhuchet/adapters/password';
import { hashSessionToken, newLinkToken, newResetCode } from '@buhuchet/adapters/tokens';
import {
  createTelegramLinkToken,
  findLogin,
  issueAdminCode,
  takeAdminCodeAttempt,
  telegramChat,
  useAdminCode,
  withUserContext,
  type LoginRecord,
} from '@buhuchet/db';
import {
  ADMIN_CODE_MAX_ATTEMPTS,
  ADMIN_CODE_MAX_DAILY,
  ADMIN_CODE_TTL_MINUTES,
  ADMIN_CODE_WINDOW_MINUTES,
  loginDenial,
} from '@buhuchet/domain';
import { AdminCodeRequest, ApiError, MeResponse } from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { botText, sendNow } from '../telegram/bot';
import { AUTH_IP_LIMITED_DESCRIPTION, authIpLimited } from './ip-limit';
import { openSession } from './open-session';

/*
 * Код из Telegram при входе администратора платформы (ревью безопасности 06.11.2026, п. Р-2, решение
 * заказчика 07.11.2026 «А»): администратор видит все организации, и одного украденного пароля не
 * должно хватать. После верного пароля бот присылает 6 цифр (5 минут, 5 вводов), сеанс начинается
 * только после кода. Без привязанного Telegram — ссылка привязки вместо сеанса: сначала Telegram,
 * потом вход с кодом.
 */

const error = { 'application/json': { schema: ApiError } };

/** Нужен ли код: не задано в deps — только на стенде и рабочем сайте (п. О-13). */
export function adminSecondFactorOn(deps: ApiDeps): boolean {
  if (deps.adminSecondFactor !== undefined) return deps.adminSecondFactor;
  return deps.config.APP_ENV === 'staging' || deps.config.APP_ENV === 'production';
}

/** Описание ответа 202 входа — для `createRoute` входа. */
export const ADMIN_CODE_SENT_DESCRIPTION = `Администратор платформы: пароль верный, бот прислал код в Telegram (${ADMIN_CODE_TTL_MINUTES} минут, ${ADMIN_CODE_MAX_ATTEMPTS} вводов); сеанс — после \`POST /auth/login/code\``;

/**
 * Ответы шага кода — тексты те же, что в словаре (`err.*`); экран показывает текст словаря.
 */
export const ADMIN_CODE_ERRORS = {
  /** Бот не подключён к платформе: без кода в Админку не войти. */
  botUnavailable: () =>
    apiError(
      'telegram_unavailable',
      'Telegram-бот не подключён: вход в Админку невозможен без кода из Telegram.',
      { variant: 'admin' },
    ),
  /** Telegram не привязан: ссылка привязки вместо сеанса. */
  telegramRequired: (url: string, expiresAt: Date) =>
    apiError(
      'telegram_required',
      'Для входа в Админку нужен Telegram: откройте ссылку, нажмите «Старт» в боте и войдите снова.',
      { url, expiresAt: expiresAt.toISOString() },
    ),
  limited: () =>
    apiError(
      'admin_code_limited',
      `Слишком много кодов для входа. Попробуйте через ${ADMIN_CODE_WINDOW_MINUTES} минут.`,
      { minutes: ADMIN_CODE_WINDOW_MINUTES },
    ),
  limitedDay: () =>
    apiError(
      'admin_code_limited',
      'Слишком много кодов для входа за сутки. Если вы не входили, кто-то знает ваш пароль: смените его кнопкой «Забыли пароль?» — вход откроется.',
      { variant: 'day', max: ADMIN_CODE_MAX_DAILY },
    ),
  sendFailed: () =>
    apiError(
      'telegram_send_failed',
      'Не удалось отправить код в Telegram. Попробуйте войти ещё раз через минуту.',
    ),
  /** Одно сообщение на неверный, истёкший, использованный и чужой код. */
  invalid: () =>
    apiError(
      'admin_code_invalid',
      `Код неверный или истёк. После ${ADMIN_CODE_MAX_ATTEMPTS} неверных кодов войдите заново.`,
      { attempts: ADMIN_CODE_MAX_ATTEMPTS },
    ),
};

/**
 * Пароль администратора платформы верный: код в Telegram (202), или ссылка привязки Telegram (403
 * `telegram_required`), или «кодов слишком много» (429), или бот не подключён / не отправил (503).
 * Хеш кода считается до проверки пределов: сюда доходит только верный пароль, а попытки входа с
 * адреса и так ограничены (п. О-12).
 */
export async function startAdminCode(c: Context<AppEnv>, deps: ApiDeps, account: LoginRecord) {
  const bot = deps.config.TELEGRAM_BOT_USERNAME;
  if (!deps.telegram || !bot) return c.json(ADMIN_CODE_ERRORS.botUnavailable(), 503);
  const chat = await telegramChat(deps.db, account.userId);
  if (!chat) {
    // Привязать Telegram без сеанса: ссылка выдаётся только тому, кто ввёл верный пароль.
    const token = newLinkToken();
    const expiresAt = await withUserContext(deps.db, account.userId, (tx) =>
      createTelegramLinkToken(tx, hashSessionToken(token)),
    );
    const url = `https://t.me/${bot}?start=${token}`;
    return c.json(ADMIN_CODE_ERRORS.telegramRequired(url, expiresAt), 403);
  }
  const code = newResetCode();
  const challenge = newLinkToken();
  const issued = await issueAdminCode(deps.db, {
    userId: account.userId,
    tokenHash: hashSessionToken(challenge),
    codeHash: await hashPassword(code),
  });
  if (issued.outcome === 'limited') {
    c.header('retry-after', String(ADMIN_CODE_WINDOW_MINUTES * 60));
    return c.json(ADMIN_CODE_ERRORS.limited(), 429);
  }
  if (issued.outcome === 'limited_day') return c.json(ADMIN_CODE_ERRORS.limitedDay(), 429);
  if (issued.outcome !== 'ok') throw new Error('код входа: учётная запись не администратор');
  const text = await botText(deps, 'tgAdminCode', {
    код: code,
    логин: account.login,
    минут: ADMIN_CODE_TTL_MINUTES,
  });
  // В журнал отправок — без текста кода (docs/deviations.md, п. 12); вид — «Код» (п. О-13).
  const sent = await sendNow(
    deps,
    chat.chatId,
    text,
    'admin_code',
    { timeoutMs: 5000 },
    { userId: account.userId, kind: 'code' },
  );
  if (!sent) return c.json(ADMIN_CODE_ERRORS.sendFailed(), 503);
  return c.json(
    {
      secondFactor: 'telegram' as const,
      challenge,
      expiresAt: issued.expiresAt.toISOString(),
    },
    202,
  );
}

export const adminCodeRoute = createRoute({
  method: 'post',
  path: '/auth/login/code',
  tags: ['auth'],
  summary: 'Вход администратора платформы: код из Telegram',
  request: {
    body: { required: true, content: { 'application/json': { schema: AdminCodeRequest } } },
  },
  responses: {
    200: {
      description: 'Вошёл: cookie сеанса выставлена',
      content: { 'application/json': { schema: MeResponse } },
    },
    400: {
      description: `Неверные данные запроса, или код неверный, истёк, уже использован, введён ${ADMIN_CODE_MAX_ATTEMPTS} раз или пароль сменили после него (\`admin_code_invalid\`)`,
      content: error,
    },
    429: { description: AUTH_IP_LIMITED_DESCRIPTION, content: error },
    503: {
      description:
        'Очередь проверки паролей переполнена (`server_busy`): попытка ввода не тратится',
      content: error,
    },
  },
});

/**
 * Шаг 2 входа администратора: токен шага и код. Попытка ввода занимается до проверки кода (очередь
 * проверки паролей полна — 503 до попытки, она не тратится); код подошёл — он больше не действует,
 * сеанс начинается. Состояние учётной записи проверяется ещё раз: за 5 минут её могли заблокировать.
 */
export function adminCodeHandler(deps: ApiDeps): RouteHandler<typeof adminCodeRoute, AppEnv> {
  return async (c) => {
    const { challenge, code } = c.req.valid('json');
    const ipLimited = await authIpLimited(c, deps);
    if (ipLimited) return c.json(ipLimited, 429);
    if (passwordQueueFull()) throw new PasswordBusyError();
    const attempt = await takeAdminCodeAttempt(deps.db, hashSessionToken(challenge));
    const valid = attempt
      ? await verifyPassword(attempt.codeHash, code)
      : await verifyAgainstDummy(code);
    if (!attempt || !valid) return c.json(ADMIN_CODE_ERRORS.invalid(), 400);
    const account = await findLogin(deps.db, attempt.login);
    if (
      !account ||
      account.userId !== attempt.userId ||
      !account.isPlatformAdmin ||
      loginDenial(account)
    ) {
      return c.json(ADMIN_CODE_ERRORS.invalid(), 400);
    }
    if (!(await useAdminCode(deps.db, attempt.codeId))) {
      return c.json(ADMIN_CODE_ERRORS.invalid(), 400);
    }
    deps.logger.info({ userId: account.userId }, 'вход администратора платформы по коду');
    return c.json(await openSession(c, deps, account), 200);
  };
}
