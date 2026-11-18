'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
} from '@buhuchet/domain';
import type { OperationWindow } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  Icon,
  KeyValues,
  linkButtonClass,
  MiniTable,
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
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { RecordFiles } from '../files/record-files';
import { fileHistoryText } from '../files/file-history';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { ReceiptEditDialog } from '../money/tax-dialogs';
import { CorrectionDialog, OperationDeleteDialog, WhyButton } from './finance-dialogs';
import {
  operationDeletedText,
  operationEditedText,
  receiptCreatedText,
  signedSom,
} from './finance-history';
import { OpHistoryFold, OpMoreButton, OpWindowSub } from './op-window-parts';
import { OperationEditDialog } from './operation-edit';
import { operationQuery, useFinanceRefresh } from './finance-data';

/*
 * Окно финансовой операции (задачи 2.20 и 2.22; ТЗ «Финансовые операции по контрагентам» → «Окно
 * оплаты», «Обратные записи», «Изменить» и «Удалить»; прототип v136 modules/fin-op.js `opWin`, `opHistIn`;
 * решение заказчика 17.11.2026 «Меньше текста, понятнее, плавнее»): тип, сумма, контрагент и дата — в
 * шапке и в таблице не повторяются; ниже — поля, как их вводили, отметка «Изменена», детализация
 * поступления, обратные записи, файлы и свёрнутая «История» (изменения «было → стало», кто создал и
 * изменил). Внизу один ряд: «Действия» («Обратная запись», «Открыть источник» — отчёт или вкладка
 * «Деньги», «Удалить») и «Изменить» — с замком и причиной (поступление изменяется своим окном, прочие —
 * `opEditDlg`); «Готово» нет.
 */

type HistoryRow = OperationWindow['history'][number];

/**
 * Строка «Истории изменений» окна (прототип opLog): поступление — «Поступление 5 000 сом записано»;
 * удаление — «Списание отменено: списание в бонус на 300 сом от 18.10.2026. Причина: …»; обратная
 * запись к поступлению — «Обратная запись +100 сом: …».
 */
export function operationHistoryText(t: Translate, op: OperationWindow, h: HistoryRow): string {
  if (h.action === 'create') return receiptCreatedText(t, h.changes) ?? t('cp.hist.update');
  // Файлы операции (прототип opLog: «Прикреплены файлы: …»).
  const file = (key: 'from' | 'to') =>
    String(h.changes.find((c) => c.field === 'file')?.[key] ?? '');
  const shared = fileHistoryText(t, h);
  if (shared !== null) return shared;
  if (h.action === 'file_attach') return t('report.hist.file_attach', { name: file('to') });
  if (h.action === 'file_delete') return t('report.hist.file_delete', { name: file('from') });
  if (h.action === 'file_hide') return t('files.hist.page_hide', { name: file('to') });
  if (h.action === 'file_show') return t('files.hist.page_show', { name: file('to') });
  if (h.action === 'delete')
    return (
      operationDeletedText(t, h.changes, h.reason, {
        kind: op.kind,
        amount: op.amount,
        date: op.date,
      }) ?? t('cp.hist.update')
    );
  const corr = h.changes.find((c) => c.field === 'correction')?.to;
  if (typeof corr === 'number')
    return t('fin.hist.correction', { amount: signedSom(corr), reason: h.reason ?? '' });
  const edited = operationEditedText(t, h.changes, h.reason);
  if (edited) return edited;
  return h.reason ? `${t('cp.hist.update')} (${h.reason})` : t('cp.hist.update');
}

function historyItems(t: Translate, op: OperationWindow): TimelineItem[] {
  return op.history.map((h) => {
    const at = new Date(h.at);
    return {
      id: String(h.id),
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: operationHistoryText(t, op, h),
      who: h.actor ?? t('status.system'),
    };
  });
}

