import type { MenuModuleId } from '@buhuchet/domain';

/**
 * Куда ведёт «Перейти» у шага урока (прототип modules/kb-lessons.js, `G(mod, tab, hl, mhl, after)`):
 * модуль и вкладка, что подсветить и что сразу открыть. Шаг виден, только когда он есть в
 * `KB_STEP_RULES` (`@buhuchet/domain`); задача модуля, слитая позже, добавляет сюда свой шаг вместе с
 * ним (docs/decisions.md п. Г-2).
 */
export interface KbTarget {
  /** Модуль и вкладка; null — остаться на текущем экране (Telegram, поиск). */
  module: MenuModuleId | null;
  tab?: string;
  /** Что подсветить на ПК и, если другое, на телефоне (первый видимый элемент). */
  flash: string;
  phoneFlash?: string;
  /** Сразу открыть: «+ Добавить» модуля этим способом или «Мой профиль». */
  open?: { add: string } | 'profile';
}

/** Строки списка: таблица на ПК и карточки на телефоне. */
const LIST = '[data-grid-scroll], [data-grid-cards]';

export const KB_GO: Readonly<Record<string, KbTarget>> = {
  profile: { module: 'org', tab: 'main', flash: 'main section' },
  policy: { module: 'org', tab: 'policy', flash: 'main section' },
  remind: { module: 'org', tab: 'policy', flash: '[data-remind-days]' },
  settings: { module: 'org', tab: 'settings', flash: 'main [type=submit]' },
  tg: { module: null, flash: '[data-profile-telegram]', open: 'profile' },
  types: { module: 'dicts', tab: 'types', flash: LIST },
  typecfg: { module: 'dicts', tab: 'types', flash: LIST },
  pdicts: { module: 'dicts', tab: 'platform', flash: 'main' },
  roles: { module: 'staff', tab: 'roles', flash: 'main' },
  emps: { module: 'staff', tab: 'list', flash: LIST, open: { add: 'employee' } },
  empcard: { module: 'staff', tab: 'list', flash: LIST },
  search: { module: null, flash: '[role=search]', phoneFlash: '[data-search-open]' },
  // Пока нет «Контрагентов» — на списке «Видов отчётов»: он виден всем.
  cols: { module: 'dicts', tab: 'types', flash: '[data-grid-columns-button]' },
  grp: { module: 'dicts', tab: 'types', flash: '[data-grid-group-button]' },
  xls: { module: 'dicts', tab: 'types', flash: '[data-grid-export]' },
  swipe: { module: 'dicts', tab: 'types', flash: '[data-tabrow]' },
};

/** Сколько ждать, пока нужный элемент появится на экране после перехода, мс. */
const FLASH_WAIT_MS = 2500;
/** Сколько держится подсветка (две вспышки по 1,3 с), мс. */
const FLASH_MS = 2800;

/**
 * Подсветить место шага (прототип ckFlash): первый видимый элемент по селектору прокручивается в
 * середину экрана и дважды вспыхивает рамкой. Экран после перехода может ещё грузиться — элемент
 * ищется до 2,5 секунд. `onFlash` — элемент найден и подсвечен.
 */
export function flashTarget(selector: string, onFlash?: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Date.now();
  const find = () => {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (x) => x.getClientRects().length > 0,
    );
    if (!el) {
      if (Date.now() - started < FLASH_WAIT_MS) timer = setTimeout(find, 150);
      return;
    }
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    el.removeAttribute('data-ck-flash');
    void el.offsetWidth;
    el.setAttribute('data-ck-flash', '');
    onFlash?.();
    timer = setTimeout(() => el.removeAttribute('data-ck-flash'), FLASH_MS);
  };
  timer = setTimeout(find, 380);
  return () => clearTimeout(timer);
}
