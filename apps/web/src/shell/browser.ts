import {
  NAV_COOKIE,
  prefCookie,
  THEME_COOKIE,
  TREE_COOKIE,
  serializeTree,
  type Theme,
} from './prefs';

/** Ширина телефона (ТЗ: граница ПК и телефона — 768 px). */
export const PHONE_QUERY = '(max-width: 767px)';

function savePref(name: string, value: string) {
  document.cookie = prefCookie(name, value, window.location.protocol === 'https:');
}

/** Тема сейчас: выбранная или (без выбора) тема устройства. */
function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Переключить тему на противоположную и запомнить выбор на этом устройстве. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  savePref(THEME_COOKIE, next);
  return next;
}

export function saveNavHidden(hidden: boolean) {
  savePref(NAV_COOKIE, hidden ? 'hidden' : 'shown');
}

export function saveTree(ids: Iterable<string>) {
  savePref(TREE_COOKIE, serializeTree(ids));
}
