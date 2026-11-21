import {
  FEATURES,
  MENU_MODULE_IDS,
  MENU_MODULES,
  PERMISSION_IDS,
  UI_TEXTS,
  type Feature,
  type MenuModuleId,
  type PermissionId,
} from '@buhuchet/domain';
import type { MeResponse } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import {
  addActions,
  lockedMe,
  MODULES,
  moduleHref,
  parseAppPath,
  phoneModules,
  resolveAppRoute,
  roleEditorOf,
  shellAccess,
  subLock,
  visibleTabs,
} from './modules';
import {
  parseMaxPrefs,
  parseNavHidden,
  parseWide,
  parseTheme,
  parseTree,
  prefCookie,
  serializeMaxPrefs,
  serializeTree,
} from './prefs';

const ALL_FEATURES = Object.fromEntries(FEATURES.map((f) => [f, true])) as Record<Feature, boolean>;

function me({
  modules = ['home', 'cps', 'reports', 'fin', 'staff'] as MenuModuleId[],
  permissions = PERMISSION_IDS as readonly PermissionId[],
  features = ALL_FEATURES as Partial<Record<Feature, boolean>>,
  admin = false,
  reportConfirm = true,
} = {}): MeResponse {
  return {
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      login: 'erkin',
      isPlatformAdmin: admin,
      mustChangePassword: false,
    },
    employee: null,
    organization: null,
    telegram: null,
    permissions: [...permissions],
    scopes: {},
    features,
    reportConfirm,
    payFirst: false,
    modules,
  };
}

const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);

describe('реестр модулей оболочки', () => {
  it('описан каждый модуль меню, все тексты — из словаря', () => {
    expect(Object.keys(MODULES).sort()).toEqual([...MENU_MODULE_IDS].sort());
    const keys = Object.values(MODULES).flatMap((m) => [
      m.title,
      m.short,
      m.desc,
      ...(m.tabs ?? []).map((t) => t.label),
      ...(m.add ?? []).flatMap((a) => (a.sub ? [a.label, a.sub] : [a.label])),
    ]);
    expect(keys.filter((k) => !(k in UI_TEXTS))).toEqual([]);
  });

  it('у вкладок и способов добавления модуля нет повторов', () => {
    for (const m of Object.values(MODULES)) {
      expect(new Set(ids(m.tabs ?? [])).size).toBe((m.tabs ?? []).length);
      expect(new Set(ids(m.add ?? [])).size).toBe((m.add ?? []).length);
    }
  });
});

