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
  /** Нажать подсвеченную кнопку (у блока на экране своё «+ Добавить», не в меню модуля). */
  press?: boolean;
}

/** Строки списка: таблица на ПК и карточки на телефоне. */
const LIST = '[data-grid-scroll], [data-grid-cards]';

export const KB_GO: Readonly<Record<string, KbTarget>> = {
  profile: { module: 'org', tab: 'main', flash: 'main section' },
  accs: { module: 'org', tab: 'main', flash: '[data-org-account-add]', press: true },
  policy: { module: 'org', tab: 'policy', flash: 'main section' },
  remind: { module: 'org', tab: 'policy', flash: '[data-remind-days]' },
  settings: { module: 'org', tab: 'settings', flash: 'main [type=submit]' },
  // «Хранилище файлов» (задача 2.29).
  storage: { module: 'org', tab: 'settings', flash: '[data-org-storage]' },
  tg: { module: null, flash: '[data-profile-telegram]', open: 'profile' },
  types: { module: 'dicts', tab: 'types', flash: LIST },
  typecfg: { module: 'dicts', tab: 'types', flash: LIST },
  pdicts: { module: 'dicts', tab: 'platform', flash: 'main' },
  roles: { module: 'staff', tab: 'roles', flash: 'main' },
  emps: { module: 'staff', tab: 'list', flash: LIST, open: { add: 'employee' } },
  empcard: { module: 'staff', tab: 'list', flash: LIST },
  // Задачи (задача 2.23).
  mtask: { module: 'tasks', tab: 'byme', flash: LIST, open: { add: 'task' } },
  daymonth: { module: 'tasks', tab: 'mine', flash: '[data-task-legend]' },
  tdone: { module: 'tasks', tab: 'mine', flash: LIST },
  tconf: { module: 'tasks', tab: 'mine', flash: '[data-plate="pend"], main' },
  // «Показатели контрагентов» (2.27): «Кому вести» — нажать переключатель вида.
  kset: { module: 'kpi', tab: 'setup', flash: '[data-kpi-setup-list]' },
  kwho: {
    module: 'kpi',
    tab: 'setup',
    flash: '[data-kpi-setup-view] button:last-child',
    press: true,
  },
  kval: { module: 'kpi', tab: 'month', flash: '[data-kpi-table], [data-kpi-tile]' },
  kper: { module: 'kpi', tab: 'period', flash: LIST },
  kchk: { module: 'kpi', tab: 'period', flash: LIST },
  // «Файловый менеджер» (2.29): «Загрузить файл» сразу открывает окно загрузки.
  upload: { module: 'files', flash: LIST, open: { add: 'upload' } },
  ffind: { module: 'files', flash: LIST },
  search: { module: null, flash: '[role=search]', phoneFlash: '[data-search-open]' },
  // Пока нет «Контрагентов» — на списке «Видов отчётов»: он виден всем.
  cols: { module: 'dicts', tab: 'types', flash: '[data-grid-columns-button]' },
  grp: { module: 'dicts', tab: 'types', flash: '[data-grid-group-button]' },
  xls: { module: 'dicts', tab: 'types', flash: '[data-grid-export]' },
  swipe: { module: 'dicts', tab: 'types', flash: '[data-tabrow]' },
  // Админка. Прототип ведёт на «Режимы» — вкладка придёт со второй частью задачи 2.36.
  'a-dicts': { module: 'pdicts', tab: 'forms', flash: 'main' },
  'a-l10n': { module: 'l10n', flash: 'main' },
  'a-org': { module: 'orgs', flash: LIST, open: { add: 'org' } },
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
export function flashTarget(selector: string, onFlash?: (el: HTMLElement) => void): () => void {
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
    onFlash?.(el);
    timer = setTimeout(() => el.removeAttribute('data-ck-flash'), FLASH_MS);
  };
  timer = setTimeout(find, 380);
  return () => clearTimeout(timer);
}
