import { takeRateLimit } from '@buhuchet/db';
import { AUTH_IP_MAX_ATTEMPTS, AUTH_IP_WINDOW_MINUTES } from '@buhuchet/domain';
import type { Context } from 'hono';
import { clientIpSubject } from '../../client-ip';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';

/**
 * Предел попыток входа и восстановления пароля с одного адреса (ревью безопасности 06.11.2026,
 * п. Р-4; docs/deviations.md п. О-12): вход, «Забыли пароль?» и ввод кода считаются вместе, верные и
 * неверные, по любым логинам — не больше AUTH_IP_MAX_ATTEMPTS за AUTH_IP_WINDOW_MINUTES. Попытка
 * занимается до проверки пароля и до поиска логина: ответ сверх предела одинаков для любого логина.
 * Предел по набранному логину (5 неверных — 15 минут) остаётся как был.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-12
export const AUTH_IP_LIMIT = {
  kind: 'auth_ip',
  max: AUTH_IP_MAX_ATTEMPTS,
  windowSeconds: AUTH_IP_WINDOW_MINUTES * 60,
} as const;

/** Описание ответа 429 по адресу — для `createRoute`. */
export const AUTH_IP_LIMITED_DESCRIPTION = `Больше ${AUTH_IP_MAX_ATTEMPTS} попыток входа и восстановления пароля с этого адреса за ${AUTH_IP_WINDOW_MINUTES} минут (\`auth_ip_limited\`)`;

/** Занять попытку с адреса запроса; null — можно, иначе готовый ответ 429. */
export async function authIpLimited(c: Context<AppEnv>, deps: ApiDeps) {
  const deployed = deps.config.APP_ENV === 'staging' || deps.config.APP_ENV === 'production';
  const limit =
    deps.authIpLimit === undefined ? (deployed ? AUTH_IP_LIMIT : null) : deps.authIpLimit;
  if (!limit) return null;
  const take = await takeRateLimit(deps.db, limit, clientIpSubject(c, deps, 'auth'));
  if (take.ok) return null;
  const minutes = Math.ceil(limit.windowSeconds / 60);
  c.header('retry-after', String(limit.windowSeconds));
  return apiError(
    'auth_ip_limited',
    `Слишком много попыток входа с этого адреса. Попробуйте через ${minutes} минут.`,
    { minutes },
  );
}
