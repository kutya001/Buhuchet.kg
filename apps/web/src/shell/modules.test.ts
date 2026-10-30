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
  MODULES,
  moduleHref,
  parseAppPath,
  phoneModules,
  resolveAppRoute,
  roleEditorOf,
  shellAccess,
  visibleTabs,
} from './modules';
import {
  parseMaxPrefs,
  parseNavHidden,
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
    expect(addActions('pdicts', access, 'requests')).toEqual([]);
    expect(addActions('pdicts', access)).toEqual([]);
  });

  it('у «Базы знаний (содержимое)» способ добавления — своей вкладки: «Новость» только на «Новостях»', () => {
    const access = shellAccess(me({ admin: true }));
    expect(ids(addActions('kbadm', access, 'news'))).toEqual(['news']);
    expect(addActions('kbadm', access, 'steps')).toEqual([]);
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

  it('адрес модуля — сразу на первой видимой вкладке; без вкладок — сам модуль', () => {
    const access = shellAccess(me());
    expect(moduleHref('reports', access)).toBe('/app/reports/week');
    expect(moduleHref('files', access)).toBe('/app/files');
  });

  it('открытый модуль и видимая вкладка — показываются', () => {
    expect(resolveAppRoute(me(), 'reports', ['overdue'])).toEqual({
      moduleId: 'reports',
      tabId: 'overdue',
    });
    expect(resolveAppRoute(me({ modules: ['files'] }), 'files', undefined)).toEqual({
      moduleId: 'files',
      tabId: null,
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
    expect(resolveAppRoute(me({ modules: ['files'] }), 'files', ['x'])).toEqual({
      redirect: '/app/files',
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
  it('тема — только light или dark, иначе тема устройства', () => {
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
