'use client';

import {
  ADMIN_TAX_COLUMNS,
  ADMIN_TAX_SORT,
  formatSom,
  type AdminTaxList,
  type GridKey,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  AdminTaxInfo,
  AdminTaxRowList,
  ListValues,
  Taxes,
  type AdminTaxRow,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  DataGrid,
  EmptyState,
  KeyValues,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api, apiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { catalogQuery } from '../dicts/dicts-data';
import { TaxGuide } from '../dicts/type-guide';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels, type CountKey } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { DictHistory } from './dict-history-box';
import { EnRateDialog } from './enrate-dialog';
import { ExportDialog, ImportDialog, IoBar } from './io-dialogs';

const ref = api.api.admin['tax-ref'];

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };
const json = async <T,>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

const fetchTaxes =
  (list: AdminTaxList): FetchListPage<AdminTaxRow> =>
  async (params) =>
    json(await ref[':list'].$get({ param: { list }, query: params }), (v) =>
      AdminTaxRowList.parse(v),
    );

const fetchTaxValues = (list: AdminTaxList) => async (col: string, q?: string) =>
  json(await ref[':list'].values.$get({ param: { list }, query: q ? { col, q } : { col } }), (v) =>
    ListValues.parse(v),
  );

const infoQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'tax-ref', 'info'],
  queryFn: async () => json(await ref.info.$get(), (v) => AdminTaxInfo.parse(v)),
  staleTime: Infinity,
});

/** Налоги с отключёнными: администратор видит справку целиком. */
const allTaxesQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'tax-ref', 'taxes'],
  queryFn: async () =>
    json(await api.api.taxes.$get({ query: { all: 'true' } }), (v) => Taxes.parse(v)),
  staleTime: Infinity,
});

/** Ширины столбцов, px — как в прототипе (`adm-taxes`, `adm-enrates`, `adm-proprates`). */
const WIDTHS: Readonly<Record<AdminTaxList, Readonly<Record<string, number>>>> = {
  taxes: {
    code: 90,
    name: 300,
    group: 220,
    level: 150,
    about: 360,
    payers: 300,
    rates: 300,
    period: 160,
    reportDue: 220,
    payDue: 220,
    form: 180,
    organ: 120,
    art: 130,
    types: 180,
    verify: 110,
  },
  en_rates: {
    code: 90,
    activity: 320,
    explain: 360,
    rate: 220,
    cond: 300,
    art: 160,
    gked: 240,
  },
  property_rates: {
    place: 220,
    region: 220,
    homeA: 150,
    homeB: 150,
    homeLand: 150,
    bizA: 150,
    bizB: 150,
    bizLand: 160,
  },
};

/** Главный столбец — жирным (прототип `<span class="strong">`). */
const STRONG: Readonly<Record<AdminTaxList, string>> = {
  taxes: 'name',
  en_rates: 'activity',
  property_rates: 'place',
};

const COUNT: Readonly<Record<AdminTaxList, CountKey>> = {
  taxes: 'pdicts.taxes_count',
  en_rates: 'pdicts.en_rates_count',
  property_rates: 'pdicts.property_rates_count',
};

const value = (x: AdminTaxRow, key: string) => x.values[key] ?? '';

function taxColumns(list: AdminTaxList, t: Translate): GridColumn<AdminTaxRow>[] {
  return ADMIN_TAX_COLUMNS[list].map((c) => {
    const column: GridColumn<AdminTaxRow> = {
      key: c.key,
      label: t(c.label as UiTextKey),
      type: c.type,
      width: WIDTHS[list][c.key],
      // Ставка на имущество — сомы за м² в тыйынах: «50,50», у целых — без «,00» (прототип n2).
      text: (x) =>
        c.type === 'money' ? formatSom(Number(value(x, c.key)), 'auto') : String(value(x, c.key)),
    };
    if (c.key === 'code') column.className = MONO_CLASS;
    if (STRONG[list] === c.key) {
      column.cell = (x) => <span className="font-semibold">{value(x, c.key)}</span>;
    }
    // «Виды деятельности (ГКЭД)» ставки (задача 2.38, прототип gkRuleHtml): пусто — «все виды».
    if (c.key === 'gked') {
      column.className = MONO_CLASS;
      column.cell = (x) =>
        value(x, 'gked') ? (
          <span>{value(x, 'gked')}</span>
        ) : (
          <span className="font-sans text-faint">{t('pdicts.gked.rule.any')}</span>
        );
    }
    // «Сверка»: «Сверить» — оранжевой меткой, иначе пусто (прототип vf).
    if (c.key === 'verify') {
      column.text = (x) => String(value(x, 'verify_text'));
      column.cell = (x) =>
        value(x, 'verify') === 'yes' ? (
          <Pill tone="warn" size="sm" icon="alert">
            {value(x, 'verify_text')}
          </Pill>
        ) : null;
    }
    return column;
  });
}

