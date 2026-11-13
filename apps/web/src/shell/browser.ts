import type { MaxPrefs } from '@buhuchet/ui';
import {
  MAX_COOKIE,
  NAV_COOKIE,
  prefCookie,
  THEME_COOKIE,
  TREE_COOKIE,
  WIDE_COOKIE,
  serializeMaxPrefs,
  serializeTree,
  type Theme,
} from './prefs';

/** Ширина телефона (ТЗ: граница ПК и телефона — 768 px). */
export const PHONE_QUERY = '(max-width: 767px)';

function savePref(name: string, value: string) {
  document.cookie = prefCookie(name, value, window.location.protocol === 'https:');
}

/** Тема сейчас: выбранная, без выбора — светлая (от темы устройства не зависит; прототип v88). */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Как меняется тема на экране: волной, плавной сменой цветов или сразу. */
export type ThemeChange = 'wave' | 'fade' | 'instant';

/** Способ смены темы: «Уменьшить движение» — сразу; без View Transitions — плавная смена цветов. */
export function themeChangeKind(reducedMotion: boolean, viewTransitions: boolean): ThemeChange {
  if (reducedMotion) return 'instant';
  return viewTransitions ? 'wave' : 'fade';
}

/** С какой стороны экрана идёт волна: с той, где нажатая кнопка (без кнопки — справа). */
export function waveSide(
  button: { left: number; width: number } | null,
  viewportWidth: number,
): 'l' | 'r' {
  if (!button || button.width <= 0) return 'r';
  return button.left + button.width / 2 < viewportWidth / 2 ? 'l' : 'r';
}

const FADE_MS = 450;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
let waveRun = 0;

/**
 * Смена темы на экране волной от нажатой кнопки (прототип v88, `setTheme` в ui/shell.js; стили —
 * packages/ui/src/theme.css): `apply` меняет атрибут темы, браузер накатывает новый вид маской.
 */
function themeWave(apply: () => void, from: Element | null | undefined): void {
  const root = document.documentElement;
  const kind = themeChangeKind(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    typeof document.startViewTransition === 'function',
  );
  if (kind === 'instant') return apply();
  if (kind === 'fade') {
    root.classList.add('bu-theme-fade');
    apply();
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove('bu-theme-fade'), FADE_MS);
    return;
  }
  root.dataset.wave = waveSide(from?.getBoundingClientRect() ?? null, window.innerWidth);
  const run = ++waveRun;
  const done = () => {
    if (run === waveRun) delete root.dataset.wave;
  };
  document.startViewTransition(apply).finished.then(done, done);
}

/**
 * Выбрать тему и запомнить выбор на этом устройстве (кнопка темы, «Мой профиль» → «Личные
 * настройки», кнопка на лендинге). `from` — нажатая кнопка: волна идёт с её стороны экрана.
 */
export function setTheme(theme: Theme, from?: Element | null): void {
  const changed = currentTheme() !== theme;
  const apply = () => {
    document.documentElement.dataset.theme = theme;
  };
  savePref(THEME_COOKIE, theme);
  if (changed) themeWave(apply, from);
  else apply();
}

/** Переключить тему на противоположную и запомнить выбор на этом устройстве. */
export function toggleTheme(from?: Element | null): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next, from);
  return next;
}

export function saveNavHidden(hidden: boolean) {
  savePref(NAV_COOKIE, hidden ? 'hidden' : 'shown');
}

export function saveWide(wide: boolean) {
  savePref(WIDE_COOKIE, wide ? 'on' : 'off');
}

export function saveTree(ids: Iterable<string>) {
  savePref(TREE_COOKIE, serializeTree(ids));
}

export function saveMaxPrefs(prefs: MaxPrefs) {
  savePref(MAX_COOKIE, serializeMaxPrefs(prefs));
}
