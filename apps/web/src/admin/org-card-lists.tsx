'use client';

import {
  ACCOUNT_LOCK_FAILURES,
  formatCount,
  formatDateRu,
  formatMomentRu,
  formatSom,
  monthLabel,
  pluralForm,
  type AccountCardState,
  type GridViewSettings,
  type ListPageSize,
  type ListSort,
  type UiTextKey,
  type YearMonth,
} from '@buhuchet/domain';
import {
  ADMIN_ORG_CONTRACTOR_COLUMNS,
  AdminOrgContractorList,
  AdminOrgRepMonthList,
  AdminOrgReport,
  AdminOrgStaffList,
  ListValues,
  ReportList,
  type AdminOrgCard,
  type AdminOrgContractorRow,
  type AdminOrgRepMonthRow,
  type AdminOrgReportPlate,
  type AdminOrgStaffRow,
  type ReportRow,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  DataGrid,
  EmptyState,
  Fold,
  Hint,
  Icon,
  inputClass,
  KeyValues,
  Modal,
  MONO_CLASS,
  Note,
  PHONE_QUERY,
  Pill,
  Plate,
  Plates,
  StatusHistory,
  useMediaQuery,
  type GridColumn,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { storageFileDownloadHref, storageFileViewSrc } from '../afiles/afiles-data';
import { api, apiFailure } from '../api-client';
import { contractorTone, ServiceCell } from '../contractors/contractor-columns';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FileViewer } from '../files/file-viewer';
import { fileSizeText } from '../files/files-data';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { reportColumns, reportShortCard, reportTone } from '../reports/report-columns';
import { historyLabels, historyView, statusEvents, statusName } from '../status/status-view';
import { ORG_CARD_KEY } from './org-actions';

// Списки карточки организации — общий список с сервера (доработки 20.11.2026, пакет 2, блок 1,
// пункты 2–5; прототип v150 admin-cards.js ocGrids, ocRep, ocRepWin): страницы, сортировка, фильтры и
// «В Excel» — как у списков модулей, только просмотр. Столбцы и подписи — как в прототипе.

const CARD_PAGE_SIZE: ListPageSize = 50;
const DASH = <span className="text-faint">—</span>;
const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

/** Ответ сервера с ошибкой — исключение для `useQuery` и списка. */
async function ok<T>(res: Response, parse: (body: unknown) => T): Promise<T> {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
}

/**
 * Вид списка карточки (прототип acGrid): без служебных столбцов и общего поиска, страницами по 50
 * (ТЗ «Доработки 20.11.2026, пакет 2», блок 1, пункты 2 и 5), пока пользователь не выбрал другой размер.
 */
export function useCardList<Row>(o: {
  gridKey:
    'orgs.card.staff' | 'orgs.card.cps' | 'orgs.card.rep' | 'orgs.card.repm' | 'orgs.card.files';
  columns: readonly GridColumn<Row>[];
  defaultVisible: readonly string[];
  defaultSort: ListSort;
  /** Вид, пока пользователь его не настроил (прототип `defGroup`); постоянный объект модуля. */
  defaultView?: GridViewSettings;
  fetchPage: FetchListPage<Row>;
  sendExport: (query: Record<string, string>) => Promise<Response>;
  search?: string;
  searchAlso?: readonly string[];
  extra?: Readonly<Record<string, string>>;
}) {
  const view = useViewSettings(o.gridKey);
  const { defaultView } = o;
  const settings = useMemo(() => {
    const base = Object.keys(view.settings).length ? view.settings : { ...defaultView };
    return base.size ? base : { ...base, size: CARD_PAGE_SIZE };
  }, [view.settings, defaultView]);
  const list = useListPage({
    gridKey: o.gridKey,
    columns: o.columns,
    audit: false,
    defaultVisible: o.defaultVisible,
    settings,
    defaultSort: o.defaultSort,
    search: o.search ?? '',
    enabled: view.ready,
    fetchPage: o.fetchPage,
    ...(o.extra ? { extra: o.extra } : {}),
    ...(o.searchAlso ? { searchAlso: o.searchAlso } : {}),
  });
  const { params, visible } = list;
  const { sendExport } = o;
  const send = useCallback(
    () => sendExport({ ...params, cols: visible.join(',') }),
    [sendExport, params, visible],
  );
  const exporter = useListExport(send);
  return {
    columns: o.columns,
    defaultVisible: o.defaultVisible,
    defaultSort: o.defaultSort,
    settings,
    onSettingsChange: view.save,
    onResetView: () => void view.reset(),
    data: view.ready ? list.data : undefined,
    onPageChange: list.setPage,
    error: list.error,
    errorText: list.errorText,
    errorTextOf: list.errorTextOf,
    onRetry: list.retry,
    filters: list.filters,
    onFiltersChange: list.setFilters,
    onExport: () => void exporter.run(),
    exporting: exporter.exporting,
  };
}

