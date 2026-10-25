import { isSessionTokenShape } from '@buhuchet/adapters/tokens';
import { SESSION_TTL_DAYS } from '@buhuchet/domain';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ApiDeps } from '../deps';

/**
 * Cookie сеанса (ТЗ «Вход и сеансы — свои»): HttpOnly, Secure, SameSite=Lax. На стенде и рабочем
 * сайте — с приставкой `__Host-` (только https, только наш адрес, без поддоменов). Локально и в
 * сквозных тестах сайт работает по http, там cookie без Secure.
 */
function cookieOptions(deps: ApiDeps) {
  const secure = deps.config.APP_ENV === 'staging' || deps.config.APP_ENV === 'production';
  return { name: secure ? '__Host-bh_session' : 'bh_session', secure };
}

export function sessionCookieName(deps: ApiDeps): string {
  return cookieOptions(deps).name;
}

/** Токен из cookie; мусор вместо токена — как будто cookie нет. */
export function readSessionToken(c: Context, deps: ApiDeps): string | null {
  const value = getCookie(c, cookieOptions(deps).name);
  return value && isSessionTokenShape(value) ? value : null;
}

export function writeSessionCookie(c: Context, deps: ApiDeps, token: string): void {
  const { name, secure } = cookieOptions(deps);
  setCookie(c, name, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: Context, deps: ApiDeps): void {
  const { name, secure } = cookieOptions(deps);
  if (getCookie(c, name) !== undefined) deleteCookie(c, name, { path: '/', secure });
}
