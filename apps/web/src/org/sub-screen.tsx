'use client';

import {
  formatCount,
  formatDateRu,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  pluralForm,
  SUBSCRIPTION_GB_MB,
  subscriptionDaysLeft,
  type IsoDate,
} from '@buhuchet/domain';
import {
  Box,
  buttonClass,
  EmptyState,
  Hint,
  Icon,
  linkButtonClass,
  MiniTable,
  miniWide,
  Note,
  Pill,
  type IconName,
  type MiniRow,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useSubDialogs } from './sub-dialogs';
import { orgSubQuery } from './sub-data';
import {
  againOf,
  bytesMb,
  gbText,
  kindLabel,
  pendingOf,
  planPrice,
  SUB_STATUS_PILL,
  subDays,
  termText,
  whatText,
  type PayMode,
  type SubPay,
  type SubView,
} from './sub-model';
import { PayPill, ReceiptLink } from './sub-pay-view';

/*
 * Экран «Подписка» (доработки 20.11.2026, блок 5, пункт 2; прототип v154 `subScreenHtml`,
 * `subScreenBind`; этап 1, П7, поток И): заметки о закрытом доступе и чеке на проверке, вид и статус,
 * кнопки оплаты, карточки «Срок», «Пакет», «Память», «Скидки» и «История оплат». Тот же экран без
 * кнопок оплаты — в Админке (`admin`, окно «Подписка организации» и вкладка карточки организации).
 */

export interface SubScreenProps {
  /** Ответ `GET /api/org/subscription` (у Админки — свой метод с той же схемой). */
  view: SubView;
  /** Админка: без кнопок оплаты, заметок владельца и «Прикрепить другой чек». */
  admin?: boolean;
  /** Нажатие на строку «Истории оплат»; без него — окно оплаты владельца. */
  onOpen?: (pay: SubPay) => void;
  /** Чек строки; без него — окно просмотра чека владельца. */
  onReceipt?: (pay: SubPay) => void;
}

