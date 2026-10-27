'use client';

import { formatMomentRu, initials, type ListSort } from '@buhuchet/domain';
import { EmployeeList, ListValues, type Employee } from '@buhuchet/shared';
import {
  Avatar,
  buttonClass,
  DataGrid,
  EmptyState,
  Icon,
  MONO_CLASS,
  Note,
  Pill,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useCallback, useMemo } from 'react';
import { api, apiFailure } from '../api-client';
import { KbBadge } from '../kb/kb-parts';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useNewRole } from '../roles/new-role';
import { useShell } from '../shell/context';
import { useStaffActions } from './staff-actions';
import { useStaffAddRequest } from './staff-add';

/** Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (прототип defSort). */
const DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/**
 * Видимые по умолчанию (ТЗ «Столбцы, видимые по умолчанию»: ФИО, роль, телефон, контрагентов,
 * просрочено, статус, уровень знаний). Контрагентов, несданные, просрочено и баланс счёта добавят их
 * модули; «Уровень знаний» — только с правом «Видеть уровни сотрудников».
 */
const DEFAULT_VISIBLE = ['fullName', 'role', 'phone', 'active'];
const DEFAULT_VISIBLE_KB = [...DEFAULT_VISIBLE, 'kb'];

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

// «Роль» перед «Телефоном» — как в ТЗ (docs/deviations.md, п. 31, решение А; прототип поправят).
/**
 * Столбцы списка сотрудников — как в прототипе (modules/staff.js, renderStaff), ключи — как на сервере.
 * Служебные «Создал», «Изменил», «Создано», «Изменено» добавляет сам список (`STAFF_AUDIT`).
 */
export function staffColumns(t: Translate, kb = false): GridColumn<Employee>[] {
  const columns: GridColumn<Employee>[] = [
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
  if (kb) {
    columns.push({
      key: 'kb',
      label: t('staff.col.kb'),
      type: 'enum',
      width: 230,
      text: (e) => e.kb?.name ?? '',
      cell: (e) =>
        e.kb ? <KbBadge level={e.kb.level} name={e.kb.name} pct={e.kb.pct} of={e.kb.of} /> : null,
    });
  }
  return columns;
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
  if (!res.ok) throw await apiFailure(res);
  return EmployeeList.parse(await res.json());
};

/**
 * Значения столбца для фильтра-галочек: роли по названию, статус, «Telegram привязан»; `q` — «Найти
 * значение» по всем значениям.
 */
const fetchStaffValues = async (col: string, q?: string) => {
  const res = await api.api.staff.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/**
 * «Сотрудники» → список (ТЗ «Сотрудники», прототип modules/staff.js, renderStaff): общий список
 * записей с поиском, фильтрами у столбцов, группировкой и «В Excel» (по праву «Выгружать в Excel»);
 * заблокированные — приглушённо. Строка открывает карточку сотрудника; действия — «⋯», долгим
 * нажатием и правым кликом (`useStaffActions`). Пока в организации один сотрудник — подсказка
 * «Добавить сотрудника». «+ Добавить» — «Сотрудник» и «Роль».
 */
export function StaffList() {
  const t = useT();
  const labels = useGridLabels('staff.count');
  const { search, clearSearch, access } = useShell();
  const kb = access.can('kbLevels');
  const columns = useMemo(() => staffColumns(t, kb), [t, kb]);
  const defaultVisible = kb ? DEFAULT_VISIBLE_KB : DEFAULT_VISIBLE;
  const view = useViewSettings('staff.list');
  const list = useListPage({
    gridKey: 'staff.list',
    columns,
    defaultVisible,
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
  const staff = useStaffActions();
  const newRole = useNewRole();
  useStaffAddRequest({ employee: staff.newEmployee, role: newRole.open });
  // Подсказка — пока в организации только владелец (прототип `EMP.length===1`): без поиска и фильтров
  // в списке одна запись.
  const alone =
    access.can('staff') &&
    !search &&
    Object.keys(list.filters).length === 0 &&
    list.data?.total === 1;

  return (
    <div className="flex flex-col gap-3.5">
      {alone ? (
        <Note icon="users">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="min-w-0 flex-1">{t('staff.first.text')}</span>
            <button type="button" className={buttonClass('cta', 'sm')} onClick={staff.newEmployee}>
              <Icon name="plus" size="sm" />
              {t('staff.first.add')}
            </button>
          </span>
        </Note>
      ) : null}
      <DataGrid
        columns={columns}
        audit={STAFF_AUDIT}
        defaultVisible={defaultVisible}
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
        onOpen={staff.openCard}
      />
      {staff.dialogs}
      {newRole.dialog}
    </div>
  );
}