/* ── «Сотрудники» ── */

const STAFF_SORT: ListSort = { key: 'fullName', dir: 'asc' };
const STAFF_VISIBLE = ['fullName', 'login', 'role', 'tg', 'lastLoginAt', 'state'];

/** Столбцы «Сотрудников» карточки (прототип ocGrids, oc-staff): ключи — как на сервере. */
function staffColumns(t: Translate): GridColumn<AdminOrgStaffRow>[] {
  const state = (s: AccountCardState) =>
    t(`accounts.card.state.${s}`, { n: ACCOUNT_LOCK_FAILURES });
  const states = (u: AdminOrgStaffRow) => u.states.map(state).join(', ');
  return [
    {
      key: 'fullName',
      label: t('orgs.card.staff.col.name'),
      type: 'text',
      width: 240,
      text: (u) => u.fullName,
      cell: (u) => <span className="font-semibold">{u.fullName}</span>,
    },
    {
      key: 'login',
      label: t('orgs.card.staff.col.login'),
      type: 'text',
      width: 140,
      text: (u) => u.login,
      className: MONO_CLASS,
    },
    {
      key: 'role',
      label: t('orgs.card.staff.col.role'),
      type: 'enum',
      width: 190,
      text: (u) => u.role,
    },
    {
      key: 'tg',
      label: t('orgs.card.staff.col.tg'),
      type: 'enum',
      width: 150,
      text: (u) => t(u.telegram ? 'orgs.card.staff.tg_on' : 'orgs.card.staff.tg_off'),
    },
    {
      key: 'lastLoginAt',
      label: t('orgs.card.staff.col.last'),
      type: 'datetime',
      width: 150,
      text: (u) => (u.lastLoginAt ? moment(u.lastLoginAt) : t('orgs.card.staff.never')),
    },
    { key: 'state', label: t('orgs.card.staff.col.state'), type: 'enum', width: 220, text: states },
  ];
}

/** «Сотрудники» (прототип ocGrids, oc-staff): строка открывает карточку пользователя. */
export function OrgStaffTab({
  t,
  orgId,
  onUser,
}: {
  t: Translate;
  orgId: string;
  onUser: (userId: string) => void;
}) {
  const labels = useGridLabels('staff.count');
  const columns = useMemo(() => staffColumns(t), [t]);
  const staff = api.api.admin.organizations[':id'].staff;
  const fetchPage = useCallback<FetchListPage<AdminOrgStaffRow>>(
    async (query) =>
      ok(await staff.$get({ param: { id: orgId }, query }), (b) => AdminOrgStaffList.parse(b)),
    [staff, orgId],
  );
  const loadValues = useCallback(
    async (col: string, q?: string) =>
      ok(await staff.values.$get({ param: { id: orgId }, query: q ? { col, q } : { col } }), (b) =>
        ListValues.parse(b),
      ),
    [staff, orgId],
  );
  const sendExport = useCallback(
    (query: Record<string, string>) =>
      staff.export.$get({ param: { id: orgId }, query: query as { cols: string } }),
    [staff, orgId],
  );
  const grid = useCardList({
    gridKey: 'orgs.card.staff',
    columns,
    defaultVisible: STAFF_VISIBLE,
    defaultSort: STAFF_SORT,
    fetchPage,
    sendExport,
  });
  return (
    <div data-org-staff="">
      <DataGrid
        {...grid}
        loadValues={loadValues}
        empty={<EmptyState icon="users" title={t('orgs.card.empty')} />}
        rowKey={(u) => u.userId}
        titleKey="fullName"
        label={t('orgs.card.tab.staff')}
        labels={labels}
        onOpen={(u) => onUser(u.userId)}
      />
    </div>
  );
}

