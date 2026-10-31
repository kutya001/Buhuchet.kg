import type { ListColumnType, ListSort } from '../common/list';
import type { UiTextKey } from '../l10n/texts';
import { MENU_MODULE_IDS, type MenuModuleId } from '../org/modules';
import { FEATURES, PERMISSIONS } from '../roles/permissions';
import type { KbLevelDef } from './catalog';
import { isKbEvent } from './events';

/*
 * Админка → «База знаний (содержимое)» (задача 2.39; ТЗ «Модуль База знаний (содержимое)»; прототип
 * admin/kb-content.js): шаги уроков, статьи и уровни для всех организаций и отдельная программа
 * администраторов платформы. Здесь — что можно записать (`kbStepProblems`, `kbArticleProblems`,
 * `kbLevelsProblem`), столбцы списков и строки «Истории изменений» словами прототипа (`pdLog`).
 */

/** Списки вкладок: «Шаги уроков» и «Статьи». */
export const KB_ADMIN_LISTS = ['steps', 'arts'] as const;
export type KbAdminList = (typeof KB_ADMIN_LISTS)[number];

export function isKbAdminList(value: string): value is KbAdminList {
  return (KB_ADMIN_LISTS as readonly string[]).includes(value);
}

/** Кому статья (прототип `aud`): организациям, администраторам платформы, всем. */
export const KB_ARTICLE_AUDIENCES = ['biz', 'adm', 'all'] as const;
export type KbArticleAudience = (typeof KB_ARTICLE_AUDIENCES)[number];

export const KB_STEP_TITLE_MAX = 200;
export const KB_STEP_WHY_MAX = 500;
export const KB_ARTICLE_TITLE_MAX = 200;
export const KB_ARTICLE_SECTION_MAX = 100;
/** Текст статьи: картинки в нём — адресами хранилища, не данными. */
export const KB_ARTICLE_HTML_MAX = 100_000;
export const KB_LEVEL_NAME_MAX = 60;

/** Названия модулей меню — «Место для «Перейти»», «К какому модулю относится». */
export const KB_MODULE_TITLES: Readonly<Record<MenuModuleId, UiTextKey>> = {
  home: 'nav.home',
  cps: 'nav.counterparties',
  reports: 'nav.reports',
  fin: 'nav.finance',
  projects: 'nav.projects',
  kpi: 'nav.indicators',
  tasks: 'nav.tasks',
  files: 'nav.files',
  staff: 'nav.staff',
  dicts: 'nav.dicts',
  org: 'nav.org',
  kb: 'kb.title',
  accounts: 'nav.accounts',
  orgs: 'nav.organizations',
  pdicts: 'nav.platform_dicts',
  l10n: 'nav.l10n',
  kbadm: 'nav.kb_content',
  tg: 'nav.telegram',
};

export function isMenuModuleId(value: string): value is MenuModuleId {
  return (MENU_MODULE_IDS as readonly string[]).includes(value);
}

const PERMISSION_IDS: ReadonlySet<string> = new Set(PERMISSIONS.map(([id]) => id));

/* ───────────── Шаги уроков ───────────── */

/** Поля окна «Шаг урока» (прототип kbStepDlg). */
export interface KbStepInput {
  /** Модуль программы — группа шагов (`kbGroups`). */
  g: string;
  t: string;
  w: string;
  /** «Посмотреть»; иначе — «Сделать». */
  learn: boolean;
  /** Статья шага; пусто — статья модуля. */
  art: string;
  star: boolean;
  /** Необходимое право; пусто — просмотр модуля. */
  perm: string;
  /** Функция учётной политики; пусто — не зависит от функций. */
  featk: string;
  /** Условие отметки (`KB_EVENTS`). */
  evk: string;
  active: boolean;
  /** Место для «Перейти» — только у нового шага. */
  mod?: string;
}

export type KbStepField = keyof KbStepInput;

