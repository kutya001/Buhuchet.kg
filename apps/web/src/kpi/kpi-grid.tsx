'use client';

import { formatCount, indicatorTotals, KPI_GRID_MAX_MONTHS, searchText } from '@buhuchet/domain';
import type { KpiColumn, KpiGrid } from '@buhuchet/shared';
import {
  buttonClass,
  CHECKBOX_CLASS,
  EmptyState,
  Icon,
  inputClass,
  Note,
  NothingFound,
  Popover,
  useToast,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, callApi } from '../api-client';
import { ContractorLink } from '../contractors/contractor-link';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { exportFailureText, exportFileName, saveFile } from '../lists/export';
import { useShell } from '../shell/context';
import { gridQuery, useKpiRefresh } from './kpi-data';
import { exCellOf, exKey, type KxRef, KxTd, putCells } from './kpi-ex';
import { monthHeadName, monthName, totalText } from './kpi-format';
import { defaultGridPeriod, PeriodBar } from './kpi-period-bar';
import { setKpiChoice, useKpiChoice, type KpiGridChoice } from './kpi-state';
import { HEAD_CLASS, NUM, TABLE_CLASS, WRAP_CLASS, type CellChange } from './kpi-table';
import { EX_WRAP, useExTable } from './use-ex-table';

/*
 * Вкладка «Ввод по месяцам» (прототип v80 modules/kpi.js: kpiGrid, kGridRows, kGridCps; css/extable.css
 * `.kg-t`, `.kg-f`): таблица в виде выгрузки Excel — строка «контрагент × показатель» (ИНН, контрагент,
 * показатель), столбцы — месяцы периода, до 24; в конце строки — итог по основному итогу показателя.
 * Ввод — как в Excel (`ex-table.ts`). Над таблицей — период, выбор контрагентов, ответственного и
 * показателей, «Выгрузить в Excel» (тот же вид, что у шаблона «Ввода из Excel») и «Загрузить из Excel»
 * (шаг 2 окна «Ввод из Excel»). На телефоне ИНН и «Контрагент» скрыты: название контрагента — над
 * показателем в первой строке контрагента.
 * ОТКЛОНЕНИЕ: docs/deviations.md#О-61
 */

/**
 * Строк таблицы на экране — не больше: дальше браузер рисует таблицу заметно долго (в прототипе предела
 * нет). Остальные — после сужения выбора.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-61
export const GRID_ROWS_SHOWN = 2000;

type Row = KpiGrid['rows'][number];
type Contractor = KpiGrid['contractors'][number];

/** Столбцы ИНН, «Контрагент» и «Показатель» закреплены слева (`.kg-t .kt-inn`, `.kt-cp2`, `.kt-ind`). */
const KEY_CELL = 'sticky z-[1] overflow-hidden text-ellipsis';
const INN_COL = `${KEY_CELL} left-0 w-[122px] min-w-[122px] max-w-[122px] max-md:hidden`;
const CP_COL = `${KEY_CELL} left-[122px] w-[220px] min-w-[220px] max-w-[220px] max-md:hidden`;
const IND_COL = `${KEY_CELL} left-[342px] w-[190px] min-w-[190px] max-w-[190px] shadow-[inset_-1px_0_0_var(--bu-border-strong)] max-md:left-0 max-md:w-[140px] max-md:min-w-[140px] max-md:max-w-[140px] max-md:whitespace-normal! max-md:text-[12.5px] max-md:leading-[1.3]`;
/** Ячейки-ключи строки — на сером фоне (`.kg-t td.kt-inn`). */
const KEY_TD = 'bg-pane-alt!';
/** Итог строки (`.kg-tot`). */
const TOT_COL = 'bg-pane-alt! border-l! border-line-strong!';

