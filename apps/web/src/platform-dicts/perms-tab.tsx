'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ADMIN_PERMISSION_COLUMNS,
  ADMIN_PERMISSION_SORT,
  type AdminPermissionColumn,
  type UiTextKey,
} from '@buhuchet/domain';
import { AdminPermissionFields, type AdminPermission } from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Field,
  inputClass,
  Modal,
  MONO_CLASS,
  Note,
  RecordChangedNotice,
  useToast,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { DictHistory } from './dict-history-box';
import {
  fetchAdminPermissions,
  fetchAdminPermissionValues,
  pdictsPermissionsQuery,
  usePdictsRefresh,
} from './pdicts-data';

const perms = api.api.admin['platform-dicts'].perms;

/** Ширины столбцов, px — как в прототипе (`adm-perms`). */
const WIDTHS: Readonly<Record<AdminPermissionColumn['key'], number>> = {
  group: 220,
  name: 260,
  description: 520,
  id: 120,
};

function permColumns(t: Translate): GridColumn<AdminPermission>[] {
  return ADMIN_PERMISSION_COLUMNS.map((c) => {
    const column: GridColumn<AdminPermission> = {
      key: c.key,
      label: t(c.label as UiTextKey),
      type: c.type,
      width: WIDTHS[c.key],
      text: (x) => (c.key === 'group' ? x.groupText : x[c.key]),
    };
    if (c.key === 'name') column.cell = (x) => <span className="font-semibold">{x.name}</span>;
    if (c.key === 'id') column.className = MONO_CLASS;
    return column;
  });
}

/**
 * Окно «Право роли» (прототип permEditDlg): название и описание обязательны, название не повторяет
 * другое право. Набор прав и их действие не меняются — меняются тексты, которые организации видят в
 * форме роли.
 */
function PermDialog({
  open,
  onClose,
  item,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  item: AdminPermission;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const [version, setVersion] = useState(item.version);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AdminPermissionFields>({
    resolver: zodResolver(AdminPermissionFields),
    defaultValues: { name: item.name, description: item.description },
  });

  const reload = async () => {
    setReloading(true);
    const all = await client
      .fetchQuery({ ...pdictsPermissionsQuery, staleTime: 0 })
      .catch(() => null);
    setReloading(false);
    const fresh = all?.find((p) => p.id === item.id);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setVersion(fresh.version);
    reset({ name: fresh.name, description: fresh.description });
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      if (!isDirty) return onClose();
      const res = await callApi(() =>
        perms[':id'].$put({ param: { id: item.id }, json: { ...values, version } }),
      );
      if (res.ok) {
        onDone();
        onClose();
        return toast(t('pdicts.perm.toast'), { icon: 'check' });
      }
      if (res.error.code === 'record_changed') return setChanged(true);
      if (res.error.code === 'perm_taken') {
        return setError(
          'name',
          { type: 'server', message: t('pdicts.err.perm_taken') },
          { shouldFocus: true },
        );
      }
      toast(errorText(res.error), { bad: true });
    })(event);
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('pdicts.perm.title')}
      sub={t('pdicts.perm.sub', { group: item.groupText, code: item.id })}
      dirty={isDirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={isSubmitting || changed}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <Field
          id={`${id}-name`}
          label={t('pdicts.col.name')}
          required
          error={fieldError(t, errors.name)}
          full
        >
          {(c) => <input {...c} {...register('name')} className={inputClass()} />}
        </Field>
        <Field
          id={`${id}-description`}
          label={t('pdicts.col.description')}
          hint={t('pdicts.perm.description_hint')}
          required
          error={fieldError(t, errors.description)}
          full
        >
          {(c) => (
            <textarea
              {...c}
              {...register('description')}
              className={`${inputClass({ multiline: true })} min-h-[80px]`}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

/**
 * Админка → «Справочники платформы» → «Права ролей» (ТЗ «Справочники, на которых держится логика
 * системы»; прототип renderPDicts, вкладка perms): 39 прав по группам — список общим механизмом
 * (поиск, фильтры, группировка, «В Excel»); строка и «Изменить» открывают окно права.
 */
export function PermsTab() {
  const t = useT();
  const refresh = usePdictsRefresh();
  const labels = useGridLabels('pdicts.perms_count');
  const columns = useMemo(() => permColumns(t), [t]);
  const defaultVisible = useMemo(
    () => ADMIN_PERMISSION_COLUMNS.filter((c) => !c.hidden).map((c) => c.key),
    [],
  );
  const view = useViewSettings('pdicts.perms');
  const { search, clearSearch } = useShell();
  const listPage = useListPage({
    gridKey: 'pdicts.perms',
    columns,
    defaultVisible,
    settings: view.settings,
    defaultSort: ADMIN_PERMISSION_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchAdminPermissions,
  });
  const { params, visible } = listPage;
  const sendExport = useCallback(
    () => perms.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [dialog, setDialog] = useState<DialogSlot<AdminPermission> | null>(null);
  const open = (x: AdminPermission) => setDialog(openSlot(x));
  const actions = (x: AdminPermission): ActionEntry[] => [
    { id: 'edit', label: t('pdicts.action.edit'), icon: 'edit', run: () => open(x) },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="lock">{t('pdicts.note.perms')}</Note>
      <DataGrid
        columns={columns}
        defaultVisible={defaultVisible}
        defaultSort={ADMIN_PERMISSION_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? listPage.data : undefined}
        onPageChange={listPage.setPage}
        error={listPage.error}
        errorText={listPage.errorText}
        errorTextOf={listPage.errorTextOf}
        onRetry={listPage.retry}
        filters={listPage.filters}
        onFiltersChange={listPage.setFilters}
        loadValues={fetchAdminPermissionValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="shield" title={t('grid.empty')} />}
        rowKey={(x) => x.id}
        titleKey="name"
        label={t('tab.pdicts.perms')}
        labels={labels}
        actions={actions}
        onOpen={open}
      />
      <DictHistory dict="perms" />
      {dialog ? (
        <PermDialog
          key={`perm-${dialog.n}`}
          open={dialog.open}
          onClose={() => setDialog(closeSlot)}
          item={dialog.data}
          onDone={() => refresh('perms')}
        />
      ) : null}
    </div>
  );
}
