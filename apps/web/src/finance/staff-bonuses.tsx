'use client';

import {
  bishkekDate,
  bonusOutProblems,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  parseSom,
  type IsoDate,
  type ListSort,
  type UiTextKey,
} from '@buhuchet/domain';
import type { BonusBalanceRow, BonusLogRow } from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Field,
  FormGrid,
  Icon,
  inputClass,
  linkButtonClass,
  Modal,
  Note,
  Pill,
  pillClass,
  Plate,
  Plates,
  Segments,
  useToast,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useNewRole } from '../roles/new-role';
import { useShell } from '../shell/context';
import { useStaffActions } from '../staff/staff-actions';
import { useStaffAddRequest } from '../staff/staff-add';
import {
  bonusEmployeeQuery,
  bonusSummaryQuery,
  fetchBonusBalances,
  fetchBonusBalanceValues,
  fetchBonusLog,
  fetchBonusLogValues,
  undoBonusWriteoff,
  writeOffBonus,
} from './bonus-data';
import { BonusTab } from './bonus-tab';
import { useFinanceRefresh } from './finance-data';
import { JournalActionDialog } from './journal-actions';
import { ServiceCardDialog } from './service-card';

/*
 * Вкладка «Бонусы» раздела «Сотрудники» (прототип v84 и v87, modules/staff.js — `renderStaff`, `bonus`;
 * `bonusLogGrid`, `bonusEmpDlg`; modules/services.js — `bonusOutDlg`, `bonusUndo`; docs/deviations.md
 * п. О-75). «Остатки» — сколько накоплено у каждого сотрудника и «Списать»; «Начисления и списания» —
 * журнал; «Остатки контрагентов» — прежний отчёт о списаниях остатков контрагентов в бонус с закрытием
 * месяца. Суммы видят «Сотрудники и роли» и «Списывать остаток в бонус»; списывает и отменяет — второе.
 */

type Section = 'bal' | 'log' | 'cp';

/** Раздел вкладки (прототип `S.bonV`): один на страницу до её перезагрузки. */
let chosen: Section = 'bal';

/** Целые сомы плашки (прототип `fmtM(x, false)`). */
const whole = (tyiyn: number) => formatSom(Math.round(tyiyn / 100) * 100, 'auto');
const dateText = (iso: string) => iso.split('-').reverse().join('.');
const Faint = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="text-faint" title={title}>
    {children}
  </span>
);

/** «+ Добавить» модуля работает и на этой вкладке (в «Остатках контрагентов» его держит `BonusTab`). */
function StaffTabAdd() {
  const staff = useStaffActions();
  const newRole = useNewRole();
  useStaffAddRequest({ employee: staff.newEmployee, role: newRole.open });
  return (
    <>
      {staff.dialogs}
      {newRole.dialog}
    </>
  );
}

export function StaffBonusTab() {
  const t = useT();
  const summary = useQuery(bonusSummaryQuery);
  const stats = useModuleStats('staff');
  const [section, setSection] = useState<Section>(chosen);
  const s = summary.data;
  const options = [
    { value: 'bal' as const, label: t('staff.bonus.seg.bal') },
    { value: 'log' as const, label: t('staff.bonus.seg.log') },
    ...(s?.contractors ? [{ value: 'cp' as const, label: t('staff.bonus.seg.cp') }] : []),
  ];
  // Раздела «Остатки контрагентов» может не быть (право или функция) — тогда «Остатки».
  const shown: Section = section === 'cp' && s && !s.contractors ? 'bal' : section;
  const segments = (
    <Segments
      label={t('staff.bonus.seg.label')}
      options={options}
      value={shown}
      onChange={(v) => {
        chosen = v;
        setSection(v);
      }}
    />
  );
  if (shown === 'cp') return <BonusTab lead={segments} />;
  return (
    <div data-staff-bonuses={shown} className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {segments}
        <span className="text-muted">
          {t(shown === 'bal' ? 'staff.bonus.bal_note' : 'staff.bonus.log_note')}
        </span>
      </div>
      {summary.isError && !s ? (
        <Note tone="bad" icon="alert">
          {t('staff.bonus.load_error')}{' '}
          <button
            type="button"
            className={linkButtonClass()}
            onClick={() => void summary.refetch()}
          >
            {t('grid.retry')}
          </button>
        </Note>
      ) : null}
      {shown === 'bal' ? (
        <>
          {s ? (
            <Plates shown={stats.shown}>
              <Plate
                id="b1"
                icon="gift"
                color="purple"
                label={t('staff.bonus.plate.all')}
                value={whole(s.bal)}
                unit={t('report.plate.som')}
                sub={t('staff.bonus.plate.all_sub')}
              />
              <Plate
                id="b2"
                icon="wallet"
                color="blue"
                label={t('staff.bonus.plate.cp')}
                value={whole(s.cp)}
                unit={t('report.plate.som')}
              />
              <Plate
                id="b3"
                icon="coins"
                color="green"
                label={t('staff.bonus.plate.svc')}
                value={whole(s.svc)}
                unit={t('report.plate.som')}
              />
              <Plate
                id="b4"
                icon="up"
                color="yellow"
                label={t('staff.bonus.plate.out')}
                value={whole(s.out)}
                unit={t('report.plate.som')}
              />
            </Plates>
          ) : null}
          <BonusBalances canOut={!!s?.canOut} />
        </>
      ) : (
        <BonusLog canOut={!!s?.canOut} />
      )}
      <StaffTabAdd />
    </div>
  );
}