/** Что видно: контрагенты по выбору, ответственному и поиску; показатели по выбору. */
function visible(data: KpiGrid, choice: KpiGridChoice, search: string) {
  const known = new Set(data.contractors.map((c) => c.id));
  const cps = new Set(choice.cps.filter((id) => known.has(id)));
  const q = searchText(search.trim());
  const shown = new Set(
    data.contractors
      .filter(
        (c) =>
          (!cps.size || cps.has(c.id)) &&
          (!choice.resp || c.responsibleId === choice.resp) &&
          (!q || searchText(c.name).includes(q) || c.inn.includes(q)),
      )
      .map((c) => c.id),
  );
  const inds = data.indicators.filter((i) => !choice.inds || choice.inds.includes(i.id));
  const on = new Set(inds.map((i) => i.id));
  return {
    cps: [...cps],
    inds,
    rows: data.rows.filter((r) => shown.has(r.contractorId) && on.has(r.indicatorId)),
  };
}

export function KpiGridTab({ onUpload }: { onUpload: () => void }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useKpiRefresh();
  const { search, clearSearch, access } = useShell();
  const choice = useKpiChoice().grid;
  const period = choice.period ?? defaultGridPeriod();
  const query = useQuery({ ...gridQuery(period), placeholderData: keepPreviousData });
  const data = query.data;
  const [busy, setBusy] = useState(false);
  const view = useMemo(() => (data ? visible(data, choice, search) : null), [data, choice, search]);

  if (query.isError && !data) return <Note tone="bad">{t('kpi.load_error')}</Note>;
  if (!data || !view) return null;

  const set = (patch: Partial<KpiGridChoice>) => setKpiChoice({ grid: { ...choice, ...patch } });
  const months = data.months;

  /** Сохранить ячейки: сразу в таблице, потом на сервере; ошибка — уведомление и данные с сервера. */
  const save = async (changes: readonly CellChange[]) => {
    if (changes.length === 0) return true;
    client.setQueryData<KpiGrid>(gridQuery(period).queryKey, (old) => old && patched(old, changes));
    const res = await callApi(() => api.api.kpi.values.$put({ json: { values: [...changes] } }));
    void refresh();
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return false;
    }
    return true;
  };

  /** «Выгрузить в Excel» (прототип `kg-dl`): то, что на экране, в виде шаблона. */
  const download = async () => {
    setBusy(true);
    try {
      const res = await api.api.kpi.grid.export.$post({
        json: {
          from: period.from,
          to: period.to,
          cps: view.cps,
          inds: choice.inds ? view.inds.map((i) => i.id) : null,
          ...(choice.resp ? { resp: choice.resp } : {}),
          ...(search.trim() ? { q: search.trim() } : {}),
        },
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        toast(exportFailureText(body, t, errorText, t('grid.export_failed')), {
          icon: 'alert',
          bad: true,
        });
        return;
      }
      const name = exportFileName(res.headers.get('content-disposition'));
      saveFile(await res.blob(), name);
      toast(t('kpi.grid.downloaded', { name }), { icon: 'download' });
    } catch {
      toast(t('grid.export_failed'), { icon: 'alert', bad: true });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string, on: boolean) => {
    const ids = data.indicators
      .map((i) => i.id)
      .filter((i) => (i === id ? on : !choice.inds || choice.inds.includes(i)));
    set({ inds: ids.length === data.indicators.length ? null : ids });
  };

  const filters = (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2" data-kpi-grid-filters="">
      <ContractorPick
        t={t}
        all={data.contractors}
        chosen={view.cps}
        onPick={(cps) => set({ cps })}
      />
      <select
        className={`${inputClass({ full: false })} min-h-8 w-auto px-2 py-[3px]`}
        aria-label={t('kpi.col.responsible')}
        value={choice.resp}
        onChange={(e) => set({ resp: e.target.value })}
        data-kpi-grid-resp=""
      >
        <option value="">{t('kpi.grid.resp_all')}</option>
        {data.responsibles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1.5" data-kpi-grid-inds="">
        {data.indicators.map((i) => {
          const on = !choice.inds || choice.inds.includes(i.id);
          return (
            <label
              key={i.id}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-raised px-[11px] py-1 text-[12.5px] ${on ? 'border-accent text-ink' : 'border-line text-muted'}`}
            >
              <input
                type="checkbox"
                className="m-0 accent-accent"
                checked={on}
                onChange={(e) => toggle(i.id, e.target.checked)}
              />
              {i.name}
            </label>
          );
        })}
      </div>
      <div className="ml-auto flex flex-wrap gap-2.5">
        {access.can('export') ? (
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            disabled={!view.rows.length || busy}
            onClick={() => void download()}
            data-kpi-grid-download=""
          >
            <Icon name="download" size="sm" />
            {t('kpi.grid.download')}
          </button>
        ) : null}
        {access.can('kpiImport') ? (
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            onClick={onUpload}
            data-kpi-grid-upload=""
          >
            <Icon name="upload" size="sm" />
            {t('kpi.grid.upload')}
          </button>
        ) : null}
      </div>
    </div>
  );

  let body;
  if (data.indicators.length === 0) {
    body = (
      <EmptyState icon="gauge" title={t('kpi.no_indicators')} text={t('kpi.no_indicators_text')} />
    );
  } else if (view.rows.length === 0) {
    body = search.trim() ? (
      <NothingFound
        title={t('grid.not_found')}
        resetLabel={t('grid.reset_filters')}
        onReset={clearSearch}
      />
    ) : (
      <EmptyState icon="search" title={t('grid.not_found')} text={t('kpi.grid.none')} />
    );
  } else {
    body = (
      <GridTable
        t={t}
        data={data}
        rows={view.rows.slice(0, GRID_ROWS_SHOWN)}
        total={view.rows.length}
        onSave={save}
      />
    );
  }

  return (
    <div
      className="flex flex-col gap-3.5"
      data-kpi-grid={`${months[0]}|${months[months.length - 1]}`}
    >
      <PeriodBar value={{ from: data.from, to: data.to }} onChange={(p) => set({ period: p })} />
      {filters}
      {data.cut ? <Note tone="warn">{t('kpi.grid.cut', { n: KPI_GRID_MAX_MONTHS })}</Note> : null}
      {body}
    </div>
  );
}

/** Ячейки после правки — сразу в таблице, пока сервер не ответил. */
function patched(data: KpiGrid, changes: readonly CellChange[]): KpiGrid {
  const by = new Map(changes.map((c) => [`${c.contractorId}|${c.indicatorId}|${c.month}`, c]));
  return {
    ...data,
    rows: data.rows.map((r) => {
      const values = data.months.map((m, j) => {
        const c = by.get(`${r.contractorId}|${r.indicatorId}|${m}`);
        return c ? c.value : r.values[j]!;
      });
      return values.some((v, j) => v !== r.values[j]) ? { ...r, values } : r;
    }),
  };
}

/**
 * Выбор контрагентов (прототип `kGridCps`): поиск по названию или ИНН, «Выбрать все» и «Снять все» (по
 * найденным), «Показать»; выбраны все — «Все контрагенты».
 */
function ContractorPick({
  t,
  all,
  chosen,
  onPick,
}: {
  t: Translate;
  all: readonly Contractor[];
  chosen: readonly string[];
  onPick: (cps: string[]) => void;
}) {
  const toast = useToast();
  const label = chosen.length
    ? t('kpi.grid.cps_some', { n: formatCount(chosen.length), of: formatCount(all.length) })
    : t('kpi.grid.cps_all', { n: formatCount(all.length) });
  return (
    <Popover
      label={t('kpi.grid.cps_title')}
      padded
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          className={`${buttonClass('default', 'sm')} gap-1.5`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          data-kpi-grid-cps=""
        >
          <Icon name="users" size="sm" />
          {label}
          <Icon name="down" size="sm" />
        </button>
      )}
    >
      {(close) => (
        <PickList
          t={t}
          all={all}
          initial={chosen.length ? chosen : all.map((c) => c.id)}
          onShow={(on) => {
            if (!on.size) return toast(t('kpi.grid.cps_none'), { icon: 'alert', bad: true });
            onPick(on.size === all.length ? [] : all.filter((c) => on.has(c.id)).map((c) => c.id));
            close();
          }}
        />
      )}
    </Popover>
  );
}

function PickList({
  t,
  all,
  initial,
  onShow,
}: {
  t: Translate;
  all: readonly Contractor[];
  initial: readonly string[];
  onShow: (on: ReadonlySet<string>) => void;
}) {
  const [on, setOn] = useState<ReadonlySet<string>>(() => new Set(initial));
  const [q, setQ] = useState('');
  const key = searchText(q.trim());
  const found = all.filter((c) => !key || `${searchText(c.name)} ${c.inn}`.includes(key));
  const mark = (ids: readonly string[], value: boolean) =>
    setOn((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  return (
    <div className="flex w-[min(344px,calc(100vw-32px))] flex-col gap-1.5" data-kpi-grid-pick="">
      <input
        type="search"
        className={inputClass()}
        placeholder={t('kpi.import.q_placeholder')}
        aria-label={t('kpi.grid.cps_search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() =>
            mark(
              found.map((c) => c.id),
              true,
            )
          }
        >
          {t('kpi.grid.cps_check_all')}
        </button>
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() =>
            mark(
              found.map((c) => c.id),
              false,
            )
          }
        >
          {t('kpi.grid.cps_uncheck_all')}
        </button>
        <span className="flex-1" />
        <span className="text-[12px] text-muted">
          {t('kpi.grid.cps_count', { n: formatCount(on.size), of: formatCount(all.length) })}
        </span>
      </div>
      <div className="flex max-h-[300px] flex-col overflow-y-auto">
        {found.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-hover"
          >
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={on.has(c.id)}
              onChange={(e) => mark([c.id], e.target.checked)}
            />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <small className="text-faint tabular-nums">{c.inn}</small>
          </label>
        ))}
      </div>
      <div className="flex justify-end pt-1">
        <button type="button" className={buttonClass('cta', 'sm')} onClick={() => onShow(on)}>
          {t('kpi.grid.cps_show')}
        </button>
      </div>
    </div>
  );
}

/** Итог строки по основному итогу показателя (прототип `tot`): «1 250 000 сумма», «среднее по 3». */
function RowTotal({ t, col, row }: { t: Translate; col: KpiColumn; row: Row }) {
  const totals = indicatorTotals(row.values);
  if (!('sum' in totals)) return <span className="text-faint">—</span>;
  return (
    <>
      {totalText(col.type, totals, col.total)}
      <small className="ml-1 text-[10.5px] font-[450] text-faint">
        {t(`kpi.total.${col.total}`).toLowerCase()}
        {col.total === 'avg' ? ` ${t('kpi.grid.avg_by', { n: totals.count })}` : ''}
      </small>
    </>
  );
}

function GridTable({
  t,
  data,
  rows,
  total,
  onSave,
}: {
  t: Translate;
  data: KpiGrid;
  rows: readonly Row[];
  total: number;
  onSave: (changes: CellChange[]) => Promise<boolean>;
}) {
  const months = data.months;
  const cps = new Map(data.contractors.map((c) => [c.id, c]));
  const cols = new Map(data.indicators.map((i) => [i.id, i]));
  const at = (r: number, c: number): KxRef | null => {
    const row = rows[r];
    const month = months[c];
    if (!row || !month) return null;
    const col = cols.get(row.indicatorId)!;
    return {
      contractorId: row.contractorId,
      indicatorId: row.indicatorId,
      type: col.type,
      required: col.required,
      archived: col.archived,
      month,
      state: row.states[c]!,
      start: row.start,
      offSince: row.offSince,
      value: row.values[c] ?? null,
      editable: cps.get(row.contractorId)!.editable,
    };
  };
  const {
    wrapRef: exRef,
    layer: exLayer,
    stat: exStat,
    menu: exMenu,
  } = useExTable({
    rows: rows.length,
    cols: months.length,
    get: (r, c) => exCellOf(t, at(r, c), data.current),
    key: (r, c) => exKey(at(r, c)),
    put: (list) => putCells(list, at, onSave),
    label: (r, c) =>
      t('kpi.ex.cell_label', {
        name: cps.get(rows[r]!.contractorId)!.name,
        ind: cols.get(rows[r]!.indicatorId)!.name,
        month: monthName(t, months[c]!),
      }),
  });

  return (
    <>
      {total > rows.length ? (
        <Note tone="warn">
          {t('kpi.grid.rows_cap', { shown: formatCount(rows.length), n: formatCount(total) })}
        </Note>
      ) : null}
      {exStat}
      <div ref={exRef} className={`${WRAP_CLASS} ${EX_WRAP}`} data-no-swipe="">
        {exLayer}
        <table className={TABLE_CLASS} data-kpi-grid-table="">
          <thead>
            <tr>
              <th className={`${HEAD_CLASS} ${INN_COL} z-[3]`}>{t('kpi.import.inn')}</th>
              <th className={`${HEAD_CLASS} ${CP_COL} z-[3]`}>{t('kpi.col.contractor')}</th>
              <th className={`${HEAD_CLASS} ${IND_COL} z-[3]`}>{t('kpi.col.indicator')}</th>
              {months.map((m, c) => (
                <th
                  key={m}
                  className={`${HEAD_CLASS} ${NUM}`}
                  data-exc={c}
                  title={t('kpi.ex.select_col')}
                >
                  {monthHeadName(t, m)}
                </th>
              ))}
              <th className={`${HEAD_CLASS} ${NUM} ${TOT_COL}`}>{t('kpi.grid.total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const cp = cps.get(row.contractorId)!;
              const col = cols.get(row.indicatorId)!;
              const first = r === 0 || rows[r - 1]!.contractorId !== row.contractorId;
              const line = first ? '[&_td]:border-t [&_td]:border-t-line-strong' : '';
              const rep = first ? '' : 'text-faint';
              return (
                <tr
                  key={`${row.contractorId}|${row.indicatorId}`}
                  className={line}
                  data-kpi-grid-row={`${row.contractorId}|${row.indicatorId}`}
                >
                  <td className={`${INN_COL} ${KEY_TD} font-mono text-[.92em] ${rep}`} data-exr={r}>
                    {cp.inn}
                  </td>
                  <td className={`${CP_COL} ${KEY_TD} ${rep}`} data-exr={r} title={cp.name}>
                    <ContractorLink
                      id={cp.id}
                      name={cp.name}
                      tab="kpi"
                      className={first ? '' : 'font-[450] text-faint!'}
                    />
                  </td>
                  <td
                    className={`${IND_COL} ${KEY_TD}`}
                    data-exr={r}
                    title={col.description ? `${col.name}: ${col.description}` : col.name}
                  >
                    {first ? (
                      <span className="mb-0.5 hidden max-w-full truncate text-[11.5px] max-md:block">
                        <ContractorLink id={cp.id} name={cp.name} tab="kpi" />
                      </span>
                    ) : null}
                    {col.name}
                    {col.unit ? <small className="ml-1 text-faint">{col.unit}</small> : null}
                  </td>
                  {months.map((m, c) => (
                    <KxTd key={m} r={r} c={c} x={at(r, c)!} current={data.current} />
                  ))}
                  <td className={`${NUM} ${TOT_COL} tabular-nums`} data-kpi-grid-total="">
                    <RowTotal t={t} col={col} row={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {exMenu}
    </>
  );
}
