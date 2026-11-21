'use client';

import { formatMomentRu, type ListSort } from '@buhuchet/domain';
import type { DmTokenRow } from '@buhuchet/shared';
import { buttonClass, DataGrid, EmptyState, MONO_CLASS, Note, type GridColumn } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useMemo } from 'react';
import { flashTarget, KB_TOKEN_VARIANT } from '../kb/kb-go';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { dropAddressParam, linkedRecordId } from '../record-link';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { TokenStatePill, useTokenActions } from './token-dialogs';
import {
  DM_TOKEN_GRID,
  exportTokens,
  fetchTokens,
  fetchTokenValues,
  tokenFormQuery,
  type DmSide,
} from './tokens-data';

/** Сначала новые (прототип `sort: {key: 'at', dir: -1}`). */
const DEFAULT_SORT: ListSort = { key: 'at', dir: 'desc' };
const NUM = 'tabular-nums';
const DASH = <span className="text-faint">—</span>;
const moment = (iso: string) => formatMomentRu(new Date(iso));

/** Столбцы списка — как в прототипе (`renderDmTok`, grid `dm-tok-adm` / `dm-tok`), ключи — как на сервере. */
export function tokenColumns(t: Translate, side: DmSide): GridColumn<DmTokenRow>[] {
  return [
    {
      key: 'name',
      label: t('dm.tok.col.name'),
      type: 'text',
      width: 210,
      text: (k) => k.name,
      cell: (k) => (
        <>
          <span className="font-semibold">{k.name}</span>
          <div className={`${MONO_CLASS} text-faint`}>{`${k.prefix}…`}</div>
        </>
      ),
    },
    {
      key: 'st',
      label: t('dm.tok.col.st'),
      type: 'enum',
      width: 170,
      text: (k) => t(`dm.tok.state.${k.state}`),
      cell: (k) => (
        <>
          <TokenStatePill t={t} state={k.state} />
          {k.note ? (
            <div className="text-[12px] whitespace-normal text-faint" data-dm-note="">
              {k.note}
            </div>
          ) : null}
        </>
      ),
    },
    ...(side === 'admin'
      ? [
          {
            key: 'org',
            label: t('dm.tok.col.org'),
            type: 'enum',
            width: 200,
            text: (k) => k.orgName,
          } satisfies GridColumn<DmTokenRow>,
        ]
      : []),
    { key: 'tpl', label: t('dm.tok.col.tpl'), type: 'enum', width: 220, text: (k) => k.tplName },
    { key: 'by', label: t('dm.tok.col.by'), type: 'enum', width: 160, text: (k) => k.byName },
    {
      key: 'at',
      label: t('dm.tok.col.at'),
      type: 'datetime',
      width: 140,
      text: (k) => moment(k.createdAt),
      className: NUM,
    },
    {
      key: 'till',
      label: t('dm.tok.col.till'),
      type: 'datetime',
      width: 140,
      text: (k) => moment(k.till),
      className: NUM,
    },
    {
      key: 'last',
      label: t('dm.tok.col.last'),
      type: 'datetime',
      width: 190,
      text: (k) => (k.lastAt ? moment(k.lastAt) : ''),
      cell: (k) =>
        k.lastAt ? (
          <>
            <span className={NUM}>{moment(k.lastAt)}</span>
            {k.lastIp ? <div className={`${MONO_CLASS} text-faint`}>{k.lastIp}</div> : null}
          </>
        ) : (
          DASH
        ),
    },
    {
      key: 'n30',
      label: t('dm.tok.col.n30'),
      type: 'int',
      width: 110,
      text: (k) => String(k.n30),
    },
  ];
}

/**
 * «Витрина данных» → «API Токены» (доработки 20.11.2026: Витрина данных, блок 5; прототип v155
 * `renderDmTok`): пояснение над списком, у организации — красная строка «Внешний доступ по API выключен»
 * и «В демо-версии токены не выпускаются»; список токенов, меню строки «Открыть · Перевыпустить ·
 * Отозвать», окно токена. «+ Добавить» → «Токен» — окно «Новый API-токен».
 */