describe('вкладки и «+ Добавить» по правам и учётной политике', () => {
  it('владелец со всеми функциями видит все вкладки «Финансовых операций»', () => {
    expect(ids(visibleTabs('fin', shellAccess(me())))).toEqual([
      'all',
      'tax',
      'fee',
      'proj',
      'wo',
      'journal',
    ]);
  });

  it('без учёта оплаты налогов нет вкладок оплаты, без платы за обслуживание — «Плата» и «Должники»', () => {
    const access = shellAccess(me({ features: { ...ALL_FEATURES, taxpay: false, fee: false } }));
    expect(ids(visibleTabs('fin', access))).toEqual(['all', 'proj']);
    expect(ids(visibleTabs('cps', access))).toEqual(['all', 'mine']);
    expect(ids(addActions('fin', access))).toEqual(['service']);
  });

  it('вкладка «Проекты» в финансах — при плате за обслуживание или праве вести проекты', () => {
    const noProjects = PERMISSION_IDS.filter((p) => p !== 'projects');
    const noFee = { ...ALL_FEATURES, fee: false };
    expect(
      ids(visibleTabs('fin', shellAccess(me({ permissions: noProjects, features: noFee })))),
    ).not.toContain('proj');
    expect(ids(visibleTabs('fin', shellAccess(me({ permissions: noProjects }))))).toContain('proj');
  });

  it('«Ожидают подтверждения» — только при включённой «Сдача отчётов требует подтверждения»', () => {
    expect(ids(visibleTabs('reports', shellAccess(me())))).toContain('waiting');
    expect(ids(visibleTabs('reports', shellAccess(me({ reportConfirm: false }))))).toEqual([
      'week',
      'overdue',
      'all',
      'months',
      'matrix',
      'calendar',
    ]);
  });

  it('«Календарь» отчётов — только при включённом календаре сроков', () => {
    const off = shellAccess(me({ features: { ...ALL_FEATURES, calendar: false } }));
    expect(ids(visibleTabs('reports', off))).not.toContain('calendar');
    expect(ids(visibleTabs('reports', shellAccess(me())))).toContain('calendar');
  });

  it('бухгалтер без прав на сотрудников видит только список, без «+ Добавить»', () => {
    const access = shellAccess(
      me({ permissions: ['cpView', 'repView', 'staffView'] as PermissionId[] }),
    );
    expect(ids(visibleTabs('staff', access))).toEqual(['list']);
    expect(addActions('staff', access)).toEqual([]);
  });

  it('загрузка показателей из Excel — отдельной кнопкой; «Попросить добавить» и «Мои запросы» — без права', () => {
    const kpi = addActions('kpi', shellAccess(me()));
    expect(kpi.find((a) => a.id === 'excel')?.separate).toBe(true);
    expect(ids(addActions('dicts', shellAccess(me({ permissions: [] }))))).toEqual([
      'request',
      'mine',
    ]);
  });

  it('«Справочники платформы»: вкладки по группам, «+ Добавить» — по вкладке', () => {
    const access = shellAccess(me({ admin: true }));
    const tabs = visibleTabs('pdicts', access);
    expect(tabs.map((t) => t.group).filter((g, i, all) => g !== all[i - 1])).toEqual([
      'tab.pdicts.group.taxes',
      'tab.pdicts.group.regimes',
      'tab.pdicts.group.classes',
      'tab.pdicts.group.organs',
      'tab.pdicts.group.system',
      'tab.pdicts.group.service',
    ]);
    expect(ids(addActions('pdicts', access, 'organs'))).toEqual([
      'value',
      'io_export',
      'io_import',
    ]);
    expect(ids(addActions('pdicts', access, 'ugns'))).toEqual(['ugns', 'io_export', 'io_import']);
    expect(addActions('pdicts', access, 'types').find((a) => a.id === 'io_export')?.sep).toBe(true);
    // «ГКЭД»: «Код ГКЭД» и Excel; календарь — Excel рядом с «Нерабочий день» (задачи 2.37 и 2.38).
    expect(ids(addActions('pdicts', access, 'gked'))).toEqual(['gked', 'io_export', 'io_import']);
    expect(ids(addActions('pdicts', access, 'calendar'))).toEqual(
      expect.arrayContaining(['io_export', 'io_import']),
    );
    expect(addActions('pdicts', access, 'requests')).toEqual([]);
    expect(addActions('pdicts', access)).toEqual([]);
  });

  it('у «Базы знаний (содержимое)» способ добавления — своей вкладки и Excel; у «Уровней» — ничего', () => {
    const access = shellAccess(me({ admin: true }));
    const io = ['io_export', 'io_import'];
    expect(ids(addActions('kbadm', access, 'news'))).toEqual(['news', ...io]);
    expect(ids(addActions('kbadm', access, 'steps'))).toEqual(['step', ...io]);
    expect(ids(addActions('kbadm', access, 'shows'))).toEqual(['show', ...io]);
    // «Страница контрагента» (прототип v120 cphAdmAdd): «Вопрос», «Слово» и Excel своего раздела.
    expect(ids(addActions('kbadm', access, 'cppage'))).toEqual(['cph_faq', 'cph_word', ...io]);
    expect(ids(addActions('kbadm', access, 'arts'))).toEqual(['art', ...io]);
    expect(addActions('kbadm', access, 'arts').find((a) => a.id === 'io_export')?.sep).toBe(true);
    expect(addActions('kbadm', access, 'levels')).toEqual([]);
    // Видео платформы (прототип v79 kbAdmAdd): «Видео» без Excel; у «Просмотров видео» — ничего.
    expect(ids(addActions('kbadm', access, 'video'))).toEqual(['video']);
    expect(addActions('kbadm', access, 'vviews')).toEqual([]);
  });

  it('«Витрина данных» (прототип v155 dmTabs, dmAdd): Админке — «Шаблон» и «Токен»; организации — «Токен» только с «Управлять API-токенами» и «Попросить шаблон»', () => {
    // Вкладки — «Вывод» первой, «Шаблоны» и «API Токены» (другие вкладки модуля добавляют свои задачи).
    const admin = shellAccess(me({ admin: true }));
    expect(ids(visibleTabs('dm', admin)).slice(0, 3)).toEqual(['out', 'tpl', 'tok']);
    expect(ids(addActions('dm', admin))).toEqual(['tpl', 'tok']);
    const owner = shellAccess(me());
    expect(ids(visibleTabs('dm', owner)).slice(0, 3)).toEqual(['out', 'tpl', 'tok']);
    expect(ids(addActions('dm', owner))).toEqual(['tok', 'ask']);
    const viewer = shellAccess(
      me({ permissions: PERMISSION_IDS.filter((p) => p !== 'dmTokens') as PermissionId[] }),
    );
    expect(ids(visibleTabs('dm', viewer)).slice(0, 2)).toEqual(['out', 'tpl']);
    expect(ids(visibleTabs('dm', viewer))).not.toContain('tok');
    expect(ids(addActions('dm', viewer))).toEqual(['ask']);
  });
});

