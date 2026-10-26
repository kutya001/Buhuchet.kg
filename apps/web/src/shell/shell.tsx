'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import { MeResponse } from '@buhuchet/shared';
import {
  AppFrame,
  buttonClass,
  SideFootButton,
  SideFootRow,
  SideNav,
  SideOrg,
  TabRow,
  TopBar,
  type AddAction,
  type ShellLink,
  type ShellModule,
} from '@buhuchet/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { PHONE_QUERY, saveNavHidden, saveTree, toggleTheme } from './browser';
import { Clock } from './clock';
import {
  addActions,
  APP_PATH,
  canEnter,
  MODULES,
  moduleHref,
  parseAppPath,
  shellAccess,
  tabHref,
  visibleTabs,
  type ShellAccess,
} from './modules';

/** Запрос «+ Добавить»: какой способ выбран в каком модуле; `n` отличает повторный выбор того же. */
export interface AddRequest {
  moduleId: string;
  actionId: string;
  label: string;
  n: number;
}

interface ShellState {
  /** Общий поиск по текущей вкладке; при смене модуля или вкладки очищается. */
  search: string;
  addRequest: AddRequest | null;
  clearAddRequest: () => void;
}

const ShellContext = createContext<ShellState>({
  search: '',
  addRequest: null,
  clearAddRequest: () => {},
});

/** Состояние рабочей страницы для экранов модулей: поиск и выбранный способ добавления. */
export function useShell(): ShellState {
  return useContext(ShellContext);
}

const NextLink: ShellLink = (props) => <Link {...props} />;

function shellModule(id: MenuModuleId, access: ShellAccess, t: Translate): ShellModule {
  const def = MODULES[id];
  return {
    id,
    title: t(def.title),
    icon: def.icon,
    href: moduleHref(id, access),
    tabs: visibleTabs(id, access).map((tab) => ({
      id: tab.id,
      label: t(tab.label),
      icon: tab.icon,
      href: tabHref(id, tab.id),
    })),
  };
}

/**
 * Рабочая страница за входом (ТЗ «Рабочая страница (work_page)», прототип ui/shell.js): левая панель
 * модулей по правам и учётной политике, верхняя панель, ряд вкладок и «+ Добавить»; экран модуля —
 * `children`. Модули не рисуют свои заголовки, кнопки добавления и поля поиска — всё это даёт оболочка.
 */
export function Shell({
  me: initialMe,
  initialNavHidden,
  initialOpen,
  serverNow,
  children,
}: {
  me: MeResponse;
  initialNavHidden: boolean;
  initialOpen: readonly string[];
  /** Момент показа страницы на сервере (мс) — часы первого показа. */
  serverNow: number;
  children: ReactNode;
}) {
  const t = useT();
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
  const modules = useMemo(
    () => me.modules.map((id) => shellModule(id, access, t)),
    [me.modules, access, t],
  );
  const current = modules.find((m) => m.id === moduleId) ?? null;
  const currentTab = current?.tabs.find((tab) => tab.id === tabId) ?? null;

  const [navHidden, setNavHidden] = useState(initialNavHidden);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(initialOpen));
  const [search, setSearch] = useState('');
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Смена модуля или вкладки очищает поиск и забытый запрос «Добавить» (ТЗ «Общий поиск»).
  const route = `${moduleId}/${tabId}`;
  const [shownRoute, setShownRoute] = useState(route);
  if (shownRoute !== route) {
    setShownRoute(route);
    setSearch('');
    setAddRequest(null);
  }

  const actions: AddAction[] = current
    ? addActions(current.id as MenuModuleId, access).map((a) => ({
        id: a.id,
        label: t(a.label),
        icon: a.icon,
        sub: a.sub && t(a.sub),
        badge: a.beta ? t('add.beta') : undefined,
        separate: a.separate,
      }))
    : [];

  const toggleNav = () => {
    // На телефоне «Меню» выдвигает панель модулей снизу — задача #11.
    if (window.matchMedia(PHONE_QUERY).matches) return;
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

  const logout = async () => {
    setLeaving(true);
    try {
      await api.api.auth.logout.$post();
    } finally {
      window.location.assign('/login');
    }
  };

  const title = current?.title ?? '';
  const desc = current ? t(MODULES[current.id as MenuModuleId].desc) : '';
  const state = useMemo(
    () => ({ search, addRequest, clearAddRequest: () => setAddRequest(null) }),
    [search, addRequest, setAddRequest],
  );

  return (
    <ShellContext.Provider value={state}>
      <AppFrame
        navHidden={navHidden}
        paneLabel={title}
        side={
          <SideNav
            mode={t(access.admin ? 'shell.mode.admin' : 'shell.mode.business')}
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
                    href={`${APP_PATH}/org`}
                    Link={NextLink}
                  />
                )}
                <SideFootRow>
                  <SideFootButton
                    icon="logout"
                    label={t('shell.logout')}
                    onClick={logout}
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
            menu={{ label: t('shell.menu'), onClick: toggleNav }}
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
              onChange: setSearch,
              placeholder: t('shell.search'),
              scope: currentTab?.label ?? title,
            }}
            clock={<Clock initial={serverNow} />}
            help={{
              label: t('shell.help'),
              title: t('shell.help_title'),
              // Статей «Базы знаний» о модулях ещё нет: описание модуля и «Открыть Базу знаний».
              content: (close) => (
                <>
                  <h4 className="m-0 text-xs font-[650] tracking-[0.07em] text-faint uppercase">
                    {title}
                  </h4>
                  <div className="max-w-[300px] text-[13px] leading-normal">{desc}</div>
                  <Link
                    href={moduleHref('kb', access)}
                    onClick={close}
                    className={`${buttonClass('default', 'sm')} self-start`}
                  >
                    {t('kb.open')}
                  </Link>
                </>
              ),
            }}
            theme={{
              label: t('shell.theme'),
              title: t('shell.theme_title'),
              onToggle: toggleTheme,
            }}
          />
        }
      >
        {current && (
          <TabRow
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
        {children}
      </AppFrame>
    </ShellContext.Provider>
  );
}
