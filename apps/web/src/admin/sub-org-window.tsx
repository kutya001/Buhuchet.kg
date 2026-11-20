'use client';

import {
  formatDateRu,
  formatMomentRu,
  formatSomWithUnit,
  type IsoDate,
  type SubscriptionStatus,
} from '@buhuchet/domain';
import type { AdminSubscriptionCard, AdminSubscriptionPayment } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  EmptyState,
  Icon,
  KeyValues,
  linkButtonClass,
  Modal,
  Pill,
  Timeline,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { SubScreen } from '../org/sub-screen';
import { subCardQuery } from './subs-data';
import {
  SUB_PAY_TONE,
  SUB_STATUS_TONE,
  subHistoryItems,
  subLineText,
  subPayStatusText,
  subPayTerm,
  subPayWhat,
  subPayWho,
  subStatusText,
} from './subs-model';

/*
 * Окно «Подписка организации» Админки (доработки 20.11.2026, блок 6, пункты 2–4, 7; прототип
 * admin/subs-admin.js: subOrgWin, subOrgBody, subPayWin): чеки на проверке с «Подтвердить оплату» и
 * «Отклонить», сводка подписки, «История оплат», «История изменений». Тело — одно для окна и вкладки
 * «Подписка» карточки организации. Сводка и «История оплат» — экран «Подписка» владельца (`SubScreen`
 * с `admin`, поток И), как `subScreenHtml(orgId, {admin: true})` прототипа.
 */

type Payment = AdminSubscriptionPayment;

/** Что делают кнопки тела окна. */
export interface SubBodyActions {
  confirm: (p: Payment, card: AdminSubscriptionCard) => void;
  reject: (p: Payment, card: AdminSubscriptionCard) => void;
  pay: (p: Payment, card: AdminSubscriptionCard) => void;
  receipt: (p: Payment) => void;
}

const moment = (iso: string) => formatMomentRu(new Date(iso));

/** Статус подписки и «Ждёт проверки больше N дней» (прототип `subPill`). */
export function SubStatusPill({
  t,
  status,
  late,
  days,
}: {
  t: Translate;
  status: SubscriptionStatus;
  late: boolean;
  days: number;
}) {
  const tone = SUB_STATUS_TONE[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-sub-status={status}>
      {status === 'demo' ? (
        <span className="text-faint">{subStatusText(t, status)}</span>
      ) : (
        <Pill tone={tone.tone} icon={tone.icon} size="sm">
          {subStatusText(t, status)}
        </Pill>
      )}
      {late ? (
        <Pill tone="bad" icon="alert" size="sm">
          <span data-sub-late="">{t('subs.late', { days })}</span>
        </Pill>
      ) : null}
    </span>
  );
}

/** Статус оплаты (прототип `subPaySt`). */
export function SubPayPill({ t, p }: { t: Translate; p: Pick<Payment, 'status'> }) {
  const tone = SUB_PAY_TONE[p.status];
  return (
    <Pill tone={tone.tone} icon={tone.icon} size="sm">
      {subPayStatusText(t, p.status)}
    </Pill>
  );
}

/** Чек: название файла кнопкой (прототип `subFileBtn`). */
function ReceiptButton({
  t,
  p,
  onOpen,
}: {
  t: Translate;
  p: Payment;
  onOpen: (p: Payment) => void;
}) {
  if (!p.receipt) return <span className="text-faint">{t('subs.receipt.none')}</span>;
  return (
    <button
      type="button"
      className={linkButtonClass()}
      data-sub-receipt={p.id}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(p);
      }}
    >
      <Icon name="file" size="sm" />
      {p.receipt.name}
    </button>
  );
}

/** «Расчёт суммы»: строки и «Итого к оплате» (прототип `subLinesHtml`). */
export function SubCalcLines({ t, p }: { t: Translate; p: Pick<Payment, 'lines' | 'amount'> }) {
  if (!p.lines.length) return <span className="text-faint">{t('subs.calc.none')}</span>;
  const items: KeyValueItem[] = [
    ...p.lines.map((l, i) => ({
      id: `l${i}`,
      label: subLineText(t, l),
      value: <span className="tabular-nums">{formatSomWithUnit(l.sum)}</span>,
    })),
    {
      id: 'total',
      label: t('subs.line.total'),
      value: <strong className="tabular-nums">{formatSomWithUnit(p.amount)}</strong>,
      wide: true,
    },
  ];
  return <KeyValues items={items} />;
}

