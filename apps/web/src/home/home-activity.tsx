'use client';

import {
  ACTIVITY_DEFAULT,
  ACTIVITY_KINDS,
  ACTIVITY_MAX_BACK,
  activityBarHeight,
  activityBucketLabeled,
  activityKindChosen,
  activityRange,
  activityShift,
  bishkekDate,
  formatCount,
  formatDateRu,
  monthLabel,
  weekdayMondayFirst,
  type ActivityBucket,
  type ActivityKind,
  type ActivityPeriod,
  type IsoDate,
  type ListSort,
} from '@buhuchet/domain';
import {
  ActivityList,
  ListValues,
  type ActivityEmployee,
  type ActivityOverview,
  type ActivityRow,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  DataGrid,
  EmptyState,
  Icon,
  linkButtonClass,
  MiniTable,
  Modal,
  Note,
  Pill,
  Plate,
  Plates,
  Segments,
  type ActionEntry,
  type GridColumn,
  type MiniRow,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api, apiFailure } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useStaffActions } from '../staff/staff-actions';
import { employeeQuery } from '../staff/staff-data';
import { activityEmployeeQuery, activityOverviewQuery, useHomeRefreshOnSave } from './home-data';

const GRID_KEY = 'home.act';

/** По умолчанию — по «Действий», от больших (прототип `sort: {key: 'n', dir: -1}`). */
const ACTIVITY_SORT: ListSort = { key: 'n', dir: 'desc' };

/** Видимые по умолчанию — все, кроме «Сдано позже срока» (прототип: `hide: true`). */
const ACTIVITY_VISIBLE = [
  'fio',
  'role',
  'last',
  'in',
  'out',
  'days',
  'n',
  'sub',
  'due',
  'over',
  'cps',
  'tasks',
];

/**
 * Период «Активности» (прототип `S.act`): один на страницу до её перезагрузки — вернувшись на вкладку,
 * сотрудник видит тот же период.
 */
let chosen: ActivityPeriod | null = null;

/** Кнопка-значок листания (прототип `.icon-btn.sm.raised`). */
const RAISED_ICON =
  'inline-grid h-[27px] w-[27px] flex-none cursor-pointer place-items-center rounded-lg border-0 bg-btn text-muted shadow-btn hover:bg-btn-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-45';

type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type MonthNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Подпись периода (прототип `actRange`): «12.11.2026, четверг», «09.11 – 15.11.2026», «ноябрь 2026», «2026 год». */
function periodLabel(t: Translate, p: ActivityPeriod, today: IsoDate): string {
  const { from, to } = activityRange(p, today);
  if (p.k === 'd') {
    return t('home.act.label.d', {
      date: formatDateRu(from),
      dow: t(`pdicts.cal.dow.${weekdayMondayFirst(from) as Dow}`),
    });
  }
  if (p.k === 'w') {
    return t('home.act.label.w', { from: formatDateRu(from).slice(0, 5), to: formatDateRu(to) });
  }
  if (p.k === 'm') return monthLabel(from.slice(0, 7));
  return t('home.an.year', { y: Number(from.slice(0, 4)) });
}

/** «12.11.2026 14:05» из «2026-11-12 14:05». */
export const momentText = (last: string) => `${formatDateRu(last.slice(0, 10))} ${last.slice(11)}`;

export const Faint = ({ children }: { children: ReactNode }) => (
  <span className="text-faint">{children}</span>
);

/** Число в ячейке: ноль — бледный (прототип `actNum`). */
export const num = (v: number) => (v ? String(v) : <Faint>0</Faint>);

/** «Просрочено сейчас»: красная метка со значком (прототип `.pill.red.sm`). */
const overdue = (v: number) =>
  v ? (
    <Pill tone="bad" size="sm" icon="alert">
      {v}
    </Pill>
  ) : (
    <Faint>0</Faint>
  );

/**
 * Строка выбора периода (прототип `actBar`): день, неделя, месяц, год; «Раньше» и «Позже» (не дальше
 * текущего), подпись периода, «К текущему» и пояснение справа.
 */
