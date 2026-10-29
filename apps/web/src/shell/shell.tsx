'use client';

import { initials, type MenuModuleId } from '@buhuchet/domain';
import { MeResponse } from '@buhuchet/shared';
import {
  AppFrame,
  BottomNav,
  BottomSheet,
  buttonClass,
  ConfirmDialog,
  Icon,
  Modal,
  PhoneMenu,
  SheetAction,
  SideFootButton,
  SideFootRow,
  SideNav,
  SideOrg,
  TabPager,
  TabRow,
  TopBar,
  useWindow,
  useWindows,
  type AddAction,
  type MaxPrefs,
  type PhoneModule,
  type ShellLink,
  type ShellModule,
  type TabRowProps,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api-client';
import { kbStateQuery } from '../kb/kb-data';
import { KbContext, useKb, useKbRuntime, type KbControls } from '../kb/kb-provider';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { newsUnreadQuery } from '../news/news-data';
import { NewsContext, useNewsRuntime, type NewsControls } from '../news/news-provider';
import { OrgProfileWindow } from '../org/org-profile-window';
import { ProfileWindow } from '../profile/profile-window';
import { QueryProvider } from '../query';
import { useModuleStats } from '../lists/stats';
import { ModuleScreen, screenHasPlates } from '../screens/module-screen';
import { PHONE_QUERY, saveNavHidden, saveTree, toggleTheme } from './browser';
import { Clock } from './clock';
import { ShellContext, type AddRequest } from './context';
import {
  addActions,
  APP_PATH,
  canEnter,
  isModuleId,
  MODULES,
  moduleHref,
  parseAppPath,
  phoneModules,
  roleEditorOf,
  shellAccess,
  tabHref,
  visibleTabs,
  type ShellAccess,
} from './modules';
import { menuDot, useTabCounts, withTabCounts } from './tab-counts';
import { UiProviders } from './ui-providers';

export { useShell, type AddRequest } from './context';

const NextLink: ShellLink = (props) => <Link {...props} />;
/** Переход из панели «Меню» заменяет её запись в истории: «Назад» вернёт на прежнюю страницу. */
const ReplaceLink: ShellLink = (props) => <Link {...props} replace />;

function shellModule(id: MenuModuleId, access: ShellAccess, t: Translate): ShellModule {
  const def = MODULES[id];
  return {
    id,
    title: t(def.title),
    icon: def.icon,
    href: moduleHref(id, access),
    tabs: visibleTabs(id, access).map((tab) => {
      const label = t(tab.label);
      const group = tab.group && t(tab.group);
      return {
        id: tab.id,
        label,
        icon: tab.icon,
        href: tabHref(id, tab.id),
        ...(group ? { group, title: t('tab.grouped', { group, tab: label }) } : {}),
      };
    }),
  };
}

interface ShellProps {
  me: MeResponse;
  initialNavHidden: boolean;
  initialOpen: readonly string[];
  /** Развёрнутые на весь экран карточки и формы (выбор на этом устройстве). */
  initialMax: MaxPrefs;
  /** Момент показа страницы на сервере (мс) — часы первого показа. */
  serverNow: number;
  children: ReactNode;
}

/**
 * Рабочая страница за входом (ТЗ «Рабочая страница (work_page)» и «Мобильная навигация», прототип
 * ui/shell.js): левая панель модулей по правам и учётной политике, верхняя панель, ряд вкладок и
 * «+ Добавить»; на телефоне — нижняя панель из четырёх основных модулей, панель «Меню» с «Другими
 * модулями» и листание вкладок свайпом. Экран модуля — `children`. Модули не рисуют свои заголовки,
 * кнопки добавления и поля поиска — всё это даёт оболочка. Окна (`Modal`) и уведомления (`useToast`)
 * экраны берут из `@buhuchet/ui`: тексты и выбор «На весь экран» им даёт оболочка.
 */
export function Shell({ initialMax, ...props }: ShellProps) {
  return (
    <QueryProvider>
      <UiProviders initialMax={initialMax}>
        <ShellPage {...props} />
      </UiProviders>
    </QueryProvider>
  );
}

/** Нижняя строка окна помощи: «Открыть Базу знаний» (окно закрывается, переход заменяет его в истории) и «Закрыть». */
function HelpFooter({ kbHref }: { kbHref: string }) {
  const t = useT();
  const { close, leave } = useWindow();
  return (
    <>
      <Link href={kbHref} replace onClick={leave} className={buttonClass('ghost')}>
        <Icon name="grad" size="sm" />
        {t('kb.open')}
      </Link>
      <div className="flex-1" />
      <button type="button" onClick={close} className={buttonClass('cta')}>
        {t('btn.close')}
      </button>
    </>
  );
}

/**
 * Ряд вкладок модуля; у экрана с плашками-итогами — с кнопкой «Статистика» (выбор хранится в
 * настройках вида пользователя для модуля, отдельно на ПК и на телефоне).
 */
function ModuleTabRow({
  moduleId,
  plates,
  ...props
}: TabRowProps & { moduleId: MenuModuleId; plates: boolean }) {
  if (!plates) return <TabRow {...props} />;
  return <TabRowWithStats moduleId={moduleId} {...props} />;
}

function TabRowWithStats({ moduleId, ...props }: TabRowProps & { moduleId: MenuModuleId }) {
  const t = useT();
  const kb = useKb();
  const stats = useModuleStats(moduleId);
  return (
    <TabRow
      {...props}
      stats={{
        shown: stats.shown,
        onToggle: () => {
          // «Скрыть и показать статистику модуля» в «Базе знаний» — первое использование.
          kb.hit('stats');
          stats.toggle();
        },
        label: t('shell.stats'),
        show: t('shell.stats_show'),
        hide: t('shell.stats_hide'),
      }}
    />
  );
}

function ShellPage({
  me: initialMe,
  initialNavHidden,
  initialOpen,
  serverNow,
  children,
}: Omit<ShellProps, 'initialMax'>) {
  const t = useT();
  const windows = useWindows();
  const router = useRouter();
  const pathname = usePathname();
  const { moduleId, tabId } = parseAppPath(pathname);

  // Права и учётную политику меняет владелец, часто на другом устройстве: при каждом переходе меню
  // сверяется с сервером (прототип перерисовывает меню на каждом переходе). Этот же запрос продлевает
  // сеанс. Сеанс закрыт или вход больше не годится — на страницу входа.
  const [me, setMe] = useState(initialMe);
  const [shownMe, setShownMe] = useState(initialMe);
  if (shownMe !== initialMe) {
    setShownMe(initialMe);
    setMe(initialMe);
  }
  useEffect(() => {
    let cancelled = false;
    api.api.auth.me
      .$get()
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) return 'out';
        if (res.status !== 200) return null;
        const fresh = MeResponse.parse(await res.json());
        return canEnter(fresh) ? fresh : 'out';
      })
      .then((fresh) => {
        if (cancelled || !fresh) return;
        if (fresh === 'out') return window.location.assign('/login');
        setMe(fresh);
        // Открытый модуль пропал из меню — на первый модуль меню.
        if (moduleId && !fresh.modules.some((m) => m === moduleId)) router.replace(APP_PATH);
      })
      // Нет сети — меню остаётся прежним, данные всё равно проверяет API.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname, moduleId, router]);

  const access = useMemo(() => shellAccess(me), [me]);
  const counts = useTabCounts(me.modules);
  // «Начните с Базы знаний»: точка у модуля, пока уровень 0 % (прототип kbDot).
  const kbProgress = useQuery(kbStateQuery).data?.progress;
  const kbStart = !!kbProgress && kbProgress.total > 0 && kbProgress.pct === 0;
  // Непрочитанные новости: красный счётчик у модуля и вкладки «Новости» — вместо точки (прототип kbTabs).
  const newsUnread = useQuery({ ...newsUnreadQuery, enabled: me.modules.includes('kb') }).data ?? 0;
  const modules = useMemo(
    () =>
      me.modules.map((id) => {
        const m = withTabCounts(shellModule(id, access, t), counts[id]);
        if (id !== 'kb') return m;
        if (newsUnread) {
          const count = { value: newsUnread, tone: 'red' as const, title: t('news.badge') };
          return {
            ...m,
            count,
            tabs: m.tabs.map((tab) => (tab.id === 'news' ? { ...tab, count } : tab)),
          };
        }
        return kbStart ? { ...m, count: { value: '', dot: true, title: t('kb.dot') } } : m;
      }),
    [me.modules, access, t, counts, kbStart, newsUnread],
  );
  const current = modules.find((m) => m.id === moduleId) ?? null;
  const currentTab = current?.tabs.find((tab) => tab.id === tabId) ?? null;
  const phone = useMemo(() => {
    const split = phoneModules(me.modules, access.admin);
    const pick = (id: MenuModuleId, title: string): PhoneModule => {
      const m = modules.find((x) => x.id === id)!;
      return { id, title, icon: m.icon, href: m.href, count: m.count };
    };
    return {
      bottom: split.bottom.map((id) => pick(id, t(MODULES[id].short))),
      other: split.other.map((id) => pick(id, t(MODULES[id].title))),
    };
  }, [me.modules, access.admin, modules, t]);

  const [navHidden, setNavHidden] = useState(initialNavHidden);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(initialOpen));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  /** Выход ждёт ответа «Выйти без сохранения?»; `replace` — выход из панели «Меню». */
  const [askLogout, setAskLogout] = useState<{ replace: boolean } | null>(null);

  // Смена модуля или вкладки очищает поиск и забытый запрос «Добавить» (ТЗ «Общий поиск»).
  const route = `${moduleId}/${tabId}`;
  const [shownRoute, setShownRoute] = useState(route);
  if (shownRoute !== route) {
    setShownRoute(route);
    setSearch('');
    setAddRequest(null);
  }

  // Окно стало шире телефона — панели «Меню» там нет.
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const change = () => {
      if (!query.matches) setSheetOpen(false);
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  const actions: AddAction[] = current
    ? addActions(current.id as MenuModuleId, access, tabId ?? current.tabs[0]?.id ?? null).map(
        (a) => ({
          id: a.id,
          label: t(a.label),
          icon: a.icon,
          sub: a.sub && t(a.sub),
          badge: a.beta ? t('add.beta') : undefined,
          separate: a.separate,
        }),
      )
    : [];

  const toggleNav = () => {
    // На телефоне «Меню» выдвигает снизу панель с остальными модулями.
    if (window.matchMedia(PHONE_QUERY).matches) {
      setSheetOpen(true);
      return;
    }
    setNavHidden((hidden) => {
      saveNavHidden(!hidden);
      return !hidden;
    });
  };

  const toggleBranch = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveTree(next);
      return next;
    });
  };

  /** Выйти; из панели «Меню» — заменяя её запись в истории, чтобы «Назад» не вернул к панели. */
  const logout = async (replace: boolean) => {
    setLeaving(true);
    try {
      await api.api.auth.logout.$post();
    } finally {
      if (replace) window.location.replace('/login');
      else window.location.assign('/login');
    }
  };
  /**
   * В открытой форме несохранённые изменения — сначала «Выйти без сохранения?» (ТЗ «Панель модулей»,
   * решение заказчика 26.10.2026 — docs/deviations.md, п. 27).
   */
  const requestLogout = (replace = false) => {
    if (windows.hasUnsavedForm()) setAskLogout({ replace });
    else void logout(replace);
  };

  const title = current?.title ?? '';
  const desc = current ? t(MODULES[current.id as MenuModuleId].desc) : '';
  const state = useMemo(
    () => ({
      search,
      clearSearch: () => setSearch(''),
      addRequest,
      clearAddRequest: () => setAddRequest(null),
      access,
      userId: me.user.id,
      employeeId: me.employee?.id ?? null,
      editor: roleEditorOf(me),
    }),
    [search, addRequest, setAddRequest, access, me],
  );
  // «База знаний»: «Перейти» у шага, полоса урока, отметки шагов (задача 2.30).
  const tabHrefOf = useCallback(
    (module: MenuModuleId, tab?: string) => {
      if (!me.modules.includes(module)) return null;
      return tab && visibleTabs(module, access).some((x) => x.id === tab)
        ? tabHref(module, tab)
        : moduleHref(module, access);
    },
    [me.modules, access],
  );
  const kb = useKbRuntime({
    moduleId,
    screen: current ? [current.id, tabId ?? current.tabs[0]?.id].filter(Boolean).join('.') : null,
    tabHrefOf,
    hrefOf: (module) => (isModuleId(module) ? tabHrefOf(module) : null),
    tabsOf: (module) =>
      isModuleId(module)
        ? visibleTabs(module, access).map((x) => ({ id: x.id, label: t(x.label) }))
        : [],
    onAdd: useCallback(
      (module: MenuModuleId, actionId: string) => {
        const action = addActions(module, access).find((a) => a.id === actionId);
        if (!action) return;
        setAddRequest((prev) => ({
          moduleId: module,
          actionId,
          label: t(action.label),
          n: (prev?.n ?? 0) + 1,
        }));
      },
      [access, t],
    ),
    onProfile: useCallback(() => setProfileOpen(true), [setProfileOpen]),
    kbHref: moduleHref('kb', access),
    lessonsHref: tabHref('kb', 'lessons'),
  });
  // «Новости»: окно новости и «Что нового» после входа (задача 2.32).
  const news = useNewsRuntime({
    tabHrefOf,
    openArticle: kb.controls.openArticle,
    newsHref: tabHref('kb', 'news'),
    lessonsHref: tabHref('kb', 'lessons'),
  });
  const openHelp = () => {
    if (!moduleId || !isModuleId(moduleId)) return setHelpOpen(true);
    void kb.controls.help(moduleId).then((found) => {
      if (!found) setHelpOpen(true);
    });
  };

  const mode = t(access.admin ? 'shell.mode.admin' : 'shell.mode.business');
  const fullName = me.employee?.fullName ?? t('profile.platform_admin');

  return (
    <ShellContext.Provider value={state}>
      <KbProviders kb={kb.controls} news={news.controls}>
        <AppFrame
          navHidden={navHidden}
          paneLabel={title}
          side={
            <SideNav
              mode={mode}
              modules={modules}
              activeModule={moduleId}
              activeTab={tabId}
              openIds={openIds}
              onToggle={toggleBranch}
              labels={{
                nav: t('shell.modules'),
                expand: t('shell.expand_tabs'),
                collapse: t('shell.collapse_tabs'),
              }}
              Link={NextLink}
              footer={
                <>
                  {me.organization && (
                    <SideOrg
                      name={me.organization.name}
                      sub={
                        me.organization.inn ? t('shell.org_inn', { inn: me.organization.inn }) : ''
                      }
                      title={t('shell.org_profile')}
                      onClick={() => setOrgOpen(true)}
                    />
                  )}
                  <SideFootRow>
                    <SideFootButton
                      icon="user"
                      label={t('profile.title')}
                      onClick={() => setProfileOpen(true)}
                    />
                    <SideFootButton
                      icon="logout"
                      label={t('shell.logout')}
                      onClick={() => requestLogout()}
                      disabled={leaving}
                    />
                  </SideFootRow>
                </>
              }
            />
          }
          topBar={
            <TopBar
              title={title}
              tab={currentTab?.label ?? null}
              menu={{
                label: t('shell.menu'),
                onClick: toggleNav,
                // Непрочитанные новости — обычная точка у «Меню», цветная — только у показателей
                // (прототип renderSheetDot).
                ...menuDot(
                  phone.other.map((m) =>
                    m.id === 'kb' && m.count?.value
                      ? { ...m, count: { ...m.count, tone: undefined, dot: true } }
                      : m,
                  ),
                ),
              }}
              info={{
                label: t('shell.module_info'),
                content: (
                  <>
                    <h4 className="m-0 text-xs font-[650] tracking-[0.07em] text-faint uppercase">
                      {title}
                    </h4>
                    <div className="max-w-[300px] text-[13px] leading-normal">{desc}</div>
                  </>
                ),
              }}
              search={{
                value: search,
                onChange: (value) => {
                  setSearch(value);
                  if (value.trim()) kb.controls.hit('search');
                },
                placeholder: t('shell.search'),
                scope: currentTab?.label ?? title,
                openLabel: t('shell.search_open'),
              }}
              clock={<Clock initial={serverNow} />}
              help={{
                label: t('shell.help'),
                title: t('shell.help_title'),
                onClick: openHelp,
              }}
              theme={{
                label: t('shell.theme'),
                title: t('shell.theme_title'),
                onToggle: toggleTheme,
              }}
            />
          }
          bottomNav={
            <BottomNav
              modules={phone.bottom}
              active={moduleId}
              label={t('shell.modules')}
              Link={NextLink}
            />
          }
          sheet={
            <BottomSheet
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              label={t('shell.menu')}
            >
              {(leave) => (
                <PhoneMenu
                  mode={mode}
                  modules={phone.other}
                  active={moduleId}
                  label={t('shell.other_modules')}
                  // Выбор модуля закрывает панель; уже открытый модуль — просто закрывает.
                  onSelect={(e, m) => {
                    if (m.href === pathname) {
                      e.preventDefault();
                      setSheetOpen(false);
                    } else {
                      leave();
                    }
                  }}
                  Link={ReplaceLink}
                  footer={
                    <>
                      {me.organization && (
                        <SideOrg
                          name={me.organization.name}
                          sub={t('shell.org_profile')}
                          title={t('shell.org_profile')}
                          onClick={() => {
                            setSheetOpen(false);
                            setOrgOpen(true);
                          }}
                        />
                      )}
                      <SheetAction
                        icon="user"
                        avatar={initials(fullName)}
                        label={t('profile.title')}
                        sub={fullName}
                        onClick={() => {
                          setSheetOpen(false);
                          setProfileOpen(true);
                        }}
                      />
                      <SheetAction
                        icon="logout"
                        label={t('shell.logout')}
                        onClick={() => {
                          leave();
                          requestLogout(true);
                        }}
                        disabled={leaving}
                      />
                    </>
                  }
                />
              )}
            </BottomSheet>
          }
        >
          {current && (
            <ModuleTabRow
              moduleId={current.id as MenuModuleId}
              plates={screenHasPlates(current.id as MenuModuleId, tabId)}
              tabs={current.tabs}
              activeTab={tabId}
              label={title}
              addActions={actions}
              addLabel={t('btn.add')}
              onAdd={(actionId) =>
                setAddRequest((prev) => ({
                  moduleId: current.id,
                  actionId,
                  label: actions.find((a) => a.id === actionId)?.label ?? '',
                  n: (prev?.n ?? 0) + 1,
                }))
              }
              Link={NextLink}
            />
          )}
          {current ? (
            <TabPager
              tabs={current.tabs.map((tab) => tab.id)}
              activeTab={tabId}
              scope={current.id}
              renderTab={(tab) => (
                <ModuleScreen moduleId={current.id as MenuModuleId} tabId={tab} />
              )}
              onSwipe={(tab) => {
                kb.controls.hit('swipe');
                router.replace(tabHref(current.id as MenuModuleId, tab), { scroll: false });
              }}
            >
              {children}
            </TabPager>
          ) : (
            children
          )}
        </AppFrame>
        {kb.overlays}
        {news.overlays}
        {/* «?» без статьи о модуле — описание модуля (прототип kb.js kbHelp). */}
        <Modal
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          size="mid"
          title={title}
          sub={t('kb.title')}
          footer={<HelpFooter kbHref={moduleHref('kb', access)} />}
        >
          <p className="m-0 leading-[1.6]">{desc}</p>
          <p className="m-0 text-muted">{t('kb.no_article')}</p>
        </Modal>
        <ProfileWindow open={profileOpen} onClose={() => setProfileOpen(false)} me={me} />
        {me.organization && (
          <OrgProfileWindow
            open={orgOpen}
            onClose={() => setOrgOpen(false)}
            name={me.organization.name}
            canEdit={access.can('org')}
          />
        )}
        <ConfirmDialog
          open={askLogout !== null}
          onClose={() => setAskLogout(null)}
          title={t('shell.logout_discard_title')}
          text={t('shell.logout_discard_text')}
          ok={t('shell.logout_discard_ok')}
          danger
          onConfirm={() => void logout(askLogout?.replace ?? false)}
        />
      </KbProviders>
    </ShellContext.Provider>
  );
}

/** Управление «Базой знаний» и «Новостями» для экранов модулей (задачи 2.30 и 2.32). */
function KbProviders({
  kb,
  news,
  children,
}: {
  kb: KbControls;
  news: NewsControls;
  children: ReactNode;
}) {
  return (
    <KbContext.Provider value={kb}>
      <NewsContext.Provider value={news}>{children}</NewsContext.Provider>
    </KbContext.Provider>
  );
}