/* ── «Контрагенты» ── */

const CPS_SORT: ListSort = { key: 'name', dir: 'asc' };
const CPS_KEYS = [...ADMIN_ORG_CONTRACTOR_COLUMNS];

/**
 * Столбцы прототипа ocGrids, oc-cps — ключи общего списка контрагентов, подписи карточки. Строка — только
 * поля этих столбцов (телефоны, договоры и контактные лица клиентов фирмы Админке не отдаются).
 */
function cpsColumns(t: Translate): GridColumn<AdminOrgContractorRow>[] {
  return [
    {
      key: 'name',
      label: t('orgs.card.cps.col.name'),
      type: 'text',
      width: 250,
      text: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="font-semibold">{r.name}</span>
          {!r.responsible && r.serviceStatus !== 'archived' ? (
            <Pill tone="caution" size="sm" icon="alert">
              {t('cp.no_responsible')}
            </Pill>
          ) : null}
        </span>
      ),
    },
    {
      key: 'inn',
      label: t('orgs.card.cps.col.inn'),
      type: 'text',
      width: 150,
      className: MONO_CLASS,
      text: (r) => r.inn,
    },
    {
      key: 'form',
      label: t('orgs.card.cps.col.form'),
      type: 'enum',
      width: 100,
      text: (r) => r.form,
    },
    {
      key: 'regime',
      label: t('orgs.card.cps.col.regime'),
      type: 'enum',
      width: 130,
      text: (r) => r.regime ?? '',
    },
    {
      key: 'responsible',
      label: t('orgs.card.cps.col.responsible'),
      type: 'enum',
      width: 170,
      text: (r) => r.responsible?.shortName ?? '',
    },
    {
      key: 'kind',
      label: t('orgs.card.cps.col.kind'),
      type: 'enum',
      width: 120,
      text: (r) => t(r.kind === 'oneoff' ? 'cp.kind.oneoff' : 'cp.kind.regular'),
    },
    {
      key: 'fee',
      label: t('orgs.card.cps.col.fee'),
      type: 'money',
      width: 160,
      text: (r) => (r.tariff ? formatSom(r.tariff.amount) : ''),
      cell: (r) =>
        r.tariff ? (
          <span>
            {formatSom(r.tariff.amount)}{' '}
            <span className="text-faint">
              {t(r.tariff.period === 'Y' ? 'cp.list.per_year' : 'cp.list.per_month')}
            </span>
          </span>
        ) : (
          DASH
        ),
    },
    {
      key: 'service',
      label: t('orgs.card.cps.col.state'),
      type: 'enum',
      width: 170,
      text: (r) => t(`status.service.${r.serviceStatus}`),
      cell: (r) => <ServiceCell t={t} r={r} />,
    },
  ];
}

