'use client';

import {
  addMonths,
  bishkekDate,
  currentPlanMonth,
  formatSom,
  formatSomWithUnit,
  pluralForm,
  type GridViewSettings,
  type ListSort,
  type MonthPlanGroup,
  type MonthPlanItem,
  type MonthPlanQuick,
} from '@buhuchet/domain';
import { ListValues, ReportList, type ReportRow } from '@buhuchet/shared';
import {
  ActionMenu,
  buttonClass,
  CHECKBOX_CLASS,
  DataGrid,
  EmptyState,
  Icon,
  iconButtonClass,
  MiniTable,
  Note,
  PHONE_QUERY,
  Pill,
  Tag,
  TOUCH_AREA,
  useMediaQuery,
  type ActionEntry,
  type GridColumn,
  type MiniColumn,
  type MiniRow,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api, apiFailure, ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useMassAssign } from './mass-assign';
import { useReportActions, useReportAddRequest, type ReportActions } from './report-actions';
import { REPORT_AUDIT, reportColumns, reportTone } from './report-columns';
import {
  contractorPlan,
  monthDueText,
  monthPills,
  monthTitle,
  parseReportsMode,
  reportsModeCookie,
  type MonthTotals,
  type MonthsCardView,
  type ReportsMode,
} from './report-months-model';
import {
  contractorMonthReportsQuery,
  reportMonthSummaryQuery,
  reportSummaryQuery,
} from './reports-data';
import { NoTypesNote, ReportQuickChips, useReportQuick } from './reports-list';
import { useReportKanban } from './use-report-board';

const QUICK: readonly MonthPlanQuick[] = ['all', 'sub', 'pay'];

const Dash = () => <span className="text-faint">—</span>;

/** Плашка выбора (прототип `.chipsel`): выбранная — цвета акцента. */
const chipClass = (on: boolean) =>
  `inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] font-[550] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? 'border-transparent bg-accent text-on-accent shadow-cta' : 'border-line bg-raised text-muted'}`;

/** Итог месяца одной строкой (прототип `rmSumHtml`): метки и сроки. */
export function MonthSummary({ g, taxpay }: { g: MonthTotals; taxpay: boolean }) {
  const t = useT();
  const due = monthDueText(t, g);
  return (
    <>
      {monthPills(t, g, taxpay).map((p) => (
        <span key={p.key} title={p.title} data-month-pill={p.key}>
          <Pill tone={p.tone} size="sm" icon={p.icon}>
            {p.text}
          </Pill>
        </span>
      ))}
      {due ? <span className="text-[11.5px] leading-[1.4] text-faint">{due}</span> : null}
    </>
  );
}

/** Вид вкладки «Отчёты к сдаче» карточки: запоминает браузер (прототип `store` `cp.repmode`). */
export function useReportsMode(): [ReportsMode, (mode: ReportsMode) => void] {
  const [mode, setMode] = useState<ReportsMode>(() =>
    typeof document === 'undefined' ? 'months' : parseReportsMode(document.cookie),
  );
  const choose = (next: ReportsMode) => {
    document.cookie = reportsModeCookie(next, window.location.protocol === 'https:');
    setMode(next);
  };
  return [mode, choose];
}

/** Переключатель «По месяцам / Списком» (прототип `[data-rm-mode]`). */
export function ReportsModeSwitch({
  mode,
  onChange,
}: {
  mode: ReportsMode;
  onChange: (mode: ReportsMode) => void;
}) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t('report.months.mode.label')}
      data-reports-mode=""
      className="flex flex-wrap gap-1.5"
    >
      {(['months', 'list'] as const).map((m) => (
        <button
          key={m}
          type="button"
          data-mode={m}
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={chipClass(mode === m)}
        >
          {t(`report.months.mode.${m}`)}
        </button>
      ))}
    </div>
  );
}

/** Ширины столбцов таблицы месяца на ПК (прототип `.rm-tbl th`). */
const WIDTHS: Readonly<Record<string, number>> = {
  act: 152,
  due: 158,
  status: 148,
  amount: 112,
  payDue: 108,
  paid: 178,
  menu: 40,
};

/**
 * Месяц плана (прототип `rmMonthHtml`, `rmRowHtml`): заголовок с итогом и таблица отчётов — что сделать,
 * срок и статус сдачи, сумма, срок оплаты и «Оплачено в бюджет» (при «Учёте оплаты налогов»). Чего по
 * отчёту делать не нужно — «—». Строка открывает карточку отчёта, «⋯» — те же действия, что в списке.
 */
