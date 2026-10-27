'use client';

import {
  bishkekDate,
  formatCount,
  formatDateRu,
  formatMomentRu,
  type ListSort,
} from '@buhuchet/domain';
import {
  AdminOrganizationList,
  AdminOrgSummary,
  ListValues,
  type AdminOrganization,
} from '@buhuchet/shared';
import {
  ConfirmDialog,
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Pill,
  Plate,
  Plates,
  useToast,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { NewOrganizationDialog } from './new-org-dialog';
import { orgMenu } from './orgs-menu';

/**
 * Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (ТЗ «Сортировка»; прототип
 * defSort: при служебных столбцах `sort` списка не действует).
 */
const DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/** Видимые по умолчанию (прототип ui/grid.js, SHOW['adm-orgs']); адрес страницы и регистрация — в «Столбцах». */
const DEFAULT_VISIBLE = ['name', 'inn', 'owner', 'contractors', 'employees', 'active'];

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

/**
 * Столбцы списка организаций — как в прототипе (admin/accounts-orgs.js, renderOrgs), ключи — как на
 * сервере. Служебные «Создал», «Изменил», «Создано», «Изменено» добавляет сам список (`ORGS_AUDIT`).
 */
export function orgColumns(t: Translate): GridColumn<AdminOrganization>[] {
  return [
    {
      key: 'name',
      label: t('orgs.col.name'),
      type: 'text',
      width: 280,
      text: (o) => o.name,
      cell: (o) => <span className="font-semibold">{o.name}</span>,
    },
    {
      key: 'inn',
      label: t('orgs.col.inn'),
      type: 'text',
      width: 150,
      text: (o) => o.inn ?? '',
      className: MONO_CLASS,
    },
    {
      key: 'owner',
      label: t('orgs.col.owner'),
      type: 'text',
      width: 160,
      text: (o) => o.ownerLogin ?? '',
      className: MONO_CLASS,
    },
    {
      key: 'slug',
      label: t('orgs.col.slug'),
      type: 'text',
      width: 170,
      text: (o) => o.slug,
      className: MONO_CLASS,
    },
    {
      key: 'contractors',
      label: t('orgs.col.contractors'),
      type: 'int',
      width: 120,
      text: (o) => formatCount(o.contractors),
    },
    {
      key: 'employees',
      label: t('orgs.col.employees'),
      type: 'int',
      width: 120,
      text: (o) => formatCount(o.employees),
    },
    {
      key: 'registered',
      label: t('orgs.col.registered'),
      type: 'date',
      width: 120,
      text: (o) => formatDateRu(bishkekDate(new Date(o.audit.createdAt))),
    },
    {
      key: 'active',
      label: t('orgs.col.active'),
      type: 'enum',
      width: 150,
      text: (o) => t(o.active ? 'orgs.active' : 'orgs.blocked'),
      cell: (o) =>
        o.active ? (
          <Pill tone="ok" icon="check">
            {t('orgs.active')}
          </Pill>
        ) : (
          <span title={o.blockedReason ?? undefined}>
            <Pill tone="bad" icon="lock">
              {t('orgs.blocked')}
            </Pill>
          </span>
        ),
    },
  ];
}

/** Значения служебных столбцов; «Изменил» у записи без правок — тот, кто создал (прототип `_ub || _cb`). */
const ORGS_AUDIT: GridAudit<AdminOrganization> = {
  createdBy: (o) => o.audit.createdBy ?? '',
  updatedBy: (o) => o.audit.updatedBy ?? o.audit.createdBy ?? '',
  createdAt: (o) => moment(o.audit.createdAt),
  updatedAt: (o) => moment(o.audit.updatedAt),
};

const fetchOrgs: FetchListPage<AdminOrganization> = async (params) => {
  const res = await api.api.admin.organizations.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return AdminOrganizationList.parse(await res.json());
};

/** Значения столбца для фильтра-галочек; `q` — «Найти значение» по всем значениям. */
const fetchOrgValues = async (col: string, q?: string) => {
  const res = await api.api.admin.organizations.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw new Error(`admin organization values: ${res.status}`);
  return ListValues.parse(await res.json());
};

/** Плашки над списком: активных организаций, контрагентов, пользователей, запросов в справочники. */
const summaryQuery = queryOptions({
  queryKey: ['admin', 'orgs-summary'],
  queryFn: async () => {
    const res = await api.api.admin.organizations.summary.$get();
    if (!res.ok) throw new Error(`admin organizations summary: ${res.status}`);
    return AdminOrgSummary.parse(await res.json());
  },
});

/** После создания, блокировки и разблокировки — перечитать список и плашки. */
function useOrgsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', 'orgs.list'] });
    void client.invalidateQueries({ queryKey: summaryQuery.queryKey });
  }, [client]);
}

