'use client';

import {
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  pluralForm,
  submitNeedsPayment,
  type YearMonth,
} from '@buhuchet/domain';
import { fileDownloadPath, type ReportCard, type ReportRow } from '@buhuchet/shared';
import {
  buttonClass,
  Icon,
  MiniTable,
  Note,
  Pill,
  StatusMini,
  StatusMiniNone,
  StatusPill,
  StatusScale,
  Tag,
  useToast,
} from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { miniView, scaleView, statusName, type StatusEvent } from '../status/status-view';

/*
 * Деньги отчёта на экране (задача 2.19; прототип modules/reports.js — столбцы «Получено от
 * контрагента», «Оплачено в бюджет», «Деньги (сверка)»; modules/report-card.js — блок сумм, шкала
 * «Оплата», график оплаты, «Деньги контрагента»; ui/status-scale.js — subPayWhy, subPayNote).
 */

/** Отчёт ждёт оплаты: вид с суммой, сумма больше 0, оплачено меньше, не «Не требуется» (прототип payOk). */
export const reportWaitsPayment = (r: ReportRow & { superseded?: boolean }) =>
  r.act !== 'sub' &&
  (r.amount ?? 0) > 0 &&
  r.paid < (r.amount ?? 0) &&
  r.status !== 'not_required' &&
  !r.superseded;

/** «Сначала оплатите налог: к уплате 5 000 сом, оплачено 0 сом» (прототип subPayWhy); пусто — можно. */
export function payFirstWhy(
  t: Translate,
  r: ReportRow & { superseded?: boolean },
  payFirst: boolean,
  sum: number | null = r.amount,
): string {
  const facts = { ...r, sum: r.amount, superseded: r.superseded ?? false };
  if (!submitNeedsPayment(facts, payFirst, sum)) return '';
  return t('report.pay_first.why', {
    amount: formatSomWithUnit(sum ?? 0),
    paid: formatSomWithUnit(r.paid),
  });
}

/** Компактная шкала оплаты без строки «когда» (прототип scaleMini0('pay')). */
export function PaymentMini({ t, r }: { t: Translate; r: ReportRow }) {
  const view = miniView(t, { scale: 'payment', status: r.paymentStatus, history: [] });
  return (
    <span data-payment-mini={r.paymentStatus} className="inline-flex max-w-full">
      {view.kind === 'none' ? (
        <StatusMiniNone label={view.label} title={view.title} />
      ) : view.kind === 'pill' ? (
        <StatusPill {...view.pill} size="sm" />
      ) : (
        <StatusMini {...view.props} />
      )}
    </span>
  );
}

const PayOverdue = ({ t }: { t: Translate }) => (
  <span title={t('report.pay.overdue_title')}>
    <Pill tone="bad" size="sm" icon="alert">
      {t('report.pay.overdue')}
    </Pill>
  </span>
);

/** «Принять» в строке списка: окно поступления под этот отчёт (прототип `data-recv`). */
export function ReceiveButton({ t, onClick }: { t: Translate; onClick: () => void }) {
  return (
    <button
      type="button"
      data-report-receive=""
      title={t('report.receive.title')}
      className={buttonClass('default', 'sm')}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name="plus" size="sm" />
      {t('report.receive.short')}
    </button>
  );
}

/** «Получено от контрагента» в списке: зелёным, когда получено всё; «Принять», пока не всё. */
export function ReceivedCell({
  t,
  r,
  onReceive,
}: {
  t: Translate;
  r: ReportRow;
  onReceive: (() => void) | null;
}) {
  if (r.act === 'sub' || !((r.amount ?? 0) > 0)) return <span className="text-faint">—</span>;
  const full = r.received >= r.amount!;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className={full ? 'text-ok' : undefined}>{formatSom(r.received)}</span>
      {onReceive && r.received + r.selfPaid < r.amount! ? (
        <ReceiveButton t={t} onClick={onReceive} />
      ) : null}
    </span>
  );
}

