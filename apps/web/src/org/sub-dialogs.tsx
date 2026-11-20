'use client';

import { useToast } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FileViewer } from '../files/file-viewer';
import { useT } from '../l10n/provider';
import { orgSubQuery, subReceiptDownloadHref, subReceiptViewSrc } from './sub-data';
import { pendingOf, type PayMode, type SubPay, type SubView } from './sub-model';
import { SubPayDialog } from './sub-pay-dialog';
import { ReplaceReceiptDialog, SubPayView } from './sub-pay-view';

/*
 * Окна экрана «Подписка» владельца одним хуком (прототип v154 `subPayDlg`, `subPayView`, `subFileDlg`;
 * этап 1, П7, поток И): оплата, оплата из «Истории оплат», «Заменить файл чека» и чек в окне просмотра.
 * Окно оплаты из истории берёт оплату из свежего ответа экрана — после замены чека видна новая.
 */

export interface SubDialogs {
  /** «Продлить», «Расширить пакет», «Купить память»; `pre` — «Прикрепить другой чек». */
  pay: (view: SubView, mode: PayMode, pre?: SubPay | null) => void;
  view: (view: SubView, pay: SubPay) => void;
  file: (pay: SubPay) => void;
  receipt: (pay: SubPay) => void;
  node: React.ReactNode;
}

export function useSubDialogs(): SubDialogs {
  const t = useT();
  const toast = useToast();
  const fresh = useQuery({ ...orgSubQuery, enabled: false }).data;
  const [paySlot, setPaySlot] = useState<DialogSlot<{
    view: SubView;
    mode: PayMode;
    pre: SubPay | null;
  }> | null>(null);
  const [viewSlot, setViewSlot] = useState<DialogSlot<{ view: SubView; id: string }> | null>(null);
  const [fileSlot, setFileSlot] = useState<DialogSlot<SubPay> | null>(null);
  const [receiptSlot, setReceiptSlot] = useState<DialogSlot<SubPay> | null>(null);

  const pay = useCallback(
    (view: SubView, mode: PayMode, pre: SubPay | null = null) => {
      if (pendingOf(view)) {
        toast(t('err.sub_pending'), { icon: 'clock', bad: true });
        return;
      }
      let m = mode;
      if (m !== 'renew' && (!view.sub || view.closed)) {
        toast(t('err.sub_renew_first'), { icon: 'info' });
        m = 'renew';
      }
      setPaySlot(openSlot({ view, mode: m, pre }));
    },
    [t, toast],
  );
  const file = useCallback(
    (p: SubPay) => {
      if (p.status !== 'pending') {
        toast(t('err.sub_pay_decided'), { icon: 'alert', bad: true });
        return;
      }
      setFileSlot(openSlot(p));
    },
    [t, toast],
  );
  const view = useCallback(
    (v: SubView, p: SubPay) => setViewSlot(openSlot({ view: v, id: p.id })),
    [],
  );
  const receipt = useCallback((p: SubPay) => {
    if (p.receipt) setReceiptSlot(openSlot(p));
  }, []);

  const shownView = viewSlot ? (fresh ?? viewSlot.data.view) : null;
  const shownPay = viewSlot
    ? (shownView?.payments.find((x) => x.id === viewSlot.data.id) ??
      viewSlot.data.view.payments.find((x) => x.id === viewSlot.data.id))
    : undefined;

  const node = (
    <>
      {paySlot ? (
        <SubPayDialog
          key={`sub-pay-${paySlot.n}`}
          open={paySlot.open}
          view={paySlot.data.view}
          mode={paySlot.data.mode}
          pre={paySlot.data.pre}
          onClose={() => setPaySlot(closeSlot)}
        />
      ) : null}
      {viewSlot && shownView && shownPay ? (
        <SubPayView
          key={`sub-view-${viewSlot.n}`}
          open={viewSlot.open}
          pay={shownPay}
          checkDays={shownView.prices.checkDays}
          closed={shownView.closed}
          own
          onClose={() => setViewSlot(closeSlot)}
          onReceipt={receipt}
          onFile={file}
          onAgain={(p) => {
            setViewSlot(closeSlot);
            pay(shownView, p.kind === 'grow' || p.kind === 'mem' ? p.kind : 'renew', p);
          }}
        />
      ) : null}
      {fileSlot ? (
        <ReplaceReceiptDialog
          key={`sub-file-${fileSlot.n}`}
          open={fileSlot.open}
          pay={fileSlot.data}
          onClose={() => setFileSlot(closeSlot)}
        />
      ) : null}
      {receiptSlot && receiptSlot.data.receipt ? (
        <FileViewer
          key={`sub-receipt-${receiptSlot.n}`}
          open={receiptSlot.open}
          files={[
            {
              id: receiptSlot.data.id,
              name: receiptSlot.data.receipt.name,
              size: receiptSlot.data.receipt.bytes ?? 0,
              contentType: receiptSlot.data.receipt.type ?? undefined,
            },
          ]}
          index={0}
          src={subReceiptViewSrc}
          download={subReceiptDownloadHref}
          onClose={() => setReceiptSlot(closeSlot)}
        />
      ) : null}
    </>
  );
  return { pay, view, file, receipt, node };
}
