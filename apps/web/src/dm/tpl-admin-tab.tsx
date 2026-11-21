'use client';

import { formatMomentRu, type ListSort } from '@buhuchet/domain';
import type { DmAdminTemplateRow } from '@buhuchet/shared';
import { DataGrid, EmptyState, MONO_CLASS, Note, Pill, type GridColumn } from '@buhuchet/ui';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useMemo } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { dropAddressParam, linkedRecordId } from '../record-link';
import { useShell } from '../shell/context';
import { useTemplateActions } from './tpl-actions';
import {
  DM_TPL_GRID,
  exportTemplates,
  fetchTemplates,
  fetchTemplateValues,
} from './tpl-admin-data';
import { TPL_PILL } from './tpl-admin-model';

/** По названию (прототип `sort: {key: 'name', dir: 1}`). */
const DEFAULT_SORT: ListSort = { key: 'name', dir: 'asc' };
const NUM = 'tabular-nums';
/** «Модуль» скрыт по умолчанию (прототип `hide: true`). */
const HIDDEN = new Set(['mod']);

/** Столбцы списка (прототип grid `dm-tpl`), ключи — как на сервере. */
export function templateColumns(t: Translate): GridColumn<DmAdminTemplateRow>[] {
  return [
    {
      key: 'name',
      label: t('dm.tpl.col.name'),
      type: 'text',
      width: 270,
      text: (x) => x.name,
      cell: (x) => (
        <>
          <span className="font-semibold">{x.name}</span>
          {x.builtin ? (
            <>
              {' '}
              <span
                className="rounded-full bg-pane-alt px-[7px] text-[11.5px] text-muted"
                data-dm-tpl-builtin=""
              >
                {t('dm.tpl.builtin')}
              </span>
            </>
          ) : null}
        </>
      ),
    },
    {
      key: 'code',
      label: t('dm.tpl.col.code'),
      type: 'text',
      width: 170,
      text: (x) => x.code,
      className: MONO_CLASS,
    },
    {
      key: 'kind',
      label: t('dm.tpl.col.kind'),
      type: 'enum',
      width: 170,
      text: (x) => t(`dm.tpl.kind.${x.audience}`),
    },
    {
      key: 'state',
      label: t('dm.tpl.col.state'),
      type: 'enum',
      width: 150,
      text: (x) => t(`dm.tpl.state.${x.state}`),
      cell: (x) => (
        <Pill tone={TPL_PILL[x.state].tone} icon={TPL_PILL[x.state].icon}>
          {t(`dm.tpl.state.${x.state}`)}
        </Pill>
      ),
    },
    {
      key: 'orgs',
      label: t('dm.tpl.col.orgs'),
      type: 'int',
      width: 130,
      text: (x) => (x.orgs === null ? '' : String(x.orgs)),
    },
    {
      key: 'toks',
      label: t('dm.tpl.col.toks'),
      type: 'int',
      width: 90,
      text: (x) => String(x.toks),
    },
    {
      key: 'checked',
      label: t('dm.tpl.col.checked'),
      type: 'datetime',
      width: 150,
      text: (x) => (x.checkedAt ? formatMomentRu(new Date(x.checkedAt)) : ''),
      className: NUM,
    },
    {
      key: 'mod',
      label: t('dm.tpl.col.mod'),
      type: 'enum',
      width: 220,
      text: (x) => (x.module ? t(`dm.mod.${x.module}`) : t('dm.tpl.mod.none')),
    },
  ];
}

/**
 * Админка → «Витрина данных» → «Шаблоны» (доработки 20.11.2026: Витрина данных, блок 2; общий план
 * 20.11, этап 2, П7; прототип v155 `renderDmTplAdm`): пояснение, список шаблонов, меню строки
 * «Открыть · Копировать · Отключить/Включить», окно шаблона. «+ Добавить» → «Шаблон» разбирает экран
 * модуля (`DmScreen`): окно открывается с любой вкладки, как в прототипе.
 */
export function TemplatesAdminTab() {
  const t = useT();
  const labels = useGridLabels('dm.tpl.count');
  const columns = useMemo(() => templateColumns(t), [t]);
  const visible = useMemo(() => columns.map((c) => c.key).filter((k) => !HIDDEN.has(k)), [columns]);
  const view = useViewSettings(DM_TPL_GRID);
  const { search, clearSearch } = useShell();
  const tpl = useTemplateActions();
  // Строка колокольчика «Шаблон перестал работать»: окно шаблона и адрес без `?tpl=`.
  const tplParam = useSearchParams().get('tpl');
  const openLinked = useEffectEvent((value: string) => {
    dropAddressParam('tpl');
    const id = linkedRecordId(value);
    if (id) void tpl.open(id);
  });
  useEffect(() => {
    if (tplParam) openLinked(tplParam);
  }, [tplParam]);
  const list = useListPage({
    gridKey: DM_TPL_GRID,
    columns,
    audit: false,
    defaultVisible: visible,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchTemplates,
  });
  const { params } = list;
  const sendExport = useCallback(
    () =>
      exportTemplates({
        ...(params as Record<string, string>),
        cols: list.visible.join(','),
      }),
    [params, list.visible],
  );
  const exporter = useListExport(sendExport);

  return (
    <div data-dm-tpl-admin="" className="flex flex-col gap-3.5">
      <Note>{t('dm.tpl.note')}</Note>
      <DataGrid
        columns={columns}
        defaultVisible={visible}
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
        loadValues={fetchTemplateValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={
          <EmptyState icon="layers" title={t('dm.tpl.empty_title')} text={t('dm.tpl.empty_text')} />
        }
        rowKey={(x) => x.id}
        titleKey="name"
        label={t('tab.dm.tpl')}
        labels={labels}
        actions={tpl.actions}
        onOpen={(x) => void tpl.open(x.id)}
      />
      {tpl.node}
    </div>
  );
}