export type KbAdminProblem =
  | 'kb_title_required'
  | 'kb_title_too_long'
  | 'kb_why_too_long'
  | 'kb_section_required'
  | 'kb_section_too_long'
  | 'kb_html_too_long'
  | 'kb_unknown';

/** Тексты отказов для ответа API (экран показывает их из словаря, `kbadm.err.<код>`). */
export const KB_ADMIN_MESSAGES: Readonly<Record<KbAdminProblem, string>> = {
  kb_title_required: 'Введите название',
  kb_title_too_long: `Не длиннее ${KB_STEP_TITLE_MAX} знаков`,
  kb_why_too_long: `Не длиннее ${KB_STEP_WHY_MAX} знаков`,
  kb_section_required: 'Укажите раздел',
  kb_section_too_long: `Не длиннее ${KB_ARTICLE_SECTION_MAX} знаков`,
  kb_html_too_long: 'Не длиннее 100 000 знаков',
  kb_unknown: 'Такого значения нет в списке',
};

/**
 * Что не так с шагом (прототип kbStepDlg «Сохранить»: «Введите название»): название обязательно и не
 * длиннее 200 знаков; модуль программы, статья, право, функция, условие и место для «Перейти» — только
 * из списков (окно других не даёт, проверка — для запроса в обход окна).
 */
export function kbStepProblems(
  input: KbStepInput,
  known: { groups: ReadonlySet<string>; articles: ReadonlySet<string>; isNew: boolean },
): Partial<Record<KbStepField, KbAdminProblem>> {
  const out: Partial<Record<KbStepField, KbAdminProblem>> = {};
  const title = input.t.trim();
  if (!title) out.t = 'kb_title_required';
  else if (title.length > KB_STEP_TITLE_MAX) out.t = 'kb_title_too_long';
  if (input.w.trim().length > KB_STEP_WHY_MAX) out.w = 'kb_why_too_long';
  if (!known.groups.has(input.g)) out.g = 'kb_unknown';
  if (input.art && !known.articles.has(input.art)) out.art = 'kb_unknown';
  if (input.perm && !PERMISSION_IDS.has(input.perm)) out.perm = 'kb_unknown';
  if (input.featk && !(FEATURES as readonly string[]).includes(input.featk))
    out.featk = 'kb_unknown';
  if (!isKbEvent(input.evk)) out.evk = 'kb_unknown';
  if (known.isNew && !(input.mod && isMenuModuleId(input.mod))) out.mod = 'kb_unknown';
  return out;
}

/* ───────────── Статьи ───────────── */

/** Поля окна «Статья» (прототип kbArtEditDlg). */
export interface KbArticleInput {
  sec: string;
  t: string;
  /** Модуль статьи; пусто — общая статья. */
  mod: string;
  /** Право для просмотра; пусто — у всех, кто видит модуль. */
  perm: string;
  aud: KbArticleAudience;
  active: boolean;
  html: string;
}

export type KbArticleField = keyof KbArticleInput;

/** Что не так со статьёй (прототип: «Введите название», «Укажите раздел»). */
export function kbArticleProblems(
  input: KbArticleInput,
): Partial<Record<KbArticleField, KbAdminProblem>> {
  const out: Partial<Record<KbArticleField, KbAdminProblem>> = {};
  const title = input.t.trim();
  if (!title) out.t = 'kb_title_required';
  else if (title.length > KB_ARTICLE_TITLE_MAX) out.t = 'kb_title_too_long';
  const sec = input.sec.trim();
  if (!sec) out.sec = 'kb_section_required';
  else if (sec.length > KB_ARTICLE_SECTION_MAX) out.sec = 'kb_section_too_long';
  if (input.mod && !isMenuModuleId(input.mod)) out.mod = 'kb_unknown';
  if (input.perm && !PERMISSION_IDS.has(input.perm)) out.perm = 'kb_unknown';
  if (!(KB_ARTICLE_AUDIENCES as readonly string[]).includes(input.aud)) out.aud = 'kb_unknown';
  if (input.html.length > KB_ARTICLE_HTML_MAX) out.html = 'kb_html_too_long';
  return out;
}

