'use client';

import {
  formatCount,
  formatMomentRu,
  type ListFilterValue,
  type ListSort,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  AdminTelegramLogList,
  AdminTelegramRetryResult,
  AdminTelegramSummary,
  ListValues,
  type AdminTelegramLogRow,
} from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Pill,
  Plate,
  Plates,
  useToast,
  type GridBulkAction,
  type GridColumn,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { bulkRetryToast, logMenu } from './tgadm-menu';

/** Сначала новые (прототип `sort: {key: 'at', dir: -1}`). */
const DEFAULT_SORT: ListSort = { key: 'at', dir: 'desc' };
const DEFAULT_VISIBLE = ['at', 'to', 'org', 'kind', 'st', 'tries', 'err'];

const STATUS_PILL = {
  sent: { tone: 'ok', icon: 'check' },
  pending: { tone: 'warn', icon: 'hourglass' },
  error: { tone: 'bad', icon: 'alert' },
} as const;

/** «Ошибка» строки: ответ Telegram или подпись кода итога из словаря. */
function errorOf(t: Translate, row: AdminTelegramLogRow): string {
  if (!row.error) return '';
  return row.error === 'recipient_unlinked' ? t('tgadm.err.unlinked') : row.error;
}

/** Столбцы журнала — как в прототипе (admin/telegram.js, grid 'tg-log'), ключи — как на сервере. */
export function logColumns(t: Translate): GridColumn<AdminTelegramLogRow>[] {
  return [
    {
      key: 'at',
      label: t('tgadm.col.at'),
      type: 'datetime',
      width: 150,
      text: (r) => formatMomentRu(new Date(r.at)),
    },
    { key: 'to', label: t('tgadm.col.to'), type: 'text', width: 190, text: (r) => r.recipient },
    {
      key: 'org',
      label: t('tgadm.col.org'),
      type: 'enum',
      width: 220,
      text: (r) => r.orgName ?? t('tgadm.org.platform'),
    },
    {
      key: 'kind',
      label: t('tgadm.col.kind'),
      type: 'enum',
      width: 190,
      text: (r) => t(`telegram.kind.${r.kind}` as UiTextKey),
    },
    {
      key: 'st',
      label: t('tgadm.col.st'),
      type: 'enum',
      width: 140,
      text: (r) => t(`tgadm.st.${r.status}`),
      cell: (r) => (
        <Pill tone={STATUS_PILL[r.status].tone} icon={STATUS_PILL[r.status].icon}>
          {t(`tgadm.st.${r.status}`)}
        </Pill>
      ),
    },
    {
      key: 'tries',
      label: t('tgadm.col.tries'),
      type: 'int',
      width: 90,
      numeric: true,
      text: (r) => formatCount(r.tries),
    },
    {
      key: 'err',
      label: t('tgadm.col.err'),
      type: 'text',
      width: 280,
      text: (r) => errorOf(t, r),
      className: MONO_CLASS,
    },
  ];
}

const fetchLog: FetchListPage<AdminTelegramLogRow> = async (params) => {
  const res = await api.api.admin.telegram.log.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return AdminTelegramLogList.parse(await res.json());
};

