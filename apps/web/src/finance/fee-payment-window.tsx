'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  formatMomentRu,
  formatSomWithUnit,
  monthLabel,
} from '@buhuchet/domain';
import type { FeePaymentWindow } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  Icon,
  KeyValues,
  Modal,
  Note,
  Pill,
  type ActionEntry,
  type KeyValueItem,
  type TimelineItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiFailure } from '../api-client';
import { feePaymentHistoryText } from '../contractors/contractor-history';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FeePaymentEditDialog } from '../fees/fee-dialogs';
import { RecordFiles } from '../files/record-files';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { ReceiptEditDialog } from '../money/tax-dialogs';
import { useFinanceRefresh } from './finance-data';
import { FeePaymentDeleteDialog, WhyButton } from './finance-dialogs';
import { feePaymentQuery } from './journal-data';
import { OpHistoryFold, OpMoreButton, OpWindowSub } from './op-window-parts';
import { OperationWindowDialog } from './operation-window';

/*
 * Окно оплаты за обслуживание (задача 2.22; ТЗ «Финансовые операции по контрагентам» → «Окно оплаты»;
 * прототип v136 modules/fin-op.js `opWin` с `src:'fee'`): тип, сумма, контрагент (открывает вкладку
 * «Обслуживание») и дата — в шапке; ниже — «За что», «Куда поступили», отметки «Удалена» и «Изменена»,
 * файлы и свёрнутая «История» («было → стало», кто создал и изменил). Внизу — «Действия» («Открыть
 * источник», «Удалить») и «Изменить» с замком и причиной; у части общего поступления «Изменить»
 * открывает само поступление, а «Открыть источник» — его окно.
 */

/** «За что» (прототип fpWhat): «Обслуживание за октябрь 2026, ноябрь 2026 · аванс 2 000 сом». */
function whatOf(t: Translate, p: FeePaymentWindow): string {
  const allocated = p.allocation.reduce((a, x) => a + x.amount, 0);
  if (!p.allocation.length) return t('fin.j.fee_adv');
  const months = p.allocation.map((x) => monthLabel(x.month as `${number}-${number}`)).join(', ');
  const advance = p.amount - allocated;
  return `${t('fin.j.fee_months', { months })}${
    advance > 0 ? t('fin.j.fee_more_adv', { amount: formatSomWithUnit(advance) }) : ''
  }`;
}

function historyItems(t: Translate, p: FeePaymentWindow): TimelineItem[] {
  return p.history.map((h) => {
    const at = new Date(h.at);
    return {
      id: String(h.id),
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: feePaymentHistoryText(t, { ...h, reason: h.reason ?? null }),
      who: h.actor ?? t('status.system'),
    };
  });
}