/** «Оплачено в бюджет» в списке: сумма, под ней — шкала оплаты и «просрочено». */
export function PaidCell({ t, r }: { t: Translate; r: ReportRow }) {
  if (r.act === 'sub') return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex flex-col items-end gap-[3px] leading-[1.2]">
      <span className="tabular-nums">{formatSom(r.paid)}</span>
      <PaymentMini t={t} r={r} />
      {r.payOverdue ? <PayOverdue t={t} /> : null}
    </span>
  );
}

/** «Оплачено» строкой сумм на плитке телефона: сумма и «просрочено» (прототип `cv` столбца paid). */
export function PaidTile({ t, r }: { t: Translate; r: ReportRow }) {
  return (
    <>
      {formatSom(r.paid, 'auto')}
      {r.payOverdue ? (
        <>
          {' '}
          <PayOverdue t={t} />
        </>
      ) : null}
    </>
  );
}

/** «Статус оплаты» в списке: шкала и «просрочено». */
export function PaymentStatusCell({ t, r }: { t: Translate; r: ReportRow }) {
  if (r.act === 'sub') return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <PaymentMini t={t} r={r} />
      {r.payOverdue ? <PayOverdue t={t} /> : null}
    </span>
  );
}

/** «Деньги (сверка)»: «Оплачено», «Достаточно» или «Недостача N» (прототип moneyHtml0). */
export function FundsPill({ t, r }: { t: Translate; r: ReportRow }) {
  const f = r.funds;
  if (!f) return <span className="text-faint">—</span>;
  if (f.state === 'paid')
    return (
      <Pill size="sm" icon="check">
        {t('report.funds.paid')}
      </Pill>
    );
  if (f.state === 'enough')
    return (
      <Pill tone="ok" size="sm" icon="ok">
        {t('report.funds.enough')}
      </Pill>
    );
  return (
    <span title={t('report.funds.short_title', { amount: formatSomWithUnit(f.short) })}>
      <Pill tone="bad" size="sm" icon="alert">
        {`${t('report.funds.short')} ${formatSom(f.short)}`}
      </Pill>
    </span>
  );
}

/** «Деньги (сверка)» с «Принять», пока получено меньше суммы (прототип moneyHtml). */
export function FundsCell({
  t,
  r,
  onReceive,
}: {
  t: Translate;
  r: ReportRow;
  onReceive: (() => void) | null;
}) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      <FundsPill t={t} r={r} />
      {onReceive && r.funds && r.receivedFor < (r.amount ?? 0) ? (
        <ReceiveButton t={t} onClick={onReceive} />
      ) : null}
    </span>
  );
}

/** Текст «Деньги (сверка)» для поиска и выгрузки (прототип moneyTxt). */
export const fundsText = (t: Translate, r: ReportRow) =>
  r.funds ? t(`report.funds.${r.funds.state}`) : '';

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px] rounded-lg bg-btn px-2.5 py-2">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
    </div>
  );
}

const Sub = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11.5px] text-faint">{children}</span>
);

/**
 * Блок сумм вверху карточки — в том же порядке, что столбцы списка (решение заказчика 25.10.2026):
 * «К уплате», «Получено от контрагента», «Оплачено в бюджет» со шкалой, «Осталось оплатить».
 */
