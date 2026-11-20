'use client';

import type { AdminSubscriptionCard, AdminSubscriptionPayment } from '@buhuchet/shared';
import { useToast } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { storageFileDownloadHref, storageFileViewSrc } from '../afiles/afiles-data';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FileViewer, type ViewerFile } from '../files/file-viewer';
import { useT } from '../l10n/provider';
import { SubConfirmDialog, SubEditDialog, SubRejectDialog } from './sub-dialogs';
import { SubOrgWindow, SubPayWindow, type SubBodyActions } from './sub-org-window';
import { subCardQuery } from './subs-data';

/*
 * Окна вкладки «Подписки» (прототип admin/subs-admin.js, действия `data-subact`): «Подписка
 * организации», окно оплаты, «Подтвердить оплату», «Отклонить чек», «Изменить подписку» и чек в окне
 * просмотра файлов (прототип `fileView`; байты и «Скачать» — методы модуля «Файлы» Админки, вид
 * `receipt`). `nodes` — в разметку экрана; вкладка «Подписка» карточки организации берёт `act`.
 */

type Payment = AdminSubscriptionPayment;
type Card = AdminSubscriptionCard;

export function useSubActions(opts: { onOrg?: (orgId: string) => void } = {}): {
  openWindow: (orgId: string, name: string) => void;
  openEdit: (orgId: string) => void;
  act: SubBodyActions;
  nodes: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const [win, setWin] = useState<DialogSlot<{ orgId: string; name: string }> | null>(null);
  const [pay, setPay] = useState<DialogSlot<{ p: Payment; card: Card }> | null>(null);
  const [ok, setOk] = useState<DialogSlot<{ p: Payment; card: Card }> | null>(null);
  const [rej, setRej] = useState<DialogSlot<{ p: Payment; card: Card }> | null>(null);
  const [edit, setEdit] = useState<DialogSlot<Card> | null>(null);
  const [view, setView] = useState<DialogSlot<ViewerFile> | null>(null);
  const onOrg = opts.onOrg;

  const openWindow = useCallback(
    (orgId: string, name: string) => setWin(openSlot({ orgId, name })),
    [],
  );

  /** «Изменить подписку» открывается по свежему окну подписки: поля сразу с нынешними значениями. */
  const openEdit = useCallback(
    (orgId: string) =>
      void (async () => {
        try {
          const card = await client.fetchQuery({ ...subCardQuery(orgId), staleTime: 0 });
          setEdit(openSlot(card));
        } catch {
          toast(t('subs.win.load_error'), { bad: true, icon: 'alert' });
        }
      })(),
    [client, t, toast],
  );

  /** Чек — в окне просмотра поверх окна подписки (номер файла — номер оплаты). */
  const receipt = useCallback((p: Payment) => {
    if (!p.receipt) return;
    setView(
      openSlot<ViewerFile>({
        id: p.id,
        name: p.receipt.name,
        size: p.receipt.bytes,
        contentType: p.receipt.type,
      }),
    );
  }, []);

  const act = useMemo<SubBodyActions>(
    () => ({
      confirm: (p, card) => setOk(openSlot({ p, card })),
      reject: (p, card) => setRej(openSlot({ p, card })),
      pay: (p, card) => setPay(openSlot({ p, card })),
      receipt,
    }),
    [receipt],
  );

  /** После проверки чека окно оплаты больше не нужно (прототип: `MODALS.filter(x=>x.o.payWin)…close()`). */
  const decided = () => {
    setOk(closeSlot);
    setRej(closeSlot);
    setPay(closeSlot);
  };

  const nodes = (
    <>
      {win ? (
        <SubOrgWindow
          key={`sub-win-${win.n}`}
          orgId={win.data.orgId}
          name={win.data.name}
          open={win.open}
          onClose={() => setWin(closeSlot)}
          onOrg={(id) => onOrg?.(id)}
          onEdit={openEdit}
          act={act}
        />
      ) : null}
      {pay ? (
        <SubPayWindow
          key={`sub-pay-${pay.n}`}
          p={pay.data.p}
          card={pay.data.card}
          open={pay.open}
          onClose={() => setPay(closeSlot)}
          act={act}
        />
      ) : null}
      {ok ? (
        <SubConfirmDialog
          key={`sub-ok-${ok.n}`}
          p={ok.data.p}
          card={ok.data.card}
          open={ok.open}
          onClose={() => setOk(closeSlot)}
          onDone={decided}
        />
      ) : null}
      {rej ? (
        <SubRejectDialog
          key={`sub-rej-${rej.n}`}
          p={rej.data.p}
          card={rej.data.card}
          open={rej.open}
          onClose={() => setRej(closeSlot)}
          onDone={decided}
        />
      ) : null}
      {edit ? (
        <SubEditDialog
          key={`sub-edit-${edit.n}`}
          card={edit.data}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
        />
      ) : null}
      {view ? (
        <FileViewer
          key={`sub-receipt-${view.n}`}
          files={[view.data]}
          index={0}
          open={view.open}
          onClose={() => setView(closeSlot)}
          src={(id) => storageFileViewSrc({ kind: 'receipt', id })}
          download={(id) => storageFileDownloadHref({ kind: 'receipt', id })}
        />
      ) : null}
    </>
  );
  return { openWindow, openEdit, act, nodes };
}
