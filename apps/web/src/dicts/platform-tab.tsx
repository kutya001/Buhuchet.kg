'use client';

import { formatMomentRu, isOrgDictWindowId, type ListSort } from '@buhuchet/domain';
import {
  ListValues,
  PlatformValueList,
  type PlatformDictGroups,
  type PlatformValueRow,
} from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Icon,
  Note,
  Tag,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { api, apiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { useDictRequest, useMyRequests } from './dict-request';
import { useDictsAddRequest } from './dicts-add';
import { platformTilesQuery } from './dicts-data';
import { PlatformDictWindow, type DictTile } from './platform-dict-window';
import { useTaxPick } from './tax-pick';

// ОТКЛОНЕНИЕ: docs/deviations.md#48 — как в прототипе, не по «Создано» из ТЗ «Списки».
/** «Поиск по всем значениям» — по справочнику (прототип `sort: {key: 'd', dir: 1}`). */
const ALL_SORT: ListSort = { key: 'd', dir: 'asc' };
const ALL_VISIBLE = ['d', 'name'];

function valueColumns(t: Translate): GridColumn<PlatformValueRow>[] {
  return [
    {
      key: 'd',
      label: t('dicts.platform.col.all.d'),
      type: 'enum',
      width: 230,
      text: (r) => r.dictName,
    },
    {
      key: 'name',
      label: t('dicts.platform.col.all.name'),
      type: 'text',
      width: 340,
      text: (r) => r.name,
      cell: (r) => <span className="truncate font-semibold">{r.name}</span>,
    },
  ];
}

/** Кто и когда менял значение в Админке; даты появления у справочников платформы нет. */
const VALUE_AUDIT: GridAudit<PlatformValueRow> = {
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: () => '',
  updatedAt: (r) => (r.audit.updatedAt ? formatMomentRu(new Date(r.audit.updatedAt)) : ''),
};

const fetchValues: FetchListPage<PlatformValueRow> = async (params) => {
  const res = await api.api['platform-values'].$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return PlatformValueList.parse(await res.json());
};

const fetchValueValues = async (col: string, q?: string) => {
  const res = await api.api['platform-values'].values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/** «Поиск по всем значениям» (прототип grid `dict-platform`): справочник и значение, общий поиск. */
function AllValues() {
  const t = useT();
  const { search, clearSearch, access } = useShell();
  const labels = useGridLabels('dicts.platform.count');
  const columns = useMemo(() => valueColumns(t), [t]);
  const viewSettings = useViewSettings('dicts.platform');
  const list = useListPage({
    gridKey: 'dicts.platform',
    columns,
    defaultVisible: ALL_VISIBLE,
    settings: viewSettings.settings,
    defaultSort: ALL_SORT,
    search,
    enabled: viewSettings.ready,
    fetchPage: fetchValues,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api['platform-values'].export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  return (
    <DataGrid
      columns={columns}
      audit={VALUE_AUDIT}
      defaultVisible={ALL_VISIBLE}
      defaultSort={ALL_SORT}
      settings={viewSettings.settings}
      onSettingsChange={viewSettings.save}
      onResetView={() => void viewSettings.reset()}
      data={viewSettings.ready ? list.data : undefined}
      onPageChange={list.setPage}
      error={list.error}
      errorText={list.errorText}
      errorTextOf={list.errorTextOf}
      onRetry={list.retry}
      filters={list.filters}
      onFiltersChange={list.setFilters}
      loadValues={fetchValueValues}
      search={search}
      onClearSearch={clearSearch}
      onExport={access.can('export') ? () => void exporter.run() : undefined}
      exporting={exporter.exporting}
      empty={<EmptyState icon="book" title={t('grid.empty')} />}
      rowKey={(r) => r.id}
      titleKey="name"
      label={t('dicts.platform.all_values')}
      labels={labels}
    />
  );
}

/** Заголовок группы (`.dg-gh`): прописными, справа — число и черта до края. */
function GroupHead({ title, count }: { title: string; count?: number }) {
  return (
    <h3 className="m-0 mt-1.5 flex items-center gap-2 text-[12px] font-bold tracking-[.06em] text-muted uppercase after:h-px after:flex-1 after:bg-line after:content-['']">
      {title}
      {count === undefined ? null : <span className="text-faint">{count}</span>}
    </h3>
  );
}

/** Плитки групп; пока грузятся — пусто, ошибка — с «Повторить». */
function Tiles({
  onOpen,
}: {
  onOpen: (tile: PlatformDictGroups['groups'][number]['tabs'][number], group: string) => void;
}) {
  const t = useT();
  const tiles = useQuery(platformTilesQuery);
  if (tiles.isError) {
    return (
      <EmptyState
        icon="alert"
        title={t('dicts.platform.load_error')}
        text={t('grid.load_error_text')}
        actions={[
          {
            id: 'retry',
            label: t('grid.retry'),
            icon: 'refresh',
            onClick: () => void tiles.refetch(),
          },
        ]}
      />
    );
  }
  return (tiles.data?.groups ?? []).map((g) => (
    <section key={g.group} className="flex flex-col gap-2">
      <GroupHead title={g.group} count={g.tabs.length} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5 max-md:grid-cols-1">
        {g.tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            data-dict-tile={x.id}
            className="flex cursor-pointer flex-col items-start gap-1 rounded-xl border border-line bg-raised px-3.5 py-3 text-left text-ink shadow-pane hover:border-line-strong hover:bg-btn-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            onClick={() => onOpen(x, g.group)}
          >
            <span className="flex w-full items-center gap-2">
              <b className="flex-1 text-[14px]">{x.tab}</b>
              <Tag>{x.count}</Tag>
            </span>
            {x.about ? (
              <span className="text-[12.5px] leading-[1.4] text-muted">{x.about}</span>
            ) : null}
            {x.usedIn ? (
              <span className="text-[11.5px] leading-[1.35] text-faint">{x.usedIn}</span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  ));
}

/**
 * «Справочники» → «Справочники платформы» (ТЗ «Справочники платформы — только просмотр»; прототип
 * modules/dicts.js `renderDicts`, dict-guide.js `orgDictGroups`): пояснение, что списки ведёт
 * администратор платформы, с «Попросить добавить» и «Мои запросы» (docs/deviations.md п. 46); плитки
 * справочников по группам — плитка открывает окно со значениями, «Виды отчётов» — свою вкладку;
 * «Поиск по всем значениям». «+ Добавить» → «Попросить добавить» и «Подключить из каталога» — тоже
 * здесь.
 */
export function PlatformDicts() {
  const t = useT();
  const router = useRouter();
  const pick = useTaxPick();
  const request = useDictRequest();
  const mine = useMyRequests();
  useDictsAddRequest({ catalog: pick.open, request: request.open });
  const [win, setWin] = useState<DialogSlot<DictTile> | null>(null);

  const open = (x: PlatformDictGroups['groups'][number]['tabs'][number], group: string) => {
    if (!isOrgDictWindowId(x.id)) return router.push(tabHref('dicts', 'types'));
    setWin(openSlot({ id: x.id, tab: x.tab, about: x.about, usedIn: x.usedIn, group }));
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="lock">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="min-w-0 flex-1">{t('dicts.platform.note')}</span>
          <span className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass('default', 'sm')} onClick={request.open}>
              <Icon name="send" size="sm" />
              {t('dicts.req.title')}
            </button>
            <button type="button" className={buttonClass('default', 'sm')} onClick={mine.open}>
              <Icon name="history" size="sm" />
              {t('dicts.req.mine')}
            </button>
          </span>
        </span>
      </Note>
      <Tiles onOpen={open} />
      <section className="flex flex-col gap-2">
        <GroupHead title={t('dicts.platform.all_values')} />
        <AllValues />
      </section>
      {win ? (
        <PlatformDictWindow
          key={`dict-${win.n}`}
          tile={win.data}
          open={win.open}
          onClose={() => setWin(closeSlot)}
        />
      ) : null}
      {request.dialog}
      {mine.dialog}
      {pick.dialog}
    </div>
  );
}