export function SumsBox({ t, r }: { t: Translate; r: ReportCard }) {
  const sum = r.amount;
  const left = Math.max(0, (sum ?? 0) - r.paid);
  return (
    <div
      data-box
      data-report-sums=""
      className="grid grid-cols-4 gap-2.5 rounded-xl border border-line bg-raised px-4 py-3.5 max-md:grid-cols-2"
    >
      <Cell label={t('money.pay.due')}>
        <b className="text-[18px] font-bold tabular-nums">
          {sum === null ? (
            <span className="text-faint">{t('report.amount.none')}</span>
          ) : (
            formatSomWithUnit(sum)
          )}
        </b>
        {r.amountAuto ? (
          <span>
            <Tag icon="repeat">{t('report.repeat.tag')}</Tag>
          </span>
        ) : null}
      </Cell>
      <Cell label={t('report.col.received')}>
        <b
          className={`text-[18px] font-bold tabular-nums ${(sum ?? 0) > 0 && r.received >= sum! ? 'text-ok' : ''}`}
        >
          {formatSomWithUnit(r.received)}
        </b>
        {(sum ?? 0) > 0 ? (
          <Sub>
            {t(
              r.received + r.selfPaid >= sum!
                ? 'report.money.received_full'
                : r.received > 0
                  ? 'report.money.received_part'
                  : 'report.money.received_wait',
            )}
          </Sub>
        ) : null}
      </Cell>
      <Cell label={t('report.col.paid')}>
        <b className="text-[18px] font-bold tabular-nums">{formatSomWithUnit(r.paid)}</b>
        <span className="text-[11.5px]">
          <PaymentMini t={t} r={r} />
        </span>
        {r.selfPaid ? (
          <Sub>{t('report.money.self_paid', { amount: formatSomWithUnit(r.selfPaid) })}</Sub>
        ) : null}
        {sum !== null && r.paid > sum ? (
          <span>
            <Pill tone="caution" size="sm">
              {t('report.money.over', { amount: formatSom(r.paid - sum) })}
            </Pill>
          </span>
        ) : null}
      </Cell>
      <Cell label={t('report.col.left')}>
        <b className={`text-[18px] font-bold tabular-nums ${r.payOverdue ? 'text-danger' : ''}`}>
          {formatSomWithUnit(left)}
        </b>
        {r.payOverdue ? (
          <span>
            <Pill tone="bad" size="sm" icon="alert">
              {t('report.money.pay_overdue')}
            </Pill>
          </span>
        ) : null}
      </Cell>
    </div>
  );
}

/**
 * Оплата, которую отменит откат шкалы оплаты (прототип scBack('pay')): последняя действующая по дате
 * оплаты, при равной — записанная позже; так же выбирает сервер.
 */
export function lastPayment(
  r: ReportCard,
): NonNullable<ReportCard['money']>['payments'][number] | null {
  const live = (r.money?.payments ?? []).filter((p) => !p.cancelled);
  return (
    live.reduce<(typeof live)[number] | null>(
      (best, p) =>
        !best || p.date > best.date || (p.date === best.date && p.at >= best.at) ? p : best,
      null,
    ) ?? null
  );
}

/**
 * «История статусов» оплаты (прототип statusHist('pay')): «Не оплачено» с создания отчёта, затем
 * каждая оплата («Оплата в бюджет N», платёжка) и её отмена откатом с причиной.
 */
export function paymentEvents(t: Translate, r: ReportCard): StatusEvent[] {
  const sum = r.amount ?? 0;
  const statusOf = (paid: number) =>
    paid >= sum && sum > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  const steps = (r.money?.payments ?? []).flatMap((p) => [
    { at: new Date(p.at), amount: p.amount, pay: p, cancel: false as const },
    ...(p.cancelled
      ? [{ at: new Date(p.cancelled.at), amount: -p.amount, pay: p, cancel: true as const }]
      : []),
  ]);
  steps.sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: StatusEvent[] = [
    {
      at: new Date(r.audit.createdAt),
      from: null,
      to: 'unpaid',
      rollback: false,
      reason: null,
      actor: r.audit.createdBy,
    },
  ];
  let paid = 0;
  let cur = 'unpaid';
  for (const s of steps) {
    paid += s.amount;
    const next = statusOf(paid);
    out.push({
      at: s.at,
      from: cur,
      to: next,
      rollback: s.cancel,
      reason: s.cancel
        ? [
            t('report.money.event_cancel', { amount: formatSomWithUnit(s.pay.amount) }),
            s.pay.cancelled?.reason,
          ]
            .filter(Boolean)
            .join('. ')
        : t('report.money.event_pay', { amount: formatSomWithUnit(s.pay.amount) }),
      actor: s.cancel ? (s.pay.cancelled?.actor ?? null) : s.pay.actor,
      file:
        !s.cancel && s.pay.file
          ? { name: s.pay.file.name, href: fileDownloadPath(s.pay.file.id) }
          : null,
    });
    cur = next;
  }
  return out;
}

