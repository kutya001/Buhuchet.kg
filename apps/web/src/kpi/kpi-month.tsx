'use client';

import { addMonths, columnTotals, monthText, pluralForm, searchText } from '@buhuchet/domain';
import { KpiValuesSaved, type KpiColumn, type KpiMonth } from '@buhuchet/shared';
import {
  ActionMenu,
  buttonClass,
  EmptyState,
  Hint,
  Icon,
  iconButtonClass,
  Note,
  NothingFound,
  PHONE_QUERY,
  Popover,
  useMediaQuery,
  useToast,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, callApi } from '../api-client';
import { ContractorLink } from '../contractors/contractor-link';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { monthQuery, useKpiRefresh } from './kpi-data';
import { useKpiEntry } from './kpi-entry';
import { exCellOf, exKey, type KxRef, KxTd, putCells } from './kpi-ex';
import { columnSub, monthName, totalText } from './kpi-format';
import { KpiPlates } from './kpi-plates';
import { setKpiChoice, useKpiChoice } from './kpi-state';
import { MonthMini } from './kpi-status';
import {
  FIRST_CLASS,
  FOOT_CLASS,
  HEAD_CLASS,
  InfoTip,
  NUM,
  OVERDUE_ROW,
  TABLE_CLASS,
  WRAP_CLASS,
  type CellChange,
} from './kpi-table';
import { EX_WRAP, useExTable } from './use-ex-table';

/*
 * Вкладка «Ввод за месяц» (задача 2.27; ТЗ «Вкладка «Ввод за месяц»»; прототип v81 modules/kpi.js:
 * kpiMonth, kMonPick, KTOT): выбор месяца, таблица контрагенты × показатели как в Excel (выделение,
 * ввод, блоки через буфер обмена, Ctrl+Z — `ex-table.ts`), итог под каждым столбцом на выбор и статус
 * месяца; на телефоне — та же таблица без столбца «Ответственный».
 */

export function KpiMonthTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useKpiRefresh();
  const { search, clearSearch } = useShell();
  const phone = useMediaQuery(PHONE_QUERY);
  const { month } = useKpiChoice();
  const query = useQuery({ ...monthQuery(month), placeholderData: keepPreviousData });
  const entry = useKpiEntry();
  const data = query.data;

  const rows = useMemo(() => {
    if (!data) return [];
    const q = searchText(search.trim());
    return data.rows
      .filter(
        (r) =>
          !q || searchText(r.name).includes(q) || searchText(r.responsibleName ?? '').includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [data, search]);

  if (query.isError && !data) return <Note tone="bad">{t('kpi.load_error')}</Note>;
  if (!data) return <KpiPlates />;

  /** Сохранить ячейки: сразу на экране, потом на сервере; ошибка — уведомление и данные с сервера. */
  const save = async (changes: readonly CellChange[]) => {
    if (changes.length === 0) return 0;
    client.setQueryData<KpiMonth>(
      monthQuery(month).queryKey,
      (old) => old && patched(old, changes),
    );
    const res = await callApi(() => api.api.kpi.values.$put({ json: { values: [...changes] } }));
    void refresh();
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return null;
    }
    return KpiValuesSaved.parse(res.data).changed;
  };

  const header = (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
      <MonthPicker data={data} />
      <Hint>{t('kpi.month.hint')}</Hint>
    </div>
  );

  let body;
  if (data.indicators.length === 0) {
    body = (
      <EmptyState icon="gauge" title={t('kpi.no_indicators')} text={t('kpi.no_indicators_text')} />
    );
  } else if (rows.length === 0) {
    body = search.trim() ? (
      <NothingFound
        title={t('grid.not_found')}
        resetLabel={t('grid.reset_filters')}
        onReset={clearSearch}
      />
    ) : (
      <EmptyState
        icon="search"
        title={t('grid.not_found')}
        text={t('kpi.month.nobody', { month: monthName(t, data.month) })}
      />
    );
  } else {
    // На телефоне — та же таблица без столбца «Ответственный»: нажатие на ячейку открывает ввод.
    body = (
      <MonthTable
        t={t}
        data={data}
        rows={rows}
        phone={phone}
        onSave={async (changes) => (await save(changes)) !== null}
        onEntry={(cid) => void entry.open(cid, data.month)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3.5" data-kpi-month={data.month}>
      <KpiPlates />
      {header}
      {body}
      {entry.dialog}
    </div>
  );
}

/** Ячейки после правки — сразу в таблице, пока сервер не ответил. */
function patched(data: KpiMonth, changes: readonly CellChange[]): KpiMonth {
  const by = new Map(changes.map((c) => [`${c.contractorId}|${c.indicatorId}`, c.value]));
  return {
    ...data,
    rows: data.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c) => {
        const key = `${r.contractorId}|${c.indicatorId}`;
        return by.has(key) ? { ...c, value: by.get(key)! } : c;
      }),
    })),
  };
}

/**
 * Выбор месяца (прототип `kMonPick`): стрелки «‹ ›» и список месяцев, у месяца с незаполненными
 * значениями — красная точка и число контрагентов; вперёд — не дальше идущего месяца.
 */
