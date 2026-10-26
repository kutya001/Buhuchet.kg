'use client';

import { formatMomentRu, initials, type ListSort } from '@buhuchet/domain';
import { EmployeeList, ListValues, type Employee } from '@buhuchet/shared';
import {
  Avatar,
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Pill,
  useToast,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useCallback, useEffect, useMemo } from 'react';
import { api } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useStaffActions } from './staff-actions';

/** Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (прототип defSort). */
const DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/**
 * Видимые по умолчанию (ТЗ «Столбцы, видимые по умолчанию»: ФИО, роль, телефон, контрагентов,
 * просрочено, статус, уровень знаний). Контрагентов, несданные, просрочено, баланс счёта и уровень
 * знаний добавят их модули.
 */
const DEFAULT_VISIBLE = ['fullName', 'role', 'phone', 'active'];

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

// «Роль» перед «Телефоном» — как в ТЗ (docs/deviations.md, п. 31, решение А; прототип поправят).
/**
 * Столбцы списка сотрудников — как в прототипе (modules/staff.js, renderStaff), ключи — как на сервере.
 * Служебные «Создал», «Изменил», «Создано», «Изменено» добавляет сам список (`STAFF_AUDIT`).
 */
export function staffColumns(t: Translate): GridColumn<Employee>[] {
  return [
    {
      key: 'fullName',
      label: t('staff.col.full_name'),
      type: 'text',
      width: 270,
      text: (e) => e.fullName,
      cell: (e) => (
        <span className="flex items-center gap-[9px]">
          <Avatar initials={initials(e.fullName)} />
          <span className="truncate font-semibold">{e.fullName}</span>
        </span>
      ),
    },
    {
      key: 'login',
      label: t('staff.col.login'),
      type: 'text',
      width: 100,
      text: (e) => e.login,
      className: MONO_CLASS,
    },
    { key: 'role', label: t('staff.col.role'), type: 'enum', width: 170, text: (e) => e.role.name },
    {
      key: 'phone',
      label: t('staff.col.phone'),
      type: 'text',
      width: 160,
      text: (e) => e.phoneText ?? '',
      className: MONO_CLASS,
    },
    {
      key: 'telegram',
      label: t('staff.col.telegram'),
      type: 'enum',
      width: 140,
      text: (e) => t(e.telegram ? 'staff.telegram.linked' : 'staff.telegram.none'),
      cell: (e) =>
        e.telegram ? (
          <Pill tone="ok" icon="tg" size="sm">
            {t('staff.telegram.linked_pill')}
          </Pill>
        ) : (
          <Pill tone="caution" icon="alert" size="sm">
            {t('staff.telegram.none_pill')}
          </Pill>
        ),
    },
    {
      key: 'lastLoginAt',
      label: t('staff.col.last_login'),
      type: 'datetime',
      width: 150,
      text: (e) => moment(e.lastLoginAt),
    },
    {
      key: 'active',
      label: t('staff.col.active'),
      type: 'enum',
      width: 130,
      text: (e) => t(e.active ? 'staff.active' : 'staff.blocked'),
      cell: (e) =>
        e.active ? (
          <Pill tone="ok" icon="check">
            {t('staff.active')}
          </Pill>
        ) : (
          <Pill tone="bad" icon="lock">
            {t('staff.blocked')}
          </Pill>
        ),
    },
  ];
}

/** Значения служебных столбцов; «Изменил» у записи без правок — тот, кто создал (прототип `_ub || _cb`). */
const STAFF_AUDIT: GridAudit<Employee> = {
  createdBy: (e) => e.audit.createdBy ?? '',
  updatedBy: (e) => e.audit.updatedBy ?? e.audit.createdBy ?? '',
  createdAt: (e) => moment(e.audit.createdAt),
  updatedAt: (e) => moment(e.audit.updatedAt),
};

const fetchStaff: FetchListPage<Employee> = async (params) => {
  const res = await api.api.staff.$get({ query: params });
  if (!res.ok) throw new Error(`staff: ${res.status}`);
  return EmployeeList.parse(await res.json());
};

/** Значения столбца для фильтра-галочек: роли по названию, статус, «Telegram привязан». */
const fetchStaffValues = async (col: string) => {
  const res = await api.api.staff.values.$get({ query: { col } });
  if (!res.ok) throw new Error(`staff values: ${res.status}`);
  return ListValues.parse(await res.json());
};

/**
 * «Сотрудники» → список (ТЗ «Сотрудники», прототип modules/staff.js, renderStaff): общий список
 * записей с поиском, фильтрами у столбцов, группировкой и «В Excel» (по праву «Выгружать в Excel»);
 * заблокированные — приглушённо. Действия над сотрудником — «⋯», долгим нажатием и правым кликом
 * (`useStaffActions`). Карточка сотрудника и окно «Новый сотрудник» — задача #18; до неё выбор
 * «+ Добавить» подтверждается уведомлением, как в заглушке модуля.
 */
export function StaffList() {
  const t = useT();
  const toast = useToast();
  const labels = useGridLabels('staff.count');
  const columns = useMemo(() => staffColumns(t), [t]);
  const view = useViewSettings('staff.list');
  const { search, clearSearch, access, addRequest, clearAddRequest } = useShell();
  const list = useListPage({
    gridKey: 'staff.list',
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchStaff,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.staff.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const staff = useStaffActions(list.retry);

  const request = addRequest?.moduleId === 'staff' ? addRequest : null;
  useEffect(() => {
    if (!request) return;
    toast(t('shell.stub_add', { action: request.label }), { icon: 'info' });
    clearAddRequest();
  }, [request, toast, t, clearAddRequest]);

  return (
    <>
      <DataGrid
        columns={columns}
        audit={STAFF_AUDIT}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={fetchStaffValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="users" title={t('grid.empty')} />}
        rowKey={(e) => e.id}
        titleKey="fullName"
        rowTone={(e) => (e.active ? undefined : 'muted')}
        label={t('nav.staff')}
        labels={labels}
        actions={staff.actions}
      />
      {staff.dialogs}
    </>
  );
}
