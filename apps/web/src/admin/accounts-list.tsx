'use client';

import { formatMomentRu, type ListSort } from '@buhuchet/domain';
import {
  AdminUserList,
  ListValues,
  TemporaryPasswordResponse,
  type AdminUser,
} from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Modal,
  MONO_CLASS,
  Pill,
  useToast,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { accountMenu } from './accounts-menu';

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
 * приглушённо. Нажатие на строку открывает меню записи, как в прототипе: «Сбросить пароль» (окно
 * «Пароль сброшен» с временным паролем), «Заблокировать» после вопроса и «Разблокировать» сразу.
 */
export function AccountsList() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const labels = useGridLabels('accounts.count');
  const columns = useMemo(() => accountColumns(t), [t]);
  const view = useViewSettings('accounts.list');
  const { search, clearSearch, userId } = useShell();
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
  const [askBlock, setAskBlock] = useState<AdminUser | null>(null);
  const [reset, setReset] = useState<{
    account: AdminUser;
    password: string;
    telegram: boolean;
  } | null>(null);
  // Учётные записи, по которым запрос ещё идёт: повторное нажатие не шлёт второй запрос.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const refresh = useCallback(
    () => void client.invalidateQueries({ queryKey: ['list', 'accounts.list'] }),
    [client],
  );

  const once = async <T,>(id: string, fetch: () => Promise<T>): Promise<T | null> => {
    if (pending.has(id)) return null;
    setPending((p) => new Set(p).add(id));
    try {
      return await fetch();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      });
    }
  };

  const setBlocked = async (u: AdminUser, blocked: boolean) => {
    const res = await once(u.id, () =>
      callApi(() =>
        api.api.admin.users[':id'][blocked ? 'block' : 'unblock'].$post({
          param: { id: u.id },
          json: { version: u.version },
        }),
      ),
    );
    if (!res) return;
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t(blocked ? 'accounts.block.done' : 'accounts.unblock.done'), {
      icon: blocked ? 'lock' : 'key',
    });
  };

  const resetPassword = async (u: AdminUser) => {
    const res = await once(u.id, () =>
      callApi(() => api.api.admin.users[':id']['password-reset'].$post({ param: { id: u.id } })),
    );
    if (!res) return;
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const body = TemporaryPasswordResponse.safeParse(res.data);
    if (!body.success) return toast(t('err.unknown'), { bad: true });
    refresh();
    setReset({
      account: u,
      password: body.data.temporaryPassword,
      telegram: body.data.telegramNotified,
    });
  };

  const actions = accountMenu({
    userId: userId ?? '',
    t,
    run: {
      resetPassword: (u) => void resetPassword(u),
      block: setAskBlock,
      unblock: (u) => void setBlocked(u, false),
    },
  });

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
        openMenu
      />
      <ConfirmDialog
        open={askBlock !== null}
        onClose={() => setAskBlock(null)}
        title={t('accounts.block.title', { login: askBlock?.login ?? '' })}
        text={t('accounts.block.text')}
        ok={t('accounts.action.block')}
        danger
        onConfirm={() => askBlock && void setBlocked(askBlock, true)}
      />
      <Modal
        open={reset !== null}
        onClose={() => setReset(null)}
        kind="message"
        title={t('staff.reset.title')}
        sub={reset ? `${reset.account.fullName} · ${reset.account.login}` : undefined}
        footer={
          <button type="button" className={buttonClass('cta')} onClick={() => setReset(null)}>
            {t('btn.done')}
          </button>
        }
      >
        <p className="m-0">
          {t('staff.reset.password')}{' '}
          <b data-temporary-password className={`${MONO_CLASS} text-base`}>
            {reset?.password}
          </b>
        </p>
        <p className="m-0 text-muted">
          {t(reset?.telegram ? 'accounts.reset.sessions_tg' : 'accounts.reset.sessions')}
        </p>
      </Modal>
    </>
  );
}