/** Полоска «занято из» (прототип `subBarHtml`): с 80 % — жёлтая, со 100 % — красная. */
function UsageBar({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const pct = limit ? Math.round((used / limit) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, pct)}
      aria-label={label}
      className="mt-1.5 mb-0.5 h-2 overflow-hidden rounded-full bg-pane-alt shadow-[inset_0_0_0_1px_var(--bu-border)]"
    >
      <i
        className={`block h-full rounded-full ${pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warn' : 'bg-ok'}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

function SubCard({
  id,
  icon,
  title,
  value,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <section
      data-sub-card={id}
      className="flex min-w-0 flex-col rounded-xl border border-line bg-raised px-4 py-3.5"
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
        <Icon name={icon} size="sm" />
        {title}
      </div>
      <div className="mt-1.5 mb-1 text-[18px] font-bold tabular-nums text-ink">{value}</div>
      <div className="flex flex-col gap-1 text-[12px] leading-[1.45] text-muted">{children}</div>
    </section>
  );
}

const placesText = (t: Translate, n: number) => t(`sub.places.${pluralForm(n)}`, { n });

function SubCards({ view }: { view: SubView }) {
  const t = useT();
  const { sub, usage: u, prices: p } = view;
  const plan = sub ? view.plans.find((x) => x.id === sub.planId) : undefined;
  const left = sub ? subscriptionDaysLeft(sub.paidUntil, view.today as IsoDate) : 0;
  const extra = sub && sub.seats > p.extraDiscountOver ? sub.extraDiscountPct : 0;
  const usedGb = gbText(bytesMb(u.bytesUsed));
  const incMb = p.baseMb + p.seatMb * u.seats;
  const termHint = !sub
    ? t('sub.card.never')
    : left >= 0
      ? t(left === 0 ? 'sub.card.last_day' : 'sub.card.left', { days: subDays(t, left) })
      : t('sub.card.late', { days: subDays(t, -left) });
  const next = sub?.next && sub.next.from > view.today ? sub.next : null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
      <SubCard
        id="term"
        icon="calendar"
        title={t('sub.card.term')}
        value={
          sub ? t('sub.card.paid', { date: formatDateRu(sub.paidUntil) }) : t('sub.card.unpaid')
        }
      >
        <span>{termHint}</span>
        {sub && next ? (
          <span>
            {t('sub.card.next', {
              date: formatDateRu(next.from),
              seats: next.seats ?? sub.seats,
              gb: next.extraGb ?? sub.extraGb,
            })}
          </span>
        ) : null}
      </SubCard>
      <SubCard
        id="pack"
        icon="building"
        title={t('sub.card.pack')}
        value={t('sub.card.pack_v', { used: u.seatsUsed, pack: u.seats })}
      >
        <UsageBar used={u.seatsUsed} limit={u.seats} label={t('sub.card.pack')} />
        <span>
          {!u.seats ? (
            t('sub.card.nopack')
          ) : u.seatsUsed > u.seats ? (
            <span className="text-danger">{t('sub.card.over')}</span>
          ) : (
            t('sub.card.free', {
              free: placesText(t, Math.max(0, u.seats - u.seatsUsed)),
              step: p.seatStep,
            })
          )}
        </span>
      </SubCard>
      <SubCard
        id="mem"
        icon="folder"
        title={t('sub.card.mem')}
        value={
          u.bytesLimit === null
            ? t('sub.card.mem_free', { used: usedGb })
            : t('sub.card.mem_v', { used: usedGb, limit: gbText(bytesMb(u.bytesLimit)) })
        }
      >
        <UsageBar used={u.bytesUsed} limit={u.bytesLimit} label={t('sub.card.mem')} />
        <span>
          {t('sub.card.mem_inc', {
            inc: gbText(incMb),
            base: gbText(p.baseMb),
            seat: formatCount(p.seatMb),
          })}
          {u.extraGb
            ? ` · ${t('sub.card.mem_extra', { gb: gbText(u.extraGb * SUBSCRIPTION_GB_MB) })}`
            : ''}
        </span>
      </SubCard>
      <SubCard
        id="disc"
        icon="gift"
        title={t('sub.card.disc')}
        value={
          plan?.discountPct
            ? t('sub.card.disc_v', { pct: plan.discountPct })
            : t('sub.card.disc_none')
        }
      >
        <span>
          {plan?.discountPct
            ? t('sub.card.disc_plan', {
                plan: plan.name,
                price: formatSom(planPrice(view, plan.discountPct)),
                base: formatSom(p.seatPrice),
              })
            : t('sub.card.disc_hint')}
        </span>
        {extra ? <b className="text-ink">{t('sub.card.disc_extra', { pct: extra })}</b> : null}
        {sub && !sub.firstPaid ? (
          <span>{t('sub.card.disc_first', { pct: p.firstMonthPct })}</span>
        ) : null}
      </SubCard>
    </div>
  );
}

function PaysTable({
  view,
  own,
  onOpen,
  onReceipt,
}: {
  view: SubView;
  own: boolean;
  onOpen: (pay: SubPay) => void;
  onReceipt?: (pay: SubPay) => void;
}) {
  const t = useT();
  const pays = view.payments;
  if (!pays.length) {
    return (
      <EmptyState
        icon="wallet"
        title={t('sub.pays.empty')}
        text={own ? t('sub.pays.empty_text') : undefined}
      />
    );
  }
  const rows: MiniRow[] = pays.map((p) => {
    const reason = p.status === 'rejected' ? (p.reason ?? '') : '';
    const what = whatText(t, p.kind);
    return {
      key: p.id,
      cells: {
        at: formatMomentRu(new Date(p.at)),
        what,
        term: termText(t, p),
        sum: p.kind === 'free' ? '—' : formatSomWithUnit(p.amount),
        file: <ReceiptLink pay={p} onOpen={onReceipt} />,
        st: <PayPill pay={p} />,
        reason: reason || '—',
      },
      wide: miniWide({ what, reason, file: p.receipt?.name ?? '' }),
      blank: [...(reason ? [] : ['reason']), ...(p.receipt ? [] : ['file'])],
    };
  });
  return (
    <MiniTable
      label={t('sub.pays.title')}
      columns={[
        { key: 'at', label: t('sub.col.at'), width: 140 },
        { key: 'what', label: t('sub.col.what'), width: 240 },
        { key: 'term', label: t('sub.col.term'), width: 110 },
        { key: 'sum', label: t('sub.col.sum'), numeric: true, width: 110 },
        { key: 'file', label: t('sub.col.file'), width: 170 },
        { key: 'st', label: t('sub.col.st'), width: 180 },
        { key: 'reason', label: t('sub.col.reason'), width: 240 },
      ]}
      rows={rows}
      empty={t('sub.pays.empty')}
      onOpen={(key) => {
        const p = pays.find((x) => x.id === key);
        if (p) onOpen(p);
      }}
    />
  );
}

/** Экран «Подписка» с данными снаружи: вкладка владельца и окна Админки. */
export function SubScreen({ view, admin = false, onOpen, onReceipt }: SubScreenProps) {
  const t = useT();
  const dialogs = useSubDialogs();
  const own = !admin;
  usePayParam(own, view, dialogs.pay);
  const { sub } = view;
  const pending = pendingOf(view);
  const again = own ? againOf(view) : null;
  const plan = sub ? view.plans.find((x) => x.id === sub.planId) : undefined;
  const pill = SUB_STATUS_PILL[view.status];
  const openPay = (mode: PayMode, pre?: SubPay) => dialogs.pay(view, mode, pre ?? null);
  const open = onOpen ?? ((p: SubPay) => dialogs.view(view, p));
  const receipt = onReceipt ?? (own ? dialogs.receipt : undefined);
  const blocked = pending ? t('sub.btn.wait') : view.closed || !sub ? t('sub.btn.closed') : null;
  const sentText = (p: SubPay) => ({
    what: whatText(t, p.kind),
    sum: formatSomWithUnit(p.amount),
    at: formatMomentRu(new Date(p.at)),
  });

  return (
    <div data-sub-screen={admin ? 'admin' : 'own'} className="flex min-w-0 flex-col gap-3.5">
      {view.closed && !pending ? (
        <Note tone="bad" icon="lock">
          {[
            sub ? t('sub.head.ended', { date: formatDateRu(sub.paidUntil) }) : t('sub.head.never'),
            t(view.lastRejected ? 'sub.head.rej' : 'sub.head.open'),
            t('sub.head.kept'),
          ].join(' ')}
        </Note>
      ) : view.status === 'expiring' && sub ? (
        <Note tone="warn" icon="clock">
          {t('sub.head.expiring', { date: formatDateRu(sub.paidUntil) })}
        </Note>
      ) : null}
      {pending && own ? (
        <div data-sub-wait="">
          <Note icon="clock">
            <b>{t('sub.wait.title')}</b> {t('sub.wait.text', sentText(pending))}{' '}
            {t(pending.opensAccess || !view.closed ? 'sub.wait.open' : 'sub.wait.after')}{' '}
            {t('sub.wait.next')}{' '}
            <button
              type="button"
              data-sub-wait-file=""
              className={linkButtonClass()}
              onClick={() => dialogs.file(pending)}
            >
              {t('sub.act.file')}
            </button>
          </Note>
        </div>
      ) : null}
      {again ? (
        <div data-sub-again="">
          <Note tone="bad" icon="ban">
            <b>{t('sub.rej.title')}</b>{' '}
            {t('sub.rej.text', { ...sentText(again), reason: again.reason ?? '—' })}{' '}
            <button
              type="button"
              data-sub-again-open=""
              className={linkButtonClass()}
              onClick={() =>
                openPay(again.kind === 'grow' || again.kind === 'mem' ? again.kind : 'renew', again)
              }
            >
              {t('sub.act.again')}
            </button>
          </Note>
        </div>
      ) : null}

      <section
        data-sub-top=""
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-raised px-4 py-3.5"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="m-0 text-[15px] font-[650] text-ink">{kindLabel(t, sub)}</h3>
          <Pill tone={pill.tone} icon={pill.icon}>
            {t(`sub.st.${view.status}`)}
          </Pill>
          <div className="grow" />
          {plan && sub && !sub.free ? (
            <span className="text-muted">
              {t('sub.price', { price: formatSom(planPrice(view, plan.discountPct)) })}
            </span>
          ) : null}
        </div>
        {own || view.renewTotal !== null ? (
          <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:flex-[1_1_auto] max-md:[&>button]:justify-center">
            {view.renewTotal !== null ? (
              <span className="min-w-0 grow max-md:basis-full">
                <Hint>{t('sub.renew_total', { sum: formatSomWithUnit(view.renewTotal) })}</Hint>
              </span>
            ) : (
              <div className="grow" />
            )}
            {own ? (
              <>
                <button
                  type="button"
                  data-sub-pay-open="mem"
                  className={buttonClass()}
                  disabled={!!blocked}
                  title={blocked ?? t('sub.btn.mem_tip')}
                  onClick={() => openPay('mem')}
                >
                  <Icon name="folder" size="sm" />
                  {t('sub.btn.mem')}
                </button>
                <button
                  type="button"
                  data-sub-pay-open="grow"
                  className={buttonClass()}
                  disabled={!!blocked}
                  title={blocked ?? t('sub.btn.grow_tip')}
                  onClick={() => openPay('grow')}
                >
                  <Icon name="building" size="sm" />
                  {t('sub.btn.grow')}
                </button>
                <button
                  type="button"
                  data-sub-pay-open="renew"
                  className={buttonClass('cta')}
                  disabled={!!pending}
                  title={pending ? t('sub.btn.wait') : undefined}
                  onClick={() => openPay('renew')}
                >
                  <Icon name="wallet" size="sm" />
                  {t(sub ? 'sub.btn.renew' : 'sub.btn.pay')}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <SubCards view={view} />

      <Box title={t('sub.pays.title')}>
        <div data-sub-pays="">
          <PaysTable view={view} own={own} onOpen={open} onReceipt={receipt} />
        </div>
        <Hint>{t(own ? 'sub.pays.hint_own' : 'sub.pays.hint')}</Hint>
      </Box>
      {own ? dialogs.node : null}
    </div>
  );
}

const PAY_MODES: readonly PayMode[] = ['renew', 'grow', 'mem'];

/**
 * `?pay=renew|grow|mem` (полоса «Продлить», «Купить память» окна «Память организации заполнена»):
 * окно оплаты открывается один раз на переход, метка уходит из адреса.
 */
function usePayParam(own: boolean, view: SubView, pay: (view: SubView, mode: PayMode) => void) {
  const router = useRouter();
  const pathname = usePathname();
  const asked = useSearchParams().get('pay');
  const done = useRef<string | null>(null);
  const run = useEffectEvent((mode: PayMode) => pay(view, mode));
  useEffect(() => {
    if (!asked) {
      done.current = null;
      return;
    }
    if (!own || done.current === asked) return;
    done.current = asked;
    router.replace(pathname, { scroll: false });
    const mode = PAY_MODES.find((m) => m === asked);
    if (mode) run(mode);
  }, [own, asked, router, pathname]);
}

/** Вкладка «Моя организация» → «Подписка» владельца: экран одним запросом. */
export function OrgSubTab() {
  const t = useT();
  const errorText = useErrorText();
  const query = useQuery(orgSubQuery);
  if (query.isError) {
    const error = query.error instanceof ApiFailure ? query.error.error : null;
    return (
      <Note tone={error?.code === 'sub_owner_only' ? 'info' : 'bad'} icon="lock">
        {error ? errorText(error) : t('sub.load_error')}
      </Note>
    );
  }
  if (!query.data) return null;
  return <SubScreen view={query.data} />;
}
