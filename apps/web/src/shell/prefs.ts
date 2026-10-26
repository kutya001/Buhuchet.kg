import type { MaxPrefs } from '@buhuchet/ui';

/**
 * Выбор пользователя на этом устройстве: тема, скрытая левая панель, раскрытые ветки дерева модулей,
 * развёрнутые на весь экран карточки и формы (ТЗ: «выбор запоминается», «тема применяется без вспышки
 * при загрузке», «выбор запоминается на этом устройстве отдельно для карточек и для форм ввода»). Хранится в cookie, а не
 * в localStorage: сервер читает её и сразу отдаёт страницу в нужном виде — без вспышки и прыжка
 * панелей. Cookie не HttpOnly (её пишет страница) и без секретов; значения сервер проверяет.
 */
export const THEME_COOKIE = 'bh_theme';
export const NAV_COOKIE = 'bh_nav';
export const TREE_COOKIE = 'bh_tree';
export const MAX_COOKIE = 'bh_max';

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

/** Развёрнутые на весь экран виды окон: `card`, `form` через точку; пусто — оба свёрнуты. */
export function parseMaxPrefs(value: string | undefined): MaxPrefs {
  const kinds = (value ?? '').split('.');
  return { card: kinds.includes('card'), form: kinds.includes('form') };
}

export function serializeMaxPrefs(prefs: MaxPrefs): string {
  return (['card', 'form'] as const).filter((kind) => prefs[kind]).join('.');
}

/** Строка для `document.cookie`: на год, для всего сайта; по https — только по https. */
export function prefCookie(name: string, value: string, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