/** Таблица вкладки: поиск сверху экрана, фильтры, сортировка, группы и «В Excel» — общим механизмом. */
function TaxTable({
  list,
  onOpen,
  openLabel = 'pdicts.tax.action.open',
}: {
  list: AdminTaxList;
  onOpen?: (x: AdminTaxRow) => void;
  /** Пункт меню строки: «Открыть», у ставки единого налога — «Виды деятельности (ГКЭД)». */
  openLabel?: UiTextKey;
}) {
  const t = useT();
  const gridKey = `pdicts.${list}` as GridKey;
  const labels = useGridLabels(COUNT[list]);
  const columns = useMemo(() => taxColumns(list, t), [list, t]);
  const defaultVisible = useMemo(
    () => ADMIN_TAX_COLUMNS[list].filter((c) => !c.hidden).map((c) => c.key),
    [list],
  );
  const view = useViewSettings(gridKey);
  const { search, clearSearch } = useShell();
  const fetchPage = useMemo(() => fetchTaxes(list), [list]);
  const loadValues = useMemo(() => fetchTaxValues(list), [list]);
  const listPage = useListPage({
    gridKey,
    columns,
    defaultVisible,
    settings: view.settings,
    defaultSort: ADMIN_TAX_SORT[list],
    search,
    enabled: view.ready,
    fetchPage,
  });
  const { params, visible } = listPage;
  const sendExport = useCallback(
    () =>
      ref[':list'].export.$get({ param: { list }, query: { ...params, cols: visible.join(',') } }),
    [list, params, visible],
  );
  const exporter = useListExport(sendExport);
  const actions = onOpen
    ? (x: AdminTaxRow): ActionEntry[] => [
        {
          id: 'open',
          label: t(openLabel),
          icon: list === 'en_rates' ? 'edit' : 'eye',
          run: () => onOpen(x),
        },
      ]
    : undefined;

  return (
    <DataGrid
      columns={columns}
      defaultVisible={defaultVisible}
      defaultSort={ADMIN_TAX_SORT[list]}
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
      loadValues={loadValues}
      search={search}
      onClearSearch={clearSearch}
      onExport={() => void exporter.run()}
      exporting={exporter.exporting}
      empty={<EmptyState icon="coins" title={t('grid.empty')} />}
      rowKey={(x) => x.id}
      titleKey={STRONG[list]}
      label={t(`pdicts.tax.box.${list}`)}
      labels={labels}
      {...(actions ? { actions } : {})}
      {...(onOpen ? { onOpen } : {})}
      // Ставки — и на телефоне таблицей (прототип `fixedView: 'table'`).
      {...(list === 'taxes' ? {} : { fixedView: 'table' as const })}
    />
  );
}

/** Таблицы вкладки с «Выгрузить» и «Загрузить». */
type TaxIoDict = 'taxes' | 'enrates' | 'proprates';
type TaxIo = { dict: TaxIoDict; action: 'export' | 'import' };

interface TaxView {
  title: string;
  sub: string;
  body: ReactNode;
}