export function FeePaymentWindowDialog({
  id,
  open,
  onClose,
  onOpenReport,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  /** Отчёт из окна поступления-источника. */
  onOpenReport: (reportId: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const refresh = useFinanceRefresh();
  const query = useQuery(feePaymentQuery(id));
  const [del, setDel] = useState<DialogSlot<FeePaymentWindow> | null>(null);
  const [edit, setEdit] = useState<DialogSlot<FeePaymentWindow> | null>(null);
  const [child, setChild] = useState<DialogSlot<string> | null>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const p = query.data;
  const failed =
    query.isError && !p
      ? errorText(
          query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
        )
      : null;
  const lock = p && !p.deleted ? (p.locks.edit ?? p.locks.del) : null;

  const openContractor = () => {
    if (!p) return;
    onClose();
    openContractorCard({ id: p.contractor.id }, 'fee');
  };

  const items: KeyValueItem[] = [];
  if (p) {
    const what = whatOf(t, p);
    items.push(
      { id: 'what', label: t('fin.op.what'), value: what },
      {
        id: 'to',
        label: t('fin.fee.to'),
        value: (
          <span className="inline-flex items-center gap-1">
            <Icon name={p.toOwner ? 'user' : 'building'} size="sm" />
            {p.to}
          </span>
        ),
      },
    );
    if (p.note && p.note !== what)
      items.push({ id: 'note', label: t('fin.op.note'), value: p.note });
  }

  // «Действия» (прототип `opActs(d, false)`): «Изменить», «Открыть источник» — поступление, частью
  // которого пришла оплата, или вкладка «Обслуживание» контрагента, «Удалить»; у удалённой — источник.
  const actions: ActionEntry[] = [];
  if (p) {
    const source: ActionEntry = {
      id: 'source',
      label: t('fin.op.source'),
      icon: 'link',
      sub: p.receipt
        ? t('fin.fee.source_receipt', {
            amount: formatSomWithUnit(p.receipt.total),
            date: formatDateRu(p.receipt.date),
          })
        : t('fin.fee.source_cp'),
      run: () => (p.receipt ? setChild(openSlot(p.receipt.id)) : openContractor()),
    };
    if (p.deleted) actions.push(source);
    else
      actions.push(
        {
          id: 'edit',
          label: t('fin.op.edit'),
          icon: 'edit',
          disabled: !!p.locks.edit,
          reason: p.locks.edit?.text,
          run: () => setEdit(openSlot(p)),
        },
        source,
        { id: 's1', separator: true },
        {
          id: 'delete',
          label: t('fin.del.ok'),
          icon: 'trash',
          danger: true,
          disabled: !!p.locks.del,
          reason: p.locks.del?.text,
          run: () => setDel(openSlot(p)),
        },
      );
  }

  const footer = (
    <>
      {p ? (
        <OpMoreButton t={t} open={more !== null} onClick={(el) => setMore(more ? null : el)} />
      ) : null}
      <div className="flex-1" />
      {p && !p.deleted ? (
        <WhyButton
          icon="edit"
          label={t('fin.op.edit')}
          why={p.locks.edit?.text ?? null}
          data="edit"
          cta
          onClick={() => setEdit(openSlot(p))}
        />
      ) : null}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={
        p ? t('fin.op.title', { kind: t('fin.fee.kind'), amount: formatSomWithUnit(p.amount) }) : ''
      }
      label={p ? undefined : t('fin.fee.open')}
      sub={
        p ? (
          <OpWindowSub name={p.contractor.name} date={p.date} onContractor={openContractor} />
        ) : undefined
      }
      footer={footer}
    >
      <div className="flex flex-col gap-3.5" data-fee-payment-window={id}>
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {p && (p.deleted || p.edited) ? (
          <div className="flex flex-wrap gap-1.5">
            {p.deleted ? (
              <Pill tone="bad" icon="trash">
                {t('fin.op.deleted_pill')}
              </Pill>
            ) : null}
            {p.edited ? (
              <Pill tone="warn" icon="edit">
                {t('fin.op.edited_pill')}
              </Pill>
            ) : null}
          </div>
        ) : null}
        {p?.deleted ? (
          <Note tone="bad" icon="trash">
            <b>{t('fin.op.deleted_pill')}</b>
            {' · '}
            {t('fin.op.deleted', {
              name: p.deleted.name ?? '—',
              at: formatMomentRu(new Date(p.deleted.at)),
              reason: p.deleted.reason,
            })}
          </Note>
        ) : lock ? (
          <Note icon="lock">{lock.text}</Note>
        ) : null}
        {p?.receipt ? (
          <Note icon="info">
            {t('fin.fee.receipt_note', {
              amount: formatSomWithUnit(p.receipt.total),
              date: formatDateRu(p.receipt.date),
            })}
          </Note>
        ) : null}
        {p ? (
          <Box>
            <KeyValues items={items} />
          </Box>
        ) : null}
        {p?.files ? <RecordFiles source={{ kind: 'fee_payment', id: p.id }} /> : null}
        {p ? (
          <OpHistoryFold t={t} items={historyItems(t, p)} created={p.created} updated={p.updated} />
        ) : null}
      </div>
      {more && p ? (
        <ActionMenu
          items={actions}
          place={{ anchor: more }}
          label={t('status.act.more')}
          onClose={() => setMore(null)}
        />
      ) : null}
      {del ? (
        <FeePaymentDeleteDialog
          key={`del-${del.n}`}
          payment={del.data}
          open={del.open}
          onClose={() => setDel(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {edit && edit.data.editReceipt && edit.data.receipt ? (
        <ReceiptEditDialog
          key={`edit-${edit.n}`}
          id={edit.data.receipt.id}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          onDone={refresh}
          onOpenOperation={(next) => setChild(openSlot(next))}
        />
      ) : edit ? (
        <FeePaymentEditDialog
          key={`edit-${edit.n}`}
          id={edit.data.id}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {child ? (
        <OperationWindowDialog
          key={`op-${child.n}`}
          id={child.data}
          open={child.open}
          onClose={() => setChild(closeSlot)}
          onOpenReport={onOpenReport}
        />
      ) : null}
    </Modal>
  );
}