describe('вошедший для правил формы роли', () => {
  it('своя роль, действующие права и область из «Кто я»; у администратора — никто', () => {
    expect(roleEditorOf(me({ admin: true }))).toBeNull();
    const editor = roleEditorOf({
      ...me({ permissions: ['cpView', 'staffView', 'staff'] }),
      employee: {
        id: '00000000-0000-4000-8000-000000000002',
        fullName: 'Кадров Тест',
        shortName: 'Тест К.',
        phone: null,
        roleId: '00000000-0000-4000-8000-000000000003',
        roleName: 'Кадры',
        isOwner: false,
      },
      scopes: { cps: 'all', reports: 'own' },
    });
    expect(editor).toEqual({
      isOwner: false,
      roleId: '00000000-0000-4000-8000-000000000003',
      subject: {
        employeeId: '00000000-0000-4000-8000-000000000002',
        isOwner: false,
        permissions: new Set(['cpView', 'staffView', 'staff']),
        scopes: { cps: 'all', reports: 'own' },
      },
    });
  });
});

describe('адрес страницы за входом', () => {
  it('модуль и вкладка из адреса /app/модуль/вкладка', () => {
    expect(parseAppPath('/app/reports/week')).toEqual({ moduleId: 'reports', tabId: 'week' });
    expect(parseAppPath('/app/files')).toEqual({ moduleId: 'files', tabId: null });
    expect(parseAppPath('/app')).toEqual({ moduleId: null, tabId: null });
    expect(parseAppPath('/bukhgalter-plus/inn/01203201910123')).toEqual({
      moduleId: null,
      tabId: null,
    });
  });

  // Без «Страницы контрагента по ссылке» у «Файлового менеджера» вкладок нет (прототип v112 `filesTabs`).
  const noPage = { ...ALL_FEATURES, cppage: false };

  it('адрес модуля — сразу на первой видимой вкладке; без вкладок — сам модуль', () => {
    const access = shellAccess(me());
    expect(moduleHref('reports', access)).toBe('/app/reports/week');
    expect(moduleHref('files', access)).toBe('/app/files/all');
    expect(moduleHref('files', shellAccess(me({ features: noPage })))).toBe('/app/files');
  });

  it('«Файловый менеджер»: «Все файлы» и «Файлы от контрагентов» — только со «Страницей контрагента»', () => {
    expect(ids(visibleTabs('files', shellAccess(me())))).toEqual(['all', 'sent']);
    expect(ids(visibleTabs('files', shellAccess(me({ features: noPage }))))).toEqual([]);
  });

  it('открытый модуль и видимая вкладка — показываются', () => {
    expect(resolveAppRoute(me(), 'reports', ['overdue'])).toEqual({
      moduleId: 'reports',
      tabId: 'overdue',
    });
    expect(
      resolveAppRoute(me({ modules: ['files'], features: noPage }), 'files', undefined),
    ).toEqual({
      moduleId: 'files',
      tabId: null,
    });
    expect(resolveAppRoute(me({ modules: ['files'] }), 'files', ['sent'])).toEqual({
      moduleId: 'files',
      tabId: 'sent',
    });
  });

  it('«Ожидают подтверждения» без подтверждения сдачи в учётной политике — на «Все отчёты» (прототип renderReports)', () => {
    expect(resolveAppRoute(me({ reportConfirm: false }), 'reports', ['waiting'])).toEqual({
      redirect: '/app/reports/all',
    });
    expect(resolveAppRoute(me({ reportConfirm: false }), 'reports', ['nope'])).toEqual({
      redirect: '/app/reports/week',
    });
  });

  it('модуля нет в меню (нет права «Просматривать …») — на первый модуль меню', () => {
    expect(resolveAppRoute(me(), 'projects', ['active'])).toEqual({
      redirect: '/app/home/today',
    });
    expect(resolveAppRoute(me(), 'nope', undefined)).toEqual({ redirect: '/app/home/today' });
    expect(resolveAppRoute(me({ modules: [] }), 'home', undefined)).toEqual({
      redirect: '/login',
    });
  });

  it('вкладки нет, она не видна или адрес длиннее — на первую видимую вкладку', () => {
    const noCalendar = me({ features: { ...ALL_FEATURES, calendar: false } });
    expect(resolveAppRoute(noCalendar, 'reports', ['calendar'])).toEqual({
      redirect: '/app/reports/week',
    });
    expect(resolveAppRoute(me(), 'reports', undefined)).toEqual({
      redirect: '/app/reports/week',
    });
    expect(resolveAppRoute(me(), 'reports', ['week', 'x'])).toEqual({
      redirect: '/app/reports/week',
    });
    expect(resolveAppRoute(me({ modules: ['files'], features: noPage }), 'files', ['x'])).toEqual({
      redirect: '/app/files',
    });
    expect(resolveAppRoute(me({ modules: ['files'] }), 'files', ['x'])).toEqual({
      redirect: '/app/files/all',
    });
  });

  it('администратор платформы попадает в модули Админки', () => {
    const admin = me({ admin: true, modules: ['accounts', 'orgs', 'pdicts'], permissions: [] });
    expect(resolveAppRoute(admin, 'home', undefined)).toEqual({ redirect: '/app/accounts' });
    expect(resolveAppRoute(admin, 'pdicts', ['gked'])).toEqual({
      moduleId: 'pdicts',
      tabId: 'gked',
    });
  });
});

