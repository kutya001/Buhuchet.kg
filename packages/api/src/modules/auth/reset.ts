import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword, verifyPassword } from '@buhuchet/adapters/password';
import { newResetCode } from '@buhuchet/adapters/tokens';
import {
  completePasswordReset,
  findLogin,
  passwordResetStatus,
  requestPasswordReset,
  reservePasswordResetAttempt,
  withOrgContext,
  withUserContext,
  writeHistory,
  type LoginRecord,
  type Tx,
} from '@buhuchet/db';
import {
  loginDenial,
  normalizeLogin,
  RESET_CODE_MAX_DAILY_FAILURES,
  RESET_CODE_MAX_PER_HOUR,
  RESET_CODE_TTL_MINUTES,
  withOrganization,
} from '@buhuchet/domain';
import {
  ApiError,
  OkResponse,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  PasswordResetRequestedResponse,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { botText, notifyPasswordChanged, sendNow } from '../telegram/bot';

const error = { 'application/json': { schema: ApiError } };

/**
 * Не быстрее скольких миллисекунд отвечают оба шага «Забыли пароль?»: код считается и уходит в
 * Telegram только для настоящего логина с привязкой, и без выравнивания по времени ответа было бы
 * видно, есть ли логин (docs/deviations.md, п. 4). Отправка в Telegram обычно занимает меньше секунды.
 */
export const RESET_RESPONSE_FLOOR_MS = 1500;

/** Ответ не раньше, чем через floorMs после начала запроса. */
async function atLeast<T>(floorMs: number, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await fn();
  const rest = floorMs - (Date.now() - started);
  if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
  return result;
}

/** Один ответ для любого логина (docs/deviations.md, п. 4, решение Б). */
export const RESET_REQUESTED_MESSAGE =
  'Если к логину привязан Telegram, бот пришлёт код. Если код не пришёл, пароль сбросит владелец организации, а владельцу — администратор платформы.';

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
      description: `Один ответ для любого логина. Код из ${RESET_CODE_TTL_MINUTES} минут уходит, только если логин есть, не заблокирован, Telegram привязан и за час было меньше ${RESET_CODE_MAX_PER_HOUR} кодов, а за сутки — меньше ${RESET_CODE_MAX_DAILY_FAILURES} неверных`,
      content: { 'application/json': { schema: PasswordResetRequestedResponse } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    503: { description: 'Telegram-бот не подключён', content: error },
  },
});

/**
 * Шаг 1 «Забыли пароль?» (ТЗ «Восстановление пароля через Telegram», прототип core/login.js): логин →
 * одноразовый код из 6 цифр в привязанный Telegram, сразу, мимо очереди; действует 10 минут, не
 * больше 3 кодов в час на логин, прежний код перестаёт действовать. После 10 неверных кодов за сутки
 * восстановление через Telegram закрыто до конца суток. В базе — хеш кода; лимиты проверяются до
 * того, как его считать, чтобы запросы сверх лимита не нагружали сервер.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#4 — решение Б: в прототипе «Нет такого логина», «Telegram не
// привязан…» и «Код отправлен в Telegram @имя»; здесь для любого логина один ответ без имени Telegram.
export function resetRequestHandler(deps: ApiDeps): RouteHandler<typeof resetRequestRoute, AppEnv> {
  return async (c) => {
    if (!deps.telegram) {
      return c.json(
        apiError('telegram_unavailable', 'Telegram-бот пока не подключён к платформе'),
        503,
      );
    }
    const { login } = c.req.valid('json');
    await atLeast(deps.resetResponseFloorMs ?? RESET_RESPONSE_FLOOR_MS, async () => {
      const account = await findLogin(deps.db, normalizeLogin(login));
      if (account && !loginDenial(account)) await sendResetCode(deps, account);
    });
    return c.json({ message: RESET_REQUESTED_MESSAGE }, 200);
  };
}

/** Код в Telegram, если лимиты позволяют; ошибка Telegram пишется в журнал (sendNow). */
async function sendResetCode(deps: ApiDeps, account: LoginRecord): Promise<void> {
  if ((await passwordResetStatus(deps.db, account.userId)).status !== 'ok') return;
  const code = newResetCode();
  // Лимиты проверяются ещё раз под блокировкой: одновременные запросы не превысят их.
  const request = await requestPasswordReset(deps.db, {
    userId: account.userId,
    codeHash: await hashPassword(code),
  });
  if (request.status !== 'sent') return;
  const text = withOrganization(
    await botText(deps, 'tgCode', { код: code }),
    account.orgName,
    request.chat.shared,
  );
  await sendNow(deps, request.chat.chatId, text, 'reset_code');
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
  },
});

/**
 * Шаг 2 «Забыли пароль?»: верный код → новый пароль, все прежние сеансы завершаются, блокировка
 * входа после неверных паролей снимается, бот сообщает о смене пароля. Ввод кода занимается до его
 * проверки (не больше 5 на код и 10 неверных за сутки). Неверный, истёкший и чужой код, неизвестный
 * и заблокированный логин — одно сообщение «Код неверный или истёк» (прототип core/login.js;
 * docs/deviations.md, п. 4, решение Б) и одно время ответа. Войти нужно новым паролем: сеанс здесь не
 * создаётся.
 */
export function resetConfirmHandler(deps: ApiDeps): RouteHandler<typeof resetConfirmRoute, AppEnv> {
  return async (c) => {
    const { login, code, newPassword } = c.req.valid('json');
    const changed = await atLeast(deps.resetResponseFloorMs ?? RESET_RESPONSE_FLOOR_MS, () =>
      confirmReset(deps, normalizeLogin(login), code, newPassword),
    );
    if (!changed) return c.json(apiError('reset_code_invalid', 'Код неверный или истёк'), 400);
    return c.json({ ok: true as const }, 200);
  };
}

async function confirmReset(
  deps: ApiDeps,
  login: string,
  code: string,
  newPassword: string,
): Promise<boolean> {
  const account = await findLogin(deps.db, login);
  if (!account || loginDenial(account)) return false;
  const attempt = await reservePasswordResetAttempt(deps.db, account.userId);
  if (!attempt || !(await verifyPassword(attempt.codeHash, code))) return false;

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
  if (done) await notifyPasswordChanged(deps, account);
  return done;
}