function MonthBlock({
  g,
  open,
  onToggle,
  columns,
  taxpay,
  reports,
  onMenu,
}: {
  g: MonthPlanGroup<ReportRow>;
  open: boolean;
  onToggle: () => void;
  columns: ReadonlyMap<string, GridColumn<ReportRow>>;
  taxpay: boolean;
  reports: ReportActions;
  onMenu: (el: HTMLElement, items: ActionEntry[]) => void;
}) {
  const t = useT();
  const title = monthTitle(t, g.month);
  const cell = (key: string, r: ReportRow): ReactNode => {
    const c = columns.get(key);
    return c ? (c.cell ? c.cell(r) : c.text(r)) : null;
  };
  const head = (key: string) => columns.get(key)?.label ?? '';
  const cols: MiniColumn[] = [
    { key: 'type', label: t('report.months.col.report') },
    { key: 'act', label: head('act'), width: WIDTHS.act },
    { key: 'due', label: head('due'), width: WIDTHS.due },
    { key: 'status', label: head('status'), width: WIDTHS.status },
    { key: 'amount', label: head('amount'), numeric: true, width: WIDTHS.amount },
    { key: 'payDue', label: head('payDue'), width: WIDTHS.payDue },
    ...(taxpay ? [{ key: 'paid', label: head('paid'), numeric: true, width: WIDTHS.paid }] : []),
    { key: 'menu', label: '', actions: true, width: WIDTHS.menu },
  ];
  const row = (x: MonthPlanItem<ReportRow>): MiniRow => {
    const r = x.report;
    const items = reports.actions(r);
    const blank = [
      ...(x.submit ? [] : ['due', 'status']),
      ...(r.act === 'sub' ? ['amount'] : []),
      ...(x.pay ? [] : ['payDue', 'paid']),
    ];
    return {
      key: r.id,
      late: x.late,
      blank,
      cells: {
        type: (
          <span className="inline-flex flex-wrap items-center gap-1">
            <b title={r.type.name}>{r.type.shortName}</b>
            {r.period !== 'M' || r.eventDate ? (
              <span className="text-faint">{r.periodLabel}</span>
            ) : null}
            {r.revision ? (
              <Tag tone="info">{t('report.revision.tag', { n: r.revision })}</Tag>
            ) : null}
          </span>
        ),
        // На телефоне ячейка — столбик: метка не растягивается на всю ширину.
        act: <span className="inline-flex max-md:self-start">{cell('act', r)}</span>,
        due: x.submit ? cell('due', r) : <Dash />,
        status: x.submit ? cell('status', r) : <Dash />,
        amount: cell('amount', r),
        payDue: x.pay ? cell('payDue', r) : <Dash />,
        // Сумма не указана — только шкала оплаты (прототип `rmRowHtml`).
        paid: !x.pay ? <Dash /> : x.amount > 0 ? cell('paid', r) : cell('paymentStatus', r),
        menu: items.length ? (
          <button
            type="button"
            data-row-menu=""
            className={`${iconButtonClass('sm')} ${TOUCH_AREA}`}
            aria-label={t('report.months.row_menu')}
            title={t('grid.actions')}
            onClick={(e) => {
              e.stopPropagation();
              onMenu(e.currentTarget, items);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Icon name="more" />
          </button>
        ) : null,
      },
    };
  };
  const total: MiniRow[] =
    g.amount > 0 && g.items.length > 1
      ? [
          {
            key: 'total',
            total: true,
            blank: ['act', 'due', 'status', 'payDue', 'menu'],
            cells: {
              type: t('report.months.total'),
              amount: formatSom(g.amount),
              paid: (
                <span>
                  {formatSom(g.paid)}
                  {g.left > 0 ? (
                    <span className="font-normal text-faint">
                      {' '}
                      {t('report.months.total_left', { amount: formatSom(g.left) })}
                    </span>
                  ) : null}
                </span>
              ),
            },
          },
        ]
      : [];
  const byId = new Map(g.items.map((x) => [x.report.id, x.report]));
  const edge = g.late ? 'border-l-danger' : g.done ? 'border-l-ok' : 'border-l-line';
  return (
    <section
      data-report-month={g.month}
      data-month-state={g.late ? 'late' : g.done ? 'done' : 'open'}
      className={`flex min-w-0 flex-col rounded-xl border border-l-[3px] border-line bg-raised px-4 py-3.5 ${edge} ${open ? 'gap-2.5' : ''}`}
    >
      <h3 className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <button
          type="button"
          data-month-toggle=""
          aria-expanded={open}
          title={open ? t('report.months.fold') : t('report.months.unfold')}
          onClick={onToggle}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent py-0.5 pr-1 pl-0 text-[14.5px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className={`inline-flex transition-transform ${open ? '' : '-rotate-90'}`}>
            <Icon name="down" size="sm" />
          </span>
          <span data-month-title="">{title}</span>
        </button>
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1.5" data-month-sum="">
          <MonthSummary g={g} taxpay={taxpay} />
        </span>
      </h3>
      {open ? (
        <MiniTable
          columns={cols}
          rows={[...g.items.map(row), ...total]}
          empty=""
          fixed
          label={t('report.months.table', { title })}
          onOpen={(id) => {
            const r = byId.get(id);
            if (r) reports.openCard(r);
          }}
        />
      ) : null}
    </section>
  );
}

function monthEmptyKey(none: boolean, quick: MonthPlanQuick) {
  if (none) return 'report.months.empty.none' as const;
  return `report.months.empty.${quick}` as const;
}

/**
 * «По месяцам» вкладки «Отчёты к сдаче» карточки контрагента (решение заказчика 13.11.2026; прототип
 * v90 `rmCardHtml`, `rmCardMount`): за каждый месяц — что сдать и что оплатить, суммы и сроки. Плашки
 * «Все / Сдать / Уплатить» с числами, «Осталось оплатить», закрытые месяцы — по галочке; открытые
 * месяцы раскрыты, закрытые свёрнуты. `lead` — переключатель «По месяцам / Списком».
 */
export function ContractorReportMonths({
  contractorId,
  reports,
  lead,
  view,
  onView,
}: {
  contractorId: string;
  reports: ReportActions;
  lead: ReactNode;
  /** Выбор вкладки: хранит карточка, поэтому смена вкладки и вида его не сбрасывает. */
  view: MonthsCardView;
  onView: (view: MonthsCardView) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const { access } = useShell();
  const phone = useMediaQuery(PHONE_QUERY);
  const taxpay = access.feature('taxpay');
  const { quick, showClosed, toggled } = view;
  const [menu, setMenu] = useState<{ el: HTMLElement; items: ActionEntry[] } | null>(null);
  const query = useQuery(contractorMonthReportsQuery(contractorId));
  const onReceive = reports.receive;
  const columns = useMemo(
    () =>
      new Map(
        reportColumns(t, {
          waiting: false,
          confirm: access.reportConfirm,
          waitDays: 3,
          phone,
          taxpay,
          onReceive,
        }).map((c) => [c.key, c]),
      ),
    [t, access.reportConfirm, phone, taxpay, onReceive],
  );
  const plan = useMemo(
    () => contractorPlan(query.data ?? [], { taxpay, quick, showClosed }),
    [query.data, taxpay, quick, showClosed],
  );

  const bar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-months-bar="">
      {lead}
      <div
        role="group"
        aria-label={t('report.quick.label')}
        data-months-quick=""
        className="flex flex-wrap gap-1.5"
      >
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            data-quick={q}
            aria-pressed={quick === q}
            onClick={() => onView({ ...view, quick: q })}
            className={chipClass(quick === q)}
          >
            {t(`report.quick.${q}`)}
            {query.data ? (
              <span className="ml-1 tabular-nums opacity-70">{plan.counts[q]}</span>
            ) : null}
          </button>
        ))}
      </div>
      <span className="grow max-md:hidden" />
      {taxpay && plan.left > 0 ? (
        <span className="text-[12.5px] text-muted" data-months-left="">
          {t('report.months.left_all')}{' '}
          <b className="tabular-nums">{formatSomWithUnit(plan.left)}</b>
        </span>
      ) : null}
      {plan.closed && quick === 'all' ? (
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] whitespace-nowrap text-muted">
          <input
            type="checkbox"
            data-months-closed=""
            className={CHECKBOX_CLASS}
            checked={showClosed}
            onChange={(e) => onView({ ...view, showClosed: e.target.checked })}
          />
          {t('report.months.closed', { n: plan.closed })}
        </label>
      ) : null}
    </div>
  );

  let body: ReactNode;
  if (query.isError && !query.data) {
    body = (
      <Note tone="bad">
        {query.error instanceof ApiFailure
          ? errorText(query.error.error)
          : t('report.months.load_error')}
      </Note>
    );
  } else if (!query.data) {
    body = <div className="h-24 animate-pulse rounded-xl bg-pane-alt" aria-busy="true" />;
  } else if (!plan.months.length) {
    body = (
      <div
        data-months-empty=""
        className="flex items-center gap-2 rounded-xl border border-line bg-raised px-4 py-3.5 text-muted"
      >
        <Icon name="ok" />
        <span>{t(monthEmptyKey(plan.none, quick))}</span>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2.5" data-months-list="">
        {plan.months.map((g) => {
          const open = toggled[g.month] ?? !g.done;
          return (
            <MonthBlock
              key={g.month}
              g={g}
              open={open}
              onToggle={() => onView({ ...view, toggled: { ...toggled, [g.month]: !open } })}
              columns={columns}
              taxpay={taxpay}
              reports={reports}
              onMenu={(el, items) => setMenu({ el, items })}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5" data-contractor-months="">
      {bar}
      {body}
      <span className="text-[11.5px] leading-[1.4] text-faint">{t('report.months.hint')}</span>
      {menu ? (
        <ActionMenu
          items={menu.items}
          place={{ anchor: menu.el }}
          label={t('grid.actions')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/** Месяц вкладки «По месяцам» — до перезагрузки страницы (прототип `S.rmM`). */
const remembered: { month: string | null } = { month: null };

/** От ближайшего срока (прототип `sort:{key:'due',dir:1}`), по контрагентам (`defGroup:['cp']`). */
const MONTHS_SORT: ListSort = { key: 'due', dir: 'asc' };
const MONTHS_VIEW: GridViewSettings = { group: ['cp'] };

/** Видимые по умолчанию (прототип `SHOW['rep-months']`): контрагент — в заголовке группы. */
const monthsVisible = (taxpay: boolean): string[] => [
  'type',
  'act',
  'period',
  'due',
  'status',
  'amount',
  'payDue',
  ...(taxpay ? ['paid'] : []),
  'responsible',
];

/**
 * Контрагент скрыт столбцом, но виден заголовком группы: поиск по названию и ИНН находит его отчёты
 * (прототип с v92: `searchText` вкладки «По месяцам»).
 */
const MONTHS_SEARCH_ALSO = ['cp', 'inn'] as const;

const RAISED_ICON =
  'inline-grid h-[33px] w-[33px] flex-none cursor-pointer place-items-center rounded-lg border-0 bg-btn text-muted shadow-btn hover:bg-btn-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function cpsText(t: Translate, n: number): string {
  return t(`report.months.cps.${pluralForm(n)}`, { n });
}

/**
 * Вкладка «По месяцам» модуля «Отчеты для сдачи» (решение заказчика 13.11.2026; прототип v90
 * `rmRender`): один месяц по всем контрагентам — что сдать и что оплатить, суммы и сроки. Месяц
 * листается стрелками, по умолчанию — прошлый: отчёты за него сдаются сейчас. Под заголовком — итог
 * месяца, плашки «Все / Сдать / Уплатить», общий список, сгруппированный по контрагенту.
 */
export function ReportMonthsTab() {
  const t = useT();
  const errorText = useErrorText();
  const now = currentPlanMonth(bishkekDate(new Date()));
  const [month, setMonthState] = useState(() => remembered.month ?? now);
  const setMonth = (m: string) => {
    remembered.month = m;
    setMonthState(m);
  };
  const quick = useReportQuick();
  const reports = useReportActions();
  const mass = useMassAssign();
  useReportAddRequest({ adhoc: reports.newReport, mass: mass.open });
  const { access } = useShell();
  const taxpay = access.feature('taxpay');
  const summary = useQuery({
    ...reportMonthSummaryQuery(month),
    placeholderData: keepPreviousData,
  });
  const s = summary.data?.month === month ? summary.data : undefined;
  const title = monthTitle(t, month);

  return (
    <div className="flex flex-col gap-2.5" data-report-months="">
      <NoTypesNote />
      <div className="flex flex-wrap items-center gap-2" data-months-head="">
        <button
          type="button"
          className={RAISED_ICON}
          aria-label={t('report.cal.prev')}
          title={t('report.cal.prev')}
          data-months-move="-1"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <Icon name="left" />
        </button>
        <h3
          className="m-0 min-w-[190px] text-center text-[17px] font-bold max-md:min-w-0 max-md:flex-1 max-md:text-[15.5px]"
          data-months-title=""
        >
          {title}
        </h3>
        <button
          type="button"
          className={RAISED_ICON}
          aria-label={t('report.cal.next')}
          title={t('report.cal.next')}
          data-months-move="1"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <Icon name="right" />
        </button>
        {month === now ? null : (
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            title={t('report.months.now_title')}
            data-months-move="0"
            onClick={() => setMonth(now)}
          >
            <Icon name="calendar" size="sm" />
            {t('report.months.now')}
          </button>
        )}
        <div className="flex-1 max-md:hidden" />
        <span className="text-[11.5px] leading-[1.4] text-faint max-md:hidden">
          {t('report.months.head_hint')}
        </span>
      </div>
      {summary.isError && !summary.data ? (
        <Note tone="bad">
          {summary.error instanceof ApiFailure ? errorText(summary.error.error) : t('err.unknown')}
        </Note>
      ) : null}
      {s && s.quick.all ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-months-total="">
          <span className="text-muted">{cpsText(t, s.contractors)}</span>
          <MonthSummary g={s} taxpay={taxpay} />
        </div>
      ) : null}
      <ReportQuickChips quick={quick} counts={s?.quick} />
      <MonthList key={month} month={month} title={title} reports={reports} />
      {mass.dialog}
      {reports.dialogs}
    </div>
  );
}

/**
 * Отчёты месяца (прототип `repGrid(…, 'rep-months', …)`): общий список со своим видом — по умолчанию
 * сгруппирован по контрагенту, от ближайшего срока; поиск, фильтры, «В Excel», массовые действия.
 */
function MonthList({
  month,
  title,
  reports,
}: {
  month: string;
  title: string;
  reports: ReportActions;
}) {
  const t = useT();
  const labels = useGridLabels('report.count');
  const phone = useMediaQuery(PHONE_QUERY);
  const { search, clearSearch, access } = useShell();
  const tabCounts = useQuery(reportSummaryQuery);
  const quick = useReportQuick();
  const taxpay = access.feature('taxpay');
  const onReceive = reports.receive;
  const columns = useMemo(
    () =>
      reportColumns(t, {
        waiting: false,
        confirm: access.reportConfirm,
        waitDays: tabCounts.data?.waitDays ?? 3,
        phone,
        taxpay,
        onReceive,
      }),
    [t, access.reportConfirm, tabCounts.data?.waitDays, phone, taxpay, onReceive],
  );
  const defaultVisible = useMemo(() => monthsVisible(taxpay), [taxpay]);
  const view = useViewSettings('reports.months');
  // Пока вид не настроен — группы по контрагенту (прототип `defGroup`).
  const settings = useMemo(
    () => (Object.keys(view.settings).length ? view.settings : { ...MONTHS_VIEW }),
    [view.settings],
  );
  const extra = useMemo(() => ({ tab: 'months', quick, month }), [quick, month]);
  const fetchPage = useCallback<FetchListPage<ReportRow>>(async (params) => {
    const res = await api.api.reports.$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return ReportList.parse(await res.json());
  }, []);
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const query = { col, tab: 'months' as const, quick, month };
      const res = await api.api.reports.values.$get({ query: q ? { ...query, q } : query });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [quick, month],
  );
  const kanban = useReportKanban(reports.drop);
  const list = useListPage({
    gridKey: 'reports.months',
    columns,
    defaultVisible,
    settings,
    defaultSort: MONTHS_SORT,
    search,
    enabled: view.ready,
    fetchPage,
    extra,
    kanban,
    searchAlso: MONTHS_SEARCH_ALSO,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.reports.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);

  return (
    <div data-months-grid={month}>
      <DataGrid
        columns={columns}
        audit={REPORT_AUDIT}
        defaultVisible={defaultVisible}
        defaultSort={MONTHS_SORT}
        settings={settings}
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
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={
          <EmptyState
            icon="ok"
            title={t('report.months.empty.title', { title })}
            text={t(quick === 'all' ? 'report.months.empty.move' : 'report.months.empty.quick')}
          />
        }
        rowKey={(r) => r.id}
        titleKey="cp"
        kanban={kanban}
        rowTone={reportTone}
        label={title}
        labels={labels}
        actions={reports.actions}
        onOpen={reports.openCard}
        bulk={reports.bulk('all')}
      />
    </div>
  );
}
