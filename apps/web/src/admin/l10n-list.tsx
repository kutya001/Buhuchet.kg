'use client';

import { formatMomentRu, type ListSort } from '@buhuchet/domain';
import { AdminUiTextList, ListValues, UiLanguages, type AdminUiText } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Note,
  Plate,
  Plates,
  type ActionEntry,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { api, apiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { languageLabel } from './l10n-text';
import { UiTextDialog } from './ui-text-dialog';

/**
 * Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (ТЗ «Сортировка»; прототип
 * defSort: при служебных столбцах `sort` списка не действует).
 */
const DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

const DEFAULT_VISIBLE = ['key', 'text', 'section'];

const moment = (iso: string) => formatMomentRu(new Date(iso));

/**
 * Столбцы словаря — как в прототипе (admin/l10n.js, renderL10n): «Ключ» моноширинным, «Русский
 * текст», «Раздел»; ключи — как на сервере. Служебные столбцы добавляет сам список (`L10N_AUDIT`).
 */
export function uiTextColumns(t: Translate): GridColumn<AdminUiText>[] {
  return [
    {
      key: 'key',
      label: t('locale.col.key'),
      type: 'text',
      width: 220,
      text: (x) => x.key,
      className: MONO_CLASS,
    },
    { key: 'text', label: t('locale.col.text'), type: 'text', width: 340, text: (x) => x.text },
    {
      key: 'section',
      label: t('locale.col.section'),
      type: 'enum',
      width: 120,
      text: (x) => x.section,
    },
  ];
}

/** Значения служебных столбцов; у текста из наполнения «Создал» и «Изменил» пусты. */
const L10N_AUDIT: GridAudit<AdminUiText> = {
  createdBy: (x) => x.audit.createdBy ?? '',
  updatedBy: (x) => x.audit.updatedBy ?? x.audit.createdBy ?? '',
  createdAt: (x) => moment(x.audit.createdAt),
  updatedAt: (x) => moment(x.audit.updatedAt),
};

const fetchUiTexts: FetchListPage<AdminUiText> = async (params) => {
  const res = await api.api.admin['ui-texts'].$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return AdminUiTextList.parse(await res.json());
};

/** Значения столбца для фильтра-галочек; `q` — «Найти значение» по всем значениям. */
const fetchUiTextValues = async (col: string, q?: string) => {
  const res = await api.api.admin['ui-texts'].values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/** Плашки языков: сколько текстов языка переведено (у русского — 100 %). */
const languagesQuery = queryOptions({
  queryKey: ['admin', 'ui-languages'],
  queryFn: async () => {
    const res = await api.api.admin['ui-languages'].$get();
    if (!res.ok) throw new Error(`admin ui languages: ${res.status}`);
    return UiLanguages.parse(await res.json());
  },
});

/**
 * Админка → «Локализация» (ТЗ «Админка» → «Модуль Локализация»; прототип admin/l10n.js, renderL10n):
 * плашки языков — «Русский» (язык по умолчанию, включён, 100 %) и недоступная «Добавить язык»; заметка;
 * словарь текстов интерфейса с поиском, фильтрами, группировкой и «В Excel». Нажатие на строку и
 * «Изменить текст» открывают окно «Текст интерфейса». После сохранения словарь страницы перечитывается
 * (`router.refresh`): новый текст сразу виден на экранах, без изменения кода.
 */
export function L10nList() {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const labels = useGridLabels('locale.count');
  const columns = useMemo(() => uiTextColumns(t), [t]);
  const view = useViewSettings('l10n.list');
  const stats = useModuleStats('l10n');
  const languages = useQuery(languagesQuery);
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: 'l10n.list',
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchUiTexts,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.admin['ui-texts'].export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [edit, setEdit] = useState<DialogSlot<AdminUiText> | null>(null);
  const open = (x: AdminUiText) => setEdit(openSlot(x));
  const actions = (x: AdminUiText): ActionEntry[] => [
    { id: 'edit', label: t('locale.action.edit'), icon: 'edit', run: () => open(x) },
  ];
  const saved = () => {
    void client.invalidateQueries({ queryKey: ['list', 'l10n.list'] });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Plates shown={stats.shown}>
        {(languages.data?.items ?? []).map((l) => (
          <Plate
            key={l.lang}
            id={l.lang}
            icon="globe"
            color="green"
            label={languageLabel(t, l.lang)}
            value={t('locale.share', { n: l.share })}
            sub={l.isDefault && l.enabled ? t('locale.lang.default_on') : undefined}
          />
        ))}
        <Plate
          id="add"
          icon="plus"
          color="gray"
          label={t('locale.add_lang')}
          sub={t('locale.add_lang_sub')}
          disabled
        />
      </Plates>
      <Note icon="info">{t('locale.note')}</Note>
      <DataGrid
        columns={columns}
        audit={L10N_AUDIT}
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
        loadValues={fetchUiTextValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="globe" title={t('grid.empty')} />}
        rowKey={(x) => x.key}
        titleKey="text"
        label={t('nav.l10n')}
        labels={labels}
        actions={actions}
        onOpen={open}
      />
      {edit ? (
        <UiTextDialog
          key={`edit-${edit.n}`}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          item={edit.data}
          onDone={saved}
        />
      ) : null}
    </div>
  );
}