export function PeriodBar({
  t,
  p,
  today,
  note,
  onChange,
}: {
  t: Translate;
  p: ActivityPeriod;
  today: IsoDate;
  note?: string;
  onChange: (next: ActivityPeriod) => void;
}) {
  return (
    <div data-activity-bar="" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Segments<ActivityKind>
        label={t('home.act.period')}
        options={ACTIVITY_KINDS.map((k) => ({ value: k, label: t(`home.act.kind.${k}`) }))}
        value={p.k}
        onChange={(k) => onChange(activityKindChosen(k))}
      />
      <div className="inline-flex items-center gap-1.5 max-md:w-full max-md:justify-between">
        <button
          type="button"
          className={RAISED_ICON}
          data-activity-move="-1"
          disabled={p.off <= -ACTIVITY_MAX_BACK}
          title={t('home.act.prev')}
          aria-label={t('home.act.prev_aria')}
          onClick={() => onChange(activityShift(p, -1))}
        >
          <Icon name="left" size="sm" />
        </button>
        <b
          data-activity-label=""
          className="min-w-[150px] text-center font-[650] tabular-nums max-md:min-w-0"
        >
          {periodLabel(t, p, today)}
        </b>
        <button
          type="button"
          className={RAISED_ICON}
          data-activity-move="1"
          disabled={p.off >= 0}
          title={t('home.act.next')}
          aria-label={t('home.act.next_aria')}
          onClick={() => onChange(activityShift(p, 1))}
        >
          <Icon name="right" size="sm" />
        </button>
      </div>
      {p.off ? (
        <button
          type="button"
          className={linkButtonClass()}
          data-activity-move="0"
          onClick={() => onChange(activityShift(p, 0))}
        >
          {t('home.act.now')}
        </button>
      ) : null}
      {note ? (
        <>
          <div className="flex-1" />
          <span className="text-[12.5px] text-muted max-md:hidden">{note}</span>
        </>
      ) : null}
    </div>
  );
}

/** Плашки (прототип `renderHomeAct`): работали из стольких, входы, действия, сдано, задачи. */
function ActivityPlates({ t, v, shown }: { t: Translate; v: ActivityOverview; shown: boolean }) {
  return (
    <Plates shown={shown}>
      <Plate
        id="a1"
        icon="users"
        color={v.active ? 'green' : 'yellow'}
        label={t('home.act.plate.worked')}
        value={String(v.active)}
        unit={t('home.act.plate.worked_of', { n: v.staff })}
        sub={t('home.act.plate.worked_sub')}
      />
      <Plate
        id="a2"
        icon="key"
        color="blue"
        label={t('home.act.plate.in')}
        value={formatCount(v.in)}
        sub={t('home.act.plate.in_sub', { n: formatCount(v.out) })}
      />
      <Plate
        id="a3"
        icon="chart"
        color="purple"
        label={t('home.act.plate.n')}
        value={formatCount(v.n)}
        sub={t('home.act.plate.n_sub')}
      />
      <Plate
        id="a4"
        icon="send"
        color="green"
        label={t('home.act.plate.sub')}
        value={String(v.sub)}
        sub={v.late ? t('home.act.plate.sub_late', { n: v.late }) : t('home.act.plate.sub_ok')}
      />
      {v.tasks === null ? null : (
        <Plate
          id="a5"
          icon="task"
          color="purple"
          label={t('home.act.plate.tasks')}
          value={String(v.tasks)}
        />
      )}
    </Plates>
  );
}

/** Подпись под столбиком и подсказка (прототип `actBuckets`). */
function bucketTexts(t: Translate, k: ActivityKind, b: ActivityBucket, i: number, total: number) {
  if (k === 'y') {
    const name = t(`report.month.${Number(b.key.slice(5, 7)) as MonthNo}`).toLowerCase();
    return { label: name.slice(0, 3), title: name };
  }
  const label =
    k === 'w'
      ? t(`report.cal.dow.${(i + 1) as MonthNo & (1 | 2 | 3 | 4 | 5 | 6 | 7)}`).toLowerCase()
      : activityBucketLabeled(i, total)
        ? String(Number(b.key.slice(8)))
        : '';
  return { label, title: formatDateRu(b.key) };
}

