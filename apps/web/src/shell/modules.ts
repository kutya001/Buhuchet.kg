import type {
  Feature,
  MenuModuleId,
  PermissionId,
  RoleSaveEditor,
  UiTextKey,
} from '@buhuchet/domain';
import type { MeResponse } from '@buhuchet/shared';
import type { IconName } from '@buhuchet/ui';

/**
 * Реестр модулей оболочки (прототип core/registry.js, BIZ и ADM; вкладки и «+ Добавить» — функции
 * `*Tabs` и `*Add` модулей): значок, тексты словаря, вкладки и способы добавления с условиями по
 * функциям учётной политики и правам. Какие модули видны, решает сервер (`/api/auth/me` → modules);
 * вкладки и кнопки здесь только показываются или прячутся — данные всё равно проверяет API.
 * Счётчики вкладок и модулей добавят экраны модулей.
 */

/** Что можно вошедшему: права, функции учётной политики, режим Админки. */
export interface ShellAccess {
  admin: boolean;
  /** «Сдача отчётов требует подтверждения» включена в учётной политике. */
  reportConfirm: boolean;
  can: (permission: PermissionId) => boolean;
  feature: (feature: Feature) => boolean;
}

export function shellAccess(me: MeResponse): ShellAccess {
  const permissions = new Set<string>(me.permissions);
  return {
    admin: me.user.isPlatformAdmin,
    reportConfirm: me.reportConfirm,
    can: (p) => permissions.has(p),
    feature: (f) => me.features[f] === true,
  };
}

/**
 * Вошедший сотрудник для правил ролей на экране (`roleFormLock`, `roleScopeLock`): своя роль, его
 * действующие права и область — как их отдал сервер (`/api/auth/me`). У администратора — null.
 */
export function roleEditorOf(me: MeResponse): RoleSaveEditor | null {
  if (!me.employee) return null;
  return {
    isOwner: me.employee.isOwner,
    roleId: me.employee.roleId,
    subject: {
      employeeId: me.employee.id,
      isOwner: me.employee.isOwner,
      permissions: new Set(me.permissions),
      scopes: me.scopes,
    },
  };
}

/** Можно ли работать на страницах за входом: вошёл, сменил временный пароль, есть модули. */
export function canEnter(me: MeResponse | null): me is MeResponse {
  return !!me && !me.user.mustChangePassword && me.modules.length > 0;
}

type When = (access: ShellAccess) => boolean;

interface TabDef {
  id: string;
  icon: IconName;
  label: UiTextKey;
  /** Группа вкладки (прототип `group` у вкладок «Справочников платформы»): черта между группами. */
  group?: UiTextKey;
  when?: When;
  /** Куда вести, когда вкладка скрыта (прототип renderReports: «Ожидают» без подтверждения → «Все»). */
  fallback?: string;
}

export interface AddDef {
  id: string;
  icon: IconName;
  label: UiTextKey;
  sub?: UiTextKey;
  /** Метка «Бета» у пункта. */
  beta?: boolean;
  /** На ПК — отдельной кнопкой рядом с «+ Добавить» (в прототипе `btn: true`). */
  separate?: boolean;
  /** Только на этих вкладках модуля (прототип: `*Add` по `S.tab`); без них — на всех. */
  tabs?: readonly string[];
  when?: When;
}

interface ModuleDef {
  icon: IconName;
  title: UiTextKey;
  short: UiTextKey;
  desc: UiTextKey;
  tabs?: readonly TabDef[];
  add?: readonly AddDef[];
}

/** «Финансовые операции»: учёт оплаты налогов с правом «Учёт денег и оплата налогов» (taxVis). */
const taxVis: When = (a) => a.feature('taxpay') && a.can('money');
/** Плата за обслуживание с правом её видеть (`feat('fee') && can('fee')` прототипа). */
const feeVis: When = (a) => a.feature('fee') && a.can('fee');

/** Группы вкладок «Справочников платформы» (ТЗ «Группы справочников»). */
const G = {
  taxes: 'tab.pdicts.group.taxes',
  regimes: 'tab.pdicts.group.regimes',
  classes: 'tab.pdicts.group.classes',
  organs: 'tab.pdicts.group.organs',
  system: 'tab.pdicts.group.system',
  service: 'tab.pdicts.group.service',
} as const satisfies Record<string, UiTextKey>;

