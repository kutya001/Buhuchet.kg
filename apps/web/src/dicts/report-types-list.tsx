'use client';

import { formatMomentRu, type ListSort } from '@buhuchet/domain';
import {
  ListValues,
  OrgReportTypeList,
  OrgReportTypeSetting,
  type OrgReportTypeRow,
  type OrgReportTypeSave,
  type ReportType,
  type Taxes,
} from '@buhuchet/shared';
import {
  ActPill,
  buttonClass,
  DataGrid,
  EmptyState,
  Icon,
  MONO_CLASS,
  Note,
  SWITCH_CLASS,
  Tag,
  useToast,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useDictRequest, useMyRequests } from './dict-request';
import { useDictsAddRequest } from './dicts-add';
import {
  catalogQuery,
  taxesQuery,
  typeSettingsQuery,
  useDictsRefresh,
  type Catalog,
} from './dicts-data';
import { useTaxPick } from './tax-pick';
import { TypeView } from './type-view';

/**
 * Сортировка по умолчанию во всех списках — от новых к старым по «Создано» (прототип defSort). «Создано»
 * у вида — когда организация его подключила, поэтому сверху подключённые, последние — первыми
 * (docs/decisions.md).
 */
const DEFAULT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/**
 * Видимые по умолчанию (ТЗ «Столбцы, видимые по умолчанию»; прототип ui/grid.js, SHOW `dict-types`):
 * «Подключён», название, что сделать, что уплачивается, орган, периодичность, срок, файл, квитанция,
 * назначено контрагентам; остальные — в «Столбцах».
 */
const DEFAULT_VISIBLE = [
  'on',
  'name',
  'act',
  'pays',
  'organ',
  'per',
  'rule',
  'file',
  'receipt',
  'used',
];

const moment = (iso: string | null | undefined) => (iso ? formatMomentRu(new Date(iso)) : '');

/** Что меняет переключатель в строке. */
type Flag = 'enabled' | 'needFile' | 'needReceipt';

const yesNo = (on: boolean, t: Translate) => t(on ? 'dicts.yes' : 'dicts.no');

/** «—» бледным, как пустое значение в прототипе (`<span class="faint">—</span>`). */
const Dash = () => <span className="text-faint">—</span>;

/**
 * Столбцы списка «Виды отчётов» — как в прототипе (modules/dicts.js, grid `dict-types`), ключи — как на
 * сервере. Переключатели «Подключён», «Файл при сдаче обязателен», «Квитанция о приёме обязательна»
 * доступны только с правом «Вести справочники организации»; файла у вида «Уплата» и обоих у
 * неподключённого вида нет.
 */
