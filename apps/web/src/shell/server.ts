import 'server-only';
import { MeResponse } from '@buhuchet/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { localApi } from '../server-api';

/**
 * «Кто я» для первого показа страницы за входом — методом `/api/auth/me` через API в том же процессе,
 * с cookie сеанса из запроса браузера. Нет входа, сеанс закрыт или учётная запись заблокирована —
 * null. За один показ читается один раз.
 *
 * Продление сеанса этим запросом в браузер не попадает (серверный компонент не меняет cookie); cookie
 * продлевают запросы самой страницы к API — сеанс живёт 30 дней, а продлевается не чаще раза в час.
 */
export const loadMe = cache(async (): Promise<MeResponse | null> => {
  const cookie = (await headers()).get('cookie');
  if (!cookie) return null;
  const res = await localApi.api.auth.me.$get(undefined, { headers: { cookie } });
  if (res.status === 200) return MeResponse.parse(await res.json());
  if (res.status === 401 || res.status === 403) return null;
  // Других ответов у метода нет; на всякий случай (500) — ошибка страницы.
  throw new Error(`GET /api/auth/me: ${(res as Response).status}`);
});

/** Можно ли работать на страницах за входом: вошёл, сменил временный пароль, есть модули. */
export function canEnter(me: MeResponse | null): me is MeResponse {
  return !!me && !me.user.mustChangePassword && me.modules.length > 0;
}

/** Вошедший пользователь для страниц за входом; иначе — на страницу входа. */
export async function requireMe(): Promise<MeResponse> {
  const me = await loadMe();
  if (!canEnter(me)) redirect('/login');
  return me;
}