export const MODULES: Record<MenuModuleId, ModuleDef> = {
  home: {
    icon: 'home',
    title: 'nav.home',
    short: 'nav.short.home',
    desc: 'nav.desc.home',
    tabs: [
      { id: 'today', icon: 'home', label: 'tab.home.today' },
      { id: 'analytics', icon: 'chart', label: 'tab.home.analytics', when: feeVis },
    ],
  },
  cps: {
    icon: 'building',
    title: 'nav.counterparties',
    short: 'nav.short.cps',
    desc: 'nav.desc.cps',
    tabs: [
      { id: 'all', icon: 'list', label: 'tab.cps.all' },
      { id: 'mine', icon: 'user', label: 'tab.cps.mine' },
      { id: 'debtors', icon: 'coins', label: 'tab.cps.debtors', when: feeVis },
    ],
    add: [
      {
        id: 'contractor',
        icon: 'building',
        label: 'add.cps.contractor',
        when: (a) => a.can('createCp'),
      },
      { id: 'import', icon: 'paste', label: 'add.cps.import', when: (a) => a.can('cpImport') },
      {
        id: 'regdocs',
        icon: 'upload',
        label: 'add.cps.regdocs',
        sub: 'add.cps.regdocs.sub',
        beta: true,
        when: (a) => a.can('createCp'),
      },
    ],
  },
  reports: {
    icon: 'file',
    title: 'nav.reports',
    short: 'nav.short.reports',
    desc: 'nav.desc.reports',
    tabs: [
      { id: 'week', icon: 'calendar', label: 'tab.reports.week' },
      { id: 'overdue', icon: 'alert', label: 'tab.reports.overdue' },
      // Только при включённой «Сдача отчётов требует подтверждения» (repConfOn прототипа).
      {
        id: 'waiting',
        icon: 'hourglass',
        label: 'tab.reports.waiting',
        when: (a) => a.reportConfirm,
        fallback: 'all',
      },
      { id: 'all', icon: 'list', label: 'tab.reports.all' },
      { id: 'matrix', icon: 'matrix', label: 'tab.reports.matrix' },
      {
        id: 'calendar',
        icon: 'calendar',
        label: 'tab.reports.calendar',
        when: (a) => a.feature('calendar'),
      },
    ],
    add: [
      // «Назначить отчёты массово» откроет задача 2.15 («Кто что сдаёт»): до неё способ скрыт.
      { id: 'mass', icon: 'matrix', label: 'add.reports.mass', when: () => false },
      { id: 'adhoc', icon: 'file', label: 'add.reports.adhoc', when: (a) => a.can('changeStatus') },
    ],
  },
  fin: {
    icon: 'coins',
    title: 'nav.finance',
    short: 'nav.short.fin',
    desc: 'nav.desc.fin',
    tabs: [
      { id: 'all', icon: 'list', label: 'tab.fin.all' },
      { id: 'tax', icon: 'send', label: 'tab.fin.tax', when: taxVis },
      { id: 'fee', icon: 'coins', label: 'tab.fin.fee', when: feeVis },
      {
        id: 'proj',
        icon: 'briefcase',
        label: 'tab.fin.proj',
        when: (a) => feeVis(a) || a.can('projects'),
      },
      { id: 'wo', icon: 'gift', label: 'tab.fin.wo', when: taxVis },
      { id: 'journal', icon: 'wallet', label: 'tab.fin.journal', when: taxVis },
    ],
    add: [
      { id: 'income', icon: 'wallet', label: 'add.fin.income', when: taxVis },
      { id: 'service', icon: 'coins', label: 'add.fin.service', when: (a) => a.can('projects') },
    ],
  },
  projects: {
    icon: 'briefcase',
    title: 'nav.projects',
    short: 'nav.short.projects',
    desc: 'nav.desc.projects',
    tabs: [
      { id: 'active', icon: 'briefcase', label: 'tab.projects.active' },
      { id: 'all', icon: 'list', label: 'tab.projects.all' },
      { id: 'mine', icon: 'user', label: 'tab.projects.mine' },
    ],
    add: [
      {
        id: 'project',
        icon: 'briefcase',
        label: 'add.projects.project',
        when: (a) => a.can('projects'),
      },
    ],
  },
  kpi: {
    icon: 'gauge',
    title: 'nav.indicators',
    short: 'nav.short.kpi',
    desc: 'nav.desc.kpi',
    tabs: [
      { id: 'month', icon: 'edit', label: 'tab.kpi.month' },
      { id: 'period', icon: 'chart', label: 'tab.kpi.period' },
      { id: 'missing', icon: 'alert', label: 'tab.kpi.missing' },
      { id: 'setup', icon: 'sliders', label: 'tab.kpi.setup', when: (a) => a.can('indSetup') },
    ],
    add: [
      {
        id: 'indicator',
        icon: 'gauge',
        label: 'add.kpi.indicator',
        when: (a) => a.can('indSetup'),
      },
      {
        id: 'excel',
        icon: 'upload',
        label: 'add.kpi.excel',
        sub: 'add.kpi.excel.sub',
        separate: true,
        when: (a) => a.can('kpiImport'),
      },
    ],
  },
  tasks: {
    icon: 'task',
    title: 'nav.tasks',
    short: 'nav.short.tasks',
    desc: 'nav.desc.tasks',
    tabs: [
      { id: 'mine', icon: 'user', label: 'tab.tasks.mine' },
      { id: 'byme', icon: 'send', label: 'tab.tasks.byme', when: (a) => a.can('tasksCreate') },
      { id: 'all', icon: 'list', label: 'tab.tasks.all', when: (a) => a.can('tasksAll') },
      { id: 'overdue', icon: 'alert', label: 'tab.tasks.overdue' },
    ],
    add: [{ id: 'task', icon: 'task', label: 'add.tasks.task', when: (a) => a.can('tasksCreate') }],
  },
  files: {
    icon: 'folder',
    title: 'nav.files',
    short: 'nav.short.files',
    desc: 'nav.desc.files',
    add: [
      {
        id: 'upload',
        icon: 'upload',
        label: 'add.files.upload',
        when: (a) => a.can('filesUpload'),
      },
    ],
  },
  staff: {
    icon: 'users',
    title: 'nav.staff',
    short: 'nav.short.staff',
    desc: 'nav.desc.staff',
    tabs: [
      { id: 'list', icon: 'users', label: 'tab.staff.list' },
      { id: 'roles', icon: 'shield', label: 'tab.staff.roles', when: (a) => a.can('staff') },
      {
        id: 'bonus',
        icon: 'gift',
        label: 'tab.staff.bonus',
        when: (a) => a.can('staff') && a.feature('accounts') && a.feature('taxpay'),
      },
    ],
    add: [
      { id: 'employee', icon: 'user', label: 'add.staff.employee', when: (a) => a.can('staff') },
      { id: 'role', icon: 'shield', label: 'add.staff.role', when: (a) => a.can('staff') },
    ],
  },
  dicts: {
    icon: 'book',
    title: 'nav.dicts',
    short: 'nav.short.dicts',
    desc: 'nav.desc.dicts',
    tabs: [
      { id: 'types', icon: 'file', label: 'tab.dicts.types' },
      { id: 'platform', icon: 'lock', label: 'tab.dicts.platform' },
    ],
    add: [
      {
        id: 'catalog',
        icon: 'plus',
        label: 'add.dicts.catalog',
        separate: true,
        when: (a) => a.can('dicts'),
      },
      { id: 'request', icon: 'send', label: 'add.dicts.request' },
      { id: 'mine', icon: 'list', label: 'add.dicts.mine' },
    ],
  },
  org: {
    icon: 'landmark',
    title: 'nav.org',
    short: 'nav.short.org',
    desc: 'nav.desc.org',
    tabs: [
      { id: 'main', icon: 'landmark', label: 'tab.org.main' },
      { id: 'policy', icon: 'sliders', label: 'tab.org.policy' },
      { id: 'settings', icon: 'gauge', label: 'tab.org.settings' },
    ],
  },
  kb: {
    icon: 'grad',
    title: 'kb.title',
    short: 'nav.short.kb',
    desc: 'nav.desc.kb',
    tabs: [
      { id: 'level', icon: 'grad', label: 'tab.kb.level' },
      { id: 'lessons', icon: 'list', label: 'tab.kb.lessons' },
      { id: 'arts', icon: 'book', label: 'tab.kb.arts' },
      { id: 'news', icon: 'bell', label: 'tab.kb.news' },
      { id: 'team', icon: 'users', label: 'tab.kb.team', when: (a) => a.can('kbLevels') },
    ],
  },
  accounts: {
    icon: 'user',
    title: 'nav.accounts',
    short: 'nav.short.accounts',
    desc: 'nav.desc.accounts',
  },
  orgs: {
    icon: 'building',
    title: 'nav.organizations',
    short: 'nav.short.orgs',
    desc: 'nav.desc.orgs',
    add: [{ id: 'org', icon: 'building', label: 'add.orgs.org' }],
  },
  // Способы добавления содержимого «Базы знаний» зависят от вкладки — придут с его экраном (поток Д).
  pdicts: {
    icon: 'book',
    title: 'nav.platform_dicts',
    short: 'nav.short.pdicts',
    desc: 'nav.desc.pdicts',
    // Группы — как раздел `dictGroups` справочников платформы (прототип pdTabs).
    tabs: [
      { id: 'types', icon: 'file', label: 'tab.pdicts.types', group: G.taxes },
      { id: 'taxes', icon: 'coins', label: 'tab.pdicts.taxes', group: G.taxes },
      { id: 'bases', icon: 'tag', label: 'tab.pdicts.bases', group: G.taxes },
      { id: 'regimes', icon: 'tag', label: 'tab.pdicts.regimes', group: G.regimes },
      { id: 'benefits', icon: 'star', label: 'tab.pdicts.benefits', group: G.regimes },
      { id: 'gked', icon: 'list', label: 'tab.pdicts.gked', group: G.classes },
      { id: 'forms', icon: 'building', label: 'tab.pdicts.forms', group: G.classes },
      { id: 'phones', icon: 'globe', label: 'tab.pdicts.phones', group: G.classes },
      { id: 'organs', icon: 'landmark', label: 'tab.pdicts.organs', group: G.organs },
      { id: 'ugns', icon: 'landmark', label: 'tab.pdicts.ugns', group: G.organs },
      { id: 'banks', icon: 'wallet', label: 'tab.pdicts.banks', group: G.organs },
      { id: 'calendar', icon: 'calendar', label: 'tab.pdicts.calendar', group: G.system },
      { id: 'statuses', icon: 'ok', label: 'tab.pdicts.statuses', group: G.system },
      { id: 'cats', icon: 'tag', label: 'tab.pdicts.cats', group: G.system },
      { id: 'reasons', icon: 'calendar', label: 'tab.pdicts.reasons', group: G.system },
      { id: 'roletpl', icon: 'users', label: 'tab.pdicts.roletpl', group: G.system },
      { id: 'perms', icon: 'shield', label: 'tab.pdicts.perms', group: G.system },
      { id: 'templates', icon: 'chat', label: 'tab.pdicts.templates', group: G.system },
      { id: 'loads', icon: 'history', label: 'tab.pdicts.loads', group: G.service },
      { id: 'requests', icon: 'send', label: 'tab.pdicts.requests', group: G.service },
    ],
    // Способы добавления — по вкладке (прототип pdAdd); вкладки других частей задачи добавят свои.
    add: [
      { id: 'type', icon: 'file', label: 'pdicts.add.type', tabs: ['types'] },
      { id: 'base', icon: 'plus', label: 'pdicts.add.base', tabs: ['bases'] },
      { id: 'regime', icon: 'plus', label: 'pdicts.add.regime', tabs: ['regimes'] },
      { id: 'benefit', icon: 'plus', label: 'pdicts.add.benefit', tabs: ['benefits'] },
      {
        id: 'value',
        icon: 'plus',
        label: 'pdicts.add.value',
        tabs: ['forms', 'organs', 'banks', 'cats', 'reasons'],
      },
      { id: 'phone', icon: 'globe', label: 'pdicts.add.phone', tabs: ['phones'] },
      { id: 'ugns', icon: 'landmark', label: 'pdicts.add.ugns', tabs: ['ugns'] },
      { id: 'holiday', icon: 'calendar', label: 'pdicts.add.holiday', tabs: ['calendar'] },
      {
        id: 'calendar_copy',
        icon: 'copy',
        label: 'pdicts.add.calendar_copy',
        tabs: ['calendar'],
      },
    ],
  },
  l10n: {
    icon: 'globe',
    title: 'nav.l10n',
    short: 'nav.short.l10n',
    desc: 'nav.desc.l10n',
  },
  kbadm: {
    icon: 'layers',
    title: 'nav.kb_content',
    short: 'nav.short.kbadm',
    desc: 'nav.desc.kbadm',
    tabs: [
      { id: 'steps', icon: 'list', label: 'tab.kbadm.steps' },
      { id: 'shows', icon: 'play', label: 'tab.kbadm.shows' },
      { id: 'arts', icon: 'book', label: 'tab.kbadm.arts' },
      { id: 'levels', icon: 'grad', label: 'tab.kbadm.levels' },
      { id: 'news', icon: 'bell', label: 'tab.kbadm.news' },
    ],
    add: [{ id: 'news', icon: 'bell', label: 'add.kbadm.news', tabs: ['news'] }],
  },
  tg: {
    icon: 'tg',
    title: 'nav.telegram',
    short: 'nav.short.tg',
    desc: 'nav.desc.tg',
    tabs: [
      { id: 'log', icon: 'list', label: 'tab.tg.log' },
      { id: 'bot', icon: 'sliders', label: 'tab.tg.bot' },
      { id: 'cast', icon: 'send', label: 'tab.tg.cast' },
    ],
    add: [{ id: 'cast', icon: 'send', label: 'add.tg.cast' }],
  },
};