/** «Контрагенты» (прототип ocGrids, oc-cps): все контрагенты организации вместе с архивом. */
export function OrgContractorsTab({ t, orgId }: { t: Translate; orgId: string }) {
  const labels = useGridLabels('cp.count');
  const columns = useMemo(() => cpsColumns(t), [t]);
  const cps = api.api.admin.organizations[':id'].contractors;
  const fetchPage = useCallback<FetchListPage<AdminOrgContractorRow>>(
    async (query) =>
      ok(await cps.$get({ param: { id: orgId }, query }), (b) => AdminOrgContractorList.parse(b)),
    [cps, orgId],
  );
  const loadValues = useCallback(
    async (col: string, q?: string) =>
      ok(await cps.values.$get({ param: { id: orgId }, query: q ? { col, q } : { col } }), (b) =>
        ListValues.parse(b),
      ),
    [cps, orgId],
  );
  const sendExport = useCallback(
    (query: Record<string, string>) =>
      cps.export.$get({ param: { id: orgId }, query: query as { cols: string } }),
    [cps, orgId],
  );
  const grid = useCardList({
    gridKey: 'orgs.card.cps',
    columns,
    defaultVisible: CPS_KEYS,
    defaultSort: CPS_SORT,
    fetchPage,
    sendExport,
  });
  return (
    <div data-org-contractors="" className="flex flex-col gap-2.5">
      <DataGrid
        {...grid}
        loadValues={loadValues}
        empty={<EmptyState icon="building" title={t('orgs.card.empty')} />}
        rowKey={(r) => r.id}
        titleKey="name"
        rowTone={contractorTone}
        label={t('orgs.card.tab.cps')}
        labels={labels}
      />
      <Hint>{t('orgs.card.cps.hint')}</Hint>
    </div>
  );
}

/* ── «Отчёты» ── */

export type OrgReportPlate = AdminOrgReportPlate['plate'];

/** Плитки-фильтры (прототип OC_RFT): значок, цвет, подпись, пояснение. */
const PLATES: readonly {
  id: OrgReportPlate;
  icon: 'file' | 'clock' | 'check' | 'alert' | 'list';
  color: 'yellow' | 'purple' | 'green' | 'red' | 'blue';
  sub?: UiTextKey;
}[] = [
  { id: 'due', icon: 'file', color: 'yellow', sub: 'orgs.card.rep.plate.due_sub' },
  { id: 'work', icon: 'clock', color: 'purple' },
  { id: 'done', icon: 'check', color: 'green' },
  { id: 'over', icon: 'alert', color: 'red', sub: 'orgs.card.rep.plate.over_sub' },
  { id: 'all', icon: 'list', color: 'blue' },
];

/** Что запомнила вкладка, пока открыта карточка (прототип `st.rf`, `st.rq`, `st.rmo`). */
export interface OrgReportsView {
  plate: OrgReportPlate;
  q: string;
  months: boolean;
}
export const ORG_REPORTS_VIEW: OrgReportsView = { plate: 'due', q: '', months: false };

const REP_SORT: ListSort = { key: 'due', dir: 'asc' };
/** Столбцы прототипа OC_REPCOLS (ключи — как у общего списка отчётов); «ИНН» и «Месяц срока» скрыты. */
const REP_KEYS = [
  'cp',
  'inn',
  'type',
  'period',
  'dueMonth',
  'due',
  'status',
  'responsible',
  'amount',
  'paid',
];
const REP_HIDDEN = new Set(['inn', 'dueMonth']);
const REP_LABELS: Readonly<Record<string, UiTextKey>> = {
  cp: 'orgs.card.rep.col.contractor',
  inn: 'orgs.card.cps.col.inn',
  type: 'orgs.card.rep.col.report',
  period: 'orgs.card.rep.col.period',
  dueMonth: 'orgs.card.rep.col.month',
  due: 'orgs.card.rep.col.due',
  status: 'orgs.card.rep.col.status',
  responsible: 'orgs.card.rep.col.responsible',
  amount: 'orgs.card.money.col.sum',
  paid: 'orgs.card.money.col.paid',
};
/** Поиск прототипа (ocRepQ): контрагент, ИНН, отчёт, период — и когда столбец скрыт. */
const REP_SEARCH = ['cp', 'inn', 'type', 'period'];

