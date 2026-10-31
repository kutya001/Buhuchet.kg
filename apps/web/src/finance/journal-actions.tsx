'use client';

import { useToast } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FeePaymentEditDialog } from '../fees/fee-dialogs';
import { ReceiptEditDialog } from '../money/tax-dialogs';
import { FeePaymentWindowDialog } from './fee-payment-window';
import { operationQuery, useFinanceRefresh } from './finance-data';
import { CorrectionDialog, FeePaymentDeleteDialog, OperationDeleteDialog } from './finance-dialogs';
import { feePaymentQuery } from './journal-data';
import { OperationEditDialog } from './operation-edit';
import { OperationWindowDialog } from './operation-window';

/*
 * Действия строки журнала (задача 2.22; прототип modules/finance.js `finActions` → modules/fin-op.js
 * `opActs`): «Открыть» — окно операции или оплаты за обслуживание; «Изменить», «Обратная запись» и
 * «Удалить» — сразу своё окно, без окна операции под ним, как в прототипе. Окну удаления и обратной
 * записи нужна сама операция — она загружается; замок, который успел появиться, — уведомлением.
 */

export type JournalAction =
  | { act: 'open'; src: 'op' | 'fee'; id: string }
  | { act: 'edit'; src: 'op' | 'fee'; id: string; kind: string; receiptId: string | null }
  | { act: 'delete'; src: 'op' | 'fee'; id: string }
  | { act: 'correction'; id: string };

export function JournalActionDialog({
  action,
  open,
  onClose,
  onOpenReport,
}: {
  action: JournalAction;
  open: boolean;
  onClose: () => void;
  onOpenReport: (reportId: string) => void;
}) {
  const refresh = useFinanceRefresh();
  const [child, setChild] = useState<DialogSlot<string> | null>(null);
  const childWindow = child ? (
    <OperationWindowDialog
      key={`op-${child.n}`}
      id={child.data}
      open={child.open}
      onClose={() => setChild(closeSlot)}
      onOpenReport={onOpenReport}
    />
  ) : null;

  if (action.act === 'open')
    return action.src === 'fee' ? (
      <FeePaymentWindowDialog
        id={action.id}
        open={open}
        onClose={onClose}
        onOpenReport={onOpenReport}
      />
    ) : (
      <OperationWindowDialog
        id={action.id}
        open={open}
        onClose={onClose}
        onOpenReport={onOpenReport}
      />
    );
  if (action.act === 'edit') {
    // Поступление и оплата за обслуживание из него — окном поступления (прототип opEditDlg).
    const receipt =
      action.src === 'op' && action.kind === 'in'
        ? action.id
        : action.src === 'fee'
          ? action.receiptId
          : null;
    if (receipt)
      return (
        <>
          <ReceiptEditDialog
            id={receipt}
            open={open}
            onClose={onClose}
            onDone={refresh}
            onOpenOperation={(next) => setChild(openSlot(next))}
          />
          {childWindow}
        </>
      );
    return action.src === 'fee' ? (
      <FeePaymentEditDialog id={action.id} open={open} onClose={onClose} onDone={refresh} />
    ) : (
      <OperationEditDialog id={action.id} open={open} onClose={onClose} onDone={refresh} />
    );
  }
  if (action.act === 'delete' && action.src === 'fee')
    return <FeeDeleteById id={action.id} open={open} onClose={onClose} onDone={refresh} />;
  return (
    <>
      <OperationById
        id={action.id}
        act={action.act === 'correction' ? 'correction' : 'delete'}
        open={open}
        onClose={onClose}
        onDone={refresh}
        onOpenOperation={(next) => setChild(openSlot(next))}
      />
      {childWindow}
    </>
  );
}

/** Замок, появившийся после загрузки строки, — уведомлением, окно не открывается. */
function useLockToast(text: string | null, onClose: () => void) {
  const toast = useToast();
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!text) return;
    toast(text, { icon: 'lock', bad: true });
    close();
  }, [text, toast]);
}

function OperationById({
  id,
  act,
  open,
  onClose,
  onDone,
  onOpenOperation,
}: {
  id: string;
  act: 'delete' | 'correction';
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  onOpenOperation: (id: string) => void;
}) {
  const query = useQuery(operationQuery(id));
  const op = query.data;
  const lock = op ? ((act === 'delete' ? op.locks.del : op.locks.edit)?.text ?? null) : null;
  useLockToast(lock, onClose);
  if (!op || lock) return null;
  if (act === 'correction')
    return (
      <CorrectionDialog
        receipt={{ id: op.id, contractor: op.contractor.name, total: op.amount, date: op.date }}
        open={open}
        onClose={onClose}
        onDone={onDone}
      />
    );
  return (
    <OperationDeleteDialog
      op={op}
      open={open}
      onClose={onClose}
      onDone={onDone}
      onOpenOperation={onOpenOperation}
    />
  );
}

function FeeDeleteById({
  id,
  open,
  onClose,
  onDone,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const query = useQuery(feePaymentQuery(id));
  const p = query.data;
  const lock = p?.locks.del?.text ?? null;
  useLockToast(lock, onClose);
  if (!p || lock) return null;
  return <FeePaymentDeleteDialog payment={p} open={open} onClose={onClose} onDone={onDone} />;
}