/**
 * Четыре основных модуля нижней панели телефона (прототип core/session.js BNAV; ТЗ «Мобильная
 * навигация»): у организации и у администратора платформы свои.
 */
export const BOTTOM_NAV = {
  business: ['home', 'cps', 'reports', 'tasks'],
  admin: ['accounts', 'orgs', 'pdicts', 'tg'],
} as const satisfies Record<'business' | 'admin', readonly MenuModuleId[]>;

/**
 * Модули меню на телефоне: внизу — основные, на которые есть право (основной модуль без права просто
 * не показывается), в «Других модулях» — все остальные, в порядке меню.
 */
export function phoneModules(
  modules: readonly MenuModuleId[],
  admin: boolean,
): { bottom: MenuModuleId[]; other: MenuModuleId[] } {
  const main: readonly MenuModuleId[] = BOTTOM_NAV[admin ? 'admin' : 'business'];
  return {
    bottom: modules.filter((m) => main.includes(m)),
    other: modules.filter((m) => !main.includes(m)),
  };
}

/** Адрес страниц за входом: /app/<модуль>/<вкладка> (адреса `app` нет среди адресов организаций). */
export const APP_PATH = '/app';

export function isModuleId(id: string): id is MenuModuleId {
  return Object.hasOwn(MODULES, id);
}

