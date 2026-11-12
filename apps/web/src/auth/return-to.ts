import { RETURN_PARAM, safeReturnPath } from '@buhuchet/domain';

/*
 * Возврат на страницу программы после входа (задача #165, ТЗ «Лендинг» → «Кто что видит по адресу»):
 * гость открыл прямую ссылку (например, на отчёт из сообщения Telegram) — страница входа, а после входа —
 * та самая страница. Адрес несёт параметр `next` страницы входа; принимается только путь программы
 * (`safeReturnPath`), чужой адрес — нет.
 */

/**
 * Заголовок запроса с путём страницы программы: его ставит `proxy.ts` (значение от браузера
 * заменяется), читает `requireMe`, когда сеанс уже закрыт, а cookie ещё есть.
 */
export const RETURN_HEADER = 'x-bh-return';

/** Cookie сеанса: по https — с приставкой `__Host-` (packages/api/src/middleware/cookie.ts). */
export const SESSION_COOKIES = ['__Host-bh_session', 'bh_session'] as const;

/** Адрес страницы входа с возвратом; `/app` и чужой адрес — без параметра (после входа и так /app). */
export function loginHref(back: string | null | undefined): string {
  const path = safeReturnPath(back);
  return path && path !== '/app' ? `/login?${RETURN_PARAM}=${encodeURIComponent(path)}` : '/login';
}

/** Куда вести после входа: адрес из параметра `next`, если это страница программы, иначе /app. */
export function afterLogin(next: string | string[] | null | undefined): string {
  return safeReturnPath(typeof next === 'string' ? next : null) ?? '/app';
}

/** Ссылка на карточку в адресе: `#accounts/<логин>`, `#orgs/<адрес>` — имя раздела и значение. */
const CARD_HASH = /^#[a-z]+\/[^#\s]+$/;

/**
 * Адрес после входа вместе со ссылкой на карточку. По ссылке `…#accounts/<логин>` пришёл не вошедший
 * пользователь: браузер сохранил её в адресе страницы входа, после входа карточка открывается
 * (прототип admin/admin-cards.js, `ACARD.pend`). Другой текст после «#» не переносится.
 */
export function withCardHash(returnTo: string, hash: string): string {
  return CARD_HASH.test(hash) && !returnTo.includes('#') ? `${returnTo}${hash}` : returnTo;
}