/**
 * Админка → «Справочники платформы» → «Налоги и ставки» (ТЗ «Налоги и ставки»; прототип renderPDicts0,
 * вкладка `taxes`): справка по НК КР только для просмотра. Налоги и обязательные платежи — строка и
 * «Открыть» показывают форму просмотра налога, как в модуле «Справочники» (taxViewDlg); ставки единого
 * налога с пояснениями, кто не может его применять; ставки налога на имущество; размер бизнеса.
 */
export function TaxesTab() {
  const t = useT();
  const client = useQueryClient();
  const info = useQuery(infoQuery);
  const [view, setView] = useState<DialogSlot<TaxView> | null>(null);
  const [enRate, setEnRate] = useState<DialogSlot<string> | null>(null);
  const [io, setIo] = useState<DialogSlot<TaxIo> | null>(null);
  // «Выгрузить» и «Загрузить» над таблицей (задача 2.37, часть 3, прототип ioBar).
  const ioBar = (dict: TaxIoDict) => (
    <IoBar
      onExport={() => setIo(openSlot<TaxIo>({ dict, action: 'export' }))}
      onImport={() => setIo(openSlot<TaxIo>({ dict, action: 'import' }))}
    />
  );

  const openTax = async (x: AdminTaxRow) => {
    const [taxes, catalog] = await Promise.all([
      client.fetchQuery(allTaxesQuery),
      client.fetchQuery(catalogQuery),
    ]);
    const tax = taxes.items.find((y) => y.code === x.id);
    if (!tax) return;
    setView(
      openSlot<TaxView>({
        title: tax.name,
        sub: t('dicts.value.tax_sub', { code: tax.code, group: tax.group }),
        body: <TaxGuide tax={tax} catalog={catalog} gkedNames={taxes.gkedNames} />,
      }),
    );
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('pdicts.note.taxes')}</Note>
      <Box title={t('pdicts.tax.box.taxes')}>
        {ioBar('taxes')}
        <TaxTable list="taxes" onOpen={(x) => void openTax(x)} />
      </Box>
      <Box title={t('pdicts.tax.box.en_rates')}>
        {(info.data?.enRates ?? []).map((n, i) => (
          <p key={i} className="m-0 text-muted">
            {n}
          </p>
        ))}
        {ioBar('enrates')}
        <TaxTable
          list="en_rates"
          onOpen={(x) => setEnRate(openSlot(x.id))}
          openLabel="pdicts.enrate.gked"
        />
      </Box>
      <Box title={t('pdicts.tax.box.property_rates')}>
        {info.data?.propertyRates ? (
          <p className="m-0 text-muted">{info.data.propertyRates}</p>
        ) : null}
        {ioBar('proprates')}
        <TaxTable list="property_rates" />
      </Box>
      <Box title={t('pdicts.tax.box.biz')}>
        <KeyValues
          items={(info.data?.bizSize ?? []).map((b) => ({
            id: b.code,
            label: b.name,
            value: t('pdicts.tax.biz_line', { rule: b.rule, note: b.note }),
          }))}
        />
      </Box>
      <DictHistory dict="taxes" />
      {enRate ? (
        <EnRateDialog
          key={`enrate-${enRate.n}`}
          open={enRate.open}
          onClose={() => setEnRate(closeSlot)}
          code={enRate.data}
        />
      ) : null}
      {io?.data.action === 'export' ? (
        <ExportDialog
          key={`io-${io.n}`}
          dict={io.data.dict}
          open={io.open}
          onClose={() => setIo(closeSlot)}
        />
      ) : io ? (
        <ImportDialog
          key={`io-${io.n}`}
          dict={io.data.dict}
          open={io.open}
          onClose={() => setIo(closeSlot)}
        />
      ) : null}
      {view ? (
        <Modal
          key={`tax-${view.n}`}
          open={view.open}
          onClose={() => setView(closeSlot)}
          kind="card"
          size="mid"
          title={view.data.title}
          sub={view.data.sub}
          footer={
            <>
              <div className="flex-1" />
              <button
                type="button"
                className={buttonClass('cta')}
                onClick={() => setView(closeSlot)}
              >
                {t('btn.close')}
              </button>
            </>
          }
        >
          <div data-value-view="">{view.data.body}</div>
        </Modal>
      ) : null}
    </div>
  );
}
