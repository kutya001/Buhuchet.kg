'use client';

import {
  addMonths,
  bishkekDate,
  calendarGrid,
  formatDateRu,
  weekdayMondayFirst,
  type UiTextKey,
} from '@buhuchet/domain';
import { ListValues, ReportList, type ReportCalendar, type ReportRow } from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Icon,
  Note,
  PHONE_QUERY,
  Pill,
  useMediaQuery,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
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
import {
  REPORT_AUDIT,
  REPORT_DEFAULT_SORT,
  reportColumns,
  reportDefaultVisible,
  reportTone,
} from './report-columns';
import { reportCalendarQuery, reportSummaryQuery } from './reports-data';

type Day = ReportCalendar['days'][number];

/** Месяц и день «Календаря» — до перезагрузки страницы, как `S.cal` и `S.calSel` прототипа. */
const remembered: { month: string | null; day: string | null } = { month: null, day: null };
const remember = (patch: Partial<typeof remembered>) => Object.assign(remembered, patch);

/** Пока числа месяца не пришли — дни сетки без отметок (суббота и воскресенье — нерабочие). */
const blankDays = (month: string): Day[] =>
  calendarGrid(month).map((date) => ({
    date,
    working: weekdayMondayFirst(date) < 5,
    holiday: '',
    todo: 0,
    done: 0,
    pay: 0,
  }));

/** «Октябрь 2026» (прототип ymLabel с заглавной буквы). */
function monthTitle(t: Translate, month: string): string {
  return `${t(`report.month.${Number(month.slice(5, 7))}` as UiTextKey)} ${month.slice(0, 4)}`;
}

const RAISED_ICON =
  'inline-grid h-[33px] w-[33px] flex-none cursor-pointer place-items-center rounded-lg border-0 bg-btn text-muted shadow-btn hover:bg-btn-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** День сетки (`.cday`): нерабочий — фоном, чужой месяц — бледно, сегодня — рамкой, выбранный — тенью. */
function dayClass(d: Day, o: { inMonth: boolean; today: boolean; selected: boolean }): string {
  return [
    'flex min-h-[92px] min-w-0 cursor-pointer flex-col gap-[3px] rounded-lg border border-line px-2 py-1.5 text-left text-ink transition-shadow duration-150 hover:shadow-pane focus-visible:outline-2 focus-visible:outline-brand-blue',
    'max-[767px]:min-h-[58px] max-[767px]:px-[5px] max-[767px]:py-1',
    // Метки на телефоне мельче и без значков (`.cday .pill` прототипа).
    'max-[767px]:[&_[data-pill]]:px-[5px] max-[767px]:[&_[data-pill]]:text-[10px] max-[767px]:[&_[data-pill]]:leading-[15px] max-[767px]:[&_[data-pill]_svg]:hidden',
    d.working ? 'bg-raised' : 'bg-pane-alt',
    o.inMonth ? '' : 'opacity-40',
    o.selected
      ? 'shadow-btn-active'
      : o.today
        ? 'shadow-[inset_0_0_0_2px_var(--color-accent)]'
        : '',
  ].join(' ');
}

/**
 * Вкладка «Календарь» (ТЗ «Отчеты для сдачи» → «Вкладка «Календарь»»; прототип modules/reports.js,
 * `renderCalendar`; видна при включённой функции «Календарь отчётов»): месяц сеткой с понедельника,
 * у дня — «N к сдаче» (просроченные — красным), «N сдано» и «N оплат» (с функцией «Учёт оплат
 * налогов»); нерабочие дни и праздники — по производственному календарю. Нажатие на день — список
 * отчётов со сроком в этот день, повторное — убирает его.
 */
