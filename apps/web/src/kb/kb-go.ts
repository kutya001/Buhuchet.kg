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
  /**
   * Сразу открыть: «+ Добавить» модуля этим способом (`variant` — вариант формы: «Разовый» у нового
   * контрагента, прототип `addCpDlg('oneoff')`) или «Мой профиль».
   */
  open?: { add: string; variant?: string } | 'profile';
  /** На телефоне сначала открыть «Мой профиль»: элемент шага там, а не в верхней панели. */
  phoneOpen?: 'profile';
  /**
   * Что «Показать как» подсвечивает на телефоне, когда элемент шага там в окне, которое открывает
   * «Перейти» (прототип `mhl`: у темы — кнопка «Меню», `#burger`). Нет — то же, что `phoneFlash`.
   */
  phoneShow?: string;
  /** Нажать подсвеченную кнопку (у блока на экране своё «+ Добавить», не в меню модуля). */
  press?: boolean;
}

/** Строки списка: таблица на ПК и карточки на телефоне. */
const LIST = '[data-grid-scroll], [data-grid-cards]';

/**
 * Вариант «+ Добавить» → «Токен» от «Перейти» шага «Выпустить API-токен»: при выключенном «Внешнем
 * доступе по API» вкладка подсвечивает красную плашку вместо уведомления (прототип kb-lessons `dmtok`).
 */
export const KB_TOKEN_VARIANT = 'kb';

