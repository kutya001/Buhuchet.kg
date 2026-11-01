'use client';

import {
  leadBack,
  leadCanConnect,
  leadCanCreateOrg,
  leadCanReject,
  leadCanStart,
  type LeadStatus,
} from '@buhuchet/domain';
import { AdminLeadCard, type AdminLead } from '@buhuchet/shared';
import { ConfirmDialog, RollbackDialog, useToast, type ActionEntry } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { rollbackLabels, rollbackTitle, statusName } from '../status/status-view';
import { LeadCardDialog } from './lead-card';
import { LeadRefuseDialog } from './lead-refuse-dialog';
import { leadCardQuery, leadState, removeLead, setLeadStatus, useLeadsRefresh } from './leads-data';
import { NewOrganizationDialog, type OrgFromLead } from './new-org-dialog';

/** «Фирма · Имя» — подзаголовок окон «Отказ» и отката (прототип leadRefuse, rollbackDlg). */
const leadSub = (l: AdminLead) => `${l.firm} · ${l.name}`;

/** Как сменить статус: шаг вперёд, «Отказ» с причиной или откат с причиной. */
type Move = 'step' | 'reject' | 'rollback';

/**
 * Действия с заявкой (прототип admin/leads.js — `leadActions`, `leadStep`, `leadRefuse`, `leadDel`,
 * `leadOrg`; откат — `rollbackDlg` для `lead`): в списке — «⋯», долгим нажатием и правым кликом; в
 * окне заявки — «Ещё действия», шкала и главная кнопка. «В работу» — сразу; «Отметить «Подключена»» —
 * после вопроса; «Отказ» — окном с причиной; откат и «Снять «Отказ»» — окном с причиной («Подключена»
 * с созданной организацией не откатывается — пункт неактивен с причиной); «Создать организацию» —
 * форма с фирмой и ФИО из заявки; «Удалить» — после вопроса, окно заявки закрывается. Отказ сервера —
 * уведомлением или под полем причины.
 */