export function ReportCalendarTab() {
  const t = useT();
  const errorText = useErrorText();
  const today = bishkekDate(new Date());
  const [month, setMonthState] = useState(() => remembered.month ?? today.slice(0, 7));
  const [day, setDayState] = useState<string | null>(() => remembered.day);
  const setMonth = (m: string) => {
    remember({ month: m });
    setMonthState(m);
  };
  const setDay = (d: string | null) => {
    remember({ day: d });
    setDayState(d);
  };
  const query = useQuery({ ...reportCalendarQuery(month), placeholderData: keepPreviousData });
  const reports = useReportActions();
  const mass = useMassAssign();
  useReportAddRequest({ adhoc: reports.newReport, mass: mass.open });
  const data = query.data;
  const days = data?.month === month ? data.days : blankDays(month);
  const picked = day ? days.find((d) => d.date === day) : undefined;

  return (
    <div className="flex flex-col gap-3.5" data-report-calendar="">
      <div className="flex flex-wrap items-center gap-2" data-calendar-head="">
        <button
          type="button"
          className={RAISED_ICON}
          aria-label={t('report.cal.prev')}
          title={t('report.cal.prev')}
          data-calendar-move="-1"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <Icon name="left" />
        </button>
        <h3 className="m-0 min-w-[150px] text-center text-[17px] font-bold" data-calendar-month="">
          {monthTitle(t, month)}
        </h3>
        <button
          type="button"
          className={RAISED_ICON}
          aria-label={t('report.cal.next')}
          title={t('report.cal.next')}
          data-calendar-move="1"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <Icon name="right" />
        </button>
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          data-calendar-move="0"
          onClick={() => setMonth(today.slice(0, 7))}
        >
          {t('report.cal.today')}
        </button>
        <div className="flex-1" />
        <span className="text-[11.5px] leading-[1.4] text-faint">{t('report.cal.hint')}</span>
      </div>
      {query.isError && !data ? (
        <Note tone="bad">
          {query.error instanceof ApiFailure ? errorText(query.error.error) : t('err.unknown')}
        </Note>
      ) : null}
      <div
        className="grid grid-cols-7 gap-1.5 max-[767px]:gap-[3px]"
        data-calendar=""
        aria-busy={query.isFetching}
      >
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <div
            key={n}
            className="px-1.5 text-[11px] font-bold tracking-[.07em] text-faint uppercase"
          >
            {t(`report.cal.dow.${n}` as UiTextKey)}
          </div>
        ))}
        {days.map((d) => {
          const inMonth = d.date.slice(0, 7) === month;
          const total = d.todo + d.done;
          return (
            <button
              key={d.date}
              type="button"
              data-day={d.date}
              aria-pressed={day === d.date}
              aria-label={t('report.cal.day', { date: formatDateRu(d.date), n: total })}
              className={dayClass(d, {
                inMonth,
                today: d.date === today,
                selected: day === d.date,
              })}
              onClick={() => setDay(day === d.date ? null : d.date)}
            >
              <span className="flex justify-between gap-1 text-[13px] font-bold tabular-nums">
                <span>{Number(d.date.slice(8))}</span>
                {!d.working && inMonth ? (
                  <span className="text-[11px] font-[450] text-faint">{t('report.cal.off')}</span>
                ) : null}
              </span>
              {d.holiday && inMonth ? (
                <span
                  title={d.holiday}
                  className="truncate text-[10.5px] leading-[1.2] text-danger max-[767px]:hidden"
                >
                  {d.holiday}
                </span>
              ) : null}
              <span className="mt-auto flex flex-col items-start gap-[2px]">
                {d.todo ? (
                  <Pill size="sm" tone={d.date < today ? 'bad' : 'warn'} icon="send">
                    {t('report.cal.todo', { n: d.todo })}
                  </Pill>
                ) : null}
                {d.done ? (
                  <Pill size="sm" tone="ok" icon="check">
                    {t('report.cal.done', { n: d.done })}
                  </Pill>
                ) : null}
                {d.pay ? (
                  <Pill size="sm" tone="violet" icon="coins">
                    {t('report.cal.pay', { n: d.pay })}
                  </Pill>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {day ? (
        <>
          <h3 className="m-0 mt-1.5 flex items-center gap-2 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">
            {t('report.cal.list', { date: formatDateRu(day) })}
            {picked?.holiday ? ` · ${picked.holiday}` : ''}
          </h3>
          <ReportDayList key={day} day={day} reports={reports} />
        </>
      ) : (
        <span className="text-[11.5px] leading-[1.4] text-faint">{t('report.cal.pick')}</span>
      )}
      {mass.dialog}
      {reports.dialogs}
    </div>
  );
}

/**
 * Отчёты со сроком сдачи или оплаты в выбранный день (прототип `repGrid(…, 'rep-cal', …)`): общий список
 * со своим видом, поиском, фильтрами, «В Excel» и массовой «Отметить сданными».
 */
function ReportDayList({ day, reports }: { day: string; reports: ReportActions }) {
  const t = useT();
  const labels = useGridLabels('report.count');
  const phone = useMediaQuery(PHONE_QUERY);
  const { search, clearSearch, access } = useShell();
  const summary = useQuery(reportSummaryQuery);
  const taxpay = access.feature('taxpay');
  const onReceive = reports.receive;
  const columns = useMemo(
    () =>
      reportColumns(t, {
        waiting: false,
        confirm: access.reportConfirm,
        waitDays: summary.data?.waitDays ?? 3,
        phone,
        taxpay,
        onReceive,
      }),
    [t, access.reportConfirm, summary.data?.waitDays, phone, taxpay, onReceive],
  );
  const defaultVisible = useMemo(() => reportDefaultVisible(false, taxpay), [taxpay]);
  const view = useViewSettings('reports.calendar');
  const extra = useMemo(() => ({ tab: 'calendar', quick: 'all', day }), [day]);
  const fetchPage = useCallback<FetchListPage<ReportRow>>(async (params) => {
    const res = await api.api.reports.$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return ReportList.parse(await res.json());
  }, []);
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const query = { col, tab: 'calendar' as const, quick: 'all' as const, day };
      const res = await api.api.reports.values.$get({ query: q ? { ...query, q } : query });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [day],
  );
  const list = useListPage({
    gridKey: 'reports.calendar',
    columns,
    defaultVisible,
    settings: view.settings,
    defaultSort: REPORT_DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.reports.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);

  return (
    <div data-calendar-list={day}>
      <DataGrid
        columns={columns}
        audit={REPORT_AUDIT}
        defaultVisible={defaultVisible}
        defaultSort={REPORT_DEFAULT_SORT}
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
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="calendar" title={t('report.cal.empty')} />}
        rowKey={(r) => r.id}
        titleKey="cp"
        rowTone={reportTone}
        label={t('report.cal.list', { date: formatDateRu(day) })}
        labels={labels}
        actions={reports.actions}
        onOpen={reports.openCard}
        bulk={reports.bulk('calendar')}
      />
    </div>
  );
}