export function typeColumns(
  t: Translate,
  edit: {
    can: boolean;
    busy: (code: string) => boolean;
    flip: (row: OrgReportTypeRow, flag: Flag, on: boolean) => void;
  },
): GridColumn<OrgReportTypeRow>[] {
  const sw = (row: OrgReportTypeRow, flag: Flag, label: string) => (
    <input
      type="checkbox"
      role="switch"
      className={SWITCH_CLASS}
      checked={row[flag]}
      disabled={!edit.can || edit.busy(row.code)}
      aria-label={label}
      data-flag={flag}
      onChange={(e) => edit.flip(row, flag, e.target.checked)}
    />
  );
  return [
    {
      key: 'on',
      label: t('dicts.col.on'),
      type: 'enum',
      width: 110,
      text: (r) => yesNo(r.enabled, t),
      cell: (r) => sw(r, 'enabled', t('dicts.types.on_label', { name: r.name })),
    },
    {
      key: 'name',
      label: t('dicts.col.name'),
      type: 'text',
      width: 280,
      text: (r) => r.name,
      cell: (r) => <span className="truncate font-semibold">{r.name}</span>,
    },
    {
      key: 'act',
      label: t('dicts.col.act'),
      type: 'enum',
      width: 175,
      text: (r) => t(`report.act.${r.act}`),
      cell: (r) => <ActPill act={r.act} label={t(`report.act.${r.act}`)} />,
    },
    {
      key: 'pays',
      label: t('dicts.col.pays'),
      type: 'text',
      width: 220,
      text: (r) => r.pays,
      cell: (r) => (r.act === 'sub' ? <Dash /> : r.pays),
    },
    {
      key: 'short',
      label: t('dicts.col.short'),
      type: 'text',
      width: 100,
      text: (r) => r.shortName,
    },
    {
      key: 'code',
      label: t('dicts.col.code'),
      type: 'text',
      width: 110,
      text: (r) => r.formCode,
      className: MONO_CLASS,
    },
    {
      key: 'organ',
      label: t('dicts.col.organ'),
      type: 'enum',
      width: 130,
      text: (r) => r.authority,
    },
    {
      key: 'index',
      label: t('dicts.col.index'),
      type: 'text',
      width: 110,
      text: (r) => r.statIndex,
      className: MONO_CLASS,
    },
    {
      key: 'per',
      label: t('dicts.col.per'),
      type: 'enum',
      width: 120,
      text: (r) =>
        r.oneOff
          ? t('report.period.oneoff')
          : t(`report.period.${r.period.toLowerCase() as 'm' | 'q' | 'h' | 'y'}`),
    },
    { key: 'rule', label: t('dicts.col.rule'), type: 'text', width: 250, text: (r) => r.due },
    { key: 'payrule', label: t('dicts.col.payrule'), type: 'text', width: 250, text: (r) => r.pay },
    {
      key: 'kind',
      label: t('dicts.col.kind'),
      type: 'enum',
      width: 110,
      text: (r) => t(`report.kind.${r.kind}`),
    },
    {
      key: 'rates',
      label: t('dicts.col.rates'),
      type: 'text',
      width: 130,
      text: (r) => r.rates.join('; '),
    },
    // ОТКЛОНЕНИЕ: docs/deviations.md#44 — порядок как в ТЗ: «Файл…» и «Квитанция…» после срока, перед
    // «Назначено контрагентам» (в прототипе — сразу после «Что уплачивается»).
    {
      key: 'file',
      label: t('dicts.col.file'),
      type: 'enum',
      width: 200,
      text: (r) => yesNo(r.needFile, t),
      cell: (r) =>
        r.enabled && r.act !== 'pay' ? (
          sw(r, 'needFile', t('dicts.types.file_label', { name: r.shortName }))
        ) : (
          <Dash />
        ),
    },
    {
      key: 'receipt',
      label: t('dicts.col.receipt'),
      type: 'enum',
      width: 230,
      text: (r) => yesNo(r.needReceipt, t),
      cell: (r) =>
        r.enabled ? (
          sw(r, 'needReceipt', t('dicts.types.receipt_label', { name: r.shortName }))
        ) : (
          <Dash />
        ),
    },
    {
      key: 'used',
      label: t('dicts.col.used'),
      type: 'int',
      width: 110,
      text: (r) => String(r.assigned),
    },
    {
      key: 'regimes',
      label: t('dicts.col.regimes'),
      type: 'text',
      width: 160,
      text: (r) => r.regimes.join(', '),
    },
    {
      key: 'days',
      label: t('dicts.col.days'),
      type: 'text',
      width: 150,
      text: (r) =>
        r.enabled ? t('dicts.types.days_text', { days: (r.remindDays ?? []).join(', ') }) : '',
      cell: (r) =>
        r.enabled ? (
          <span className="flex flex-wrap items-center gap-1">
            {(r.remindDays ?? []).map((d) => (
              <Tag key={d}>{d}</Tag>
            ))}
            <span className="text-faint">{t('dicts.types.plus_deadline')}</span>
          </span>
        ) : (
          <Dash />
        ),
    },
  ];
}

/** «Создал», «Изменил», «Создано», «Изменено» — строки организации; у неподключавшегося вида — пусто. */
const TYPE_AUDIT: GridAudit<OrgReportTypeRow> = {
  createdBy: (r) => r.audit?.createdBy ?? '',
  updatedBy: (r) => r.audit?.updatedBy ?? r.audit?.createdBy ?? '',
  createdAt: (r) => moment(r.audit?.createdAt),
  updatedAt: (r) => moment(r.audit?.updatedAt),
};

const fetchTypes: FetchListPage<OrgReportTypeRow> = async (params) => {
  const res = await api.api['org-report-types'].$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return OrgReportTypeList.parse(await res.json());
};

