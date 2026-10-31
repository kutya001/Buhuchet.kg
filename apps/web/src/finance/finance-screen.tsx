'use client';

import {
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  type ListSort,
  type MoneyOpKind,
} from '@buhuchet/domain';
import type { FinJournalRow, ReceiptJournalRow } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  Icon,
  Note,
  Pill,
  Plate,
  Plates,
  SWITCH_CLASS,
  Tag,
  useToast,
  type ActionEntry,
  type GridAudit,
  type GridColumn,
  type PlateProps,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { api } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { OP_LOOK } from '../money/contractor-money';
import { ReceiptDialog } from '../money/tax-dialogs';
import { useReportActions } from '../reports/report-actions';
import { useShell } from '../shell/context';
import { ModuleStub } from '../shell/module-stub';
import { tabHref } from '../shell/modules';
import { useFinanceRefresh } from './finance-data';
import { deleteWords } from './finance-history';
import { JournalActionDialog, type JournalAction } from './journal-actions';
import {
  fetchJournal,
  fetchJournalValues,
  fetchReceipts,
  fetchReceiptValues,
  finSummaryQuery,
  journalExtra,
  receiptExtra,
  type FinJournalTab,
} from './journal-data';

/*
 * Модуль «Финансовые операции по контрагентам» (задача 2.22; ТЗ «Финансовые операции по
 * контрагентам»; прототип modules/finance.js `renderFin`, `finCols`, `finActions`, `renderJournal`):
 * плашки за текущий месяц (нажатие — вкладка, второе — «Все»), журнал вкладки с поиском, фильтрами,
 * итогами и «В Excel», «Показать удалённые» — общий для вкладок переключатель; строка открывает окно
 * операции, меню строки — «Изменить», «Обратная запись», «Удалить» с замком. «Журнал поступлений» —
 * одна строка на перевод контрагента с детализацией. «Проекты и услуги» заполнят разовые услуги (часть
 * 3 задачи).
 */

/* ───────────── «Показать удалённые» — общий для вкладок (прототип `S.finDel`) ───────────── */

let deletedNow = false;
const deletedListeners = new Set<() => void>();
const deletedStore = {
  subscribe: (listener: () => void) => {
    deletedListeners.add(listener);
    return () => void deletedListeners.delete(listener);
  },
  get: () => deletedNow,
  set: (on: boolean) => {
    deletedNow = on;
    deletedListeners.forEach((l) => l());
  },
};

function useShowDeleted(): boolean {
  return useSyncExternalStore(deletedStore.subscribe, deletedStore.get, () => false);
}

function DeletedSwitch() {
  const t = useT();
  const on = useShowDeleted();
  return (
    <div className="flex justify-end">
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          data-fin-deleted=""
          className={SWITCH_CLASS}
          checked={on}
          onChange={(e) => deletedStore.set(e.target.checked)}
        />
        <span>{t('fin.j.show_deleted')}</span>
      </label>
    </div>
  );
}

/* ───────────── Общее ───────────── */

const moment = (iso: string) => formatMomentRu(new Date(iso));

/** Служебные «Создал», «Изменил», «Создано», «Изменено» (прототип ui/grid.js `auditCols`). */
const audit = <Row extends { audit: FinJournalRow['audit'] }>(): GridAudit<Row> => ({
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: (r) => moment(r.audit.createdAt),
  updatedAt: (r) => moment(r.audit.updatedAt),
});

/** Файлы строки: скрепка и число, без файлов — «—». */
function FilesCell({ n }: { n: number }) {
  return n ? (
    <span className="inline-flex items-center gap-1">
      <Icon name="clip" size="sm" />
      {n}
    </span>
  ) : (
    <span className="text-faint">—</span>
  );
}

/** Счёт строки (прототип: «организация», «контрагент сам», сотрудник со значком). */
function accText(t: Translate, acc: FinJournalRow['acc']): string {
  if (acc.kind === 'org') return t('fin.j.acc_org');
  if (acc.kind === 'client') return t('fin.j.acc_client');
  return acc.name ?? '—';
}

/** Название и цвет вида (прототип OPK, OP_SELF, OP_OWN). */
function kindOf(t: Translate, r: FinJournalRow) {
  if (r.src === 'fee') return { label: t('fin.fee.kind'), tone: 'violet' as const };
  const key = r.self && r.kind === 'pay' ? 'self' : r.kind;
  return {
    label: t(key === 'self' ? 'money.op.self' : `money.op.${r.kind as MoneyOpKind}`),
    tone: OP_LOOK[key]?.tone ?? 'plain',
  };
}