export const KB_GO: Readonly<Record<string, KbTarget>> = {
  profile: { module: 'org', tab: 'main', flash: 'main section' },
  accs: { module: 'org', tab: 'main', flash: '[data-org-account-add]', press: true },
  policy: { module: 'org', tab: 'policy', flash: 'main section' },
  remind: { module: 'org', tab: 'policy', flash: '[data-remind-days]' },
  settings: { module: 'org', tab: 'settings', flash: '[data-org-settings-save]' },
  // «Хранилище файлов» (задача 2.29).
  storage: { module: 'org', tab: 'settings', flash: '[data-org-storage]' },
  tg: { module: null, flash: '[data-profile-telegram]', open: 'profile' },
  // «Тема оформления» (задача 2.31): кнопка темы в верхней панели; на телефоне её там нет — тема
  // меняется в «Мой профиль» (прототип v138).
  theme: {
    module: null,
    flash: '[data-theme-toggle]',
    phoneFlash: '#pf-theme',
    phoneOpen: 'profile',
    phoneShow: '[data-menu-button]',
  },
  types: { module: 'dicts', tab: 'types', flash: LIST },
  typecfg: { module: 'dicts', tab: 'types', flash: LIST },
  pdicts: { module: 'dicts', tab: 'platform', flash: 'main' },
  roles: { module: 'staff', tab: 'roles', flash: 'main' },
  emps: { module: 'staff', tab: 'list', flash: LIST, open: { add: 'employee' } },
  empcard: { module: 'staff', tab: 'list', flash: LIST },
  // Контрагенты (задачи 2.09–2.11): форма открывается сама; шаги карточки — строки списка, как в прототипе.
  cp1: { module: 'cps', tab: 'all', flash: LIST, open: { add: 'contractor' } },
  import: { module: 'cps', tab: 'all', flash: LIST, open: { add: 'import' } },
  resp: { module: 'cps', tab: 'all', flash: LIST },
  oneoff: {
    module: 'cps',
    tab: 'all',
    flash: LIST,
    open: { add: 'contractor', variant: 'oneoff' },
  },
  pause: { module: 'cps', tab: 'all', flash: 'main' },
  archive: { module: 'cps', tab: 'all', flash: 'main' },
  cppage: { module: 'cps', tab: 'all', flash: LIST },
  // «Отчеты для сдачи» (задача 2.13). «Назначить отчёты» (2.15): «Кто что сдаёт» и сразу окно
  // массового назначения.
  assign: {
    module: 'reports',
    tab: 'matrix',
    flash: '[data-add-button="button"]',
    phoneFlash: '[data-add-button="fab"]',
    open: { add: 'mass' },
  },
  matrix: { module: 'reports', tab: 'matrix', flash: '[data-matrix], main' },
  rtabs: { module: 'reports', tab: 'week', flash: '[data-tabrow]' },
  // Сдача и подтверждение (задача 2.14): «На неделе» и «Ожидают подтверждения»; массовая отметка,
  // «Создать уточнённый» (меню сданного), «Не требуется» и шкала — список «Все».
  submit: { module: 'reports', tab: 'week', flash: LIST },
  accept: { module: 'reports', tab: 'waiting', flash: LIST },
  bulk: { module: 'reports', tab: 'all', flash: LIST },
  ver: { module: 'reports', tab: 'all', flash: LIST },
  na: { module: 'reports', tab: 'all', flash: LIST },
  scale: { module: 'reports', tab: 'all', flash: LIST },
  // Задачи (задача 2.23).
  mtask: { module: 'tasks', tab: 'byme', flash: LIST, open: { add: 'task' } },
  daymonth: { module: 'tasks', tab: 'mine', flash: '[data-task-legend]' },
  tdone: { module: 'tasks', tab: 'mine', flash: LIST },
  tconf: { module: 'tasks', tab: 'mine', flash: '[data-plate="pend"], main' },
  // «Проекты контрагентов» (2.26): «Создать проект» сразу открывает окно; работы — в карточке проекта.
  proj: {
    module: 'projects',
    tab: 'all',
    flash: '[data-add-button="button"]',
    phoneFlash: '[data-add-button="fab"]',
    open: { add: 'project' },
  },
  works: { module: 'projects', tab: 'all', flash: LIST },
  tranche: { module: 'projects', tab: 'all', flash: LIST },
  pstat: { module: 'projects', tab: 'all', flash: LIST },
  // «Показатели контрагентов» (2.27, 2.28): «Кому вести» — нажать переключатель вида.
  kset: { module: 'kpi', tab: 'setup', flash: '[data-kpi-setup-list]' },
  kwho: {
    module: 'kpi',
    tab: 'setup',
    flash: '[data-kpi-setup-view] button:last-child',
    press: true,
  },
  kval: { module: 'kpi', tab: 'month', flash: '[data-kpi-table], [data-kpi-tile]' },
  // «Ввод из Excel» (2.28): сразу открыть окно шаблона и загрузки.
  kxls: { module: 'kpi', tab: 'month', flash: '[data-kpi-import]', open: { add: 'excel' } },
  kper: { module: 'kpi', tab: 'period', flash: LIST },
  kchk: { module: 'kpi', tab: 'period', flash: LIST },
  // Вкладка «Показатели» карточки контрагента (2.11): строки списка контрагентов.
  kcard: { module: 'cps', tab: 'all', flash: LIST },
  // «Файловый менеджер» (2.29): «Загрузить файл» сразу открывает окно загрузки.
  upload: { module: 'files', flash: LIST, open: { add: 'upload' } },
  ffind: { module: 'files', flash: LIST },
  // «Витрина данных» (доработки 20.11.2026, этап 3, П3; прототип v157 kb-lessons): «Показать отчёт» —
  // кнопка «Показать», «Как читать отчёт» — результат, «Каталог шаблонов» — карточки; «Выпустить
  // API-токен» — сразу «Новый API-токен», при выключенном API — красная плашка вкладки.
  dmshow: { module: 'dm', tab: 'out', flash: '[data-dm-out-show]' },
  dmxl: { module: 'dm', tab: 'out', flash: '[data-dm-res]' },
  dmcat: { module: 'dm', tab: 'tpl', flash: '[data-dm-cards]' },
  dmtok: {
    module: 'dm',
    tab: 'tok',
    flash: '[data-add-button="button"]',
    phoneFlash: '[data-add-button="fab"]',
    open: { add: 'tok', variant: KB_TOKEN_VARIANT },
  },
  // «Главная» (2.34): плашки «Сводки» (на телефоне скрыты — тогда экран) и экран «Аналитики».
  today: { module: 'home', tab: 'today', flash: '[data-plates], main' },
  anl: { module: 'home', tab: 'analytics', flash: 'main' },
  search: { module: null, flash: '[role=search]', phoneFlash: '[data-search-open]' },
  // На списке контрагентов (2.10), как в прототипе.
  cols: { module: 'cps', tab: 'all', flash: 'main [data-grid-columns-button]' },
  grp: { module: 'cps', tab: 'all', flash: 'main [data-grid-group-button]' },
  xls: { module: 'cps', tab: 'all', flash: 'main [data-grid-export]' },
  stats: { module: 'reports', tab: 'week', flash: '[data-stats-toggle]' },
  swipe: { module: 'reports', tab: 'week', flash: '[data-tabrow]' },
  // Админка.
  'a-dicts': { module: 'pdicts', tab: 'regimes', flash: 'main' },
  'a-types': { module: 'pdicts', tab: 'types', flash: LIST },
  // «Выгрузить» и «Загрузить» над списком (задача 2.37).
  'a-xls': { module: 'pdicts', tab: 'types', flash: '[data-io-bar]' },
  'a-cal': { module: 'pdicts', tab: 'calendar', flash: 'main' },
  'a-tpl': { module: 'pdicts', tab: 'templates', flash: 'main' },
  'a-l10n': { module: 'l10n', flash: 'main' },
  'a-org': { module: 'orgs', flash: LIST, open: { add: 'org' } },
  // «Шаблоны витрины» Админки (доработки 20.11.2026, этап 3, П3).
  'a-dm': { module: 'dm', tab: 'tpl', flash: 'main' },
};