/** Столбики «Действия по дням» (прототип `actChart`, стили `.act-ch`, `.act-b`). */
export function ActivityChart({
  t,
  k,
  buckets,
}: {
  t: Translate;
  k: ActivityKind;
  buckets: readonly ActivityBucket[];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.value));
  return (
    <div
      data-activity-chart=""
      role="img"
      aria-label={t(k === 'y' ? 'home.act.chart.months' : 'home.act.chart.days')}
      className="flex h-[150px] items-stretch gap-[3px] max-md:h-[120px] max-md:gap-px"
    >
      {buckets.map((b, i) => {
        const { label, title } = bucketTexts(t, k, b, i, buckets.length);
        return (
          <div
            key={b.key}
            data-activity-bar-of={b.key}
            title={t('home.act.chart.bar', { label: title, n: formatCount(b.value) })}
            className="group grid min-w-0 flex-1 grid-rows-[1fr_16px] justify-items-center"
          >
            <div className="flex w-full items-end justify-center border-b border-line">
              <i
                className="block w-full max-w-[34px] rounded-t bg-info opacity-85 group-hover:opacity-100"
                style={{ height: `${activityBarHeight(b.value, max)}%` }}
              />
            </div>
            <span className="text-[10.5px] leading-4 whitespace-nowrap text-faint">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Столбцы списка (прототип: сетка `home-act`). */
function activityColumns(t: Translate, tasks: boolean): GridColumn<ActivityRow>[] {
  type NumKey = 'in' | 'out' | 'days' | 'n' | 'sub' | 'late' | 'due' | 'cps' | 'tasks';
  const number = (key: NumKey, width: number): GridColumn<ActivityRow> => ({
    key,
    label: t(`home.act.col.${key}`),
    type: 'int',
    width,
    numeric: true,
    text: (r) => String(r[key]),
    cell: (r) => num(r[key]),
  });
  return [
    {
      key: 'fio',
      label: t('home.act.col.fio'),
      type: 'text',
      width: 220,
      text: (r) => r.name,
      cell: (r) => (
        <>
          <span className="font-semibold">{r.name}</span>
          {r.active ? null : (
            <>
              {' '}
              <Pill size="sm">{t('home.act.blocked')}</Pill>
            </>
          )}
        </>
      ),
    },
    { key: 'role', label: t('home.act.col.role'), type: 'enum', width: 170, text: (r) => r.role },
    {
      key: 'last',
      label: t('home.act.col.last'),
      type: 'datetime',
      width: 170,
      text: (r) => (r.last ? momentText(r.last) : t('home.act.never')),
      cell: (r) => (r.last ? momentText(r.last) : <Faint>{t('home.act.never')}</Faint>),
    },
    number('in', 90),
    number('out', 96),
    number('days', 150),
    number('n', 100),
    number('sub', 126),
    number('late', 150),
    number('due', 200),
    {
      key: 'over',
      label: t('home.act.col.over'),
      type: 'int',
      width: 146,
      numeric: true,
      text: (r) => String(r.over),
      cell: (r) => overdue(r.over),
    },
    number('cps', 210),
    ...(tasks ? [number('tasks', 136)] : []),
  ];
}

/** Список сотрудников за период (прототип: сетка `home-act`). */
function ActivityGrid({
  t,
  p,
  tasks,
  onDays,
  onCard,
}: {
  t: Translate;
  p: ActivityPeriod;
  tasks: boolean;
  onDays: (r: ActivityRow) => void;
  onCard?: (r: ActivityRow) => void;
}) {
  const { search, clearSearch, access } = useShell();
  const labels = useGridLabels('staff.count');
  const columns = useMemo(() => activityColumns(t, tasks), [t, tasks]);
  const view = useViewSettings(GRID_KEY);
  const extra = useMemo(() => ({ k: p.k, off: String(p.off) }), [p.k, p.off]);
  const fetchPage = useCallback<FetchListPage<ActivityRow>>(async (params) => {
    const res = await api.api.home.activity.$get({
      query: params as Record<string, string> & { k: ActivityKind; off: string },
    });
    if (!res.ok) throw await apiFailure(res);
    return ActivityList.parse(await res.json());
  }, []);
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.home.activity.values.$get({
        query: q ? { col, q, ...extra } : { col, ...extra },
      });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [extra],
  );
  const list = useListPage({
    gridKey: GRID_KEY,
    columns,
    audit: false,
    defaultVisible: ACTIVITY_VISIBLE,
    settings: view.settings,
    defaultSort: ACTIVITY_SORT,
    search,
    enabled: view.ready,
    fetchPage,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.home.activity.export.$get({
        query: { ...params, ...extra, cols: visible.join(',') },
      }),
    [params, visible, extra],
  );
  const exporter = useListExport(sendExport);
  const actions = (r: ActivityRow): ActionEntry[] => [
    { id: 'days', label: t('home.act.by_days'), icon: 'chart', run: () => onDays(r) },
    ...(onCard
      ? [{ id: 'card', label: t('home.act.card'), icon: 'user' as const, run: () => onCard(r) }]
      : []),
  ];
  return (
    <div data-home-activity-list="">
      <DataGrid
        columns={columns}
        defaultVisible={ACTIVITY_VISIBLE}
        defaultSort={ACTIVITY_SORT}
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
        empty={<EmptyState icon="users" title={t('home.act.empty')} />}
        rowKey={(r) => r.id}
        rowTone={(r) => (r.active ? undefined : 'muted')}
        titleKey="fio"
        label={t('tab.home.act')}
        labels={labels}
        actions={actions}
        onOpen={onDays}
      />
    </div>
  );
}

type EmployeeTab = 'days' | 'cps';

/** Плашки окна сотрудника (прототип `actEmpDlg`). */
function EmployeePlates({ t, v }: { t: Translate; v: ActivityEmployee }) {
  return (
    <Plates>
      <Plate
        id="d1"
        icon="clock"
        color={v.last ? 'green' : 'yellow'}
        label={t('home.act.dlg.last')}
        value={v.last ? formatDateRu(v.last.slice(0, 10)) : '—'}
        sub={v.last ? v.last.slice(11) : t('home.act.dlg.last_none')}
      />
      <Plate
        id="d2"
        icon="key"
        color="blue"
        label={t('home.act.dlg.in')}
        value={String(v.in)}
        sub={t('home.act.dlg.in_sub', { n: v.out })}
      />
      <Plate
        id="d3"
        icon="chart"
        color="purple"
        label={t('home.act.dlg.n')}
        value={formatCount(v.n)}
        sub={t('home.act.dlg.n_sub', { n: v.days.length })}
      />
      <Plate
        id="d4"
        icon="send"
        color="green"
        label={t('home.act.dlg.sub_plate')}
        value={String(v.sub)}
        sub={t('home.act.dlg.sub_due', { n: v.due })}
      />
      <Plate
        id="d5"
        icon="building"
        color="blue"
        label={t('home.act.dlg.cps')}
        value={String(v.cps)}
        sub={v.over ? t('home.act.dlg.cps_over', { n: v.over }) : t('home.act.dlg.cps_ok')}
      />
    </Plates>
  );
}

/** «По дням» (прототип: сетка `home-act-d`): от последнего дня к первому. */
function DaysTable({ t, v }: { t: Translate; v: ActivityEmployee }) {
  const rows: MiniRow[] = v.days.map((d) => ({
    key: d.day,
    cells: {
      day: (
        <>
          <span className="font-semibold">{formatDateRu(d.day)}</span>{' '}
          <Faint>{t(`pdicts.cal.dow.${weekdayMondayFirst(d.day) as Dow}`).slice(0, 2)}</Faint>
        </>
      ),
      first: d.first ?? '',
      last: d.last,
      in: num(d.in),
      out: num(d.out),
      n: num(d.n),
      sub: num(d.sub),
    },
    blank: d.first ? [] : ['first'],
  }));
  return (
    <MiniTable
      label={t('home.act.dlg.tab.days')}
      empty={t('home.act.dlg.days_empty')}
      columns={[
        { key: 'day', label: t('home.act.dlg.day'), width: 130 },
        { key: 'first', label: t('home.act.dlg.first'), width: 120 },
        { key: 'last', label: t('home.act.col.last'), width: 170 },
        { key: 'in', label: t('home.act.col.in'), numeric: true, width: 90 },
        { key: 'out', label: t('home.act.col.out'), numeric: true, width: 96 },
        { key: 'n', label: t('home.act.col.n'), numeric: true, width: 100 },
        { key: 'sub', label: t('home.act.col.sub'), numeric: true, width: 126 },
      ]}
      rows={rows}
    />
  );
}

/** «По контрагентам» (прототип: сетка `home-act-c`): строка открывает карточку контрагента. */
function ContractorsTable({ t, v }: { t: Translate; v: ActivityEmployee }) {
  const rows: MiniRow[] = v.contractors.map((c) => ({
    key: c.id,
    cells: {
      name: <span className="font-semibold">{c.name}</span>,
      sub: num(c.sub),
      due: num(c.due),
      open: num(c.open),
      over: overdue(c.over),
      act: num(c.act),
    },
  }));
  // Контрагенты, которых смотрящему видеть не положено, — одной строкой без названий (п. О-71).
  if (v.others)
    rows.push({
      key: 'others',
      total: true,
      cells: {
        name: t('home.act.dlg.cp_others', { n: v.others.count }),
        sub: num(v.others.sub),
        due: num(v.others.due),
        open: num(v.others.open),
        over: overdue(v.others.over),
        act: num(v.others.act),
      },
    });
  return (
    <MiniTable
      label={t('home.act.dlg.tab.cps')}
      empty={t('home.act.dlg.cps_empty')}
      columns={[
        { key: 'name', label: t('home.act.dlg.cp'), width: 260 },
        { key: 'sub', label: t('home.act.col.sub'), numeric: true, width: 126 },
        { key: 'due', label: t('home.act.dlg.cp_due'), numeric: true, width: 170 },
        { key: 'open', label: t('home.act.dlg.cp_open'), numeric: true, width: 100 },
        { key: 'over', label: t('home.act.col.over'), numeric: true, width: 146 },
        { key: 'act', label: t('home.act.dlg.cp_act'), numeric: true, width: 190 },
      ]}
      rows={rows}
      onOpen={v.contractors.length ? (id) => openContractorCard({ id }) : undefined}
    />
  );
}

/**
 * Окно сотрудника «Активность по дням» (прототип `actEmpDlg`): свой выбор периода (начинается с периода
 * списка), плашки и вкладки «По дням» и «По контрагентам».
 */
function EmployeeActivity({
  t,
  employee,
  period,
  today,
  open,
  onClose,
}: {
  t: Translate;
  employee: { id: string; name: string };
  period: ActivityPeriod;
  today: IsoDate;
  open: boolean;
  onClose: () => void;
}) {
  const [p, setP] = useState(period);
  const [tab, setTab] = useState<EmployeeTab>('days');
  const query = useQuery({
    ...activityEmployeeQuery(employee.id, p),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const v = query.data;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={v?.name ?? employee.name}
      sub={t('home.act.dlg.sub', { period: periodLabel(t, p, today) })}
      tabs={{
        items: [
          {
            id: 'days',
            label: t('home.act.dlg.tab.days'),
            icon: 'calendar',
            ...(v ? { count: { value: v.days.length } } : {}),
          },
          {
            id: 'cps',
            label: t('home.act.dlg.tab.cps'),
            icon: 'building',
            ...(v ? { count: { value: v.contractors.length + (v.others?.count ?? 0) } } : {}),
          },
        ],
        active: tab,
        onSelect: (next) => setTab(next as EmployeeTab),
        label: t('home.act.by_days'),
      }}
      footer={
        <button type="button" className={buttonClass()} onClick={onClose}>
          {t('btn.close')}
        </button>
      }
    >
      <div data-activity-employee={employee.id} className="flex flex-col gap-3.5">
        <PeriodBar t={t} p={p} today={today} onChange={setP} />
        {query.isError && !v ? <Note tone="bad">{t('home.act.load_error')}</Note> : null}
        {v ? (
          <>
            <EmployeePlates t={t} v={v} />
            {tab === 'days' ? <DaysTable t={t} v={v} /> : <ContractorsTable t={t} v={v} />}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * «Главная» → «Активность» (прототип v84, modules/activity.js, `renderHomeAct`; docs/deviations.md
 * п. О-71): кто из сотрудников и сколько работал в программе за день, неделю, месяц или год — входы и
 * выходы, действия, сданные отчёты, контрагенты в ответственности и выполненные задачи. Вкладку видит
 * роль с правом «Смотреть аналитику по сотрудникам». Строка открывает окно сотрудника с днями и
 * контрагентами.
 */
export function HomeActivityTab() {
  const t = useT();
  const { access } = useShell();
  const stats = useModuleStats('home');
  const client = useQueryClient();
  const staff = useStaffActions();
  const [p, setP] = useState<ActivityPeriod>(() => chosen ?? ACTIVITY_DEFAULT);
  const [employee, setEmployee] = useState<DialogSlot<{
    id: string;
    name: string;
    period: ActivityPeriod;
  }> | null>(null);
  const choose = (next: ActivityPeriod) => {
    chosen = next;
    setP(next);
  };
  const overview = useQuery({ ...activityOverviewQuery(p), placeholderData: keepPreviousData });
  useHomeRefreshOnSave();
  const v = overview.data;
  // «Сегодня» — по ответу сервера; пока ответа нет — по часам устройства.
  const today = v?.today ?? bishkekDate(new Date());

  const openDays = (r: ActivityRow) => setEmployee(openSlot({ id: r.id, name: r.name, period: p }));
  /** «Карточка сотрудника» — с правом «Просматривать сотрудников» (прототип `can('staffView')`). */
  const openCard = access.can('staffView')
    ? (r: ActivityRow) => void client.fetchQuery(employeeQuery(r.id)).then(staff.openCard)
    : undefined;

  return (
    <div data-home-activity="" className="flex flex-col gap-3.5">
      <PeriodBar t={t} p={p} today={today} note={t('home.act.note')} onChange={choose} />
      {overview.isError && !v ? (
        <Note tone="bad" icon="alert">
          {t('home.act.load_error')}{' '}
          <button
            type="button"
            className={linkButtonClass()}
            onClick={() => void overview.refetch()}
          >
            {t('grid.retry')}
          </button>
        </Note>
      ) : null}
      {v ? (
        <>
          <ActivityPlates t={t} v={v} shown={stats.shown} />
          {v.k === 'd' ? null : (
            <Box title={t(v.k === 'y' ? 'home.act.chart.months' : 'home.act.chart.days')}>
              <ActivityChart t={t} k={v.k} buckets={v.buckets} />
            </Box>
          )}
        </>
      ) : (
        <div data-home-loading="" className="min-h-[120px]" aria-busy="true" />
      )}
      <ActivityGrid
        t={t}
        p={p}
        tasks={access.feature('tasks')}
        onDays={openDays}
        onCard={openCard}
      />
      {employee ? (
        <EmployeeActivity
          key={`activity-${employee.n}`}
          t={t}
          employee={employee.data}
          period={employee.data.period}
          today={today}
          open={employee.open}
          onClose={() => setEmployee(closeSlot)}
        />
      ) : null}
      {staff.dialogs}
    </div>
  );
}