/** Вкладки модуля, которые видит вошедший, по порядку. */
export function visibleTabs(id: MenuModuleId, access: ShellAccess): readonly TabDef[] {
  return (MODULES[id].tabs ?? []).filter((t) => !t.when || t.when(access));
}

/**
 * Способы добавления, на которые есть право, на вкладке `tabId`; пусто — кнопки «+ Добавить» нет.
 */
export function addActions(
  id: MenuModuleId,
  access: ShellAccess,
  tabId: string | null = null,
): readonly AddDef[] {
  return (MODULES[id].add ?? []).filter(
    (a) => (!a.when || a.when(access)) && (!a.tabs || (tabId !== null && a.tabs.includes(tabId))),
  );
}

export function tabHref(moduleId: MenuModuleId, tabId: string): string {
  return `${APP_PATH}/${moduleId}/${tabId}`;
}

/** Адрес модуля — сразу на первой видимой вкладке. */
export function moduleHref(id: MenuModuleId, access: ShellAccess): string {
  const first = visibleTabs(id, access)[0];
  return first ? tabHref(id, first.id) : `${APP_PATH}/${id}`;
}

/** Модуль и вкладка из адреса страницы: /app/reports/week → reports, week. */
export function parseAppPath(pathname: string): { moduleId: string | null; tabId: string | null } {
  const [, base, moduleId, tabId] = pathname.split('/');
  if (`/${base}` !== APP_PATH) return { moduleId: null, tabId: null };
  return { moduleId: moduleId || null, tabId: tabId || null };
}

