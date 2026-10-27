'use client';

import {
  formatDateRu,
  ORG_DICT_COLUMNS,
  ORG_DICT_NATURAL_ORDER,
  type ListSort,
  type OrgDictWindowId,
  type UiTextKey,
} from '@buhuchet/domain';
import { ListValues, PlatformDictList, type PlatformDictRow } from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Icon,
  inputClass,
  Modal,
  MONO_CLASS,
  StatusPill,
  useToast,
  type GridColumn,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { api, apiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { statusPillView } from '../status/status-view';
import { catalogQuery, taxesQuery, valueDictsQuery } from './dicts-data';
import { TaxGuide, VerifyPill } from './type-guide';
import {
  BaseGuide,
  BenefitGuide,
  FormGuide,
  OrganGuide,
  RegimeGuide,
  SingleTaxRateGuide,
} from './value-guide';

/** Плитка, из которой открыто окно: справочник, название, что это и где используется. */
export interface DictTile {
  id: OrgDictWindowId;
  tab: string;
  about: string;
  usedIn: string;
  group: string;
}

/** Ширины столбцов по умолчанию, px — как в прототипе (`orgDictDefs`, `w`). */
const WIDTHS: Record<string, number> = {
  'taxes.code': 90,
  'taxes.name': 300,
  'taxes.about': 380,
  'taxes.period': 120,
  'en_rates.code': 90,
  'en_rates.rate': 120,
  'en_rates.activity': 300,
  'en_rates.explain': 380,
  'bases.name': 260,
  'bases.desc': 420,
  'regimes.name': 200,
  'regimes.full': 260,
  'regimes.acc': 380,
  'benefits.name': 280,
  'benefits.gives': 420,
  'gked.code': 100,
  'gked.name': 520,
  'forms.name': 200,
  'forms.full': 260,
  'forms.end': 120,
  'forms.note': 360,
  'phones.name': 220,
  'phones.code': 90,
  'phones.mask': 160,
  'organs.name': 200,
  'organs.note': 460,
  'organs.contacts': 220,
  'ugns.code': 90,
  'ugns.name': 380,
  'ugns.city': 200,
  'banks.name': 280,
  'banks.code': 100,
  'calendar.d': 120,
  'calendar.name': 320,
  'calendar.kind': 170,
  'statuses.name': 220,
  'statuses.note': 460,
  'cats.kind': 220,
  'cats.code': 100,
  'cats.name': 320,
  'templates.name': 320,
  'templates.text': 460,
};

/** Главный столбец справочника — жирным (прототип `<span class="strong">`). */
const STRONG: Partial<Record<OrgDictWindowId, string>> = {
  taxes: 'name',
  en_rates: 'activity',
  bases: 'name',
  regimes: 'name',
  benefits: 'name',
  forms: 'name',
  organs: 'name',
  banks: 'name',
  cats: 'name',
  templates: 'name',
};

/** Коды — моноширинным (прототип `cls: 'mono'`). */
const MONO = new Set([
  'taxes.code',
  'en_rates.code',
  'gked.code',
  'ugns.code',
  'banks.code',
  'cats.code',
]);

const value = (r: PlatformDictRow, key: string) => r.values[key] ?? '';

/** Столбцы окна справочника: ключи и типы — общие с сервером (`ORG_DICT_COLUMNS`). */
function dictColumns(id: OrgDictWindowId, t: Translate): GridColumn<PlatformDictRow>[] {
  return ORG_DICT_COLUMNS[id].map((c) => {
    const path = `${id}.${c.key}`;
    const column: GridColumn<PlatformDictRow> = {
      key: c.key,
      // Подписи всех столбцов есть в словаре — тест «Окна справочников платформы» (domain).
      label: t(`dicts.platform.col.${path}` as UiTextKey),
      type: c.type,
      width: WIDTHS[path],
      text: (r) =>
        c.type === 'date' && value(r, c.key) ? formatDateRu(value(r, c.key)) : value(r, c.key),
    };
    if (MONO.has(path)) column.className = MONO_CLASS;
    if (id === 'statuses' && c.key === 'name') {
      column.cell = (r) => <StatusPill {...statusPillView(t, 'report', r.id)} />;
    } else if (STRONG[id] === c.key) {
      column.cell = (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold">{value(r, c.key)}</span>
          {id === 'taxes' && value(r, 'verify') ? <VerifyPill /> : null}
        </span>
      );
    }
    return column;
  });
}

/** Сортировка по умолчанию — по первому столбцу; статусы и шаблоны — в своём порядке. */
const defaultSortOf = (id: OrgDictWindowId): ListSort | null =>
  ORG_DICT_NATURAL_ORDER.has(id) ? null : { key: ORG_DICT_COLUMNS[id][0]!.key, dir: 'asc' };

/** У каких справочников строка открывает описание значения (прототип: `open: null` — нет). */
const OPENS: ReadonlySet<OrgDictWindowId> = new Set([
  'taxes',
  'en_rates',
  'bases',
  'regimes',
  'benefits',
  'forms',
  'organs',
]);

/** Описание значения: название, строка под ним и содержимое. */
interface ValueView {
  title: string;
  sub: string;
  body: ReactNode;
}

/** Описание значения по коду: справочники — из кеша (каталог, «Налоги и ставки», формы, ставки ЕН, УГНС). */
function useValueView(tile: DictTile) {
  const t = useT();
  const client = useQueryClient();
  const sub = t('dicts.value.sub', { tab: tile.tab });
  return useCallback(
    async (code: string): Promise<ValueView | null> => {
      const catalog = await client.fetchQuery(catalogQuery);
      switch (tile.id) {
        case 'taxes': {
          const taxes = await client.fetchQuery(taxesQuery);
          const tax = taxes.items.find((x) => x.code === code);
          return tax
            ? {
                title: tax.name,
                sub: t('dicts.value.tax_sub', { code: tax.code, group: tax.group }),
                body: <TaxGuide tax={tax} catalog={catalog} gkedNames={taxes.gkedNames} />,
              }
            : null;
        }
        case 'regimes': {
          const x = catalog.regimes.find((r) => r.code === code);
          return x ? { title: x.name, sub, body: <RegimeGuide x={x} /> } : null;
        }
        case 'organs': {
          const x = catalog.authorities.find((r) => r.code === code);
          return x ? { title: x.name, sub, body: <OrganGuide x={x} catalog={catalog} /> } : null;
        }
        case 'bases': {
          const x = catalog.bases.find((r) => r.code === code);
          return x ? { title: x.name, sub, body: <BaseGuide x={x} catalog={catalog} /> } : null;
        }
        case 'benefits': {
          const { offices } = await client.fetchQuery(valueDictsQuery);
          const x = catalog.benefits.find((r) => r.code === code);
          return x
            ? {
                title: x.name,
                sub,
                body: <BenefitGuide x={x} catalog={catalog} offices={offices} />,
              }
            : null;
        }
        case 'forms': {
          const { forms } = await client.fetchQuery(valueDictsQuery);
          const x = forms.find((r) => r.code === code);
          return x ? { title: x.name, sub, body: <FormGuide x={x} /> } : null;
        }
        case 'en_rates': {
          const { rates } = await client.fetchQuery(valueDictsQuery);
          const x = rates.find((r) => r.code === code);
          return x
            ? {
                title: t('dicts.value.en_title', { code: x.code, rate: x.rate }),
                sub: x.activity,
                body: <SingleTaxRateGuide x={x} rates={rates} />,
              }
            : null;
        }
        default:
          return null;
      }
    },
    [client, sub, t, tile.id],
  );
}

/**
 * Окно справочника платформы (прототип dict-guide.js `orgDictDlg`): что это и где используется, поиск
 * по значениям, список (только таблица, без служебных столбцов), «В Excel» — с правом «Выгружать в
 * Excel». Строка налога, ставки ЕН, основания, режима, льготы, формы и органа открывает описание
 * значения поверх окна. Поиск — свой: общий поиск верхней панели под окном недоступен.
 */
export function PlatformDictWindow({
  tile,
  open,
  onClose,
}: {
  tile: DictTile;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const searchId = useId();
  const { access } = useShell();
  const labels = useGridLabels('dicts.platform.count');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<DialogSlot<ValueView> | null>(null);
  const valueView = useValueView(tile);
  const { id } = tile;
  const gridKey = `dicts.platform.${id}` as const;
  const columns = useMemo(() => dictColumns(id, t), [id, t]);
  const defaultVisible = useMemo(() => columns.map((c) => c.key), [columns]);
  const defaultSort = defaultSortOf(id);
  const viewSettings = useViewSettings(gridKey);

  const fetchPage = useCallback<FetchListPage<PlatformDictRow>>(
    async (params) => {
      const res = await api.api['platform-dicts'][':id'].$get({ param: { id }, query: params });
      if (!res.ok) throw await apiFailure(res);
      return PlatformDictList.parse(await res.json());
    },
    [id],
  );
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api['platform-dicts'][':id'].values.$get({
        param: { id },
        query: q ? { col, q } : { col },
      });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [id],
  );
  const list = useListPage({
    gridKey,
    columns,
    audit: false,
    defaultVisible,
    settings: viewSettings.settings,
    defaultSort,
    search,
    enabled: viewSettings.ready,
    fetchPage,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api['platform-dicts'][':id'].export.$get({
        param: { id },
        query: { ...params, cols: visible.join(',') },
      }),
    [id, params, visible],
  );
  const exporter = useListExport(sendExport);

  const openRow = async (row: PlatformDictRow) => {
    try {
      const next = await valueView(row.id);
      if (next) setView(openSlot(next));
    } catch {
      toast(t('err.unknown'), { bad: true });
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="card"
        size="wide"
        title={tile.tab}
        sub={t('dicts.platform.sub', { group: tile.group })}
        footer={
          <>
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.close')}
            </button>
          </>
        }
      >
        <div data-platform-dict={id} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-pane-alt px-3.5 py-3">
            {tile.about ? <p className="m-0 leading-[1.45]">{tile.about}</p> : null}
            {tile.usedIn ? (
              <div className="flex items-start gap-1.5 text-[11.5px] leading-[1.4] text-faint">
                <Icon name="info" size="sm" className="mt-px" />
                <span>{t('dicts.platform.used_in', { text: tile.usedIn })}</span>
              </div>
            ) : null}
          </div>
          <label htmlFor={searchId} className="relative flex items-center">
            <Icon
              name="search"
              size="sm"
              className="pointer-events-none absolute left-2.5 text-faint"
            />
            <input
              id={searchId}
              type="search"
              className={`${inputClass()} pl-8`}
              value={search}
              placeholder={t('dicts.platform.search')}
              aria-label={t('dicts.platform.search')}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <DataGrid
            columns={columns}
            defaultVisible={defaultVisible}
            defaultSort={defaultSort}
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
            loadValues={loadValues}
            search={search}
            onClearSearch={() => setSearch('')}
            onExport={access.can('export') ? () => void exporter.run() : undefined}
            exporting={exporter.exporting}
            empty={<EmptyState icon="book" title={t('grid.empty')} />}
            rowKey={(r) => r.id}
            titleKey={STRONG[id] ?? 'name'}
            fixedView="table"
            label={tile.tab}
            labels={labels}
            onOpen={OPENS.has(id) ? (r) => void openRow(r) : undefined}
          />
        </div>
      </Modal>
      {view ? (
        <Modal
          key={`value-${view.n}`}
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
    </>
  );
}