const fetchTypeValues = async (col: string, q?: string) => {
  const res = await api.api['org-report-types'].values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/** Текст уведомления после переключателя в строке (прототип: «НДС подключён: напоминания за 7 и 3 дн.»). */
function flipToast(
  t: Translate,
  row: OrgReportTypeRow,
  flag: Flag,
  on: boolean,
  days: readonly number[],
) {
  const name = row.shortName;
  if (flag === 'enabled') {
    if (!on) return t('dicts.types.disconnected', { name });
    return days.length
      ? t('dicts.types.connected', { name, days: days.join(` ${t('dicts.types.and')} `) })
      : t('dicts.types.connected_deadline', { name });
  }
  if (flag === 'needFile') return t(on ? 'dicts.types.file_on' : 'dicts.types.file_off', { name });
  return t(on ? 'dicts.types.receipt_on' : 'dicts.types.receipt_off', { name });
}

/**
 * «Справочники» → «Виды отчётов» (ТЗ «Справочники» → «Виды отчётов»; прототип modules/dicts.js,
 * renderDicts): каталог видов отчётов платформы глазами организации. Пока ничего не подключено —
 * подсказка с «Подключить из каталога» (окно «Выбор налогов»), всегда — пояснение про единый каталог.
 * Подключить вид и включить «Файл при сдаче обязателен» и «Квитанция о приёме обязательна» можно прямо
 * в строке (сохраняется сразу, с историей); строка и пункт «Описание и настройки» открывают форму
 * просмотра вида. Неподключённые — приглушённо.
 */
export function ReportTypesList() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useDictsRefresh();
  const labels = useGridLabels('dicts.count');
  const { search, clearSearch, access } = useShell();
  const canEdit = access.can('dicts');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [view, setViewSlot] = useState<DialogSlot<{
    row: OrgReportTypeRow;
    type: ReportType;
    catalog: Catalog;
    taxes: Taxes;
  }> | null>(null);
  const pick = useTaxPick();
  const mine = useMyRequests();
  const request = useDictRequest(mine.open);
  useDictsAddRequest({ catalog: pick.open, request: request.open, mine: mine.open });
  const settings = useQuery(typeSettingsQuery);

  const flip = useCallback(
    async (row: OrgReportTypeRow, flag: Flag, on: boolean) => {
      setPending((prev) => new Set(prev).add(row.code));
      const json: OrgReportTypeSave = { [flag]: on, version: row.version };
      const res = await callApi(() =>
        api.api['org-report-types'][':code'].$put({ param: { code: row.code }, json }),
      );
      if (res.ok) {
        const saved = OrgReportTypeSetting.parse(res.data);
        toast(flipToast(t, row, flag, on, saved.remindDays), { icon: 'check' });
      } else {
        toast(errorText(res.error), { bad: true, icon: 'alert' });
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ['list', 'dicts.types'] }),
        client.invalidateQueries({ queryKey: typeSettingsQuery.queryKey }),
      ]);
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(row.code);
        return next;
      });
    },
    [client, errorText, t, toast],
  );

  const columns = useMemo(
    () =>
      typeColumns(t, {
        can: canEdit,
        busy: (code) => pending.has(code),
        flip: (row, flag, on) => void flip(row, flag, on),
      }),
    [t, canEdit, pending, flip],
  );
  const viewSettings = useViewSettings('dicts.types');
  const list = useListPage({
    gridKey: 'dicts.types',
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: viewSettings.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: viewSettings.ready,
    fetchPage: fetchTypes,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api['org-report-types'].export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);

  /** Форма просмотра открывается, когда каталог и «Налоги и ставки» загружены. */
  const openView = async (row: OrgReportTypeRow) => {
    try {
      const [catalog, taxes] = await Promise.all([
        client.fetchQuery(catalogQuery),
        client.fetchQuery(taxesQuery),
      ]);
      const type = catalog.type(row.code);
      if (type) setViewSlot(openSlot({ row, type, catalog, taxes }));
    } catch {
      toast(t('err.unknown'), { bad: true });
    }
  };

  const noneConnected = settings.data ? !settings.data.items.some((s) => s.enabled) : false;

  return (
    <div className="flex flex-col gap-3.5">
      {noneConnected ? (
        <Note icon="book">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="min-w-0 flex-1">
              <b>{t('dicts.types.empty_title')}</b> {t('dicts.types.empty_text')}
            </span>
            {canEdit ? (
              <button type="button" className={buttonClass('cta', 'sm')} onClick={pick.open}>
                <Icon name="plus" size="sm" />
                {t('add.dicts.catalog')}
              </button>
            ) : null}
          </span>
        </Note>
      ) : null}
      <Note icon="info">{t('dicts.types.note')}</Note>
      <DataGrid
        columns={columns}
        audit={TYPE_AUDIT}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={DEFAULT_SORT}
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
        loadValues={fetchTypeValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="file" title={t('grid.empty')} />}
        rowKey={(r) => r.code}
        titleKey="name"
        rowTone={(r) => (r.enabled ? undefined : 'muted')}
        label={t('tab.dicts.types')}
        labels={labels}
        actions={(r) => [
          { id: 'open', label: t('dicts.types.open'), icon: 'eye', run: () => void openView(r) },
        ]}
        onOpen={(r) => void openView(r)}
      />
      {view ? (
        <TypeView
          key={`type-${view.n}`}
          row={view.data.row}
          type={view.data.type}
          catalog={view.data.catalog}
          taxes={view.data.taxes}
          canEdit={canEdit}
          open={view.open}
          onClose={() => setViewSlot(closeSlot)}
          onSaved={refresh}
        />
      ) : null}
      {pick.dialog}
      {request.dialog}
      {mine.dialog}
    </div>
  );
}