/** Кто и когда: имя и время строкой ниже (прототип `<div class="aud">`). */
function WhoAt({ who, at }: { who: string; at: string }) {
  return (
    <>
      {who}
      <div className="text-[11.5px] text-faint tabular-nums">{moment(at)}</div>
    </>
  );
}

/** Чек на проверке (прототип `subWaitHtml`). */
function SubWaitBox({
  t,
  card,
  p,
  act,
}: {
  t: Translate;
  card: AdminSubscriptionCard;
  p: Payment;
  act: SubBodyActions;
}) {
  const items: KeyValueItem[] = [
    { id: 'what', label: t('subs.k.what'), value: subPayWhat(t, p) },
    { id: 'term', label: t('subs.k.term'), value: `${p.planName} · ${subPayTerm(t, p)}` },
    { id: 'pack', label: t('subs.k.pack'), value: String(p.seats) },
    { id: 'gb', label: t('subs.k.gb'), value: t('subs.gb.n', { n: p.extraGb }) },
    {
      id: 'sent',
      label: t('subs.k.sent'),
      value: <WhoAt who={subPayWho(t, p.createdBy)} at={p.createdAt} />,
    },
    {
      id: 'receipt',
      label: t('subs.k.receipt'),
      value: <ReceiptButton t={t} p={p} onOpen={act.receipt} />,
    },
    {
      id: 'access',
      label: t('subs.k.access'),
      value: t(p.opensAccess ? 'subs.access.open' : 'subs.access.closed'),
    },
    ...(p.late
      ? [
          {
            id: 'check',
            label: t('subs.k.check'),
            value: (
              <Pill tone="bad" icon="alert" size="sm">
                {t('subs.late', { days: card.checkDays })}
              </Pill>
            ),
          },
        ]
      : []),
  ];
  return (
    <div
      data-sub-wait={p.id}
      className={`rounded-xl border-2 ${p.late ? 'border-danger' : 'border-info'}`}
    >
      <Box
        title={
          <span className="inline-flex items-center gap-1.5">
            <Icon name="clock" size="sm" />
            {t('subs.wait.title')}
          </span>
        }
      >
        <KeyValues items={items} />
        <h4 className="m-0 mt-1 text-[13px] font-semibold text-ink">{t('subs.calc')}</h4>
        <SubCalcLines t={t} p={p} />
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={buttonClass('danger')}
            data-sub-reject={p.id}
            onClick={() => act.reject(p, card)}
          >
            <Icon name="ban" size="sm" />
            {t('subs.btn.reject')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            data-sub-confirm={p.id}
            onClick={() => act.confirm(p, card)}
          >
            <Icon name="check" size="sm" />
            {t('subs.btn.confirm')}
          </button>
        </div>
      </Box>
    </div>
  );
}

/** «История изменений» подписки (прототип `subHistHtml`). */
function SubHistBox({ t, card }: { t: Translate; card: AdminSubscriptionCard }) {
  const items = useMemo(() => subHistoryItems(t, card), [t, card]);
  return (
    <Box title={t('subs.hist.title')}>
      <div data-sub-hist="">
        {items.length ? (
          <Timeline items={items} label={t('subs.hist.title')} />
        ) : (
          <span className="text-faint">{t('subs.hist.empty')}</span>
        )}
      </div>
    </Box>
  );
}

/** Тело окна и вкладки «Подписка» карточки организации (прототип `subOrgBody`). */
export function SubOrgBody({ card, act }: { card: AdminSubscriptionCard; act: SubBodyActions }) {
  const t = useT();
  const waiting = card.payments.filter((p) => p.status === 'pending');
  const byId = new Map(card.payments.map((p) => [p.id, p]));
  // Строка «Истории оплат» и чек экрана владельца — окна Админки (окно оплаты с решением, просмотр чека).
  const ofScreen = (fn: (p: Payment) => void) => (sp: { id: string }) => {
    const p = byId.get(sp.id);
    if (p) fn(p);
  };
  return (
    <div className="flex flex-col gap-3" data-sub-body={card.org.id}>
      {waiting.map((p) => (
        <SubWaitBox key={p.id} t={t} card={card} p={p} act={act} />
      ))}
      <SubScreen
        view={card.screen}
        admin
        onOpen={ofScreen((p) => act.pay(p, card))}
        onReceipt={ofScreen(act.receipt)}
      />
      <SubHistBox t={t} card={card} />
    </div>
  );
}

/** Тело с загрузкой: вкладка «Подписка» карточки организации. */
export function SubOrgTab({ orgId, act }: { orgId: string; act: SubBodyActions }) {
  const t = useT();
  const card = useQuery(subCardQuery(orgId));
  if (card.data) return <SubOrgBody card={card.data} act={act} />;
  if (card.isError) return <EmptyState icon="alert" title={t('subs.win.load_error')} />;
  return <div className="h-40 animate-pulse rounded-xl bg-pane-alt" />;
}

/** Окно «Подписка организации» (прототип `subOrgWin`). */
export function SubOrgWindow({
  orgId,
  name,
  open,
  onClose,
  onOrg,
  onEdit,
  act,
}: {
  orgId: string;
  /** Название из строки списка — до ответа сервера. */
  name: string;
  open: boolean;
  onClose: () => void;
  onOrg: (orgId: string) => void;
  onEdit: (orgId: string) => void;
  act: SubBodyActions;
}) {
  const t = useT();
  const card = useQuery(subCardQuery(orgId));
  const c = card.data;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={t('subs.win.title')}
      sub={c ? `${c.org.name} · ${subStatusText(t, c.status)}` : name}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2" data-sub-window={orgId}>
          <button type="button" className={buttonClass()} onClick={() => onOrg(orgId)}>
            <Icon name="building" size="sm" />
            {t('subs.act.org')}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            className={buttonClass()}
            data-sub-edit=""
            onClick={() => onEdit(orgId)}
          >
            <Icon name="edit" size="sm" />
            {t('subs.act.edit')}
          </button>
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('subs.win.done')}
          </button>
        </div>
      }
    >
      {c ? (
        <SubOrgBody card={c} act={act} />
      ) : card.isError ? (
        <EmptyState icon="alert" title={t('subs.win.load_error')} />
      ) : (
        <div className="h-40 animate-pulse rounded-xl bg-pane-alt" />
      )}
    </Modal>
  );
}

