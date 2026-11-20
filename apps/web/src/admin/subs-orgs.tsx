'use client';

import {
  formatCount,
  formatDateRu,
  formatSom,
  type IsoDate,
  type ListSort,
  type SubscriptionStatus,
} from '@buhuchet/domain';
import type { AdminSubscriptionRow } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  Note,
  Pill,
  Plate,
  Plates,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useMemo } from 'react';
import { api } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { dropAddressParam, linkedRecordId } from '../record-link';
import { useShell } from '../shell/context';
import { useAdminCards } from './admin-cards';
import { useSubActions } from './sub-actions';
import { SubStatusPill } from './sub-org-window';
import {
  fetchSubscriptions,
  fetchSubscriptionValues,
  subSettingsQuery,
  subsSummaryQuery,
} from './subs-data';
import { subGb, subGbLimit, subPlateColors } from './subs-model';

/** По статусу (прототип `sort: {key: 'st', dir: 1}`: чеки дольше срока первыми, `subSortKey`). */
const DEFAULT_SORT: ListSort = { key: 'st', dir: 'asc' };

/** Видимые по умолчанию (прототип: `hide` у дополнительной скидки, первой и последней оплаты, владельца). */
const DEFAULT_VISIBLE = ['name', 'kind', 'pack', 'mem', 'paidTo', 'st', 'chk'];

/** Срок проверки чека и «Напоминать за» по умолчанию, пока не пришли «Цены и реквизиты». */
const CHECK_DAYS = 3;
const REMIND_DAYS = 7;

const date = (d: string | null) => (d ? formatDateRu(d as IsoDate) : '');

/** Столбцы — как в прототипе (сетка `adm-subs`), ключи — как на сервере. */
function subColumns(t: Translate, checkDays: number): GridColumn<AdminSubscriptionRow>[] {
  const kind = (o: AdminSubscriptionRow) =>
    o.demo || !o.planId ? '—' : o.free ? t('subs.kind.free') : (o.planName ?? '—');
  return [
    {
      key: 'name',
      label: t('subs.col.name'),
      type: 'text',
      width: 260,
      text: (o) => o.name,
      cell: (o) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="font-semibold">{o.name}</span>
          {o.demo ? (
            <Pill tone="violet" icon="star" size="sm">
              {t('subs.demo')}
            </Pill>
          ) : null}
          {o.blocked ? (
            <Pill tone="bad" icon="lock" size="sm">
              {t('subs.blocked')}
            </Pill>
          ) : null}
        </span>
      ),
    },
    { key: 'kind', label: t('subs.col.kind'), type: 'enum', width: 150, text: kind },
    {
      key: 'pack',
      label: t('subs.col.pack'),
      type: 'int',
      width: 110,
      numeric: true,
      text: (o) => t('subs.used', { used: o.seatsUsed, pack: o.pack }),
      cell: (o) => (
        <span className={`tabular-nums ${o.seatsUsed > o.pack ? 'text-danger' : ''}`}>
          {t('subs.used', { used: o.seatsUsed, pack: o.pack })}
        </span>
      ),
    },
    {
      key: 'mem',
      label: t('subs.col.mem'),
      type: 'int',
      width: 130,
      numeric: true,
      text: (o) => t('subs.mem', { used: subGb(o.bytesUsed), limit: subGbLimit(o.bytesLimit) }),
      cell: (o) => (
        <span className="tabular-nums">
          {t('subs.mem', { used: subGb(o.bytesUsed), limit: subGbLimit(o.bytesLimit) })}
        </span>
      ),
    },
    {
      key: 'paidTo',
      label: t('subs.col.paid_to'),
      type: 'date',
      width: 120,
      text: (o) => date(o.paidUntil),
      cell: (o) => <span className="tabular-nums">{date(o.paidUntil)}</span>,
    },
    {
      key: 'st',
      label: t('subs.col.st'),
      type: 'enum',
      width: 200,
      text: (o) => t(`subs.st.${o.status}`),
      cell: (o) => <SubStatusPill t={t} status={o.status} late={o.late} days={checkDays} />,
    },
    {
      key: 'chk',
      label: t('subs.col.chk'),
      type: 'money',
      width: 130,
      numeric: true,
      text: (o) => (o.pendingAmount === null ? '' : formatSom(o.pendingAmount)),
      total: (v) => formatSom(v),
    },
    {
      key: 'add',
      label: t('subs.col.add'),
      type: 'int',
      width: 120,
      numeric: true,
      text: (o) => String(o.extraDiscountPct),
    },
    {
      key: 'first',
      label: t('subs.col.first'),
      type: 'date',
      width: 120,
      text: (o) => date(o.firstPaid),
    },
    {
      key: 'last',
      label: t('subs.col.last'),
      type: 'date',
      width: 120,
      text: (o) => date(o.lastPaid),
    },
    {
      key: 'owner',
      label: t('subs.col.owner'),
      type: 'text',
      width: 150,
      text: (o) => o.owner ?? '',
      cell: (o) => <span className="font-mono text-[.92em]">{o.owner ?? ''}</span>,
    },
  ];
}