/* ───────────── «Остатки» ───────────── */

const BAL_SORT: ListSort = { key: 'bal', dir: 'desc' };
const BAL_VISIBLE = ['fio', 'role', 'cp', 'svc', 'wait', 'out', 'bal', 'act'];

type Employee = { id: string; fullName: string; bal: number };
type BalanceWindow = { act: 'log'; id: string } | { act: 'out'; employee: Employee };

function BonusBalances({ canOut }: { canOut: boolean }) {
  const t = useT();
  const { search, clearSearch, access } = useShell();
  const labels = useGridLabels('staff.count');
  const [win, setWin] = useState<DialogSlot<BalanceWindow> | null>(null);
  const out = useCallback(
    (r: BonusBalanceRow) =>
      setWin(
        openSlot<BalanceWindow>({
          act: 'out',
          employee: { id: r.id, fullName: r.fullName, bal: r.bal },
        }),
      ),
    [],
  );
  const columns = useMemo<GridColumn<BonusBalanceRow>[]>(() => {
    const money = (key: 'cp' | 'svc' | 'out', width: number): GridColumn<BonusBalanceRow> => ({
      key,
      label: t(`staff.bonus.col.${key}`),
      type: 'money',
      width,
      total: (v) => formatSom(v),
      text: (r) => formatSom(r[key]),
    });
    return [
      {
        key: 'fio',
        label: t('staff.bonus.col.fio'),
        type: 'text',
        width: 240,
        text: (r) => r.fullName,
        cell: (r) => <span className="font-semibold">{r.fullName}</span>,
      },
      {
        key: 'role',
        label: t('staff.bonus.col.role'),
        type: 'enum',
        width: 170,
        text: (r) => r.role,
      },
      money('cp', 190),
      money('svc', 160),
      {
        key: 'wait',
        label: t('staff.bonus.col.wait'),
        type: 'money',
        width: 180,
        total: (v) => formatSom(v),
        text: (r) => (r.wait ? formatSom(r.wait) : '—'),
        cell: (r) => <Faint>{r.wait ? formatSom(r.wait) : '—'}</Faint>,
      },
      money('out', 130),
      {
        key: 'bal',
        label: t('staff.bonus.col.bal'),
        type: 'money',
        width: 160,
        total: (v) => formatSom(v),
        text: (r) => formatSom(r.bal),
        cell: (r) => <span className="font-semibold">{formatSom(r.bal)}</span>,
      },
      {
        key: 'act',
        label: t('staff.bonus.col.act'),
        type: 'text',
        width: 110,
        sortable: false,
        filterable: false,
        // Текст — подпись кнопки: вид «Карточки» рисует `cell` только у непустого значения.
        text: (r) => (canOut && r.bal > 0 ? t('staff.bonus.act.out_short') : ''),
        cell: (r) =>
          canOut && r.bal > 0 ? (
            <button
              type="button"
              data-bonus-out={r.id}
              title={t('staff.bonus.act.out_tip')}
              // В прототипе `.btn.xs` — без своего размера, обычная кнопка.
              className={buttonClass()}
              onClick={(e) => {
                e.stopPropagation();
                out(r);
              }}
            >
              {t('staff.bonus.act.out_short')}
            </button>
          ) : null,
      },
    ];
  }, [t, canOut, out]);
  const view = useViewSettings('staff.bonus.bal');
  const list = useListPage({
    gridKey: 'staff.bonus.bal',
    columns,
    audit: false,
    defaultVisible: BAL_VISIBLE,
    settings: view.settings,
    defaultSort: BAL_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchBonusBalances,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.bonuses.balances.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const actions = (r: BonusBalanceRow): ActionEntry[] => [
    {
      id: 'log',
      label: t('staff.bonus.act.log'),
      icon: 'list',
      run: () => setWin(openSlot<BalanceWindow>({ act: 'log', id: r.id })),
    },
    {
      id: 'out',
      label: t('staff.bonus.act.out'),
      icon: 'gift',
      disabled: !canOut || r.bal <= 0,
      reason: !canOut ? t('err.bonus_right') : t('staff.bonus.act.none'),
      run: () => out(r),
    },
  ];
  return (
    <>
      <div data-bonus-balances="">
        <DataGrid
          columns={columns}
          defaultVisible={BAL_VISIBLE}
          defaultSort={BAL_SORT}
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
          loadValues={fetchBonusBalanceValues}
          search={search}
          onClearSearch={clearSearch}
          onExport={access.can('export') ? () => void exporter.run() : undefined}
          exporting={exporter.exporting}
          empty={<EmptyState icon="gift" title={t('staff.bonus.empty')} />}
          rowKey={(r) => r.id}
          rowTone={(r) => (r.active ? undefined : 'muted')}
          titleKey="fio"
          label={t('staff.bonus.seg.bal')}
          labels={labels}
          actions={actions}
          onOpen={(r) => setWin(openSlot<BalanceWindow>({ act: 'log', id: r.id }))}
        />
      </div>
      {win?.data.act === 'log' ? (
        <BonusEmployeeDialog
          key={`log-${win.n}`}
          employeeId={win.data.id}
          open={win.open}
          onClose={() => setWin(closeSlot)}
        />
      ) : null}
      {win?.data.act === 'out' ? (
        <BonusOutDialog
          key={`out-${win.n}`}
          employee={win.data.employee}
          open={win.open}
          onClose={() => setWin(closeSlot)}
        />
      ) : null}
    </>
  );
}

/* ───────────── «Начисления и списания» ───────────── */

const LOG_SORT: ListSort = { key: 'date', dir: 'desc' };
const KIND_TONES = { cp: 'info', svc: 'ok', out: 'warn' } as const;
/** «Ожидает оплаты услуги» — бледная метка с рамкой (прототип `.pill.faint`). */
const WAIT_PILL = `${pillClass('sm')} bg-faint-pill-bg text-label shadow-[inset_0_0_0_1px_var(--bu-border)]`;

function logColumns(t: Translate, one: boolean): GridColumn<BonusLogRow>[] {
  return [
    {
      key: 'date',
      label: t('staff.bonus.col.date'),
      type: 'date',
      width: 110,
      text: (r) => dateText(r.date),
    },
    ...(one
      ? []
      : ([
          {
            key: 'emp',
            label: t('staff.bonus.col.emp'),
            type: 'enum',
            width: 150,
            text: (r) => r.employee.name,
          },
        ] satisfies GridColumn<BonusLogRow>[])),
    {
      key: 'kind',
      label: t('staff.bonus.col.kind'),
      type: 'enum',
      width: 170,
      text: (r) => t(`staff.bonus.kind.${r.kind}`),
      cell: (r) =>
        r.kind === 'wait' ? (
          <span data-pill className={WAIT_PILL}>
            {t('staff.bonus.kind.wait')}
          </span>
        ) : (
          <Pill size="sm" tone={KIND_TONES[r.kind]}>
            {t(`staff.bonus.kind.${r.kind}`)}
          </Pill>
        ),
    },
    {
      key: 'cp',
      label: t('staff.bonus.col.contractor'),
      type: 'enum',
      width: 210,
      text: (r) => r.contractor?.name ?? '',
    },
    {
      key: 'what',
      label: t('staff.bonus.col.what'),
      type: 'text',
      width: 260,
      text: (r) => r.what,
    },
    {
      key: 'sum',
      label: t('staff.bonus.col.sum'),
      type: 'money',
      width: 130,
      total: (v) => formatSom(v),
      text: (r) => formatSom(r.amount),
      cell: (r) =>
        r.kind === 'wait' ? (
          <Faint title={t('staff.bonus.wait_tip')}>{formatSom(r.amount)}</Faint>
        ) : (
          <span className={`font-semibold ${r.amount < 0 ? 'text-danger' : 'text-ok'}`}>
            {r.amount > 0 ? '+' : ''}
            {formatSom(r.amount)}
          </span>
        ),
    },
    {
      key: 'by',
      label: t('staff.bonus.col.by'),
      type: 'enum',
      width: 130,
      text: (r) => r.by ?? '',
    },
  ];
}

type LogWindow =
  | { act: 'service'; id: string }
  | { act: 'operation'; id: string }
  | { act: 'undo'; row: BonusLogRow };

/** Журнал: общий (с поиском и сотрудником) или одного сотрудника — в его окне. */
function BonusLog({ canOut, employeeId }: { canOut: boolean; employeeId?: string }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const shell = useShell();
  const one = employeeId !== undefined;
  const search = one ? '' : shell.search;
  const gridKey = one ? 'staff.bonus.emp' : 'staff.bonus.log';
  const labels = useGridLabels('staff.bonus.rec');
  const columns = useMemo(() => logColumns(t, one), [t, one]);
  const visible0 = useMemo(() => columns.map((c) => c.key), [columns]);
  const view = useViewSettings(gridKey);
  const extra = useMemo<Record<string, string>>(
    (): Record<string, string> => (employeeId ? { employeeId } : {}),
    [employeeId],
  );
  const loadValues = useCallback(
    (col: string, q?: string) => fetchBonusLogValues(extra, col, q),
    [extra],
  );
  const list = useListPage({
    gridKey,
    columns,
    audit: false,
    defaultVisible: visible0,
    settings: view.settings,
    defaultSort: LOG_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchBonusLog,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.bonuses.log.export.$get({ query: { ...params, ...extra, cols: visible.join(',') } }),
    [params, visible, extra],
  );
  const exporter = useListExport(sendExport);
  const refresh = useFinanceRefresh();
  const [win, setWin] = useState<DialogSlot<LogWindow> | null>(null);
  const [busy, setBusy] = useState(false);
  const show = (w: LogWindow) => setWin(openSlot<LogWindow>(w));
  const open = (r: BonusLogRow) =>
    r.serviceId
      ? show({ act: 'service', id: r.serviceId })
      : r.operationId
        ? show({ act: 'operation', id: r.operationId })
        : undefined;

  const undo = async (r: BonusLogRow) => {
    if (!r.writeoff || busy) return;
    setBusy(true);
    const res = await undoBonusWriteoff(r.writeoff.id, r.writeoff.version);
    setBusy(false);
    refresh();
    if (!res.ok) return void toast(errorText(res.error), { bad: true });
    toast(t('staff.bonus.undo.done'));
  };

  const actions = (r: BonusLogRow): ActionEntry[] => [
    ...(r.serviceId
      ? [
          {
            id: 'service',
            label: t('staff.bonus.act.svc'),
            icon: 'coins' as const,
            run: () => show({ act: 'service', id: r.serviceId! }),
          },
        ]
      : []),
    ...(r.operationId
      ? [
          {
            id: 'operation',
            label: t('staff.bonus.act.op'),
            icon: 'wallet' as const,
            run: () => show({ act: 'operation', id: r.operationId! }),
          },
        ]
      : []),
    ...(r.contractor
      ? [
          {
            id: 'card',
            label: t('staff.bonus.act.card'),
            icon: 'building' as const,
            run: () => openContractorCard({ id: r.contractor!.id }),
          },
        ]
      : []),
    ...(r.writeoff
      ? [
          {
            id: 'undo',
            label: t('staff.bonus.act.undo'),
            icon: 'history' as const,
            danger: true,
            disabled: !canOut,
            reason: t('err.bonus_right'),
            run: () => show({ act: 'undo', row: r }),
          },
        ]
      : []),
  ];
  const w = win?.data;
  return (
    <>
      <div data-bonus-log={employeeId ?? 'all'}>
        <DataGrid
          columns={columns}
          defaultVisible={visible0}
          defaultSort={LOG_SORT}
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
          search={one ? undefined : search}
          onClearSearch={one ? undefined : shell.clearSearch}
          onExport={shell.access.can('export') ? () => void exporter.run() : undefined}
          exporting={exporter.exporting}
          empty={<EmptyState icon="gift" title={t('staff.bonus.empty')} />}
          rowKey={(r) => r.id}
          titleKey={one ? 'date' : 'emp'}
          label={t('staff.bonus.seg.log')}
          labels={labels}
          actions={actions}
          onOpen={open}
        />
      </div>
      {w?.act === 'service' ? (
        <ServiceCardDialog
          key={`svc-${win!.n}`}
          id={w.id}
          open={win!.open}
          onClose={() => setWin(closeSlot)}
        />
      ) : null}
      {w?.act === 'operation' ? (
        <JournalActionDialog
          key={`op-${win!.n}`}
          action={{ act: 'open', src: 'op', id: w.id }}
          open={win!.open}
          onClose={() => setWin(closeSlot)}
          onOpenReport={() => setWin(closeSlot)}
        />
      ) : null}
      {w?.act === 'undo' ? (
        <ConfirmDialog
          key={`undo-${win!.n}`}
          open={win!.open}
          onClose={() => setWin(closeSlot)}
          title={t('staff.bonus.undo.title')}
          text={t('staff.bonus.undo.text', {
            name: w.row.employee.name,
            amount: formatSomWithUnit(-w.row.amount),
            date: formatDateRu(w.row.date),
          })}
          ok={t('staff.bonus.undo.ok')}
          danger
          onConfirm={() => void undo(w.row)}
        />
      ) : null}
    </>
  );
}

/* ───────────── Окно сотрудника ───────────── */

/** «Бонусы: начисления и списания» сотрудника (прототип `bonusEmpDlg`). */
export function BonusEmployeeDialog({
  employeeId,
  open,
  onClose,
}: {
  employeeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const query = useQuery(bonusEmployeeQuery(employeeId));
  const e = query.data;
  const [out, setOut] = useState<DialogSlot<Employee> | null>(null);
  const som = t('report.plate.som');
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      title={e?.fullName ?? t('staff.bonus.emp_sub')}
      sub={e ? t('staff.bonus.emp_sub') : undefined}
      footer={
        <>
          {e?.canOut && e.bal > 0 ? (
            <button
              type="button"
              data-bonus-emp-out=""
              className={buttonClass()}
              onClick={() => setOut(openSlot({ id: e.id, fullName: e.fullName, bal: e.bal }))}
            >
              <Icon name="gift" size="sm" />
              {t('staff.bonus.act.out')}
            </button>
          ) : null}
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('staff.bonus.emp_done')}
          </button>
        </>
      }
    >
      <div data-bonus-employee={employeeId} className="flex min-w-0 flex-col gap-3.5">
        {query.isError && !e ? (
          <Note tone="bad" icon="alert">
            {errorText(
              (query.error as { error?: { code: string; message: string } }).error ?? {
                code: 'unknown',
                message: '',
              },
            )}
          </Note>
        ) : null}
        {e ? (
          <Plates static>
            <Plate
              id="1"
              icon="gift"
              color="purple"
              label={t('staff.bonus.plate.bal')}
              value={whole(e.bal)}
              unit={som}
            />
            <Plate
              id="2"
              icon="wallet"
              color="blue"
              label={t('staff.bonus.plate.cp')}
              value={whole(e.cp)}
              unit={som}
            />
            <Plate
              id="3"
              icon="coins"
              color="green"
              label={t('staff.bonus.plate.svc')}
              value={whole(e.svc)}
              unit={som}
            />
            <Plate
              id="4"
              icon="up"
              color="yellow"
              label={t('staff.bonus.plate.out')}
              value={whole(e.out)}
              unit={som}
              sub={
                e.wait
                  ? t('staff.bonus.plate.wait_sub', { amount: formatSomWithUnit(e.wait) })
                  : undefined
              }
            />
          </Plates>
        ) : null}
        {e ? <BonusLog canOut={e.canOut} employeeId={employeeId} /> : null}
      </div>
      {out ? (
        <BonusOutDialog
          key={`out-${out.n}`}
          employee={out.data}
          today={e?.today}
          open={out.open}
          onClose={() => setOut(closeSlot)}
        />
      ) : null}
    </Modal>
  );
}

/* ───────────── «Списать бонус» ───────────── */

type OutErrors = Partial<Record<'amount' | 'date' | 'note', string>>;

/** «Списать бонус» (прототип `bonusOutDlg`): сумма — не больше остатка, дата, основание. */
export function BonusOutDialog({
  employee,
  today,
  open,
  onClose,
}: {
  employee: Employee;
  /** «Сегодня» по ответу сервера; без него — по часам устройства. */
  today?: IsoDate;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useFinanceRefresh();
  const id = useId();
  const now = today ?? bishkekDate(new Date());
  const [amount, setAmount] = useState(formatSom(employee.bal, 'auto'));
  const [date, setDate] = useState<string>(now);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<OutErrors>({});
  const [busy, setBusy] = useState(false);
  const clear = (k: keyof OutErrors) => setErrors((x) => ({ ...x, [k]: undefined }));
  const balance = formatSomWithUnit(employee.bal);

  const save = async () => {
    const n = parseSom(amount);
    // Прототип bonusOutDlg: все отказы сразу — у своих полей.
    const found: OutErrors = {};
    for (const p of bonusOutProblems(
      { amount: n, date: date as IsoDate | '', note },
      { balance: employee.bal, today: now },
    ))
      found[p.field] ??= t(`err.${p.problem}` as UiTextKey, {
        amount: p.amount !== undefined ? formatSomWithUnit(p.amount) : '',
      });
    if (Object.keys(found).length) return setErrors(found);
    setBusy(true);
    const res = await writeOffBonus(employee.id, {
      amount: n ?? 0,
      date: date as IsoDate,
      note: note.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      const field = (res.error.details as { field?: string } | undefined)?.field;
      refresh();
      if (field === 'amount' || field === 'date' || field === 'note')
        return setErrors({ [field]: errorText(res.error) });
      return void toast(errorText(res.error), { bad: true });
    }
    refresh();
    onClose();
    toast(t('staff.bonus.out.done', { amount: formatSomWithUnit(n ?? 0) }), { icon: 'gift' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={note !== '' || amount !== formatSom(employee.bal, 'auto')}
      title={t('staff.bonus.out.title')}
      sub={t('staff.bonus.out.sub', { name: employee.fullName, amount: balance })}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('staff.bonus.out.cancel')}
          </button>
          <button
            type="button"
            data-bonus-out-ok=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void save()}
          >
            {t('staff.bonus.out.ok')}
          </button>
        </>
      }
    >
      <div data-bonus-out-dialog={employee.id} className="flex flex-col gap-3.5">
        <FormGrid>
          <Field
            id={`${id}-sum`}
            label={t('staff.bonus.out.sum')}
            required
            hint={t('staff.bonus.out.sum_hint', { amount: balance })}
            error={errors.amount}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-bonus-out-sum=""
                className={`${inputClass()} tabular-nums`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  clear('amount');
                }}
              />
            )}
          </Field>
          <Field id={`${id}-date`} label={t('staff.bonus.out.date')} required error={errors.date}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-bonus-out-date=""
                className={inputClass()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  clear('date');
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-note`}
            label={t('staff.bonus.out.note')}
            required
            full
            error={errors.note}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={300}
                data-bonus-out-note=""
                placeholder={t('staff.bonus.out.note_ph')}
                className={inputClass()}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  clear('note');
                }}
              />
            )}
          </Field>
        </FormGrid>
        <Note>{t('staff.bonus.out.info')}</Note>
      </div>
    </Modal>
  );
}
