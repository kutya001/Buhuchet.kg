'use client';

import type { AdminSubscriptionCard, AdminSubscriptionPayment } from '@buhuchet/shared';
import { useToast } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { SubConfirmDialog, SubEditDialog, SubRejectDialog } from './sub-dialogs';
import { SubOrgWindow, SubPayWindow, type SubBodyActions } from './sub-org-window';
import { subCardQuery, subReceiptLink } from './subs-data';

/*
 * Окна вкладки «Подписки» (прототип admin/subs-admin.js, действия `data-subact`): «Подписка
 * организации», окно оплаты, «Подтвердить оплату», «Отклонить чек», «Изменить подписку» и чек в новой
 * вкладке. `nodes` — в разметку экрана; вкладка «Подписка» карточки организации берёт `act`.
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
  const errorText = useErrorText();
  const client = useQueryClient();
  const [win, setWin] = useState<DialogSlot<{ orgId: string; name: string }> | null>(null);
  const [pay, setPay] = useState<DialogSlot<{ p: Payment; card: Card }> | null>(null);
  const [ok, setOk] = useState<DialogSlot<{ p: Payment; card: Card }> | null>(null);
  const [rej, setRej] = useState<DialogSlot<{ p: Payment; card: Card }> | null>(null);
  const [edit, setEdit] = useState<DialogSlot<Card> | null>(null);
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

  /**
   * Чек — в новой вкладке по ссылке на 15 минут: вкладка открывается сразу по нажатию (иначе её закроет
   * блокировщик всплывающих окон), адрес ей ставится, когда придёт ссылка.
   */
  const receipt = useCallback(
    (p: Payment) =>
      void (async () => {
        const tab = window.open('', '_blank');
        if (tab) tab.opener = null;
        const res = await subReceiptLink(p.id);
        if (!res.ok) {
          tab?.close();
          return toast(errorText(res.error), { bad: true, icon: 'alert' });
        }
        if (tab) tab.location.href = res.data.url;
        else window.open(res.data.url, '_blank', 'noopener,noreferrer');
      })(),
    [errorText, toast],
  );

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
    </>
  );
  return { openWindow, openEdit, act, nodes };
}
