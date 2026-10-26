/**
 * Выбор пользователя на этом устройстве: тема, скрытая левая панель, раскрытые ветки дерева модулей
 * (ТЗ: «выбор запоминается», «тема применяется без вспышки при загрузке»). Хранится в cookie, а не
 * в localStorage: сервер читает её и сразу отдаёт страницу в нужном виде — без вспышки и прыжка
 * панелей. Cookie не HttpOnly (её пишет страница) и без секретов; значения сервер проверяет.
 */
export const THEME_COOKIE = 'bh_theme';
export const NAV_COOKIE = 'bh_nav';
export const TREE_COOKIE = 'bh_tree';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export type Theme = 'light' | 'dark';

/** Сохранённая тема; нет выбора — null (тема устройства). */
export function parseTheme(value: string | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

export function parseNavHidden(value: string | undefined): boolean {
  return value === 'hidden';
}

/** Раскрытые ветки: только известные модули, без повторов. */
export function parseTree(value: string | undefined, known: readonly string[]): string[] {
  if (!value) return [];
  return [...new Set(value.split('.'))].filter((id) => known.includes(id));
}

export function serializeTree(ids: Iterable<string>): string {
  return [...ids].join('.');
}

/** Строка для `document.cookie`: на год, для всего сайта; по https — только по https. */
export function prefCookie(name: string, value: string, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