function repColumns(
  t: Translate,
  o: { phone: boolean; confirm: boolean; taxpay: boolean },
): GridColumn<ReportRow>[] {
  const dueMonth: GridColumn<ReportRow> = {
    key: 'dueMonth',
    label: '',
    type: 'enum',
    width: 150,
    text: (r) => monthLabel(r.dueDate.slice(0, 7) as YearMonth),
  };
  const all = [
    ...reportColumns(t, {
      waiting: false,
      confirm: o.confirm,
      waitDays: 3,
      phone: o.phone,
      taxpay: o.taxpay,
      onReceive: null,
    }),
    dueMonth,
  ];
  return REP_KEYS.flatMap((key) => {
    const c = all.find((x) => x.key === key);
    return c ? [{ ...c, label: t(REP_LABELS[key]!) }] : [];
  });
}

/**
 * «Отчёты» (прототип v150 ocRep): свёрнутый блок «По месяцам и видам отчётов», плитки-фильтры, своё
 * поле поиска и список всех отчётов организации; строка открывает окно «Отчёт» только для просмотра.
 */
export function OrgReportsTab({
  t,
  orgId,
  orgName,
  reports,
  view,
  onView,
}: {
  t: Translate;
  orgId: string;
  orgName: string;
  reports: AdminOrgCard['reports'];
  view: OrgReportsView;
  onView: (view: OrgReportsView) => void;
}) {
  const [win, setWin] = useState<{ n: number; open: boolean; row: ReportRow } | null>(null);
  if (!reports.plates.all) {
    return (
      <div data-org-reports-empty="">
        <EmptyState
          icon="file"
          title={t('orgs.card.rep.none')}
          text={t('orgs.card.rep.none_text', {
            cps: t(`cp.count.${pluralForm(reports.contractors)}`, { n: reports.contractors }),
            n: reports.assigned,
          })}
        />
      </div>
    );
  }
  return (
    <>
      <Fold
        box
        title={t('orgs.card.rep.by_month')}
        open={view.months}
        onToggle={(months) => onView({ ...view, months })}
        data-org-rep-months=""
      >
        {view.months ? <ByMonth t={t} orgId={orgId} /> : null}
      </Fold>
      <div data-org-rep-plates="">
        <Plates>
          {PLATES.map((p) => {
            const n = reports.plates[p.id];
            return (
              <Plate
                key={p.id}
                id={p.id}
                icon={p.icon}
                color={p.id === 'over' && !n ? 'green' : p.color}
                label={t(`orgs.card.rep.plate.${p.id}`)}
                value={formatCount(n)}
                {...(p.sub ? { sub: t(p.sub) } : {})}
                on={view.plate === p.id}
                onClick={() => onView({ ...view, plate: p.id })}
              />
            );
          })}
        </Plates>
      </div>
      <ReportsGrid
        t={t}
        orgId={orgId}
        reports={reports}
        view={view}
        onView={onView}
        onOpen={(row) => setWin((prev) => ({ n: (prev?.n ?? 0) + 1, open: true, row }))}
      />
      <Hint>{t('orgs.card.rep.hint')}</Hint>
      {win ? (
        <OrgReportWindow
          key={`org-rep-${win.n}`}
          t={t}
          orgId={orgId}
          orgName={orgName}
          row={win.row}
          open={win.open}
          onClose={() => setWin((prev) => prev && { ...prev, open: false })}
        />
      ) : null}
    </>
  );
}

/** «По месяцам и видам отчётов»: 6 прошлых месяцев, текущий и 3 следующих. */
const MONTHS_SORT: ListSort = { key: 'm', dir: 'desc' };
const MONTHS_KEYS = ['m', 't', 'n', 'done', 'over'];
/** По месяцам срока (прототип `defGroup:['m']`). */
// Страница по 25, как acGrid прототипа без size (grid.js gst: cfg.size || 25).
const MONTHS_VIEW: GridViewSettings = { group: ['m'], size: 25 };