/** Сколько ждать, пока нужный элемент появится на экране после перехода, мс. */
const FLASH_WAIT_MS = 2500;
/** Сколько ждать самое большее, пока экран показывает заглушку загрузки, мс. */
const FLASH_BUSY_MS = 10_000;
/** Сколько держится подсветка (две вспышки по 1,3 с), мс. */
const FLASH_MS = 2800;

/**
 * Экран или открытое окно ещё грузится: на нём заглушка `aria-busy` (кнопка «в работе» не в счёт).
 * Этим же признаком показ «Показать как» ждёт экран (tour/tour-dom.ts, `settle`).
 */
export const SCREEN_BUSY =
  'main [aria-busy="true"]:not(button), [data-window] [aria-busy="true"]:not(button)';

/**
 * Ждать ли элемент дальше: первые 2,5 секунды — всегда (переход на экран), потом — только пока экран
 * показывает заглушку загрузки, и не дольше 10 секунд. Без этого «Перейти» на медленной связи молча
 * ничего не подсвечивало и не открывало: кнопка блока появляется после ответа сервера
 * (docs/typical-mistakes.md № 81).
 */
export function flashWaits(elapsed: number, busy: boolean): boolean {
  return elapsed < FLASH_WAIT_MS || (busy && elapsed < FLASH_BUSY_MS);
}

/**
 * Подсветить место шага (прототип ckFlash): первый видимый элемент по селектору прокручивается в
 * середину экрана и дважды вспыхивает рамкой. Экран после перехода может ещё грузиться — элемент
 * ищется 2,5 секунды и дольше, пока на экране заглушка загрузки (`flashWaits`); ушёл пользователь
 * за это время на другой экран — поиск прекращается. `onFlash` — элемент найден и подсвечен.
 */
export function flashTarget(selector: string, onFlash?: (el: HTMLElement) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Date.now();
  // Экран, на котором ожидание продлено из-за загрузки: нажимать кнопку на другом экране нельзя.
  let lateOn: string | null = null;
  const find = () => {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (x) => x.getClientRects().length > 0,
    );
    if (!el) {
      const elapsed = Date.now() - started;
      if (elapsed >= FLASH_WAIT_MS) {
        lateOn ??= window.location.pathname;
        if (lateOn !== window.location.pathname) return;
      }
      if (flashWaits(elapsed, !!document.querySelector(SCREEN_BUSY))) timer = setTimeout(find, 150);
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