/* ───────────── Уровни ───────────── */

/** Уровни пользователей организаций и администраторов платформы (refDB `kbLevels`). */
export const KB_LEVEL_SETS = ['business', 'admin'] as const;
export type KbLevelSet = (typeof KB_LEVEL_SETS)[number];

export type KbLevelsProblem = 'kb_level_name' | 'kb_level_name_too_long' | 'kb_level_order';

/**
 * Что не так с уровнями (прототип renderKbAdm, вкладка `levels`): у каждого уровня название; первый —
 * всегда от 0 %, пороги растут сверху вниз и не больше 100 %.
 */
export function kbLevelsProblem(levels: readonly KbLevelDef[]): KbLevelsProblem | null {
  if (levels.some((l) => !l.n.trim())) return 'kb_level_name';
  if (levels.some((l) => l.n.trim().length > KB_LEVEL_NAME_MAX)) return 'kb_level_name_too_long';
  const ok = levels.every(
    (l, j) => Number.isInteger(l.p) && (j === 0 ? l.p === 0 : l.p > levels[j - 1]!.p && l.p <= 100),
  );
  return ok ? null : 'kb_level_order';
}

/* ───────────── Списки ───────────── */

/** Столбец списка: ключ, тип, подпись (ключ словаря) и скрыт ли по умолчанию. */
export interface KbAdminColumn {
  key: string;
  type: ListColumnType;
  label: UiTextKey;
  hidden?: boolean;
}

const c = (key: string, type: ListColumnType, label: UiTextKey, hidden = false): KbAdminColumn =>
  hidden ? { key, type, label, hidden } : { key, type, label };

/** Столбцы — как в прототипе (`kb-steps`, `kb-arts`). */
export const KB_ADMIN_COLUMNS: Readonly<Record<KbAdminList, readonly KbAdminColumn[]>> = {
  steps: [
    c('n', 'int', 'kbadm.col.n'),
    c('id', 'text', 'kbadm.col.code', true),
    c('prog', 'enum', 'kbadm.col.prog', true),
    c('g', 'enum', 'kbadm.col.group'),
    c('t', 'text', 'kbadm.col.title'),
    c('type', 'enum', 'kbadm.col.type'),
    c('star', 'enum', 'kbadm.col.star', true),
    c('perm', 'text', 'kbadm.col.perm'),
    c('feat', 'enum', 'kbadm.col.feat', true),
    c('evk', 'enum', 'kbadm.col.evk'),
    c('active', 'enum', 'kbadm.col.active'),
  ],
  arts: [
    c('id', 'text', 'kbadm.col.code', true),
    c('sec', 'enum', 'kbadm.col.sec'),
    c('t', 'text', 'kbadm.col.title'),
    c('mod', 'enum', 'kbadm.col.mod'),
    c('perm', 'enum', 'kbadm.col.art_perm'),
    c('aud', 'enum', 'kbadm.col.aud'),
    c('len', 'int', 'kbadm.col.len', true),
    c('active', 'enum', 'kbadm.col.art_active'),
  ],
};

/** Сортировка по умолчанию: шаги — по «№» (порядок программ), статьи — как в справочнике. */
export const KB_ADMIN_SORT: Readonly<Record<KbAdminList, ListSort | null>> = {
  steps: { key: 'n', dir: 'asc' },
  arts: null,
};

/* ───────────── История изменений ───────────── */

/** Разделы истории: шаги, статьи, уровни (`platform_audit_log`, `<раздел>:<код>`). */
export const KB_HISTORY_SECTIONS = ['kbsteps', 'kbarts', 'kblevels'] as const;
export type KbHistorySection = (typeof KB_HISTORY_SECTIONS)[number];

/** Вкладка → её раздел истории. */
export const KB_TAB_HISTORY: Readonly<Record<'steps' | 'arts' | 'levels', KbHistorySection>> = {
  steps: 'kbsteps',
  arts: 'kbarts',
  levels: 'kblevels',
};