/** «За что» операции (прототип opView `what`). */
function whatOf(t: Translate, op: OperationWindow): string {
  if (op.kind === 'pay' && op.report) return op.report.label;
  if (op.kind === 'xfer') return t('fin.basis.xfer', { name: op.holder.name ?? '—' });
  if (op.kind === 'corr' && op.receipt)
    return `${t('fin.basis.corr', { date: formatDateRu(op.receipt.date) })}${op.note ? `: ${op.note}` : ''}`;
  if (op.kind === 'back' && op.report) return t('fin.basis.back', { n: op.report.revision });
  return op.note || '—';
}

/**
 * Окно операции (прототип opWin). `onOpenReport` — открыть отчёт (детализация, «За что», «Открыть
 * источник»); без него «Открыть источник» ведёт на вкладку «Деньги» контрагента.
 */
export function OperationWindowDialog({
  id,
  open,
  onClose,
  onOpenReport,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onOpenReport: (reportId: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const refresh = useFinanceRefresh();
  const query = useQuery(operationQuery(id));
  const [del, setDel] = useState<DialogSlot<OperationWindow> | null>(null);
  const [corr, setCorr] = useState<DialogSlot<OperationWindow> | null>(null);
  const [child, setChild] = useState<DialogSlot<string> | null>(null);
  const [edit, setEdit] = useState<DialogSlot<OperationWindow> | null>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const op = query.data;
  const corrections = op?.corrections.filter((x) => !x.deleted) ?? [];
  const failed =
    query.isError && !op
      ? errorText(
          query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
        )
      : null;

  const openReport = (reportId: string) => {
    onClose();
    onOpenReport(reportId);
  };
  const openContractor = () => {
    if (!op) return;
    onClose();
    openContractorCard({ id: op.contractor.id }, 'money');
  };

  const kindLabel = op
    ? t(op.self && op.kind === 'pay' ? 'money.op.self' : `money.op.${op.kind}`)
    : '';
  const lock = op && !op.deleted ? (op.locks.edit ?? op.locks.del) : null;

  const items: KeyValueItem[] = [];
  if (op) {
    if (op.kind === 'in' && op.receiptParts) {
      items.push({
        id: 'tax',
        label: t('fin.op.tax'),
        value: <span className="tabular-nums">{formatSomWithUnit(op.receiptParts.tax)}</span>,
      });
      if (op.receiptParts.fee)
        items.push({
          id: 'fee',
          label: t('fin.op.fee'),
          value: <span className="tabular-nums">{formatSomWithUnit(op.receiptParts.fee)}</span>,
        });
      items.push({
        id: 'advance',
        label: t('fin.op.advance'),
        value: <span className="tabular-nums">{formatSomWithUnit(op.receiptParts.advance)}</span>,
      });
    } else {
      const what = whatOf(t, op);
      items.push({
        id: 'what',
        label: t('fin.op.what'),
        value: op.report ? (
          <button
            type="button"
            className={linkButtonClass()}
            onClick={() => openReport(op.report!.id)}
          >
            {what}
          </button>
        ) : (
          what
        ),
      });
    }
    const acc =
      op.kind === 'pay' && op.self
        ? t('fin.op.acc_client')
        : op.holder.kind === 'org'
          ? t('fin.op.acc_org')
          : t('fin.op.acc_emp', { name: op.holder.name ?? '—' });
    items.push({
      id: 'acc',
      label: t(op.kind === 'xfer' ? 'fin.op.to_account' : 'fin.op.account'),
      value: (
        <span className="inline-flex items-center gap-1">
          <Icon name={op.holder.kind === 'org' || op.self ? 'building' : 'user'} size="sm" />
          {acc}
        </span>
      ),
    });
    if (op.note && op.note !== whatOf(t, op) && op.kind !== 'corr')
      items.push({ id: 'note', label: t('fin.op.note'), value: op.note });
  }

  // «Действия» (прототип `opActs(d, false)`): «Изменить», у поступления «Обратная запись», «Открыть
  // источник», «Удалить» («Отменить списание», «Отменить возврат»); у удалённой — только источник.
  const actions: ActionEntry[] = [];
  if (op) {
    const source: ActionEntry = {
      id: 'source',
      label: t('fin.op.source'),
      icon: 'link',
      sub: op.report
        ? t('fin.op.source_report', { report: op.report.label })
        : t('fin.op.source_cp'),
      run: () => (op.report ? openReport(op.report.id) : openContractor()),
    };
    if (op.deleted) actions.push(source);
    else {
      actions.push({
        id: 'edit',
        label: t('fin.op.edit'),
        icon: 'edit',
        disabled: !!op.locks.edit,
        reason: op.locks.edit?.text,
        run: () => setEdit(openSlot(op)),
      });
      if (op.kind === 'in')
        actions.push({
          id: 'correction',
          label: t('fin.op.correction'),
          icon: 'refresh',
          sub: t('fin.op.act_corr_sub'),
          disabled: !!op.locks.edit,
          reason: op.locks.edit?.text,
          run: () => setCorr(openSlot(op)),
        });
      actions.push(source, { id: 's1', separator: true });
      actions.push({
        id: 'delete',
        label: t(
          op.kind === 'bonus'
            ? 'fin.del.ok_bonus'
            : op.kind === 'refund'
              ? 'fin.del.ok_refund'
              : 'fin.del.ok',
        ),
        icon: op.kind === 'bonus' || op.kind === 'refund' ? 'history' : 'trash',
        danger: true,
        disabled: !!op.locks.del,
        reason: op.locks.del?.text,
        run: () => setDel(openSlot(op)),
      });
    }
  }

  const allocated = op ? op.allocations.reduce((a, x) => a + x.amount, 0) : 0;
  const footer = (
    <>
      {op ? (
        <OpMoreButton t={t} open={more !== null} onClick={(el) => setMore(more ? null : el)} />
      ) : null}
      <div className="flex-1" />
      {op && !op.deleted ? (
        <WhyButton
          icon="edit"
          label={t('fin.op.edit')}
          why={op.locks.edit?.text ?? null}
          data="edit"
          cta
          onClick={() => setEdit(openSlot(op))}
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
        op
          ? t('fin.op.title', {
              kind: kindLabel,
              // Обратная запись — со знаком (прототип v136: «Обратная запись −100 сом»).
              amount: op.kind === 'corr' ? signedSom(op.amount) : formatSomWithUnit(op.amount),
            })
          : ''
      }
      // Пока операция не загрузилась, названия нет; потом имя окна — его заголовок («Списание в бонус 300 сом»).
      label={op ? undefined : t('fin.op.open')}
      sub={
        op ? (
          <OpWindowSub name={op.contractor.name} date={op.date} onContractor={openContractor} />
        ) : undefined
      }
      footer={footer}
    >
      <div className="flex flex-col gap-3.5" data-fin-op-window={id} data-fin-op-kind={op?.kind}>
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {op?.edited && !op.deleted ? (
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="warn" icon="edit">
              {t('fin.op.edited_pill')}
            </Pill>
          </div>
        ) : null}
        {op?.deleted ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Pill tone="bad" icon="trash">
                {t('fin.op.deleted_pill')}
              </Pill>
              {op.edited ? (
                <Pill tone="warn" icon="edit">
                  {t('fin.op.edited_pill')}
                </Pill>
              ) : null}
            </div>
            <Note tone="bad" icon="trash">
              <b>{t('fin.op.deleted_pill')}</b>
              {' · '}
              {t('fin.op.deleted', {
                name: op.deleted.name ?? '—',
                at: formatMomentRu(new Date(op.deleted.at)),
                reason: op.deleted.reason,
              })}
            </Note>
          </>
        ) : lock ? (
          <Note icon="lock">{lock.text}</Note>
        ) : null}
        {op && items.length ? (
          <Box>
            <KeyValues items={items} />
          </Box>
        ) : null}
        {op?.kind === 'in' ? (
          <Box title={t('fin.op.alloc')}>
            <MiniTable
              label={t('fin.op.alloc')}
              empty=""
              phoneCards={false}
              onOpen={(key) => key.startsWith('r:') && openReport(key.slice(2))}
              columns={[
                { key: 'what', label: t('fin.op.what') },
                { key: 'amount', label: t('fin.op.amount'), numeric: true },
              ]}
              rows={[
                ...op.allocations.map((x) => ({
                  key: `r:${x.reportId}`,
                  cells: { what: x.label, amount: formatSom(x.amount) },
                })),
                ...op.feeAllocations.map((x) => ({
                  key: `f:${x.month}`,
                  cells: {
                    what: (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="coins" size="sm" />
                        {t('fin.op.alloc_fee', {
                          month: monthLabel(x.month as `${number}-${number}`),
                        })}
                      </span>
                    ),
                    amount: formatSom(x.amount),
                  },
                })),
                ...(op.receiptParts && op.receiptParts.tax > allocated
                  ? [
                      {
                        key: 'advance',
                        cells: {
                          what: <span className="text-muted">{t('fin.op.alloc_advance')}</span>,
                          amount: formatSom(op.receiptParts.tax - allocated),
                        },
                      },
                    ]
                  : []),
                {
                  key: 'total',
                  cells: {
                    what: <b>{t('fin.op.total')}</b>,
                    amount: <b>{formatSom(op.amount)}</b>,
                  },
                },
              ]}
            />
          </Box>
        ) : null}
        {/* Отменённая обратная запись из списка уходит (прототип: вид `corr_x` в список не попадает). */}
        {corrections.length ? (
          <Box title={t('fin.op.corrections')}>
            <MiniTable
              label={t('fin.op.corrections')}
              empty=""
              phoneCards={false}
              headless
              onOpen={(key) => setChild(openSlot(key))}
              columns={[
                { key: 'date', label: t('fin.op.date') },
                { key: 'note', label: t('fin.op.note') },
                { key: 'who', label: t('fin.op.created') },
                { key: 'amount', label: t('fin.op.amount'), numeric: true },
              ]}
              rows={corrections.map((x) => ({
                key: x.id,
                cells: {
                  date: formatDateRu(x.date),
                  note: <span className="whitespace-normal">{x.note}</span>,
                  who: x.author ?? '—',
                  amount: `${x.amount > 0 ? '+' : '−'}${formatSom(Math.abs(x.amount))}`,
                },
              }))}
            />
          </Box>
        ) : null}
        {op?.files ? <RecordFiles source={{ kind: op.files.kind, id: op.id }} /> : null}
        {op ? (
          <OpHistoryFold
            t={t}
            items={historyItems(t, op)}
            created={op.created}
            updated={op.updated}
          />
        ) : null}
      </div>
      {more && op ? (
        <ActionMenu
          items={actions}
          place={{ anchor: more }}
          label={t('status.act.more')}
          onClose={() => setMore(null)}
        />
      ) : null}
      {del ? (
        <OperationDeleteDialog
          key={`del-${del.n}`}
          op={del.data}
          open={del.open}
          onClose={() => setDel(closeSlot)}
          onDone={refresh}
          onOpenOperation={(next) => setChild(openSlot(next))}
        />
      ) : null}
      {corr ? (
        <CorrectionDialog
          key={`corr-${corr.n}`}
          receipt={{
            id: corr.data.id,
            contractor: corr.data.contractor.name,
            total: corr.data.amount,
            date: corr.data.date,
          }}
          open={corr.open}
          onClose={() => setCorr(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {edit && edit.data.kind === 'in' ? (
        <ReceiptEditDialog
          key={`edit-${edit.n}`}
          id={edit.data.id}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          onDone={refresh}
          onOpenOperation={(next) => setChild(openSlot(next))}
        />
      ) : edit ? (
        <OperationEditDialog
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