/** Знак суммы (прототип: приход «+», расход «−», перевод и «контрагент сам» — без знака). */
function signOf(r: FinJournalRow): string {
  if (r.src === 'fee') return '+';
  if ((r.self && r.kind === 'pay') || r.kind === 'xfer') return '';
  if (r.kind === 'corr') return r.signed < 0 ? '−' : '+';
  return r.signed < 0 ? '−' : '+';
}

const money = (v: number) => formatSom(v);

/* ───────────── Журнал вкладки ───────────── */

// Сортировка по умолчанию — по «Создано», новые сверху; столбцы — прототип SHOW['fin-'] (ui/grid.js).
const JOURNAL_SORT: ListSort = { key: 'createdAt', dir: 'desc' };
const JOURNAL_VISIBLE = ['date', 'cp', 'cat', 'what', 'amount', 'acc'];

function journalColumns(t: Translate): GridColumn<FinJournalRow>[] {
  return [
    {
      key: 'date',
      label: t('fin.j.col.date'),
      type: 'date',
      width: 110,
      text: (r) => r.date.split('-').reverse().join('.'),
    },
    {
      key: 'cp',
      label: t('fin.j.col.cp'),
      type: 'enum',
      width: 220,
      text: (r) => r.contractor.name,
      cell: (r) => <span className="truncate font-semibold">{r.contractor.name}</span>,
    },
    {
      key: 'cat',
      label: t('fin.j.col.cat'),
      type: 'enum',
      width: 230,
      text: (r) => kindOf(t, r).label,
      cell: (r) => {
        const k = kindOf(t, r);
        return (
          <span className="inline-flex items-center gap-1">
            <Pill tone={k.tone} size="sm">
              {k.label}
            </Pill>
            {r.deleted ? (
              <Tag tone="bad">{t('fin.j.deleted_tag')}</Tag>
            ) : r.edited ? (
              <Tag tone="warn">{t('fin.j.edited_tag')}</Tag>
            ) : null}
          </span>
        );
      },
    },
    { key: 'what', label: t('fin.j.col.what'), type: 'text', width: 320, text: (r) => r.what },
    {
      key: 'amount',
      label: t('fin.j.col.amount'),
      type: 'money',
      width: 140,
      total: money,
      text: (r) => `${signOf(r)}${formatSom(r.amount)}`,
      cell: (r) => {
        const sign = signOf(r);
        return (
          <span
            className={`tabular-nums ${r.deleted ? 'text-faint line-through' : sign === '+' ? 'text-ok' : ''}`}
          >
            {sign}
            {formatSom(r.amount)}
          </span>
        );
      },
    },
    {
      key: 'acc',
      label: t('fin.j.col.acc'),
      type: 'enum',
      width: 160,
      text: (r) => accText(t, r.acc),
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          <Icon name={r.acc.kind === 'employee' ? 'user' : 'building'} size="sm" />
          {r.acc.kind === 'employee' ? accText(t, r.acc) : accText(t, r.acc).toLowerCase()}
        </span>
      ),
    },
    { key: 'by', label: t('fin.j.col.by'), type: 'enum', width: 130, text: (r) => r.by ?? '' },
    {
      key: 'files',
      label: t('fin.j.col.files'),
      type: 'int',
      width: 90,
      text: (r) => (r.files ? String(r.files) : ''),
      cell: (r) => <FilesCell n={r.files} />,
    },
    { key: 'rep', label: t('fin.j.col.rep'), type: 'text', width: 160, text: (r) => r.rep ?? '' },
    { key: 'per', label: t('fin.j.col.per'), type: 'text', width: 140, text: (r) => r.per ?? '' },
    { key: 'note', label: t('fin.j.col.note'), type: 'text', width: 220, text: (r) => r.note },
  ];
}

const JOURNAL_AUDIT = audit<FinJournalRow>();

