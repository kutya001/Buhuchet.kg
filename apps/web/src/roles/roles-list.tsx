'use client';

import { formatMomentRu, PERMISSION_IDS, type ListSort } from '@buhuchet/domain';
import { ListValues, RoleList, Uuid, type Role, type RoleListItem } from '@buhuchet/shared';
import {
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Note,
  Tag,
  useToast,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { policyQuery } from '../org/org-data';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { useStaffAddRequest } from '../staff/staff-add';
import { useStaffActions } from '../staff/staff-actions';
import { useStaffRefresh } from '../staff/staff-data';
import { useNewRole } from './new-role';
import type { CatalogPermission } from './permission-view';
import { RoleCard } from './role-card';
import { permissionCatalogQuery, roleQuery } from './role-data';
import { RoleForm } from './role-form';
import { roleMenu } from './roles-menu';

/** По умолчанию — по названию роли (прототип `sort:{key:'name',dir:1}`). */
const DEFAULT_SORT: ListSort = { key: 'name', dir: 'asc' };

/** Видимые по умолчанию: роль, сотрудников, прав, изменено; «Изменил» — в «Столбцах». */
const DEFAULT_VISIBLE = ['name', 'employees', 'permissionCount', 'updatedAt'];

/**
 * Столбцы списка ролей — как в прототипе (modules/staff.js, renderStaff, вкладка «Роли»; служебных
 * «Создал… Изменено» нет, «Изменено» и «Изменил» — свои столбцы), ключи — как на сервере.
 */
export function roleColumns(t: Translate): GridColumn<RoleListItem>[] {
  return [
    {
      key: 'name',
      label: t('roles.col.name'),
      type: 'text',
      width: 240,
      text: (r) => r.name,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold">{r.name}</span>
          {r.isOwner ? <Tag>{t('roles.all_rights')}</Tag> : null}
        </span>
      ),
    },
    {
      key: 'employees',
      label: t('roles.col.employees'),
      type: 'int',
      width: 120,
      text: (r) => String(r.employees),
    },
    {
      key: 'permissionCount',
      label: t('roles.col.permissions'),
      type: 'int',
      width: 110,
      text: (r) => String(r.permissionCount),
      cell: (r) => (
        <>
          {r.permissionCount}{' '}
          <span className="text-faint">
            {t('roles.of_total', { total: PERMISSION_IDS.length })}
          </span>
        </>
      ),
    },
    {
      key: 'updatedAt',
      label: t('grid.col.updated_at'),
      type: 'datetime',
      width: 150,
      audit: 'updated',
      text: (r) => formatMomentRu(new Date(r.audit.updatedAt)),
    },
    {
      key: 'updatedBy',
      label: t('grid.col.updated_by'),
      type: 'enum',
      width: 140,
      audit: 'updated',
      text: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
    },
  ];
}

const fetchRoles: FetchListPage<RoleListItem> = async (params) => {
  const res = await api.api.roles.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return RoleList.parse(await res.json());
};

/** Роль и справочник прав для формы роли. */
const loadForm = async (client: QueryClient, id: string) => {
  const [role, catalog] = await Promise.all([
    client.fetchQuery(roleQuery(id)),
    client.fetchQuery(permissionCatalogQuery),
  ]);
  return { role, catalog };
};

const fetchRoleValues = async (col: string, q?: string) => {
  const res = await api.api.roles.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw new Error(`roles values: ${res.status}`);
  return ListValues.parse(await res.json());
};

/**
 * «Сотрудники» → «Роли» (ТЗ «Сотрудники» → «Вкладка Роли»; прототип modules/staff.js, renderStaff,
 * roleActions): пояснение, как устроены права, и общий список ролей — роль, сотрудников, прав,
 * изменено. Строка открывает карточку роли; в меню — «Открыть» и «Изменить» (у роли владельца
 * недоступно: её права не меняются), с правом «Сотрудники и роли» — ещё «Удалить» (docs/deviations.md,
 * п. 16): после вопроса «Удалить роль «…»?»; у роли владельца, роли с сотрудниками и роли новых
 * сотрудников («Настройки») недоступно с причиной, остальные отказы (заблокированные с этой
 * ролью, роль с правами, которые выдаёт только владелец) — уведомлением с текстом сервера. «+ Добавить» — «Сотрудник» и
 * «Роль»; новая роль открывается в форме прав (адрес вкладки с `?edit=`).
 */