/** Изменённое поле записи истории: было → стало (значения как в JSON). */
export interface KbHistoryChange {
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface KbHistoryItemInput {
  section: KbHistorySection;
  code: string;
  action: string;
  /** Название на момент записи. */
  label: string;
  changes: readonly KbHistoryChange[];
}

/** Строка истории: ключ словаря и подстановки. */
export interface KbHistoryLine {
  key: UiTextKey;
  params: Record<string, string>;
}

/** Поля шага, которые прототип называет в «изменён — …». */
const STEP_FIELDS: readonly [string, UiTextKey][] = [
  ['t', 'kbadm.hist.f.title'],
  ['active', 'kbadm.hist.f.on'],
  ['perm', 'kbadm.hist.f.perm'],
  ['evk', 'kbadm.hist.f.evk'],
  ['featk', 'kbadm.hist.f.feat'],
];

const only = (changes: readonly KbHistoryChange[], field: string) =>
  changes.length === 1 && changes[0]!.field === field ? changes[0]! : null;

const levelText = (v: unknown, t: (key: UiTextKey) => string) => {
  const l: Record<string, unknown> =
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return `${String(l.n ?? '')} ${String(l.p ?? '')} ${t('kbadm.hist.percent')}`;
};

/**
 * Запись истории словами прототипа (`pdLog`): «Шаги уроков: добавлен шаг «…» (Организации)», «… изменён
 * — название, право», «… перемещён выше», «… выключен»; «Статьи: добавлена «…»», «… изменена», «…
 * отключена»; «Уровни (организации): 2: Ученик 25 % → Ученик 30 %». `adminGroup` — группа шага в
 * программе администратора платформы.
 */
export function kbHistoryLine(
  item: KbHistoryItemInput,
  t: (key: UiTextKey) => string,
  adminGroup: (group: string) => boolean,
): KbHistoryLine {
  const name = item.label;
  if (item.section === 'kblevels') {
    const list = item.changes
      .map((ch) => `${ch.field}: ${levelText(ch.from, t)} → ${levelText(ch.to, t)}`)
      .join('; ');
    return {
      key: item.code === 'admin' ? 'kbadm.hist.levels.admin' : 'kbadm.hist.levels.business',
      params: { list },
    };
  }
  const active = only(item.changes, 'active');
  if (item.section === 'kbarts') {
    if (item.action === 'create') return { key: 'kbadm.hist.art.create', params: { name } };
    if (active) {
      return { key: active.to ? 'kbadm.hist.art.on' : 'kbadm.hist.art.off', params: { name } };
    }
    return { key: 'kbadm.hist.art.update', params: { name } };
  }
  if (item.action === 'create') {
    const g = item.changes.find((ch) => ch.field === 'g')?.to;
    const prog = t(
      typeof g === 'string' && adminGroup(g) ? 'kbadm.prog.admin' : 'kbadm.prog.business',
    );
    return { key: 'kbadm.hist.step.create', params: { name, prog } };
  }
  const ord = only(item.changes, 'ord');
  if (ord) {
    const up = Number(ord.to) < Number(ord.from);
    return { key: up ? 'kbadm.hist.step.up' : 'kbadm.hist.step.down', params: { name } };
  }
  if (active) {
    return { key: active.to ? 'kbadm.hist.step.on' : 'kbadm.hist.step.off', params: { name } };
  }
  const fields = STEP_FIELDS.filter(([f]) => item.changes.some((ch) => ch.field === f)).map(
    ([f, key]) => {
      if (f !== 'active') return t(key);
      const to = item.changes.find((ch) => ch.field === 'active')?.to;
      return t(to ? 'kbadm.hist.f.on' : 'kbadm.hist.f.off');
    },
  );
  return fields.length
    ? { key: 'kbadm.hist.step.update_fields', params: { name, list: fields.join(', ') } }
    : { key: 'kbadm.hist.step.update', params: { name } };
}
