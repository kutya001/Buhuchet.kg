import { NextResponse, type NextRequest } from 'next/server';
import { loginHref, RETURN_HEADER, SESSION_COOKIES } from './src/auth/return-to';

/*
 * Страницы программы /app/… (задача #165, ТЗ «Лендинг» → «Кто что видит по адресу»): гость без cookie
 * сеанса сразу уходит на страницу входа с адресом возврата, а после входа попадает на ту самую страницу.
 * С cookie путь передаётся макету в заголовке `x-bh-return`: если сеанс уже закрыт, `requireMe` ведёт на
 * вход с тем же возвратом. Сам сеанс здесь не проверяется — это делает API (`/api/auth/me`).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;
  if (!SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    return NextResponse.redirect(new URL(loginHref(path), request.url));
  }
  const headers = new Headers(request.headers);
  headers.set(RETURN_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/app', '/app/:path*'] };