/** Столбцы «По месяцам и видам отчётов» (прототип ocGrids, oc-rep): ключи — как на сервере. */
function monthColumns(t: Translate): GridColumn<AdminOrgRepMonthRow>[] {
  const count = (key: 'n' | 'done' | 'over', label: UiTextKey, width: number) =>
    ({
      key,
      label: t(label),
      type: 'int',
      width,
      text: (r: AdminOrgRepMonthRow) => formatCount(r[key]),
    }) satisfies GridColumn<AdminOrgRepMonthRow>;
  return [
    {
      key: 'm',
      label: t('orgs.card.rep.col.month'),
      type: 'enum',
      width: 160,
      text: (r) => monthLabel(r.m as YearMonth),
    },
    { key: 't', label: t('orgs.card.rep.col.type'), type: 'enum', width: 240, text: (r) => r.t },
    count('n', 'orgs.card.rep.col.total', 100),
    count('done', 'orgs.card.rep.col.done', 100),
    count('over', 'orgs.card.rep.col.overdue', 120),
  ];
}

/** «По месяцам и видам отчётов»: 6 прошлых месяцев, текущий и 3 следующих — общий список по месяцам. */
function ByMonth({ t, orgId }: { t: Translate; orgId: string }) {
  const labels = useGridLabels('orgs.card.repm.count');
  const columns = useMemo(() => monthColumns(t), [t]);
  const months = api.api.admin.organizations[':id'].reports.months;
  const fetchPage = useCallback<FetchListPage<AdminOrgRepMonthRow>>(
    async (query) =>
      ok(await months.$get({ param: { id: orgId }, query }), (b) => AdminOrgRepMonthList.parse(b)),
    [months, orgId],
  );
  const loadValues = useCallback(
    async (col: string, q?: string) =>
      ok(await months.values.$get({ param: { id: orgId }, query: q ? { col, q } : { col } }), (b) =>
        ListValues.parse(b),
      ),
    [months, orgId],
  );
  const sendExport = useCallback(
    (query: Record<string, string>) =>
      months.export.$get({ param: { id: orgId }, query: query as { cols: string } }),
    [months, orgId],
  );
  const grid = useCardList({
    gridKey: 'orgs.card.repm',
    columns,
    defaultVisible: MONTHS_KEYS,
    defaultSort: MONTHS_SORT,
    defaultView: MONTHS_VIEW,
    fetchPage,
    sendExport,
  });
  return (
    <div data-org-reports="" className="pt-1.5">
      <DataGrid
        {...grid}
        loadValues={loadValues}
        empty={<EmptyState icon="file" title={t('orgs.card.empty')} />}
        rowKey={(r) => `${r.m}|${r.t}`}
        titleKey="t"
        label={t('orgs.card.rep.months')}
        labels={labels}
      />
    </div>
  );
}