export function useLeadActions(): {
  actions: (l: AdminLead) => ActionEntry[];
  openCard: (id: string) => void;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useLeadsRefresh();
  const [card, setCard] = useState<DialogSlot<string> | null>(null);
  const [org, setOrg] = useState<DialogSlot<OrgFromLead> | null>(null);
  const [refuse, setRefuse] = useState<DialogSlot<AdminLead> | null>(null);
  const [connect, setConnect] = useState<AdminLead | null>(null);
  const [remove, setRemove] = useState<AdminLead | null>(null);
  const [back, setBack] = useState<DialogSlot<{ l: AdminLead; to: LeadStatus }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const once = async <T,>(key: string, send: () => Promise<T>): Promise<T | null> => {
    if (pending.has(key)) return null;
    setPending((x) => new Set(x).add(key));
    try {
      return await send();
    } finally {
      setPending((x) => {
        const next = new Set(x);
        next.delete(key);
        return next;
      });
    }
  };

  /** Смена статуса; новая заявка — в окно, список, число новых и плитки — перечитать. */
  const move = async (l: AdminLead, to: LeadStatus, how: Move, reason?: string) => {
    const res = await once(l.id, () =>
      setLeadStatus(l.id, { to, version: l.version, ...(reason ? { reason } : {}) }),
    );
    if (!res) return false;
    refresh();
    if (!res.ok) {
      if (how === 'step') toast(errorText(res.error), { bad: true });
      else setDialogError(errorText(res.error));
      return false;
    }
    const next = AdminLeadCard.safeParse(res.data);
    if (next.success) client.setQueryData(leadCardQuery(l.id).queryKey, next.data);
    if (how === 'reject') toast(t('leads.toast.rejected'), { icon: 'ban' });
    else if (how === 'rollback') toast(t('status.rollback_done'), { icon: 'history' });
    else if (to === 'connected') toast(t('leads.toast.connected'));
    else toast(t('leads.toast.status', { status: statusName(t, 'lead', to) }));
    return true;
  };

  /** Шаг вперёд (меню, шкала, главная кнопка): «Подключена» — после вопроса. */
  const step = (l: AdminLead, to: LeadStatus) => {
    if (to === 'connected') setConnect(l);
    else void move(l, to, 'step');
  };

  const startBack = (l: AdminLead, to: LeadStatus) => {
    setDialogError(undefined);
    setBack(openSlot({ l, to }));
  };

  const startRefuse = (l: AdminLead) => {
    setDialogError(undefined);
    setRefuse(openSlot(l));
  };

  const startOrg = (l: AdminLead) =>
    setOrg(openSlot<OrgFromLead>({ id: l.id, at: l.at, firm: l.firm, name: l.name }));

  const drop = async (l: AdminLead) => {
    const res = await once(l.id, () => removeLead(l.id));
    if (!res) return;
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    // Прототип leadDel: окно удалённой заявки закрывается.
    setCard((c) => (c?.data === l.id ? closeSlot(c) : c));
    client.removeQueries({ queryKey: leadCardQuery(l.id).queryKey });
    toast(t('leads.toast.deleted'), { icon: 'trash' });
  };

  /** Пункты меню (прототип `leadActions`); в окне заявки — без «Открыть заявку». */
  const entries = (l: AdminLead, inCard: boolean): ActionEntry[] => {
    const s = leadState(l);
    const items: ActionEntry[] = [];
    if (!inCard)
      items.push({
        id: 'open',
        label: t('leads.act.open'),
        icon: 'file',
        run: () => setCard(openSlot(l.id)),
      });
    if (leadCanStart(s))
      items.push({
        id: 'start',
        label: t('leads.act.start'),
        icon: 'hourglass',
        run: () => step(l, 'in_progress'),
      });
    if (leadCanCreateOrg(s))
      items.push({
        id: 'org',
        label: t('leads.act.org'),
        icon: 'building',
        run: () => startOrg(l),
      });
    if (leadCanConnect(s))
      items.push({
        id: 'connect',
        label: t('leads.act.connect'),
        icon: 'check',
        run: () => step(l, 'connected'),
      });
    if (leadCanReject(s))
      items.push({
        id: 'reject',
        label: t('leads.act.reject'),
        icon: 'ban',
        run: () => startRefuse(l),
      });
    items.push({ id: 's1', separator: true });
    if (l.status !== 'new') {
      const bk = leadBack(s);
      const to = bk && 'to' in bk ? bk.to : null;
      items.push({
        id: 'rollback',
        // Прототип: у «Подключена» с организацией — «Откатить в «—»», неактивно с причиной.
        label:
          l.status === 'rejected'
            ? t('leads.act.unreject')
            : t('leads.act.rollback', { status: to ? statusName(t, 'lead', to) : '—' }),
        icon: 'history',
        disabled: !to,
        reason: bk && 'locked' in bk ? t('leads.back_locked') : '',
        run: () => to && startBack(l, to),
      });
    }
    items.push({
      id: 'delete',
      label: t('leads.act.delete'),
      icon: 'trash',
      danger: true,
      run: () => setRemove(l),
    });
    return items;
  };

  const backTo = back?.data.to;
  const dialogs = (
    <>
      {card ? (
        <LeadCardDialog
          key={`lead-card-${card.n}`}
          id={card.data}
          open={card.open}
          onClose={() => setCard(closeSlot)}
          menu={(l) => entries(l, true)}
          onStep={step}
          onBack={startBack}
          onOrg={startOrg}
        />
      ) : null}
      {org ? (
        <NewOrganizationDialog
          key={`lead-org-${org.n}`}
          lead={org.data}
          open={org.open}
          onClose={() => setOrg(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {refuse ? (
        <LeadRefuseDialog
          key={`lead-refuse-${refuse.n}`}
          open={refuse.open}
          onClose={() => setRefuse(closeSlot)}
          sub={leadSub(refuse.data)}
          busy={busy}
          error={dialogError}
          onConfirm={(reason) => {
            setBusy(true);
            void move(refuse.data, 'rejected', 'reject', reason).then((ok) => {
              setBusy(false);
              if (ok) setRefuse(closeSlot);
            });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={connect !== null}
        onClose={() => setConnect(null)}
        title={t('leads.connect.title')}
        text={t('leads.connect.text', { firm: connect?.firm ?? '' })}
        ok={t('leads.connect.ok')}
        onConfirm={() => connect && void move(connect, 'connected', 'step')}
      />
      <ConfirmDialog
        open={remove !== null}
        onClose={() => setRemove(null)}
        title={t('leads.delete.title')}
        text={t('leads.delete.text')}
        ok={t('leads.delete.ok')}
        danger
        onConfirm={() => remove && void drop(remove)}
      />
      {back && backTo ? (
        <RollbackDialog
          key={`lead-back-${back.n}`}
          open={back.open}
          onClose={() => setBack(closeSlot)}
          title={rollbackTitle(t, 'lead', back.data.l.status, backTo)}
          sub={leadSub(back.data.l)}
          consequences={t(
            back.data.l.status === 'rejected'
              ? 'leads.rollback.unreject'
              : 'status.rollback_effect.lead',
            { name: statusName(t, 'lead', backTo) },
          )}
          busy={busy}
          error={dialogError}
          labels={rollbackLabels(t)}
          onConfirm={(reason) => {
            setBusy(true);
            void move(back.data.l, backTo, 'rollback', reason).then((ok) => {
              setBusy(false);
              if (ok) setBack(closeSlot);
            });
          }}
        />
      ) : null}
    </>
  );

  return {
    actions: (l) => entries(l, false),
    openCard: (id) => setCard(openSlot(id)),
    dialogs,
  };
}
