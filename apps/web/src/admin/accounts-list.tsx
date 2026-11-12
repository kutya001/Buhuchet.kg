'use client';

import { formatMomentRu, type ListSort } from '@buhuchet/domain';
import { AdminUserList, AdminUserLookup, ListValues, type AdminUser } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Pill,
  useToast,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useCallback, useEffect, useMemo } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { accountHashLogin } from './account-card-model';
import { useAdminCards } from './admin-cards';

/**
 * Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (ТЗ «Сортировка»; прототип
 * defSort: при служебных столбцах `sort` списка не действует).
 */
const DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/** Видимые по умолчанию (прототип ui/grid.js, SHOW['adm-users']) — все столбцы модуля. */
const DEFAULT_VISIBLE = ['login', 'fullName', 'org', 'role', 'lastLoginAt', 'active'];

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

const STATUS_TEXT = {
  active: 'accounts.active',
  blocked: 'accounts.blocked',
  owner_blocked: 'accounts.owner_blocked',
} as const;

/**
 * Столбцы списка учётных записей — как в прототипе (admin/accounts-orgs.js, renderAccounts), ключи —
 * как на сервере. «Последний вход» — момент, как у сотрудников. Служебные «Создал», «Изменил»,
 * «Создано», «Изменено» добавляет сам список (`ACCOUNTS_AUDIT`).
 */
export function accountColumns(t: Translate): GridColumn<AdminUser>[] {
  return [
    {
      key: 'login',
      label: t('accounts.col.login'),
      type: 'text',
      width: 150,
      text: (u) => u.login,
      className: MONO_CLASS,
    },
    {
      key: 'fullName',
      label: t('accounts.col.full_name'),
      type: 'text',
      width: 240,
      text: (u) => u.fullName,
      cell: (u) => <span className="font-semibold">{u.fullName}</span>,
    },
    {
      key: 'org',
      label: t('accounts.col.org'),
      type: 'enum',
      width: 240,
      text: (u) => u.orgName,
    },
    { key: 'role', label: t('accounts.col.role'), type: 'enum', width: 190, text: (u) => u.role },
    {
      key: 'lastLoginAt',
      label: t('accounts.col.last_login'),
      type: 'datetime',
      width: 150,
      text: (u) => moment(u.lastLoginAt),
    },
    {
      key: 'active',
      label: t('accounts.col.active'),
      type: 'enum',
      width: 140,
      text: (u) => t(STATUS_TEXT[u.status]),
      cell: (u) =>
        u.status === 'active' ? (
          <Pill tone="ok" icon="check">
            {t('accounts.active')}
          </Pill>
        ) : (
          // ОТКЛОНЕНИЕ: docs/deviations.md#49 — блокировка владельцем показана отдельным статусом.
          <span title={u.status === 'owner_blocked' ? t('accounts.owner_blocked_hint') : undefined}>
            <Pill tone="bad" icon="lock">
              {t(STATUS_TEXT[u.status])}
            </Pill>
          </span>
        ),
    },
  ];
}

/** Значения служебных столбцов; «Изменил» у записи без правок — тот, кто создал (прототип `_ub || _cb`). */
const ACCOUNTS_AUDIT: GridAudit<AdminUser> = {
  createdBy: (u) => u.audit.createdBy ?? '',
  updatedBy: (u) => u.audit.updatedBy ?? u.audit.createdBy ?? '',
  createdAt: (u) => moment(u.audit.createdAt),
  updatedAt: (u) => moment(u.audit.updatedAt),
};

const fetchAccounts: FetchListPage<AdminUser> = async (params) => {
  const res = await api.api.admin.users.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return AdminUserList.parse(await res.json());
};

/** Значения столбца для фильтра-галочек; `q` — «Найти значение» по всем значениям. */
const fetchAccountValues = async (col: string, q?: string) => {
  const res = await api.api.admin.users.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/**
 * Админка → «Учётные записи» (ТЗ «Админка» → «Модуль учётных записей»; прототип
 * admin/accounts-orgs.js, renderAccounts): все пользователи платформы — сотрудники всех организаций и
 * администраторы платформы — с поиском, фильтрами, группировкой и «В Excel»; заблокированные —
 * приглушённо. Нажатие на строку открывает карточку пользователя (прототип v83, accCard); в меню
 * записи — «Открыть карточку», «Сбросить пароль» (окно «Пароль сброшен» с временным паролем),
 * «Заблокировать» после вопроса и «Разблокировать» сразу. Адрес `#accounts/<логин>` открывает карточку
 * этой учётной записи (прототип admCardRoute); организация в карточке открывает карточку организации.
 */
export function AccountsList() {
  const t = useT();
  const toast = useToast();
  const labels = useGridLabels('accounts.count');
  const columns = useMemo(() => accountColumns(t), [t]);
  const view = useViewSettings('accounts.list');
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: 'accounts.list',
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchAccounts,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.admin.users.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const { accountActions: actions, openAccount, cards } = useAdminCards();
  const openCard = useCallback((u: AdminUser) => openAccount(u.id, u), [openAccount]);

  // Ссылка `#accounts/<логин>`: карточка открывается один раз, адрес остаётся без неё.
  useEffect(() => {
    const route = () => {
      const login = accountHashLogin(window.location.hash);
      if (!login) return;
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
      void (async () => {
        const res = await callApi(() => api.api.admin.users.lookup.$get({ query: { login } }));
        const found = res.ok ? AdminUserLookup.safeParse(res.data) : null;
        if (!found?.success) return toast(t('accounts.card.none'), { bad: true });
        openAccount(found.data.id);
      })();
    };
    route();
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  }, [t, toast, openAccount]);

  return (
    <>
      <DataGrid
        columns={columns}
        audit={ACCOUNTS_AUDIT}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={fetchAccountValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="user" title={t('grid.empty')} />}
        rowKey={(u) => u.id}
        titleKey="fullName"
        rowTone={(u) => (u.status === 'active' ? undefined : 'muted')}
        label={t('nav.accounts')}
        labels={labels}
        actions={actions}
        onOpen={openCard}
      />
      {cards}
    </>
  );
}