describe('меню на телефоне (ТЗ «Мобильная навигация»)', () => {
  it('внизу ровно 4 основных модуля, остальные — в «Других модулях» в порядке меню', () => {
    const all = MENU_MODULES.map((m) => m.id);
    const { bottom, other } = phoneModules(all, false);
    expect(bottom).toEqual(['home', 'cps', 'reports', 'tasks']);
    expect(other).toEqual(all.filter((m) => !bottom.includes(m)));
    expect(other).not.toContain('home');
  });

  it('основной модуль без права не показывается и не переезжает в «Другие модули»', () => {
    const { bottom, other } = phoneModules(['home', 'reports', 'fin', 'staff'], false);
    expect(bottom).toEqual(['home', 'reports']);
    expect(other).toEqual(['fin', 'staff']);
  });

  it('у администратора платформы внизу — свои четыре модуля Админки', () => {
    const { bottom, other } = phoneModules(['accounts', 'orgs', 'pdicts', 'kb', 'tg'], true);
    expect(bottom).toEqual(['accounts', 'orgs', 'pdicts', 'tg']);
    expect(other).toEqual(['kb']);
  });
});

describe('выбор на устройстве: тема, левая панель, раскрытые ветки, «На весь экран»', () => {
  it('тема — только light или dark, иначе выбора нет (светлая, прототип v88)', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('blue')).toBeNull();
    expect(parseTheme(undefined)).toBeNull();
  });

  it('левая панель скрыта только по явному выбору', () => {
    expect(parseNavHidden('hidden')).toBe(true);
    expect(parseNavHidden('shown')).toBe(false);
    expect(parseNavHidden(undefined)).toBe(false);
  });

  it('(прототип v85) «На всю ширину» — только по явному выбору', () => {
    expect(parseWide('on')).toBe(true);
    expect(parseWide('off')).toBe(false);
    expect(parseWide('true')).toBe(false);
    expect(parseWide(undefined)).toBe(false);
  });

  it('раскрытые ветки: только известные модули и без повторов', () => {
    const known = ['home', 'reports', 'cps'];
    expect(parseTree('reports.cps.reports.<script>', known)).toEqual(['reports', 'cps']);
    expect(parseTree(undefined, known)).toEqual([]);
    expect(parseTree(serializeTree(new Set(['cps', 'home'])), known)).toEqual(['cps', 'home']);
  });

  it('«На весь экран» запоминается отдельно для карточек и для форм', () => {
    expect(parseMaxPrefs(undefined)).toEqual({ card: false, form: false });
    expect(parseMaxPrefs('card')).toEqual({ card: true, form: false });
    expect(parseMaxPrefs('form.card.x')).toEqual({ card: true, form: true });
    expect(serializeMaxPrefs({ card: true, form: false })).toBe('card');
    expect(serializeMaxPrefs({ card: false, form: false })).toBe('');
    expect(parseMaxPrefs(serializeMaxPrefs({ card: false, form: true }))).toEqual({
      card: false,
      form: true,
    });
  });

  it('cookie выбора — на год, для всего сайта, по https — с Secure', () => {
    expect(prefCookie('bh_theme', 'dark', false)).toBe(
      'bh_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax',
    );
    expect(prefCookie('bh_tree', 'a.b', true)).toMatch(/^bh_tree=a\.b; .*; Secure$/);
  });
});