function ReportsGrid({
  t,
  orgId,
  reports,
  view,
  onView,
  onOpen,
}: {
  t: Translate;
  orgId: string;
  reports: AdminOrgCard['reports'];
  view: OrgReportsView;
  onView: (view: OrgReportsView) => void;
  onOpen: (row: ReportRow) => void;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const labels = useGridLabels('report.count');
  const { confirm, taxpay } = reports;
  const columns = useMemo(
    () => repColumns(t, { phone, confirm, taxpay }),
    [t, phone, confirm, taxpay],
  );
  const defaultVisible = useMemo(
    () => REP_KEYS.filter((k) => !REP_HIDDEN.has(k) && columns.some((c) => c.key === k)),
    [columns],
  );
  const rep = api.api.admin.organizations[':id'].reports;
  const plate = view.plate;
  const fetchPage = useCallback<FetchListPage<ReportRow>>(
    async (query) =>
      ok(await rep.$get({ param: { id: orgId }, query }), (b) => ReportList.parse(b)),
    [rep, orgId],
  );
  const loadValues = useCallback(
    async (col: string, q?: string) =>
      ok(
        await rep.values.$get({
          param: { id: orgId },
          query: { col, plate, ...(q ? { q } : {}) },
        }),
        (b) => ListValues.parse(b),
      ),
    [rep, orgId, plate],
  );
  const sendExport = useCallback(
    (query: Record<string, string>) =>
      rep.export.$get({ param: { id: orgId }, query: query as { cols: string } }),
    [rep, orgId],
  );
  const extra = useMemo(() => ({ plate }), [plate]);
  const grid = useCardList({
    gridKey: 'orgs.card.rep',
    columns,
    defaultVisible,
    defaultSort: REP_SORT,
    fetchPage,
    sendExport,
    search: view.q,
    searchAlso: REP_SEARCH,
    extra,
  });
  const searchId = useId();
  const shortCard = useMemo(() => reportShortCard(t, { confirm }), [t, confirm]);
  return (
    <div data-org-rep-list="" className="flex flex-col gap-2.5">
      {/* ОТКЛОНЕНИЕ: docs/deviations.md#47 — своё поле: общий поиск под окном недоступен. */}
      <label htmlFor={searchId} className="relative flex items-center">
        <Icon
          name="search"
          size="sm"
          className="pointer-events-none absolute left-2.5 text-faint"
        />
        <input
          id={searchId}
          type="search"
          data-org-rep-search=""
          className={`${inputClass()} pl-8`}
          value={view.q}
          placeholder={t('orgs.card.rep.search')}
          aria-label={t('orgs.card.rep.search_label')}
          onChange={(e) => onView({ ...view, q: e.target.value })}
        />
      </label>
      <DataGrid
        {...grid}
        loadValues={loadValues}
        search={view.q.trim()}
        onClearSearch={() => onView({ ...view, q: '' })}
        empty={<EmptyState icon="file" title={t('grid.empty')} />}
        rowKey={(r) => r.id}
        titleKey="cp"
        rowTone={reportTone}
        phoneCard={shortCard}
        label={t('orgs.card.tab.rep')}
        labels={labels}
        onOpen={onOpen}
      />
    </div>
  );
}

/* ── Окно «Отчёт» ── */

/**
 * Окно «Отчёт» карточки организации (прототип v150 ocRepWin): только просмотр — поля отчёта, «Суммы»,
 * «История статусов» и файлы отчёта; кнопок смены статуса нет. Файл отчёта открывается окном просмотра
 * администратора (`/api/admin/files/file/{id}/link`, «Скачать» — `…/download`), как в «Файлах» Админки.
 */
function OrgReportWindow({
  t,
  orgId,
  orgName,
  row,
  open,
  onClose,
}: {
  t: Translate;
  orgId: string;
  orgName: string;
  row: ReportRow;
  open: boolean;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: [...ORG_CARD_KEY, orgId, 'report', row.id],
    queryFn: async () =>
      ok(
        await api.api.admin.organizations[':id'].reports[':reportId'].$get({
          param: { id: orgId, reportId: row.id },
        }),
        (b) => AdminOrgReport.parse(b),
      ),
    staleTime: 0,
    gcTime: 0,
  });
  const r = query.data ?? row;
  const [viewer, setViewer] = useState<DialogSlot<number> | null>(null);
  const files = (query.data?.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    size: f.bytes,
    contentType: f.contentType,
  }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={`${r.type.shortName} · ${r.periodLabel}`}
      sub={`${r.contractor.name} · ${orgName}`}
      footer={
        <>
          <Hint>{t('orgs.card.rep.win.readonly')}</Hint>
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-org-report={row.id} className="flex flex-col gap-3">
        <Box>
          <KeyValues items={reportFields(t, r)} />
        </Box>
        {r.act !== 'sub' ? (
          <Box title={t('orgs.card.rep.win.sums')}>
            <div data-org-report-sums="">
              <KeyValues items={sumFields(t, r)} />
            </div>
          </Box>
        ) : null}
        {query.isError ? <Note tone="bad">{t('orgs.card.rep.win.error')}</Note> : null}
        {query.data ? (
          <Details t={t} report={query.data} onOpen={(i) => setViewer(openSlot(i))} />
        ) : null}
      </div>
      {viewer && files.length ? (
        <FileViewer
          key={`org-report-file-${viewer.n}`}
          files={files}
          index={viewer.data}
          open={viewer.open}
          onClose={() => setViewer(closeSlot)}
          src={(id) => storageFileViewSrc({ kind: 'file', id })}
          download={(id) => storageFileDownloadHref({ kind: 'file', id })}
          sub={() => `${r.type.shortName} · ${r.periodLabel} · ${r.contractor.name}`}
        />
      ) : null}
    </Modal>
  );
}