/**
 * Шкала «Оплата» (прототип scaleFull('pay')): шаги нажатием — окно «Отметить оплаченным», без права
 * «Учёт денег» шаг нажимается, но отвечает «Нет права на учёт денег» (прототип stepTo); откат — отмена
 * последней оплаты (с правом «Откат статусов»).
 */
export function PaymentScale({
  t,
  r,
  onPay,
  onCancel,
}: {
  t: Translate;
  r: ReportCard;
  onPay: (() => void) | null;
  onCancel: (() => void) | null;
}) {
  const toast = useToast();
  const events = paymentEvents(t, r);
  const last = lastPayment(r);
  const paidRest = last ? r.paid - last.amount : null;
  const back = onCancel && paidRest !== null ? (paidRest <= 0 ? 'unpaid' : 'partial') : null;
  const next = reportWaitsPayment(r)
    ? (['partial', 'paid'] as const).filter((s) => s !== r.paymentStatus)
    : [];
  const view = scaleView(t, {
    scale: 'payment',
    status: r.paymentStatus,
    history: events,
    next,
    back,
  });
  if (view.kind === 'none') return <StatusMiniNone label={view.title} title={view.text} />;
  if (view.kind === 'pill') return <StatusPill {...view.pill} />;
  // Месяц последней оплаты закрыт: отката нет, под шкалой — почему (прототип scBack('pay') с `no`).
  const closed = r.money?.cancelClosed;
  const hints = closed
    ? [
        ...(view.props.hints ?? []),
        t('err.payment_month_closed', { month: monthLabel(closed as YearMonth) }),
      ]
    : view.props.hints;
  return (
    <StatusScale
      {...view.props}
      hints={hints}
      onStep={() =>
        onPay ? onPay() : toast(t('report.act.money_no'), { bad: true, icon: 'alert' })
      }
      onBack={() => onCancel?.()}
    />
  );
}

/** График оплаты: срок, сумма, оплачено, статус платежа (прототип report-card.js, `sch`). */
export function ScheduleBox({ t, r, today }: { t: Translate; r: ReportCard; today: string }) {
  const parts = r.money?.schedule ?? [];
  if (parts.length < 2) return null;
  const n = parts.length;
  return (
    <section
      data-box
      data-report-schedule=""
      className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-raised px-4 py-3.5"
    >
      <h3 className="m-0 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">
        {t('report.money.schedule', { n: t(`report.money.schedule.${pluralForm(n)}`, { n }) })}
      </h3>
      <MiniTable
        label={t('report.money.schedule', { n: String(n) })}
        empty=""
        columns={[
          { key: 'due', label: t('report.money.col_due') },
          { key: 'amount', label: t('report.money.col_amount'), numeric: true },
          { key: 'paid', label: t('report.money.col_paid'), numeric: true },
          { key: 'status', label: t('report.money.col_status') },
        ]}
        rows={parts.map((s, i) => {
          const st = s.paid >= s.amount ? 'paid' : s.paid > 0 ? 'partial' : 'unpaid';
          const late = s.paid < s.amount && s.due < today;
          return {
            key: `${s.due}-${i}`,
            cells: {
              due: (
                <span className={late ? 'font-semibold text-danger' : undefined}>
                  {formatDateRu(s.due)}
                </span>
              ),
              amount: formatSom(s.amount),
              paid: formatSom(s.paid),
              status: (
                <Pill
                  size="sm"
                  tone={st === 'paid' ? 'ok' : st === 'partial' ? 'caution' : 'plain'}
                >
                  {statusName(t, 'payment', st)}
                </Pill>
              ),
            },
          };
        })}
      />
    </section>
  );
}

/**
 * Причина у несданного отчёта при «Сдаче только после оплаты» в карточке (прототип `subPayNote(r, false)`
 * — без кнопок: «Принять деньги» и «Отметить оплаченным» — внизу карточки).
 */
export function PayFirstNote({ t, why }: { t: Translate; why: string }) {
  return (
    <div data-pay-first="">
      <Note tone="warn" icon="lock">
        <span>
          <b>{why}.</b> {t('report.pay_first.note')}
        </span>
      </Note>
    </div>
  );
}
