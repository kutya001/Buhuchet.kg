/*
 * Что подсвечивает облачко «Показать как» на экране продукта (ТЗ: «какой элемент подсвечивает облачко
 * и что открыть перед показом, задаёт разработчик»; docs/decisions.md п. Г-5). Сценарии в refDB.json
 * (`kbShows`, `kbUi.els`) называют элементы обозначениями прототипа (`#og-save`, `#mbody .box`) —
 * здесь они переводятся в элементы продукта. Облачко, чей элемент не переведён, в показе пропускается,
 * как элемент, которого нет на экране: так показы экранов, которых ещё нет, скрыты сами.
 *
 * Задача экрана, слитая позже, добавляет строки своих элементов в `KB_SHOW_TARGETS` (по порядку модулей
 * ТЗ, одна строка на обозначение прототипа) и, если нужно, атрибут `data-…` на свой элемент. Общие
 * элементы оболочки, списков, окон и меню переводятся сами (`SHARED_TARGETS`, `PATTERNS`).
 */

/** Строка списка: таблица на ПК и карточка на телефоне. */
const ROW = 'main [data-grid] [data-id]';
/** «Ещё действия» в нижней строке открытой карточки. */
const CARD_MORE = '[data-window-foot] [aria-haspopup="menu"]';

/** Общие элементы прототипа — у всех экранов одинаковые. */
const SHARED_TARGETS: Readonly<Record<string, string>> = {
  '#tabs': '[data-tabrow]',
  '#stat-btn': '[data-stats-toggle]',
  '#add-btn': '[data-add-button="button"]',
  '#fab': '[data-add-button="fab"]',
  '.search': '[role=search]',
  '#q-open': '[data-search-open]',
  '#tb-title': '[data-page-title]',
  '#theme': '[data-theme-toggle]',
  '.pop': '[data-popover]',
  '#mbody [data-a=cols]': 'main [data-grid-columns-button]',
  '#mbody [data-a=grp]': 'main [data-grid-group-button]',
  '#mbody [data-a=xls]': 'main [data-grid-export]',
  '#mbody [data-a=opts]': 'main [data-grid-options-button]',
  '#mbody th.selc': 'main [data-grid-scroll] thead th:has(input[type=checkbox])',
  '#mbody tbody tr[data-id] || #mbody .gcard': ROW,
  '#mbody tbody tr[data-id]:not(.muted) || #mbody .gcard:not(.muted) || #mbody tbody tr[data-id] || #mbody .gcard':
    ROW,
  '#mbody [data-menu]': 'main [data-row-menu]',
  // Кнопка «Ещё действия» карточки записи: сотрудник, контрагент, отчёт.
  '#ec-more': CARD_MORE,
  '#cp-more': CARD_MORE,
  '#rc-more': CARD_MORE,
};

/**
 * Элементы экранов по модулям ТЗ. Значение — CSS-селектор продукта (первый видимый элемент; `||` —
 * «или», как в прототипе).
 */
export const KB_SHOW_TARGETS: Readonly<Record<string, string>> = {
  // Моя организация: «Основное», учётная политика, «Настройки».
  '#mbody .box': 'main [data-box]',
  '#og-save': 'main form [type=submit]',
  '#og-accs': 'main [data-box]:has([data-org-account-add])',
  '#og-addacc': '[data-org-account-add]',
  '#pol-quiz': '[data-quiz-open]',
  '#mbody [data-feat-row]': 'main [data-feat-row]',
  '#pol-tconf': '[data-task-confirm]',
  '#st-save': 'main form [type=submit]',
  // Справочники: «Справочники платформы» — плитки.
  '#mbody .gscroll || #mbody .gcards': 'main [data-dict-tile]',
  // Задачи: легенда «на день / на месяц».
  '#mbody .kd-legend': '[data-task-legend]',
  // Показатели контрагентов: месяц и период, таблица ввода (на телефоне — плитки), настройка.
  '#mbody .kpi-bar': 'main [role=group]:has([data-kpi-month-pick]) || main [data-kpi-period]',
  '#mbody .kt || #mbody .gcards': 'main [data-kpi-table] || main :has(> [data-kpi-tile])',
  '#mbody .kpi-bar .seg': 'main [data-kpi-setup-view] [data-segments]',
  '#mbody .kset': 'main [data-kpi-setup-list]',
  '#mbody [data-ksv="list"]': 'main [data-kpi-setup-view] [data-segments] button:nth-child(1)',
  '#mbody [data-ksv="who"]': 'main [data-kpi-setup-view] [data-segments] button:nth-child(2)',
  // База знаний: «Мой уровень» и «Уроки».
  '#mbody .kb-hero': 'main [data-box]:has([data-kb-level-head])',
  '#mbody .kb-rules': 'main [data-kb-rules]',
  '#mbody [data-ck-go]': 'main [data-ck-go]',
  '#mbody [data-ck-how]': 'main [data-ck-how]',
  '#mbody [data-ck-scr]': 'main [data-ck-scr]',
};

/** Обозначения прототипа, которые переводятся по образцу. */
const PATTERNS: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  // Плашка статистики: код плашки один в прототипе и продукте.
  [/^#mbody \.plate\[data-plate="([\w-]+)"\]$/, (m) => `[data-plate="${m[1]}"]`],
  [/^#mbody \[data-plate="([\w-]+)"\]$/, (m) => `[data-plate="${m[1]}"]`],
];

/** Селектор продукта для обозначения прототипа; null — элемента в продукте нет (облачко пропускается). */
export function productTarget(proto: string | null | undefined): string | null {
  if (!proto) return null;
  const own = KB_SHOW_TARGETS[proto] ?? SHARED_TARGETS[proto];
  if (own) return own;
  for (const [re, make] of PATTERNS) {
    const m = proto.match(re);
    if (m) return make(m);
  }
  return null;
}

/** Где искать элемент облачка: верхнее окно, открытое меню или рабочая область. */
export type TourRoot = 'window' | 'popover' | 'main';

/** Корень прототипа (`in`) → продукт; неизвестный — null (облачко пропускается). */
export function productRoot(proto: string | undefined): TourRoot | null | undefined {
  if (!proto) return undefined;
  if (proto === '.modal' || proto.startsWith('.modal ')) return 'window';
  if (proto === '.pop') return 'popover';
  if (proto === '#mbody') return 'main';
  return null;
}