const fetchLogValues = async (col: string, q?: string) => {
  const res = await api.api.admin.telegram.log.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

const summaryQuery = queryOptions({
  queryKey: ['admin', 'tg-summary'],
  queryFn: async () => {
    const res = await api.api.admin.telegram.log.summary.$get();
    if (!res.ok) throw new Error(`admin telegram summary: ${res.status}`);
    return AdminTelegramSummary.parse(await res.json());
  },
});

/** Плашка — фильтр «Статус» (прототип: `g.filters.st = {type: 'enum', vals: [...]}`). */
const statusFilter = (status: 'error' | 'pending'): Record<string, ListFilterValue> => ({
  st: { type: 'enum', vals: [status] },
});

/**
 * Админка → «Телеграм» → «Журнал» (ТЗ «Журнал отправленных сообщений и ошибок отправки, повтор
 * отправки»; прототип admin/telegram.js, tab 'log'): плашки «В очереди», «Ошибки отправки» (нажатие —
 * фильтр по статусу), «Отправлено сегодня» (нажатие снимает фильтры); журнал всех организаций и
 * платформы с поиском, фильтрами и «В Excel»; строки с ошибкой — красным. «Повторить отправку» у
 * строки и «Повторить ошибки» у отмеченных; код восстановления повторно не отправляется.
 */
export function TgAdmLog() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const labels = useGridLabels('tgadm.count');
  const columns = useMemo(() => logColumns(t), [t]);
  const view = useViewSettings('tg.log');
  const stats = useModuleStats('tg');
  const summary = useQuery(summaryQuery);
  const { search, clearSearch } = useShell();
  const client = useQueryClient();
  const list = useListPage({
    gridKey: 'tg.log',
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchLog,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.admin.telegram.log.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', 'tg.log'] });
    void client.invalidateQueries({ queryKey: summaryQuery.queryKey });
  }, [client]);

  const retry = async (ids: readonly string[]) => {
    if (busy) return null;
    setBusy(true);
    const res = await callApi(() =>
      api.api.admin.telegram.log.retry.$post({ json: { ids: [...ids] } }),
    );
    setBusy(false);
    refresh();
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return null;
    }
    const body = AdminTelegramRetryResult.safeParse(res.data);
    if (!body.success) {
      toast(t('err.unknown'), { bad: true });
      return null;
    }
    return body.data;
  };

  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-32 — строка снова «Ожидает» и уходит следующим запуском очереди.
  const retryOne = async (row: AdminTelegramLogRow) => {
    const result = await retry([row.id]);
    if (!result) return;
    if (result.queued) toast(t('tgadm.retry.done'), { icon: 'tg' });
    else toast(t('tgadm.retry.none'), { bad: true });
  };

  const bulk: GridBulkAction<AdminTelegramLogRow>[] = [
    {
      id: 'retry',
      label: t('tgadm.retry.bulk'),
      icon: 'refresh',
      run: (rows, done) => {
        // Строки не в «Ошибке» не повторяются и не шлются; коды восстановления пропускает сервер.
        const ids = rows.filter((r) => r.status === 'error').map((r) => r.id);
        done();
        if (!ids.length) return toast(bulkRetryToast(t, { queued: 0, codes: 0 }));
        void retry(ids).then((result) => {
          if (result) toast(bulkRetryToast(t, result));
        });
      },
    },
  ];

  const actions = logMenu({ t, retry: (row) => void retryOne(row) });
  const plate = (n: number | undefined) => (n === undefined ? '' : formatCount(n));
  const errors = summary.data?.errors ?? 0;

  return (
    <div className="flex flex-col gap-3.5">
      <Plates shown={stats.shown}>
        <Plate
          id="q"
          icon="hourglass"
          color="yellow"
          label={t('tgadm.plate.queue')}
          value={plate(summary.data?.pending)}
          sub={t('tgadm.plate.queue_sub')}
          onClick={() => list.setFilters(statusFilter('pending'))}
        />
        <Plate
          id="e"
          icon="alert"
          color={errors ? 'red' : 'green'}
          label={t('tgadm.plate.errors')}
          value={plate(summary.data?.errors)}
          sub={t('tgadm.plate.errors_sub')}
          onClick={() => list.setFilters(statusFilter('error'))}
        />
        <Plate
          id="s"
          icon="send"
          color="green"
          label={t('tgadm.plate.sent')}
          value={plate(summary.data?.sentToday)}
          onClick={() => list.setFilters({})}
        />
      </Plates>
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
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={fetchLogValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="tg" title={t('grid.empty')} />}
        rowKey={(r) => r.id}
        titleKey="kind"
        rowTone={(r) => (r.status === 'error' ? 'overdue' : undefined)}
        label={t('tab.tg.log')}
        labels={labels}
        actions={actions}
        bulk={bulk}
      />
    </div>
  );
}