function reportFields(t: Translate, r: ReportRow): KeyValueItem[] {
  return [
    { id: 'cp', label: t('report.col.cp'), value: r.contractor.name },
    { id: 'inn', label: t('report.col.inn'), value: r.contractor.inn, mono: true },
    { id: 'type', label: t('report.col.type'), value: r.type.name },
    { id: 'period', label: t('report.col.period'), value: r.periodFull || r.periodLabel },
    { id: 'due', label: t('report.col.due'), value: formatDateRu(r.dueDate) },
    {
      id: 'status',
      label: t('orgs.card.rep.win.status'),
      value: (
        <>
          {statusName(t, 'report', r.status)}
          {r.overdue ? (
            <>
              {' '}
              <Pill size="sm" tone="bad" icon="alert">
                {t('orgs.card.rep.overdue_mark')}
              </Pill>
            </>
          ) : null}
        </>
      ),
    },
    {
      id: 'responsible',
      label: t('report.col.responsible'),
      value: r.responsible?.shortName ?? DASH,
    },
    {
      id: 'submitted',
      label: t('orgs.card.rep.win.submitted'),
      value: r.submittedOn ? formatDateRu(r.submittedOn) : DASH,
    },
  ];
}

/** «Суммы» (прототип: «Оплачено» — не больше суммы к уплате). */
function sumFields(t: Translate, r: ReportRow): KeyValueItem[] {
  const sum = r.amount;
  return [
    {
      id: 'amount',
      label: t('report.col.amount'),
      value: sum === null ? DASH : formatSom(sum),
    },
    {
      id: 'paid',
      label: t('orgs.card.rep.win.paid'),
      value: sum === null ? DASH : formatSom(Math.min(r.paid, sum)),
    },
    {
      id: 'pay-due',
      label: t('report.col.pay_due'),
      value: formatDateRu(r.payDue ?? r.dueDate),
    },
  ];
}

/**
 * «История статусов» и «Файлы отчёта»: файл списка открывается окном просмотра (прототип `fileView`), в
 * истории — только название (у чужих организаций прототип показывает историю без файлов).
 */
function Details({
  t,
  report,
  onOpen,
}: {
  t: Translate;
  report: AdminOrgReport;
  onOpen: (index: number) => void;
}) {
  const history = historyView(
    t,
    'report',
    statusEvents(
      report.statusHistory.map((e) => ({ ...e, file: e.file && { ...e.file, available: false } })),
    ),
    new Date(),
  );
  const files: ReactNode = report.files.length ? (
    <ul data-org-report-files="" className="m-0 flex list-none flex-col p-0">
      {report.files.map((f, i) => (
        <li key={f.id} className="border-b border-line last:border-b-0">
          <button
            type="button"
            data-org-report-file={f.id}
            onClick={() => onOpen(i)}
            className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-0.5 py-[9px] text-left hover:bg-hover"
          >
            <Icon name="file" className="flex-none text-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink">{f.name}</div>
              <div className="truncate text-xs text-faint">{fileSizeText(t, f.bytes)}</div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <span className="text-faint">{t('orgs.card.rep.win.no_files')}</span>
  );
  return (
    <>
      <Box title={t('status.history')}>
        <div data-org-report-history="">
          {history.rows.length ? (
            <StatusHistory rows={history.rows} totals={history.totals} labels={historyLabels(t)} />
          ) : (
            <span className="text-faint">{t('orgs.card.hist.empty')}</span>
          )}
        </div>
      </Box>
      <Box title={t('orgs.card.rep.win.files', { n: report.files.length })}>{files}</Box>
    </>
  );
}