/** «+ Добавить» → «Организация» (прототип core/registry.js, ADM orgs → addOrgDlg). */
function useOrgsAddRequest(run: () => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'orgs' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'org') run();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

/**
 * Админка → «Организации» (ТЗ «Админка» → «Модуль организаций»; прототип admin/accounts-orgs.js,
 * renderOrgs): плашки — активных организаций, контрагентов на платформе, пользователей организаций,
 * запросов на добавление в справочники (нажатие открывает «Справочники платформы» → «Запросы»).
 * Список всех организаций платформы с поиском, фильтрами, группировкой и «В Excel»; заблокированные —
 * приглушённо, причина — подсказкой у метки «Заблокирована». Действия — «Заблокировать» после вопроса
 * (демо-организацию стенда не блокируют) и «Разблокировать» сразу; «+ Добавить» — «Новая организация».
 */
export function OrgsList() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const router = useRouter();
  const labels = useGridLabels('orgs.count');
  const columns = useMemo(() => orgColumns(t), [t]);
  const view = useViewSettings('orgs.list');
  const stats = useModuleStats('orgs');
  const summary = useQuery(summaryQuery);
  const { search, clearSearch } = useShell();
  const refresh = useOrgsRefresh();
  const list = useListPage({
    gridKey: 'orgs.list',
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchOrgs,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.admin.organizations.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [create, setCreate] = useState<DialogSlot<null> | null>(null);
  const [askBlock, setAskBlock] = useState<AdminOrganization | null>(null);
  // Организации, по которым запрос ещё идёт: повторное нажатие не шлёт второй запрос.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  useOrgsAddRequest(() => setCreate(openSlot(null)));

  const setActive = async (o: AdminOrganization, active: boolean) => {
    if (pending.has(o.id)) return;
    setPending((p) => new Set(p).add(o.id));
    const res = await callApi(() =>
      api.api.admin.organizations[':id'][active ? 'unblock' : 'block'].$post({
        param: { id: o.id },
        json: { version: o.version },
      }),
    );
    setPending((p) => {
      const next = new Set(p);
      next.delete(o.id);
      return next;
    });
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t(active ? 'orgs.unblock.done' : 'orgs.block.done'), {
      icon: active ? 'check' : 'lock',
    });
  };

  const actions = orgMenu({
    t,
    run: { block: setAskBlock, unblock: (o) => void setActive(o, true) },
  });
  const plate = (n: number | undefined) => (n === undefined ? '' : formatCount(n));
  const requests = summary.data?.requests ?? 0;

  return (
    <div className="flex flex-col gap-3.5">
      <Plates shown={stats.shown}>
        <Plate
          id="a"
          icon="building"
          color="blue"
          label={t('orgs.plate.active')}
          value={plate(summary.data?.active)}
          sub={t('orgs.plate.active_sub')}
        />
        <Plate
          id="b"
          icon="users"
          color="green"
          label={t('orgs.plate.contractors')}
          value={plate(summary.data?.contractors)}
        />
        <Plate
          id="c"
          icon="user"
          color="purple"
          label={t('orgs.plate.users')}
          value={plate(summary.data?.users)}
        />
        <Plate
          id="d"
          icon="send"
          color={requests ? 'yellow' : 'green'}
          label={t('orgs.plate.requests')}
          value={plate(summary.data?.requests)}
          sub={t('orgs.plate.requests_sub')}
          onClick={() => router.push(tabHref('pdicts', 'requests'))}
        />
      </Plates>
      <DataGrid
        columns={columns}
        audit={ORGS_AUDIT}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={fetchOrgValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="building" title={t('grid.empty')} />}
        rowKey={(o) => o.id}
        titleKey="name"
        rowTone={(o) => (o.active ? undefined : 'muted')}
        label={t('nav.organizations')}
        labels={labels}
        actions={actions}
      />
      {create ? (
        <NewOrganizationDialog
          key={`create-${create.n}`}
          open={create.open}
          onClose={() => setCreate(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={askBlock !== null}
        onClose={() => setAskBlock(null)}
        title={t('orgs.block.title', { name: askBlock?.name ?? '' })}
        text={t('orgs.block.text')}
        ok={t('orgs.action.block')}
        danger
        onConfirm={() => askBlock && void setActive(askBlock, false)}
      />
    </div>
  );
}