export function RolesList() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useStaffRefresh();
  const labels = useGridLabels('roles.count');
  const columns = useMemo(() => roleColumns(t), [t]);
  const view = useViewSettings('staff.roles');
  const { search, clearSearch, access } = useShell();
  const list = useListPage({
    gridKey: 'staff.roles',
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchRoles,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.roles.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const staff = useStaffActions();

  const [card, setCard] = useState<DialogSlot<RoleListItem> | null>(null);
  const [form, setForm] = useState<DialogSlot<{
    role: Role;
    catalog: CatalogPermission[];
  }> | null>(null);
  const [askDelete, setAskDelete] = useState<RoleListItem | null>(null);
  /** Роль новых сотрудников не удаляется: её сначала меняют в «Моя организация» → «Настройки». */
  const defaultRoleId = useQuery({ ...policyQuery, enabled: access.can('staff') }).data
    ?.defaultRoleId;

  const removeRole = async (r: RoleListItem) => {
    const res = await callApi(() =>
      api.api.roles[':id'].$delete({ param: { id: r.id }, query: { version: String(r.version) } }),
    );
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t('roles.delete.done'), { icon: 'check' });
  };

  /** Форма открывается, когда роль и справочник прав загружены: фокус сразу в «Названии роли». */
  const openForm = async (id: string) => {
    try {
      const data = await loadForm(client, id);
      if (!data.role.isOwner && !data.role.readOnly) setForm(openSlot(data));
    } catch {
      toast(t('err.unknown'), { bad: true });
    }
  };

  const newRole = useNewRole((role) => void openForm(role.id));
  useStaffAddRequest({ employee: staff.newEmployee, role: newRole.open });

  // Новая роль создана на любой вкладке модуля — сюда с `?edit=<id>`: адрес — снова вкладка (сразу,
  // до заглушки окна в истории; Next.js узнаёт о замене адреса сам), форма роли открывается, как
  // только загрузится.
  const editId = useSearchParams().get('edit');
  useEffect(() => {
    if (!editId) return;
    window.history.replaceState(window.history.state, '', tabHref('staff', 'roles'));
    // Только номер роли: иначе значение из адреса ушло бы в путь запроса как есть.
    if (!Uuid.safeParse(editId).success) return;
    loadForm(client, editId).then(
      (data) => {
        if (!data.role.isOwner && !data.role.readOnly) setForm(openSlot(data));
      },
      () => toast(t('err.unknown'), { bad: true }),
    );
  }, [editId, client, toast, t]);

  const actions = roleMenu({
    canDelete: access.can('staff'),
    defaultRoleId,
    t,
    run: {
      open: (r) => setCard(openSlot(r)),
      edit: (r) => void openForm(r.id),
      remove: setAskDelete,
    },
  });

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('roles.note')}</Note>
      <DataGrid
        columns={columns}
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
        loadValues={fetchRoleValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="shield" title={t('grid.empty')} />}
        rowKey={(r) => r.id}
        titleKey="name"
        label={t('tab.staff.roles')}
        labels={labels}
        actions={actions}
        onOpen={(r) => setCard(openSlot(r))}
      />
      {card ? (
        <RoleCard
          key={`card-${card.n}`}
          role={card.data}
          open={card.open}
          onClose={() => setCard(closeSlot)}
          onEdit={(r) => {
            setCard(closeSlot);
            void openForm(r.id);
          }}
        />
      ) : null}
      {form ? (
        <RoleForm
          key={`form-${form.n}`}
          role={form.data.role}
          catalog={form.data.catalog}
          open={form.open}
          onClose={() => setForm(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={askDelete !== null}
        onClose={() => setAskDelete(null)}
        title={t('roles.delete.title', { name: askDelete?.name ?? '' })}
        text={t('roles.delete.text')}
        ok={t('roles.action.delete')}
        danger
        onConfirm={() => askDelete && void removeRole(askDelete)}
      />
      {staff.dialogs}
      {newRole.dialog}
    </div>
  );
}