function MonthPicker({ data }: { data: KpiMonth }) {
  const t = useT();
  const go = (m: string) => setKpiChoice({ month: m });
  const missing = new Map(data.choices.map((c) => [c.month, c.missing]));
  const n = missing.get(data.month) ?? 0;
  const label = (m: string, count: number) =>
    count ? t('kpi.month.choice_missing', { month: monthText(m), n: count }) : monthText(m);

  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={t('kpi.month.label')}>
      <button
        type="button"
        className={iconButtonClass('sm')}
        aria-label={t('kpi.month.prev')}
        title={t('kpi.month.prev')}
        onClick={() => go(addMonths(data.month, -1))}
      >
        <Icon name="left" size="sm" />
      </button>
      <Popover
        label={t('kpi.month.label')}
        role="menu"
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            className={`${buttonClass('default', 'sm')} gap-1.5`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={id}
            title={t('kpi.month.pick')}
            data-kpi-month-pick=""
            onClick={toggle}
          >
            {n ? <Dot /> : null}
            <span>
              {n
                ? t('kpi.month.current_missing', { month: monthName(t, data.month), n })
                : monthName(t, data.month)}
            </span>
            <Icon name="down" size="sm" />
          </button>
        )}
      >
        {(close) => (
          <div className="flex max-h-[min(360px,60vh)] flex-col overflow-y-auto py-1">
            {data.choices.map((c) => (
              <button
                key={c.month}
                type="button"
                role="menuitemradio"
                aria-checked={c.month === data.month}
                data-kpi-choice={c.month}
                className={`flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover ${c.month === data.month ? 'bg-sel font-semibold' : ''}`}
                ref={(el) => {
                  if (el && c.month === data.month) el.scrollIntoView({ block: 'center' });
                }}
                onClick={() => {
                  close();
                  go(c.month);
                }}
              >
                {c.missing ? <Dot /> : <span className="h-2 w-2 flex-none" />}
                <span>
                  {label(c.month, c.missing)}
                  {c.month === data.current ? (
                    <small className="ml-1 text-faint">{t('kpi.month.now')}</small>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </Popover>
      <button
        type="button"
        className={iconButtonClass('sm')}
        aria-label={t('kpi.month.next')}
        title={t('kpi.month.next')}
        disabled={data.month >= data.current}
        onClick={() => go(addMonths(data.month, 1))}
      >
        <Icon name="right" size="sm" />
      </button>
    </div>
  );
}

/** Красная точка у месяца с незаполненными значениями (`.kdot`). */
const Dot = () => (
  <span
    aria-hidden="true"
    className="inline-block h-2 w-2 flex-none self-center rounded-full bg-danger"
  />
);

type Row = KpiMonth['rows'][number];

/** Итог под столбцом на выбор (прототип `KTOT`): у сотрудника запоминается для каждого показателя. */
const KTOT = ['sum', 'avg', 'max', 'min', 'count', 'none'] as const;
type Ktot = (typeof KTOT)[number];

/** Ключ показателя в настройках вида: без дефисов (ключ столбца — буквы и цифры). */
const ktotKey = (id: string) => `i${id.replace(/-/g, '')}`;

/** Итог по умолчанию — основной итог показателя («последнее» — сумма, прототип `kTotOf`). */
const ktotDefault = (col: KpiColumn): Ktot => (col.total === 'last' ? 'sum' : col.total);

function MonthTable({
  t,
  data,
  rows,
  phone,
  onSave,
  onEntry,
}: {
  t: Translate;
  data: KpiMonth;
  rows: readonly Row[];
  phone: boolean;
  onSave: (changes: CellChange[]) => Promise<boolean>;
  onEntry: (contractorId: string) => void;
}) {
  const cols = data.indicators;
  const view = useViewSettings('kpi.month');
  const [pick, setPick] = useState<{ col: KpiColumn; anchor: HTMLElement } | null>(null);
  const at = (r: number, c: number): KxRef | null => {
    const row = rows[r];
    const col = cols[c];
    const cell = row?.cells[c];
    if (!row || !col || !cell) return null;
    return {
      contractorId: row.contractorId,
      indicatorId: col.id,
      type: col.type,
      required: col.required,
      archived: col.archived,
      month: data.month,
      state: cell.state,
      start: cell.start,
      offSince: cell.offSince,
      value: cell.value,
      editable: row.editable,
    };
  };
  const {
    wrapRef: exRef,
    layer: exLayer,
    stat: exStat,
    menu: exMenu,
  } = useExTable({
    rows: rows.length,
    cols: cols.length,
    get: (r, c) => exCellOf(t, at(r, c), data.current),
    key: (r, c) => exKey(at(r, c)),
    put: (list) => putCells(list, at, onSave),
    label: (r, c) => t('kpi.cell_label', { name: rows[r]!.name, ind: cols[c]!.name }),
    // ОТКЛОНЕНИЕ: docs/deviations.md#О-60 — в прототипе у «Ввода за месяц» меню без окна значения.
    menu: (r) => [
      {
        id: 'entry',
        label: t('kpi.ex.menu.entry'),
        icon: 'clip',
        sub: `${rows[r]!.name} · ${monthName(t, data.month)}`,
        run: () => onEntry(rows[r]!.contractorId),
      },
    ],
  });
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-60 — выбранный итог в настройках вида на сервере, в прототипе —
  // в браузере (`g5.kpitot`).
  const ktotOf = (col: KpiColumn): Ktot => {
    const saved = view.settings.agg?.[ktotKey(col.id)];
    return saved && (KTOT as readonly string[]).includes(saved) ? saved : ktotDefault(col);
  };
  const setKtot = (col: KpiColumn, how: Ktot) =>
    view.save({ ...view.settings, agg: { ...view.settings.agg, [ktotKey(col.id)]: how } });

  return (
    <>
      {exStat}
      <div ref={exRef} className={`${WRAP_CLASS} ${EX_WRAP}`} data-no-swipe="">
        {exLayer}
        <table className={TABLE_CLASS} data-kpi-table="">
          <thead>
            <tr>
              <th className={`${HEAD_CLASS} ${FIRST_CLASS} z-[3]`}>{t('kpi.col.contractor')}</th>
              {phone ? null : <th className={HEAD_CLASS}>{t('kpi.col.responsible')}</th>}
              {cols.map((col, c) => (
                <th
                  key={col.id}
                  className={`${HEAD_CLASS} ${NUM}`}
                  data-kpi-col={col.id}
                  data-exc={c}
                  title={t('kpi.ex.select_col')}
                >
                  {col.name}
                  {col.description ? (
                    <InfoTip
                      label={t('kpi.desc_label', { name: col.name })}
                      text={col.description}
                    />
                  ) : null}
                  <small className="max-md:whitespace-normal">{columnSub(t, col)}</small>
                </th>
              ))}
              <th className={HEAD_CLASS}>{t('kpi.col.month_status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr
                key={row.contractorId}
                className={row.overdue ? OVERDUE_ROW : ''}
                data-kpi-row={row.contractorId}
              >
                <td
                  className={`${FIRST_CLASS} max-md:max-w-[140px] max-md:min-w-[112px] max-md:whitespace-normal`}
                  data-exr={r}
                >
                  <ContractorLink id={row.contractorId} name={row.name} tab="kpi" />
                </td>
                {phone ? null : <td className="text-muted">{row.responsibleName ?? '—'}</td>}
                {cols.map((col, c) => (
                  <KxTd key={col.id} r={r} c={c} x={at(r, c)!} current={data.current} />
                ))}
                <td>
                  <MonthMini
                    status={row.status}
                    needed={row.cells.some((c) => c.state === 'required')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className={FOOT_CLASS}>
            <tr className="[&_td]:align-top [&_th]:align-top">
              <th colSpan={phone ? 1 : 2} className={FIRST_CLASS}>
                {t('kpi.ktot.title')}
                <small className="block font-[450] text-faint">
                  {t(`kpi.ktot.by.${pluralForm(rows.length)}`, { n: rows.length })}
                </small>
              </th>
              {cols.map((col, c) => {
                const how = ktotOf(col);
                // ОТКЛОНЕНИЕ: docs/deviations.md#В-7 — выключенные у контрагента показатели в итоги не входят.
                const totals = columnTotals(rows.map((row) => row.cells[c]!));
                const text =
                  how === 'none'
                    ? '—'
                    : how === 'count'
                      ? t('kpi.ktot.of', { n: totals.count, of: totals.of })
                      : totalText(col.type, totals, how);
                return (
                  <td key={col.id} className={NUM} data-kpi-total={col.id}>
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[11.5px] font-medium text-link hover:underline"
                      title={t('kpi.ktot.pick', { name: col.name })}
                      aria-haspopup="menu"
                      data-kpi-ktot={col.id}
                      onClick={(e) => setPick({ col, anchor: e.currentTarget })}
                    >
                      {t(`kpi.ktot.${how}`)}
                      <Icon name="down" size="sm" className="h-3 w-3" />
                    </button>
                    <span
                      className={`block tabular-nums ${how === 'none' ? 'font-[450] text-faint' : ''}`}
                      data-kpi-total-value=""
                      title={
                        how !== 'none' && how !== 'count' && totals.count
                          ? t('kpi.total_of', { n: totals.count, of: totals.of })
                          : undefined
                      }
                    >
                      {text}
                    </span>
                  </td>
                );
              })}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {exMenu}
      {pick ? (
        <ActionMenu
          label={t('kpi.ktot.pick', { name: pick.col.name })}
          place={{ anchor: pick.anchor }}
          onClose={() => setPick(null)}
          items={KTOT.map((how) => ({
            id: how,
            label: t(`kpi.ktot.${how}`),
            icon: how === 'none' ? 'x' : how === 'count' ? 'check' : 'chart',
            on: how === ktotOf(pick.col),
            ...(how === ktotDefault(pick.col)
              ? { sub: t('kpi.ktot.main') }
              : how === 'count'
                ? { sub: t('kpi.ktot.count_sub') }
                : {}),
            run: () => setKtot(pick.col, how),
          }))}
        />
      ) : null}
    </>
  );
}