/** Плашка нажата — в фильтре «Статус» ровно её значение (прототип `on(v)`). */
const stOn = (filters: Record<string, unknown>, v: SubscriptionStatus) => {
  const f = filters.st as { type?: string; vals?: readonly string[] } | undefined;
  return f?.type === 'enum' && f.vals?.length === 1 && f.vals[0] === v;
};

/**
 * «Организации» вкладки «Подписки» (доработки 20.11.2026, блок 6, пункт 2; прототип `subOrgsPart`):
 * пояснение, плашки «Ждут подтверждения», «Просрочены», «Скоро истекают», «Активны» (нажатие — фильтр
 * «Статус»), список всех организаций; строка с чеком дольше срока — жёлтая. Нажатие на строку — окно
 * «Подписка организации»; ссылка колокольчика `?org=<номер>` открывает его сразу.
 */
export function SubsOrgs() {
  const t = useT();
  const cfg = useQuery(subSettingsQuery);
  const checkDays = cfg.data?.checkDays ?? CHECK_DAYS;
  const remindDays = cfg.data?.remindDays ?? REMIND_DAYS;
  const labels = useGridLabels('subs.count');
  const columns = useMemo(() => subColumns(t, checkDays), [t, checkDays]);
  const view = useViewSettings('orgs.subs');
  const stats = useModuleStats('orgs');
  const summary = useQuery(subsSummaryQuery);
  const { search, clearSearch } = useShell();
  const { openOrg, cards } = useAdminCards();
  const subs = useSubActions({ onOrg: (id) => openOrg(id) });
  const list = useListPage({
    gridKey: 'orgs.subs',
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchSubscriptions,
  });
  const { params, visible, filters, setFilters } = list;
  const sendExport = useCallback(
    () =>
      api.api.admin.subscriptions.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);

  // Строка колокольчика «Новый чек подписки» (поток Т): окно организации и адрес без `?org=`.
  const orgParam = useSearchParams().get('org');
  const openLinked = useEffectEvent((value: string) => {
    dropAddressParam('org');
    const id = linkedRecordId(value);
    if (id) subs.openWindow(id, '');
  });
  useEffect(() => {
    if (orgParam) openLinked(orgParam);
  }, [orgParam]);

  const actions = (o: AdminSubscriptionRow): ActionEntry[] => [
    {
      id: 'open',
      label: t('subs.act.open'),
      icon: 'wallet',
      run: () => subs.openWindow(o.id, o.name),
    },
    { id: 'edit', label: t('subs.act.edit'), icon: 'edit', run: () => subs.openEdit(o.id) },
    { id: 'sep', separator: true },
    { id: 'org', label: t('subs.act.org'), icon: 'building', run: () => openOrg(o.id) },
  ];

  const s = summary.data;
  const by = s?.byStatus ?? {};
  const colors = subPlateColors(by);
  const n = (v: number | undefined) => (s ? formatCount(v ?? 0) : '');
  const plate = (v: SubscriptionStatus) => ({
    on: stOn(filters, v),
    onClick: () => setFilters(stOn(filters, v) ? {} : { st: { type: 'enum', vals: [v] } }),
  });

  return (
    <div className="flex flex-col gap-3.5" data-subs-orgs="">
      <Note>{t('subs.orgs.note', { days: checkDays })}</Note>
      <Plates shown={stats.shown}>
        <Plate
          id="pending"
          icon="clock"
          color={colors.pending}
          label={t('subs.plate.pending')}
          value={n(by.pending)}
          sub={
            s?.late
              ? t('subs.plate.pending.late', { days: checkDays, n: s.late })
              : t('subs.plate.pending.sub')
          }
          {...plate('pending')}
        />
        <Plate
          id="overdue"
          icon="alert"
          color={colors.overdue}
          label={t('subs.plate.overdue')}
          value={n(by.overdue)}
          sub={t('subs.plate.overdue.sub')}
          {...plate('overdue')}
        />
        <Plate
          id="expiring"
          icon="hourglass"
          color={colors.expiring}
          label={t('subs.plate.expiring')}
          value={n(by.expiring)}
          sub={t('subs.plate.expiring.sub', { days: remindDays })}
          {...plate('expiring')}
        />
        <Plate
          id="active"
          icon="check"
          color="green"
          label={t('subs.plate.active')}
          value={n(by.active)}
          {...plate('active')}
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
        filters={filters}
        onFiltersChange={setFilters}
        loadValues={fetchSubscriptionValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="wallet" title={t('grid.empty')} />}
        rowKey={(o) => o.id}
        titleKey="name"
        rowTone={(o) => (o.late ? 'warn' : undefined)}
        label={t('subs.part.orgs')}
        labels={labels}
        actions={actions}
        onOpen={(o) => subs.openWindow(o.id, o.name)}
      />
      {subs.nodes}
      {cards}
    </div>
  );
}