// «Подписка» и закрытый доступ (доработки 20.11.2026, блок 4, пункты 4–5, блок 5, пункт 1; прототип
// v154 `orgTabs`, `subLockMods`): вкладку видит только владелец, при закрытом доступе у владельца —
// только «Моя организация» → «Подписка», у сотрудника — «Доступ закрыт».
describe('подписка в оболочке', () => {
  const employee = (isOwner: boolean): MeResponse['employee'] => ({
    id: '00000000-0000-4000-8000-000000000002',
    fullName: 'Садыков Эркин',
    shortName: 'Садыков Э.',
    phone: null,
    roleId: '00000000-0000-4000-8000-000000000003',
    roleName: isOwner ? 'Владелец' : 'Бухгалтер',
    isOwner,
  });
  const sub = (status: 'active' | 'expiring' | 'overdue' | 'none' | 'demo', closed = false) => ({
    status,
    paidUntil: status === 'none' ? null : '2026-11-25',
    closed,
  });
  const withSub = (
    isOwner: boolean,
    subscription: ReturnType<typeof sub> | null,
    o: Parameters<typeof me>[0] = {},
  ): MeResponse => ({
    ...me({ modules: ['home', 'cps', 'org'], ...o }),
    employee: employee(isOwner),
    subscription,
  });
  const orgTabs = (m: MeResponse) => ids(visibleTabs('org', shellAccess(m)));

  it('«Подписка» — только владельцу, не в демо-организации и не администратору', () => {
    expect(orgTabs(withSub(true, sub('active')))).toEqual(['main', 'policy', 'settings', 'sub']);
    expect(orgTabs(withSub(false, sub('active')))).toEqual(['main', 'policy', 'settings']);
    expect(orgTabs(withSub(true, sub('demo')))).toEqual(['main', 'policy', 'settings']);
    expect(orgTabs(withSub(true, null))).toEqual(['main', 'policy', 'settings']);
    expect(
      orgTabs({ ...withSub(true, sub('active')), user: { ...me().user, isPlatformAdmin: true } }),
    ).toEqual(['main', 'policy', 'settings']);
  });

  it('доступ закрыт: владелец — только «Подписка», сотрудник — «Доступ закрыт»', () => {
    const owner = withSub(true, sub('overdue', true));
    expect(subLock(owner)).toBe('owner');
    const locked = lockedMe(owner);
    expect(locked.modules).toEqual(['org']);
    expect(orgTabs(locked)).toEqual(['sub']);
    expect(resolveAppRoute(locked, 'cps', ['all'])).toEqual({ redirect: '/app/org/sub' });
    expect(resolveAppRoute(locked, 'org', ['main'])).toEqual({ redirect: '/app/org/sub' });
    expect(resolveAppRoute(locked, 'org', ['sub'])).toEqual({ moduleId: 'org', tabId: 'sub' });

    const staff = withSub(false, sub('none', true));
    expect(subLock(staff)).toBe('staff');
    expect(lockedMe(staff)).toBe(staff);
    // Сотруднику сервер подписку не отдаёт — только «доступ закрыт».
    expect(subLock({ ...withSub(false, null), subClosed: true })).toBe('staff');
    expect(subLock({ ...withSub(false, null), subClosed: false })).toBeNull();
  });

  it('открытый доступ и администратор — без замка', () => {
    expect(subLock(withSub(true, sub('expiring')))).toBeNull();
    expect(subLock(withSub(false, null))).toBeNull();
    const admin = { ...withSub(false, sub('overdue', true)), employee: null };
    expect(subLock(admin)).toBeNull();
    expect(lockedMe(withSub(true, sub('active'))).modules).toEqual(['home', 'cps', 'org']);
  });
});
