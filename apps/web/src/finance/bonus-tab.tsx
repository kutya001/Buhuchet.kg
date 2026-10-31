'use client';

import {
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  type ListSort,
} from '@buhuchet/domain';
import type { BonusRow } from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Icon,
  Tag,
  useToast,
  type ActionEntry,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useReportActions } from '../reports/report-actions';
import { useNewRole } from '../roles/new-role';
import { useShell } from '../shell/context';
import { useStaffActions } from '../staff/staff-actions';
import { useStaffAddRequest } from '../staff/staff-add';
import { useFinanceRefresh } from './finance-data';
import { JournalActionDialog, type JournalAction } from './journal-actions';
import { closedMonthsQuery, closeMonth, fetchBonuses, fetchBonusValues } from './journal-data';

/*
 * Вкладка «Списания в бонус» раздела «Сотрудники» (задача 2.22; ТЗ «Финансовые операции по
 * контрагентам» → «Ежемесячный отчёт по списаниям»; прототип modules/staff.js, `bonus`): все списания
 * остатка в бонус; «Закрыть <прошлый месяц>» — право «Списывать остаток в бонус» и область «Все»
 * финансовых операций; закрытый месяц фиксирует списания и оплаты. Строка открывает окно операции,
 * меню — «Изменить» и «Отменить списание» с замком. «+ Добавить» модуля работает, как на других вкладках.
 */

// Прототип: SHOW.bonus — месяц, сотрудник, контрагент, сумма; defSort — по «Создано».
const SORT: ListSort = { key: 'createdAt', dir: 'desc' };
const VISIBLE = ['month', 'emp', 'cp', 'sum'];

const ym = (month: string) => monthLabel(month as `${number}-${number}`);

function bonusColumns(t: Translate): GridColumn<BonusRow>[] {
  return [
    {
      key: 'date',
      label: t('fin.b.col.date'),
      type: 'date',
      width: 110,
      text: (r) => r.date.split('-').reverse().join('.'),
    },
    {
      key: 'month',
      label: t('fin.b.col.month'),
      type: 'enum',
      width: 130,
      text: (r) => ym(r.date.slice(0, 7)),
    },
    {
      key: 'emp',
      label: t('fin.b.col.emp'),
      type: 'enum',
      width: 150,
      text: (r) => (r.holder.kind === 'org' ? t('fin.b.org') : (r.holder.name ?? '—')),
    },
    {
      key: 'cp',
      label: t('fin.b.col.cp'),
      type: 'enum',
      width: 220,
      text: (r) => r.contractor.name,
    },
    {
      key: 'sum',
      label: t('fin.b.col.sum'),
      type: 'money',
      width: 130,
      total: (v) => formatSom(v),
      text: (r) => formatSom(r.amount),
    },
    { key: 'note', label: t('fin.b.col.note'), type: 'text', width: 220, text: (r) => r.note },
    { key: 'by', label: t('fin.b.col.by'), type: 'enum', width: 120, text: (r) => r.by ?? '' },
  ];
}

const AUDIT: GridAudit<BonusRow> = {
  createdBy: (r) => r.audit.createdBy ?? '',
  updatedBy: (r) => r.audit.updatedBy ?? r.audit.createdBy ?? '',
  createdAt: (r) => formatMomentRu(new Date(r.audit.createdAt)),
  updatedAt: (r) => formatMomentRu(new Date(r.audit.updatedAt)),
};

export function BonusTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const { search, clearSearch, access } = useShell();
  const staff = useStaffActions();
  const newRole = useNewRole();
  useStaffAddRequest({ employee: staff.newEmployee, role: newRole.open });
  const labels = useGridLabels('fin.b.count');
  const columns = useMemo(() => bonusColumns(t), [t]);
  const view = useViewSettings('staff.bonus');
  const months = useQuery(closedMonthsQuery);
  const refresh = useFinanceRefresh();
  const reports = useReportActions();
  const list = useListPage({
    gridKey: 'staff.bonus',
    columns,
    defaultVisible: VISIBLE,
    settings: view.settings,
    defaultSort: SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchBonuses,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.fin.bonuses.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [action, setAction] = useState<DialogSlot<JournalAction> | null>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (a: JournalAction) => setAction(openSlot(a));
  const m = months.data;

  const close = async () => {
    if (!m || busy) return;
    setBusy(true);
    const res = await closeMonth(m.toClose);
    setBusy(false);
    if (!res.ok) return void toast(errorText(res.error), { bad: true });
    refresh();
    toast(t('fin.b.closed_done'), { icon: 'lock' });
  };

  // Меню строки (прототип opActs + «Карточка контрагента» на вкладке «Деньги»).
  const actions = (r: BonusRow): ActionEntry[] => [
    {
      id: 'open',
      label: t('fin.op.act_open'),
      icon: 'list',
      run: () => run({ act: 'open', src: 'op', id: r.id }),
    },
    {
      id: 'edit',
      label: t('fin.op.edit'),
      icon: 'edit',
      disabled: !!r.locks.edit,
      reason: r.locks.edit?.text,
      run: () => run({ act: 'edit', src: 'op', id: r.id, kind: 'bonus', receiptId: null }),
    },
    {
      id: 'source',
      label: t('fin.op.source'),
      icon: 'link',
      sub: t('fin.op.source_cp'),
      run: () => openContractorCard({ id: r.contractor.id }, 'money'),
    },
    { id: 's1', separator: true },
    {
      id: 'delete',
      label: t('fin.del.ok_bonus'),
      icon: 'history',
      danger: true,
      disabled: !!r.locks.del,
      reason: r.locks.del?.text,
      run: () => run({ act: 'delete', src: 'op', id: r.id }),
    },
    { id: 's2', separator: true },
    {
      id: 'card',
      label: t('fin.op.card'),
      icon: 'building',
      run: () => openContractorCard({ id: r.contractor.id }, 'money'),
    },
  ];

  const closed = m ? [...m.closed].sort().reverse() : [];
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">{t('fin.b.note')}</span>
        <div className="flex-1" />
        {closed.length ? (
          <Tag icon="lock">{t('fin.b.closed', { months: closed.map(ym).join(', ') })}</Tag>
        ) : null}
        {m?.canClose ? (
          <button
            type="button"
            data-fin-close-month={m.toClose}
            className={buttonClass('default', 'sm')}
            disabled={busy}
            onClick={() => setAsk(true)}
          >
            <Icon name="lock" size="sm" />
            {t('fin.b.close', { month: ym(m.toClose) })}
          </button>
        ) : null}
      </div>
      <DataGrid
        columns={columns}
        audit={AUDIT}
        defaultVisible={VISIBLE}
        defaultSort={SORT}
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
        loadValues={fetchBonusValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="gift" title={t('fin.b.empty')} />}
        rowKey={(r) => r.id}
        titleKey="cp"
        label={t('tab.staff.bonus')}
        labels={labels}
        onOpen={(r) => run({ act: 'open', src: 'op', id: r.id })}
        actions={actions}
      />
      {m ? (
        <ConfirmDialog
          open={ask}
          onClose={() => setAsk(false)}
          title={t('fin.b.close_title', { month: ym(m.toClose) })}
          text={t('fin.b.close_text', {
            n: m.bonuses.count,
            amount: formatSomWithUnit(m.bonuses.amount),
          })}
          ok={t('fin.b.close_ok')}
          onConfirm={() => void close()}
        />
      ) : null}
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
      {staff.dialogs}
      {newRole.dialog}
    </div>
  );
}