export function TokensTab({ side }: { side: DmSide }) {
  const t = useT();
  const router = useRouter();
  const gridKey = DM_TOKEN_GRID[side];
  const labels = useGridLabels('dm.tok.count');
  const columns = useMemo(() => tokenColumns(t, side), [t, side]);
  const visible = useMemo(() => columns.map((c) => c.key), [columns]);
  const view = useViewSettings(gridKey);
  const { search, clearSearch, addRequest, clearAddRequest, access } = useShell();
  const form = useQuery(tokenFormQuery(side));
  const tokens = useTokenActions(side);
  // Строка колокольчика и кнопка «Открыть» сообщения бота «API-токен создан», «отозван», «истекает»
  // (общий план 20.11, этап 3, П5): окно токена и адрес без `?tok=`.
  const tokParam = useSearchParams().get('tok');
  const openLinked = useEffectEvent((value: string) => {
    dropAddressParam('tok');
    const id = linkedRecordId(value);
    if (id) tokens.open(id);
  });
  useEffect(() => {
    if (tokParam) openLinked(tokParam);
  }, [tokParam]);
  const loadValues = useMemo(() => fetchTokenValues(side), [side]);
  const list = useListPage({
    gridKey,
    columns,
    audit: false,
    defaultVisible: visible,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchTokens(side),
  });
  const { params } = list;
  const sendExport = useCallback(
    () =>
      exportTokens(side, {
        ...(params as Record<string, string>),
        cols: list.visible.join(','),
      }),
    [side, params, list.visible],
  );
  const exporter = useListExport(sendExport);

  // «+ Добавить» → «Токен» (прототип `dmAdd`); «Перейти» шага урока «Выпустить API-токен» при
  // выключенном API подсвечивает красную плашку, а не показывает уведомление (прототип kb-lessons).
  const request = addRequest?.moduleId === 'dm' ? addRequest : null;
  const start = useEffectEvent((actionId: string, variant?: string) => {
    if (actionId !== 'tok') return;
    void tokens.issue(
      undefined,
      variant === KB_TOKEN_VARIANT ? () => flashTarget('[data-dm-api-off]') : undefined,
    );
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId, request.variant);
    clearAddRequest();
  }, [request, clearAddRequest]);

  const f = form.data;
  if (side === 'org' && f?.demo) {
    return <EmptyState icon="key" title={t('dm.tok.demo_title')} text={t('dm.tok.demo_text')} />;
  }

  return (
    <div data-dm-tokens={side} className="flex flex-col gap-3.5">
      {side === 'org' && f?.apiOff ? (
        <div data-dm-api-off="">
          <Note tone="bad" icon="lock">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 grow">{t('dm.tok.api_off')}</span>
              {f.owner ? (
                <button
                  type="button"
                  className={buttonClass('default', 'sm')}
                  data-dm-api-on=""
                  onClick={() => router.push(tabHref('org', 'settings'))}
                >
                  {t('dm.tok.api_off_open')}
                </button>
              ) : null}
            </div>
          </Note>
        </div>
      ) : null}
      <Note>
        {side === 'admin' ? t('dm.tok.note_admin') : t('dm.tok.note', { max: f?.max ?? '' })}
      </Note>
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
        loadValues={loadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.admin || access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={
          <EmptyState
            icon="key"
            title={t('dm.tok.empty_title')}
            text={t(side === 'admin' ? 'dm.tok.empty_admin' : 'dm.tok.empty_org')}
          />
        }
        rowKey={(k) => k.id}
        titleKey="name"
        label={t('tab.dm.tok')}
        labels={labels}
        actions={tokens.actions}
        onOpen={(k) => tokens.open(k.id)}
      />
      {tokens.node}
    </div>
  );
}