/** Окно одной оплаты: расчёт и чек (прототип `subPayWin`, нажатие на строку «Истории оплат»). */
export function SubPayWindow({
  p,
  card,
  open,
  onClose,
  act,
}: {
  p: Payment;
  card: AdminSubscriptionCard;
  open: boolean;
  onClose: () => void;
  act: SubBodyActions;
}) {
  const t = useT();
  const items: KeyValueItem[] = [
    { id: 'st', label: t('subs.k.status'), value: <SubPayPill t={t} p={p} /> },
    { id: 'term', label: t('subs.k.term'), value: `${p.planName} · ${subPayTerm(t, p)}` },
    { id: 'pack', label: t('subs.k.pack'), value: String(p.seats) },
    { id: 'gb', label: t('subs.k.gb'), value: t('subs.gb.n', { n: p.extraGb }) },
    {
      id: 'by',
      label: t('subs.k.by'),
      value: <WhoAt who={subPayWho(t, p.createdBy)} at={p.createdAt} />,
    },
    {
      id: 'receipt',
      label: t('subs.k.receipt'),
      value: <ReceiptButton t={t} p={p} onOpen={act.receipt} />,
    },
    ...(p.decidedBy && p.decidedAt
      ? [
          {
            id: 'decided',
            label: t(p.status === 'rejected' ? 'subs.k.rejected_by' : 'subs.k.confirmed_by'),
            value: <WhoAt who={subPayWho(t, p.decidedBy)} at={p.decidedAt} />,
          },
        ]
      : []),
    ...(p.paidUntil && p.kind !== 'free'
      ? [
          {
            id: 'paid',
            label: t('subs.k.paid_until'),
            value: formatDateRu(p.paidUntil as IsoDate),
          },
        ]
      : []),
    ...(p.reason
      ? [
          {
            id: 'reason',
            label: t(p.status === 'rejected' ? 'subs.k.reject_reason' : 'subs.k.reason'),
            value: p.reason,
            wide: true,
          },
        ]
      : []),
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={subPayWhat(t, p)}
      sub={`${card.org.name} · ${moment(p.createdAt)}`}
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2" data-sub-pay={p.id}>
          {p.status === 'pending' ? (
            <>
              <button
                type="button"
                className={buttonClass('danger')}
                data-sub-reject={p.id}
                onClick={() => act.reject(p, card)}
              >
                <Icon name="ban" size="sm" />
                {t('subs.btn.reject')}
              </button>
              <button
                type="button"
                className={buttonClass('cta')}
                data-sub-confirm={p.id}
                onClick={() => act.confirm(p, card)}
              >
                <Icon name="check" size="sm" />
                {t('subs.btn.confirm')}
              </button>
            </>
          ) : (
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('subs.win.done')}
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Box>
          <KeyValues items={items} />
        </Box>
        <Box title={t('subs.calc')}>
          <SubCalcLines t={t} p={p} />
        </Box>
      </div>
    </Modal>
  );
}