/**
 * Куда вести по адресу: модуль, которого нет в меню вошедшего, — на первый модуль меню; вкладка,
 * которой нет или которая не видна, — на её `fallback` или первую видимую (как route() прототипа).
 */
export function resolveAppRoute(
  me: MeResponse,
  moduleId: string | undefined,
  tabPath: readonly string[] | undefined,
): { moduleId: MenuModuleId; tabId: string | null } | { redirect: string } {
  const access = shellAccess(me);
  const allowed = me.modules.find((m) => m === moduleId);
  if (!allowed) {
    const first = me.modules[0];
    return { redirect: first ? moduleHref(first, access) : '/login' };
  }
  const tabs = visibleTabs(allowed, access);
  const tabId = tabPath?.[0];
  if (tabs.length === 0) {
    return tabPath && tabPath.length > 0
      ? { redirect: `${APP_PATH}/${allowed}` }
      : { moduleId: allowed, tabId: null };
  }
  if (tabPath?.length === 1 && tabs.some((t) => t.id === tabId)) {
    return { moduleId: allowed, tabId: tabId! };
  }
  const fallback = (MODULES[allowed].tabs ?? []).find((t) => t.id === tabId)?.fallback;
  const to = tabs.find((t) => t.id === fallback) ?? tabs[0]!;
  return { redirect: tabHref(allowed, to.id) };
}