/** «Открыть источник» строки (прототип opView `src`): отчёт, общее поступление или карточка. */
function sourceOf(t: Translate, r: FinJournalRow): string {
  if (r.src === 'fee')
    return r.receipt
      ? t('fin.fee.source_receipt', {
          amount: formatSomWithUnit(r.receipt.total),
          date: r.receipt.date.split('-').reverse().join('.'),
        })
      : t('fin.fee.source_cp');
  return r.reportId && r.rep
    ? t('fin.op.source_report', { report: [r.rep, r.per].filter(Boolean).join(' · ') })
    : t('fin.op.source_cp');
}

function JournalTab({ tab }: { tab: FinJournalTab }) {
  const t = useT();
  const router = useRouter();
  const { search, clearSearch, access } = useShell();
  const deleted = useShowDeleted();
  const gridKey = `fin.${tab}` as const;
  const labels = useGridLabels('fin.j.count');
  const columns = useMemo(() => journalColumns(t), [t]);
  const view = useViewSettings(gridKey);
  const stats = useModuleStats('fin');
  const summary = useQuery(finSummaryQuery);
  const reports = useReportActions();
  const extra = useMemo(() => journalExtra(tab, deleted), [tab, deleted]);
  const loadValues = useMemo(() => fetchJournalValues(extra), [extra]);
  const list = useListPage({
    gridKey,
    columns,
    defaultVisible: JOURNAL_VISIBLE,
    settings: view.settings,
    defaultSort: JOURNAL_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchJournal,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.fin.journal.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [action, setAction] = useState<DialogSlot<JournalAction> | null>(null);
  const run = (a: JournalAction) => setAction(openSlot(a));
  const openReport = (id: string) => reports.openCard({ id });

  const actions = (r: FinJournalRow): ActionEntry[] => {
    const open: ActionEntry = {
      id: 'open',
      label: t('fin.op.act_open'),
      icon: 'list',
      run: () => run({ act: 'open', src: r.src, id: r.id }),
    };
    const source: ActionEntry = {
      id: 'source',
      label: t('fin.op.source'),
      icon: 'link',
      sub: sourceOf(t, r),
      run: () => {
        if (r.src === 'fee' && r.receipt) return run({ act: 'open', src: 'op', id: r.receipt.id });
        if (r.src === 'op' && r.reportId) return openReport(r.reportId);
        openContractorCard({ id: r.contractor.id }, r.src === 'fee' ? 'fee' : 'money');
      },
    };
    const card: ActionEntry = {
      id: 'card',
      label: t('fin.op.card'),
      icon: 'building',
      run: () => openContractorCard({ id: r.contractor.id }),
    };
    if (r.deleted) return [open, source, { id: 's1', separator: true }, card];
    const edit = r.locks.edit?.text;
    const del = r.locks.del?.text;
    const wo = r.src === 'op' && (r.kind === 'bonus' || r.kind === 'refund');
    return [
      open,
      {
        id: 'edit',
        label: t('fin.op.edit'),
        icon: 'edit',
        disabled: !!edit,
        reason: edit,
        run: () =>
          run({
            act: 'edit',
            src: r.src,
            id: r.id,
            kind: r.kind,
            receiptId: r.receipt?.id ?? null,
          }),
      },
      ...(r.src === 'op' && r.kind === 'in'
        ? [
            {
              id: 'corr',
              label: t('fin.op.correction'),
              icon: 'refresh',
              sub: t('fin.op.act_corr_sub'),
              disabled: !!edit,
              reason: edit,
              run: () => run({ act: 'correction', id: r.id }),
            } satisfies ActionEntry,
          ]
        : []),
      source,
      { id: 's1', separator: true },
      {
        id: 'delete',
        label: t(r.src === 'op' ? deleteWords(r.kind as 'in').ok : 'fin.del.ok'),
        icon: wo ? 'history' : 'trash',
        danger: true,
        disabled: !!del,
        reason: del,
        run: () => run({ act: 'delete', src: r.src, id: r.id }),
      },
      { id: 's2', separator: true },
      card,
    ];
  };

  // Плашка открывает свою вкладку, нажатая ещё раз — «Все» (прототип: `b.dataset.plate === tab`).
  const goPlate = (to: FinJournalTab) => router.push(tabHref('fin', to === tab ? 'all' : to));
  const s = summary.data;
  const month = s ? monthLabel(s.month as `${number}-${number}`) : '';
  const whole = (v: number) => formatSom(Math.round(v / 100) * 100, 'auto');
  const plates: PlateProps[] = [];
  if (s?.tax)
    plates.push({
      id: 'tax',
      icon: 'wallet',
      color: 'green',
      label: t('fin.plate.tax'),
      value: whole(s.tax.received),
      unit: t('report.plate.som'),
      sub: t('fin.plate.tax_sub', { amount: whole(s.tax.paid) }),
      on: tab === 'tax',
      onClick: () => goPlate('tax'),
    });
  if (s && s.fee !== null)
    plates.push({
      id: 'fee',
      icon: 'coins',
      color: 'purple',
      label: t('fin.plate.fee'),
      value: whole(s.fee),
      unit: t('report.plate.som'),
      sub: month,
      on: tab === 'fee',
      onClick: () => goPlate('fee'),
    });
  if (s && s.wo !== null)
    plates.push({
      id: 'wo',
      icon: 'gift',
      color: 'blue',
      label: t('fin.plate.wo'),
      value: whole(s.wo),
      unit: t('report.plate.som'),
      sub: month,
      on: tab === 'wo',
      onClick: () => goPlate('wo'),
    });

  return (
    <div className="flex flex-col gap-3.5">
      {plates.length ? (
        <Plates shown={stats.shown}>
          {plates.map((p) => (
            <Plate key={p.id} {...p} />
          ))}
        </Plates>
      ) : null}
      {tab === 'fee' && s?.tax ? <Note icon="info">{t('fin.j.fee_note')}</Note> : null}
      <DeletedSwitch />
      <DataGrid
        columns={columns}
        audit={JOURNAL_AUDIT}
        defaultVisible={JOURNAL_VISIBLE}
        defaultSort={JOURNAL_SORT}
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
        empty={<EmptyState icon="coins" title={t('fin.j.empty')} />}
        rowKey={(r) => r.key}
        titleKey="what"
        rowTone={(r) => (r.deleted ? 'muted' : undefined)}
        label={t(`tab.fin.${tab}`)}
        labels={labels}
        onOpen={(r) => run({ act: 'open', src: r.src, id: r.id })}
        actions={actions}
      />
      {action ? (
        <JournalActionDialog
          key={`act-${action.n}`}
          action={action.data}
          open={action.open}
          onClose={() => setAction(closeSlot)}
          onOpenReport={(id) => {
            setAction(closeSlot);
            openReport(id);
          }}
        />
      ) : null}
      {reports.dialogs}
    </div>
  );
}

/* ───────────── «Журнал поступлений» ───────────── */

// Как в прототипе: SHOW['fin-journal'], сортировка defSort — по «Создано».
const RECEIPT_SORT: ListSort = { key: 'createdAt', dir: 'desc' };
const RECEIPT_VISIBLE = ['date', 'cp', 'total', 'dist', 'adv', 'files'];

function receiptColumns(t: Translate, fee: boolean): GridColumn<ReceiptJournalRow>[] {
  const live = (r: ReceiptJournalRow, v: number) => (r.deleted ? '' : formatSom(v));
  return [
    {
      key: 'date',
      label: t('fin.j.col.date'),
      type: 'date',
      width: 110,
      text: (r) => r.date.split('-').reverse().join('.'),
    },
    {
      key: 'cp',
      label: t('fin.j.col.cp'),
      type: 'enum',
      width: 220,
      text: (r) => r.contractor.name,
      cell: (r) => <span className="truncate font-semibold">{r.contractor.name}</span>,
    },
    {
      key: 'total',
      label: t('fin.r.col.total'),
      type: 'money',
      width: 140,
      total: money,
      text: (r) => formatSom(r.total),
      cell: (r) =>
        r.deleted ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-faint tabular-nums line-through">{formatSom(r.total)}</span>
            <Tag tone="bad">{t('fin.r.deleted_tag')}</Tag>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <span className="tabular-nums">{formatSom(r.total)}</span>
            {r.edited ? <Tag tone="warn">{t('fin.r.edited_tag')}</Tag> : null}
          </span>
        ),
    },
    {
      key: 'dist',
      label: t('fin.r.col.dist'),
      type: 'money',
      width: 140,
      total: money,
      text: (r) => live(r, r.distributed),
    },
    {
      key: 'alloc',
      label: t('fin.r.col.alloc'),
      type: 'text',
      width: 360,
      text: (r) => r.alloc ?? t('fin.r.advance'),
      cell: (r) =>
        r.lines > 1 ? (
          <span className="inline-flex items-center gap-1 truncate">
            <Tag>{t('fin.r.lines', { n: r.lines })}</Tag>
            {r.alloc}
          </span>
        ) : (
          (r.alloc ?? t('fin.r.advance'))
        ),
    },
    {
      key: 'tax',
      label: t('fin.r.col.tax'),
      type: 'money',
      width: 130,
      total: money,
      text: (r) => live(r, r.tax),
    },
    ...(fee
      ? [
          {
            key: 'fee',
            label: t('fin.r.col.fee'),
            type: 'money',
            width: 140,
            total: money,
            text: (r) => live(r, r.fee ?? 0),
          } satisfies GridColumn<ReceiptJournalRow>,
        ]
      : []),
    {
      key: 'adv',
      label: t('fin.r.col.adv'),
      type: 'money',
      width: 140,
      total: money,
      text: (r) => live(r, r.advance),
    },
    {
      key: 'corr',
      label: t('fin.r.col.corr'),
      type: 'money',
      width: 130,
      text: (r) => (r.corrections ? formatSom(r.corrections) : ''),
    },
    {
      key: 'ed',
      label: t('fin.r.col.ed'),
      type: 'enum',
      width: 190,
      text: (r) =>
        t(r.deleted ? 'fin.r.ed.deleted' : r.spent > 0 ? 'fin.r.ed.spent' : 'fin.r.ed.free'),
      cell: (r) =>
        r.deleted ? (
          <span className="text-faint">—</span>
        ) : r.spent > 0 ? (
          <span title={t('fin.r.ed.min_tip', { amount: formatSomWithUnit(r.spent) })}>
            <Pill size="sm" icon="lock">
              {t('fin.r.ed.min', {
                amount: formatSom(Math.round((r.spent + (r.fee ?? 0)) / 100) * 100, 'auto'),
              })}
            </Pill>
          </span>
        ) : (
          <Pill tone="ok" size="sm" icon="edit">
            {t('fin.r.ed.can')}
          </Pill>
        ),
    },
    {
      key: 'files',
      label: t('fin.r.col.files'),
      type: 'int',
      width: 90,
      text: (r) => (r.files ? String(r.files) : ''),
      cell: (r) => <FilesCell n={r.files} />,
    },
    { key: 'by', label: t('fin.j.col.by'), type: 'enum', width: 130, text: (r) => r.by ?? '' },
    { key: 'note', label: t('fin.j.col.note'), type: 'text', width: 220, text: (r) => r.note },
    {
      key: 'holder',
      label: t('fin.r.col.holder'),
      type: 'enum',
      width: 140,
      text: (r) => (r.holder.kind === 'org' ? t('fin.r.holder_org') : (r.holder.name ?? '—')),
    },
  ];
}

const RECEIPT_AUDIT = audit<ReceiptJournalRow>();

function ReceiptsTab() {
  const t = useT();
  const { search, clearSearch, access } = useShell();
  const deleted = useShowDeleted();
  const fee = access.feature('fee') && access.can('fee');
  const labels = useGridLabels('fin.r.count');
  const columns = useMemo(() => receiptColumns(t, fee), [t, fee]);
  const view = useViewSettings('fin.journal');
  const reports = useReportActions();
  const extra = useMemo(() => receiptExtra(deleted), [deleted]);
  const loadValues = useMemo(() => fetchReceiptValues(extra), [extra]);
  const list = useListPage({
    gridKey: 'fin.journal',
    columns,
    defaultVisible: RECEIPT_VISIBLE,
    settings: view.settings,
    defaultSort: RECEIPT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchReceipts,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.fin.receipts.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [action, setAction] = useState<DialogSlot<JournalAction> | null>(null);
  const run = (a: JournalAction) => setAction(openSlot(a));

  // Меню строки (прототип inActions → opActs): замки «Изменить» и «Удалить» — от сервера.
  const actions = (r: ReceiptJournalRow): ActionEntry[] => [
    {
      id: 'open',
      label: t('fin.op.act_open'),
      icon: 'list',
      run: () => run({ act: 'open', src: 'op', id: r.id }),
    },
    ...(r.deleted
      ? []
      : [
          {
            id: 'edit',
            label: t('fin.op.edit'),
            icon: 'edit',
            disabled: !!r.locks.edit,
            reason: r.locks.edit?.text,
            run: () => run({ act: 'edit', src: 'op', id: r.id, kind: 'in', receiptId: null }),
          } satisfies ActionEntry,
          {
            id: 'corr',
            label: t('fin.op.correction'),
            icon: 'refresh',
            sub: t('fin.op.act_corr_sub'),
            disabled: !!r.locks.edit,
            reason: r.locks.edit?.text,
            run: () => run({ act: 'correction', id: r.id }),
          } satisfies ActionEntry,
        ]),
    {
      id: 'source',
      label: t('fin.op.source'),
      icon: 'link',
      sub: t('fin.op.source_cp'),
      run: () => openContractorCard({ id: r.contractor.id }, 'money'),
    },
    ...(r.deleted
      ? []
      : [
          { id: 's1', separator: true } as const,
          {
            id: 'delete',
            label: t('fin.del.ok'),
            icon: 'trash',
            danger: true,
            disabled: !!r.locks.del,
            reason: r.locks.del?.text,
            run: () => run({ act: 'delete', src: 'op', id: r.id }),
          } satisfies ActionEntry,
        ]),
    { id: 's2', separator: true },
    {
      id: 'card',
      label: t('fin.op.card'),
      icon: 'building',
      run: () => openContractorCard({ id: r.contractor.id }),
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('fin.r.note')}</Note>
      <DeletedSwitch />
      <DataGrid
        columns={columns}
        audit={RECEIPT_AUDIT}
        defaultVisible={RECEIPT_VISIBLE}
        defaultSort={RECEIPT_SORT}
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
        empty={<EmptyState icon="wallet" title={t('fin.r.empty')} />}
        rowKey={(r) => r.id}
        titleKey="cp"
        rowTone={(r) => (r.deleted ? 'muted' : undefined)}
        label={t('tab.fin.journal')}
        labels={labels}
        onOpen={(r) => run({ act: 'open', src: 'op', id: r.id })}
        actions={actions}
      />
      {action ? (
        <JournalActionDialog
          key={`act-${action.n}`}
          action={action.data}
          open={action.open}
          onClose={() => setAction(closeSlot)}
          onOpenReport={(id) => {
            setAction(closeSlot);
            reports.openCard({ id });
          }}
        />
      ) : null}
      {reports.dialogs}
    </div>
  );
}

/* ───────────── Экран модуля ───────────── */

/** «+ Добавить» модуля (прототип finAdd): «Поступление» — окно с выбором контрагента. */
function useFinAddRequest(run: { income: () => void; other: (label: string) => void }) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'fin' ? addRequest : null;
  const start = useEffectEvent((actionId: string, label: string) => {
    if (actionId === 'income') run.income();
    else run.other(label);
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId, request.label);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

const JOURNAL_TABS: readonly FinJournalTab[] = ['all', 'tax', 'fee', 'wo'];

export function FinanceScreen({ tab }: { tab: string }) {
  const t = useT();
  const toast = useToast();
  const { access } = useShell();
  const [income, setIncome] = useState<DialogSlot<null> | null>(null);
  const refresh = useFinanceRefresh();
  useFinAddRequest({
    income: () => setIncome(openSlot(null)),
    // «Разовая услуга» — с разовыми услугами (часть 3 задачи).
    other: (label) => toast(t('shell.stub_add', { action: label }), { icon: 'info' }),
  });
  const taxVis = access.feature('taxpay') && access.can('money');
  const feeVis = access.feature('fee') && access.can('fee');
  const content =
    !taxVis && !feeVis && !access.can('projects') ? (
      <Note icon="lock">{t('fin.j.no_rights')}</Note>
    ) : tab === 'journal' ? (
      <ReceiptsTab />
    ) : JOURNAL_TABS.includes(tab as FinJournalTab) ? (
      <JournalTab key={tab} tab={tab as FinJournalTab} />
    ) : (
      <ModuleStub moduleId="fin" handleAdd={false} />
    );
  return (
    <>
      {content}
      {income ? (
        <ReceiptDialog
          key={`in-${income.n}`}
          contractorId={null}
          preset={null}
          filesOn={access.feature('files')}
          canUpload={access.feature('files') && access.can('filesUpload')}
          open={income.open}
          onClose={() => setIncome(closeSlot)}
          onDone={refresh}
        />
      ) : null}
    </>
  );
}
