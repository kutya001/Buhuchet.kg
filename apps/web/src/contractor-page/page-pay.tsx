'use client';

import {
  formatSom,
  formatSomWithUnit,
  monthLabel,
  pageDateWords,
  pageFeeDue,
  pageFeeOpen,
  pageMonthName,
  pageMonthTitle,
  pagePaidProblems,
  pagePayNote,
  parseSom,
  SENT_FILE_COMMENT_MAX,
  type PagePaidProblem,
  type PayClaimPurpose,
} from '@buhuchet/domain';
import { PageSentTicket, type PagePay, type PublicPageBody } from '@buhuchet/shared';
import {
  buttonClass,
  ChipSelect,
  Field,
  FormGrid,
  Icon,
  iconButtonClass,
  inputClass,
  Modal,
  StatusPill,
  useToast,
} from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';
import { useDoneDialog } from './page-done';
import { usePageHint } from './page-help-context';
import { PageDet, PageList, PageRow, PageTip, ROW1, ROW2, usePageText } from './page-parts';
import {
  paidDefaults,
  payPlan,
  payView,
  waitingDay,
  type PayPlan,
  type PayView,
} from './page-pay-model';
import type { PageAddress } from './page-telegram';

/*
 * «Оплата», «Оплатить» и «Я оплатил» на странице контрагента простыми словами (доработки 17.11.2026;
 * прототип v135 modules/cp-page.js `pubPay`, `pubBody`, cp-paid.js `pubPayDlg`, `pubPaidDlg`). Это не
 * онлайн-оплата: клиент переводит деньги в своём банке или кошельке и отправляет чек, а бухгалтер
 * подтверждает получение. Запросы «Я оплатил» идут под адресом страницы (`/<организация>/inn/<ИНН>/paid`):
 * только туда браузер отправляет cookie этой ссылки.
 */

type Page = PublicPageBody;

const HINT = 'text-[11.5px] text-faint';

/** Скопировать в буфер и сказать об этом. */
export function useCopy() {
  const toast = useToast();
  // ОТКЛОНЕНИЕ: docs/deviations.md#Е-6
  return async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Буфер обмена недоступен: номер виден крупно, его можно выделить.
      return;
    }
    toast(done, { icon: 'copy' });
  };
}

/** Сумма без разрядов для вставки в банк: «4670,50». */
const plainSum = (tyiyn: number) => formatSom(tyiyn, 'auto').replace(/\s/g, '');

/** Сумма в поле ввода: «4 670,50». */
const fieldSum = (tyiyn: number) => (tyiyn > 0 ? formatSom(tyiyn, 'auto') : '');

/** Значок «Скопировать сумму» у «Не хватает» и «К оплате» (прототип `.pub-due .icon-btn`). */
function CopySum({ sum }: { sum: number }) {
  const t = useT();
  const copy = useCopy();
  return (
    <button
      type="button"
      data-pub-copy-sum=""
      aria-label={t('pub.sum.copy')}
      title={t('pub.sum.copy')}
      onClick={() => void copy(plainSum(sum), t('pub.sum.copied'))}
      className={iconButtonClass('sm')}
    >
      <Icon name="copy" size="sm" />
    </button>
  );
}

/** «К переводу» крупно со «Скопировать» (прототип `pubSumLine`). */
function SumLine({ sum }: { sum: number }) {
  const t = useT();
  const copy = useCopy();
  return (
    <div data-pub-sendsum="" className="flex flex-wrap items-baseline gap-2.5">
      <span className={HINT}>{t('pub.sum.to_send')}</span>
      <b className="text-[26px] tabular-nums max-md:text-[24px]">{formatSomWithUnit(sum)}</b>
      <button
        type="button"
        className={buttonClass('default', 'sm')}
        onClick={() => void copy(plainSum(sum), t('pub.sum.copied'))}
      >
        <Icon name="copy" size="sm" />
        {t('pub.sum.copy_btn')}
      </button>
    </div>
  );
}

/**
 * Куда переводить (прототип v135 `pubPay`): «По номеру телефона» или вид счёта, банк, номер крупно со
 * «Скопировать номер» / «Скопировать всё», «Только из: …» с пояснением под «?», БИК, получатель («…, ваш
 * бухгалтер» у реквизита сотрудника) и «В комментарии к переводу» со своим «Скопировать».
 */
export function PayCard({ k, a, note }: { k: PayClaimPurpose; a: PagePay; note: string }) {
  const t = useT();
  const tx = usePageText();
  const copy = useCopy();
  const phone = a.kind === 'phone';
  const line = 'flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13.5px]';
  return (
    <div
      data-pay={k}
      data-no-gloss=""
      className="flex flex-col gap-2 rounded-xl border border-line bg-pane-alt px-3.5 py-3"
    >
      <span className={HINT}>{t(`pub.pay.kind.${a.kind}`)}</span>
      {phone ? null : <span className="font-semibold">{a.bank}</span>}
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          data-pay-number=""
          className="font-mono text-[22px] font-bold tracking-[.02em] [overflow-wrap:anywhere] max-md:text-[20px]"
        >
          {a.number}
        </span>
        <button
          type="button"
          data-pay-copy=""
          onClick={() =>
            void copy(a.copy, phone ? t('pub.pay.copied_phone') : t('pub.pay.copied_account'))
          }
          className={buttonClass('default', 'sm')}
        >
          <Icon name="copy" size="sm" />
          {phone ? t('pub.pay.copy_phone') : t('pub.pay.copy_all')}
        </button>
      </div>
      {phone && a.banks.length ? (
        <div className={line}>
          <span className={HINT}>{t('pub.pay.from')}</span>
          <span>{a.banks.join(', ')}</span>
          <PageTip label={t('pub.pay.from')} text={tx('pay.banks')} />
        </div>
      ) : null}
      {a.bik ? (
        <div className={line}>
          <span className={HINT}>{t('pub.pay.bik')}</span>
          <span className="font-mono">{a.bik}</span>
        </div>
      ) : null}
      {a.holder ? (
        <div className={line}>
          <span className={HINT}>{t('pub.pay.holder')}</span>
          <span>
            <b>{a.holder}</b>
            {a.employee ? t('pub.pay.holder_yours') : ''}
          </span>
        </div>
      ) : null}
      <div data-pay-note="" className={line}>
        <span className={HINT}>{t('pub.pay.note')}</span>
        <b>{note}</b>
        <button
          type="button"
          aria-label={t('pub.pay.note_copy')}
          title={t('pub.pay.note_copy_tip')}
          onClick={() => void copy(note, t('pub.pay.note_copied'))}
          className={iconButtonClass('sm')}
        >
          <Icon name="copy" size="sm" />
        </button>
      </div>
    </div>
  );
}

/** «Чек отправлен 17 ноября · 5 000 сом[ · бухгалтер проверяет]» (прототип `pubWaitTxt`). */
export function useWaitText(today: string) {
  const t = useT();
  return (w: NonNullable<PagePay['waiting']>, full: boolean) => {
    const date = pageDateWords(waitingDay(w), today);
    const key = `pub.wait.${full ? 'full' : 'short'}${w.amount === null ? '_nosum' : ''}` as const;
    return t(key, { date, sum: w.amount === null ? '' : formatSomWithUnit(w.amount) });
  };
}

/**
 * «Я оплатил» под реквизитом (прототип `paidBtn`): пока бухгалтер принимает файлы со страницы; ждущий
 * чек — «Бухгалтер проверяет» и «Отправить ещё чек».
 */
function PaidBlock({
  k,
  waiting,
  today,
  onPaid,
}: {
  k: PayClaimPurpose;
  waiting: PagePay['waiting'];
  today: string;
  onPaid: (() => void) | null;
}) {
  const t = useT();
  const waitText = useWaitText(today);
  if (!onPaid) return null;
  return (
    <div className="flex flex-col items-stretch gap-1.5">
      {waiting ? (
        <span data-pay-wait="" className="flex flex-col items-start gap-1">
          <StatusPill tone="blue" icon="hourglass" label={t('pub.wait.pill')} size="sm" />
          <span className={HINT}>{waitText(waiting, false)}</span>
        </span>
      ) : null}
      <button
        type="button"
        data-pub-paid={k}
        className={`${buttonClass('default')} justify-center max-md:min-h-11`}
        onClick={onPaid}
      >
        <Icon name="check" size="sm" />
        {waiting ? t('pub.paid.again') : t('pub.paid.btn')}
      </button>
    </div>
  );
}

/** Строка расчёта «подпись — сумма» (прототип `.kv.pub-calc`). */
function CalcRow({
  id,
  label,
  strong = false,
  children,
}: {
  id: string;
  label: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-calc={id} className="flex items-baseline justify-between gap-3">
      <dt className="text-[13.5px] font-medium text-muted">{label}</dt>
      <dd
        className={`m-0 inline-flex items-center gap-1 text-[15px] tabular-nums ${strong ? 'font-bold' : ''}`}
      >
        {children}
      </dd>
    </div>
  );
}

const STATUS = 'min-w-0 text-right text-[13.5px]';

/** Строка «Оплаты» (прототип `poRow`): название, состояние, стрелка; раскрывается по нажатию. */
function PayRow({
  k,
  title,
  status,
  open,
  onToggle,
  flash,
  children,
}: {
  k: PayClaimPurpose;
  title: string;
  status: ReactNode;
  open: boolean;
  onToggle: () => void;
  flash: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-po={k}
      data-open={open ? '' : undefined}
      className={`scroll-mt-3 rounded-lg border-t border-line transition-shadow duration-700 first:border-t-0 ${flash ? 'shadow-[0_0_0_3px_var(--color-info-bg)]' : ''}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-0.5 py-3 text-left font-[inherit] text-inherit"
      >
        <b>{title}</b>
        <span className="grow" />
        {status}
        <Icon
          name="down"
          size="sm"
          className={`flex-none text-faint transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div className="flex animate-slide-up flex-col gap-2.5 px-0.5 pb-3 motion-reduce:animate-none">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Раздел «Оплата» (прототип v135 `pubBody`, `P`): строки «Налоги» и «Услуги бухгалтера»; раскрыта та,
 * по которой есть долг. Внутри — расчёт, куда переводить, «Я оплатил», «Из чего сумма», «За год» и
 * «История оплат».
 */
export function PaySection({
  page,
  view,
  rows,
  onRow,
  dets,
  onDet,
  flash,
  onPaid,
}: {
  page: Page;
  view: PayView;
  rows: ReadonlySet<PayClaimPurpose>;
  onRow: (k: PayClaimPurpose) => void;
  dets: ReadonlySet<string>;
  onDet: (id: string) => void;
  flash: PayClaimPurpose | null;
  onPaid: ((k: PayClaimPurpose) => void) | null;
}) {
  const t = useT();
  const { today, contractor } = page;
  const year = today.slice(0, 4);
  const [allNeed, setAllNeed] = useState(false);
  const [allHist, setAllHist] = useState(false);
  const som = formatSomWithUnit;
  const det = (id: string, label: string, body: ReactNode) => (
    <PageDet id={id} label={label} open={dets.has(id)} onToggle={() => onDet(id)}>
      {body}
    </PageDet>
  );
  const out: ReactNode[] = [];

  if (view.tax) {
    const { money: v, due, late, account } = view.tax;
    const M = page.money;
    const status = !v ? (
      <span className={`${STATUS} text-faint`}>{t('pub.pay.st.where')}</span>
    ) : due > 0 ? (
      <span data-pay-st="short" className={`${STATUS} font-bold ${late ? 'text-danger' : ''}`}>
        {t('pub.pay.st.short', { sum: som(due) })}
      </span>
    ) : v.spare > 0 ? (
      <span data-pay-st="spare" className={`${STATUS} text-ok`}>
        {t(M && M.dueSum > 0 ? 'pub.pay.st.enough_spare' : 'pub.pay.st.spare', {
          sum: som(v.spare),
        })}
      </span>
    ) : (
      <span data-pay-st="enough" className={`${STATUS} text-ok`}>
        {t('pub.pay.st.enough')}
      </span>
    );
    const acc = account ? (
      <>
        <PayCard k="tax" a={account} note={pagePayNote(contractor.name, 'tax', [], today)} />
        <PaidBlock
          k="tax"
          waiting={view.tax.waiting}
          today={today}
          onPaid={onPaid ? () => onPaid('tax') : null}
        />
      </>
    ) : null;
    out.push(
      <PayRow
        key="tax"
        k="tax"
        title={t('pub.pay.tax')}
        status={status}
        open={rows.has('tax')}
        onToggle={() => onRow('tax')}
        flash={flash === 'tax'}
      >
        {M && v ? (
          <dl data-pub-calc="" className="m-0 flex flex-col gap-1.5">
            <CalcRow
              id="need"
              label={t('pub.calc.need', { date: pageDateWords(M.monthEnd, today) })}
            >
              {som(M.dueSum)}
            </CalcRow>
            <CalcRow id="ours" label={t('pub.calc.ours')}>
              {som(v.ours)}
            </CalcRow>
            {due > 0 ? (
              <CalcRow id="short" label={t('pub.calc.short')} strong>
                {som(due)}
                <CopySum sum={due} />
              </CalcRow>
            ) : (
              <CalcRow id="spare" label={t('pub.calc.spare')}>
                {som(v.spare)}
              </CalcRow>
            )}
          </dl>
        ) : null}
        {due > 0 || !v ? acc : acc ? det('acc-tax', t('pub.det.where'), acc) : null}
        {M?.due.length
          ? det(
              'need',
              t('pub.det.need'),
              <PageList
                count={M.due.length}
                all={allNeed}
                onAll={() => setAllNeed(true)}
                more={t('pub.more', { n: M.due.length - 5 })}
              >
                {M.due.map((r) => (
                  <PageRow key={r.id}>
                    <div className={ROW1}>
                      <span>{t('pub.row.type_period', { type: r.type, period: r.period })}</span>
                      <span className="grow" />
                      <b className="tabular-nums">{som(r.left)}</b>
                    </div>
                    <div className={ROW2}>
                      <span>{t('pub.till', { date: pageDateWords(r.payDue, today) })}</span>
                    </div>
                  </PageRow>
                ))}
              </PageList>,
            )
          : null}
        {M
          ? det(
              'year',
              t('pub.det.year'),
              <dl className="m-0 flex flex-col gap-1.5">
                <CalcRow id="got" label={t('pub.calc.got', { y: year })}>
                  {som(M.got)}
                </CalcRow>
                <CalcRow id="paid" label={t('pub.calc.paid')}>
                  {som(M.paid)}
                </CalcRow>
              </dl>,
            )
          : null}
      </PayRow>,
    );
  }

  if (view.fee && page.fee) {
    const F = page.fee;
    const { due: debt, late, account } = view.fee;
    // Месяцы приходят от новых к старым (прототип `ms … .reverse()`).
    const open = F.months.filter((m) => m.got < m.charge);
    const done = F.months.filter((m) => m.got >= m.charge);
    const status =
      debt > 0 ? (
        <span data-pay-st="debt" className={`${STATUS} font-bold ${late ? 'text-danger' : ''}`}>
          {som(debt)}
        </span>
      ) : (
        <span data-pay-st="ok" className={`${STATUS} text-ok`}>
          {F.paidTill
            ? t('pub.fee.st.till', { month: monthLabel(F.paidTill).split(' ')[0] ?? '' })
            : t('pub.fee.st.none')}
        </span>
      );
    const monthRow = (m: (typeof F.months)[number]) => {
      const paid = m.got >= m.charge;
      const wait = m.status === 'wait';
      const bad = !paid && !wait && pageFeeDue(m.month, F.feeDay) < today;
      const st = paid ? 'paid' : wait ? 'wait' : m.got > 0 ? 'partial' : 'unpaid';
      return (
        <PageRow key={m.month}>
          <div className={ROW1}>
            <span>{pageMonthName(m.month, today)}</span>
            <span className="grow" />
            <b className="tabular-nums">{som(m.charge)}</b>
            <span
              data-fee-st={st}
              className={paid ? 'text-ok' : bad ? 'text-danger' : 'text-[13px] text-faint'}
            >
              {t(`pub.fee.m.${st}`)}
            </span>
          </div>
          {m.got > 0 && !paid ? (
            <div className={ROW2}>
              <span>{t('pub.fee.m.part', { got: som(m.got), charge: som(m.charge) })}</span>
            </div>
          ) : null}
        </PageRow>
      );
    };
    const acc = account ? (
      <>
        <PayCard k="fee" a={account} note={pagePayNote(contractor.name, 'fee', F.months, today)} />
        <PaidBlock
          k="fee"
          waiting={view.fee.waiting}
          today={today}
          onPaid={onPaid ? () => onPaid('fee') : null}
        />
      </>
    ) : null;
    out.push(
      <PayRow
        key="fee"
        k="fee"
        title={t('pub.pay.fee')}
        status={status}
        open={rows.has('fee')}
        onToggle={() => onRow('fee')}
        flash={flash === 'fee'}
      >
        {F.tariff ? (
          <div data-fee-tariff="" className={`${ROW2} text-[13.5px]`}>
            <span>
              {t(F.tariff.period === 'Y' ? 'pub.fee.cost.y' : 'pub.fee.cost.m', {
                amount: som(F.tariff.amount),
              })}
            </span>
            <span>{t('pub.fee.day', { day: F.feeDay })}</span>
          </div>
        ) : null}
        {open.length ? (
          <div data-fee-open="" className="flex flex-col gap-2">
            {open.map(monthRow)}
          </div>
        ) : null}
        {debt > 0 ? (
          <dl data-pub-calc="" className="m-0 flex flex-col gap-1.5">
            <CalcRow id="fee" label={t('pub.calc.fee')} strong>
              {som(debt)}
              {account ? <CopySum sum={debt} /> : null}
            </CalcRow>
          </dl>
        ) : null}
        {debt > 0 ? acc : acc ? det('acc-fee', t('pub.det.where'), acc) : null}
        {done.length
          ? det(
              'feehist',
              t('pub.det.fee_hist'),
              <PageList
                count={done.length}
                all={allHist}
                onAll={() => setAllHist(true)}
                more={t('pub.more', { n: done.length - 5 })}
              >
                {done.map(monthRow)}
              </PageList>,
            )
          : null}
      </PayRow>,
    );
  }
  return <div className="flex flex-col">{out}</div>;
}

/**
 * Окно «Оплатить» (прототип `pubPayDlg`): сумма со «Скопировать», куда переводить, «Из чего сумма»
 * свёрнуто, «Я оплатил» — пока бухгалтер принимает файлы со страницы.
 */
function PayDialog({
  page,
  plan,
  account,
  open,
  onClose,
  onPaid,
}: {
  page: Page;
  plan: PayPlan;
  account: PagePay;
  open: boolean;
  onClose: () => void;
  onPaid: (() => void) | null;
}) {
  const t = useT();
  const { today } = page;
  const [rows, setRows] = useState(false);
  const som = formatSomWithUnit;
  const title =
    plan.purpose === 'fee'
      ? t('pub.payw.title.fee')
      : plan.titleMonth
        ? t('pub.payw.title.tax_month', {
            month: monthLabel(plan.titleMonth).replace(` ${today.slice(0, 4)}`, ''),
          })
        : t('pub.payw.title.tax');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="mid"
      noMax
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('pub.payw.close')}
          </button>
          {onPaid ? (
            <button
              type="button"
              data-pub-pay-paid=""
              className={buttonClass('cta')}
              onClick={onPaid}
            >
              <Icon name="check" size="sm" />
              {t('pub.paid.btn')}
            </button>
          ) : null}
        </>
      }
    >
      <div data-pub-pay-dlg={plan.purpose} className="flex flex-col gap-3">
        {plan.sum > 0 ? <SumLine sum={plan.sum} /> : null}
        <PayCard
          k={plan.purpose}
          a={account}
          note={pagePayNote(page.contractor.name, plan.purpose, page.fee?.months ?? [], today)}
        />
        {plan.rows.length ? (
          <PageDet id="rows" label={t('pub.det.need')} open={rows} onToggle={() => setRows(!rows)}>
            {plan.calc ? (
              <span className={HINT}>
                {t('pub.payw.calc', {
                  date: pageDateWords(plan.calc.until, today),
                  need: som(plan.calc.need),
                  ours: som(plan.calc.ours),
                })}
              </span>
            ) : null}
            {plan.rows.map((r) => (
              <PageRow key={r.id}>
                <div className={ROW1}>
                  <span>
                    {r.month
                      ? pageMonthTitle(r.month)
                      : t('pub.row.type_period', { type: r.type ?? '', period: r.period ?? '' })}
                  </span>
                  <span className="grow" />
                  <b className="tabular-nums">{som(r.sum)}</b>
                </div>
                {r.due ? (
                  <div className={ROW2}>
                    <span>{t('pub.till', { date: pageDateWords(r.due, today) })}</span>
                  </div>
                ) : null}
              </PageRow>
            ))}
          </PageDet>
        ) : null}
      </div>
    </Modal>
  );
}

interface PaidBody {
  purpose: PayClaimPurpose;
  month: string | null;
  amount: number;
  comment: string;
}

/**
 * «Я оплатил»: начать (ссылка на хранилище для чека) → положить чек → закончить с теми же полями.
 * Любой отказ — ошибкой с кодом словаря.
 */
async function sendPaid(address: PageAddress, body: PaidBody, file: File) {
  const base = `/${address.slug}/inn/${address.inn}/paid`;
  const post = (url: string, data: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  const started = await callApi(() =>
    post(base, { ...body, file: { name: file.name, size: file.size } }),
  );
  if (!started.ok) return started.error;
  const [item] = PageSentTicket.parse(started.data).items;
  if (!item) return { code: 'file_not_uploaded', message: '' };
  try {
    const put = await fetch(item.upload.url, {
      method: item.upload.method,
      headers: item.upload.headers,
      body: file,
    });
    if (!put.ok) return { code: 'file_not_uploaded', message: '' };
  } catch {
    return { code: 'network', message: '' };
  }
  const done = await callApi(() => post(`${base}/complete`, { ...body, id: item.id }));
  return done.ok ? null : done.error;
}

type FieldErrors = Partial<Record<PagePaidProblem['field'], string>>;

/** Поле и код текста из отказа сервера `page_paid_invalid`. */
function serverProblem(e: ApiErrorLike): PagePaidProblem | null {
  if (e.code !== 'page_paid_invalid') return null;
  const d = e.details as { field?: unknown; problem?: unknown } | undefined;
  if (typeof d?.field !== 'string' || typeof d.problem !== 'string') return null;
  return { field: d.field, code: d.problem } as PagePaidProblem;
}

/** Откуда открыто «Я оплатил». */
export interface PaidStart {
  purpose: PayClaimPurpose;
  /** Месяц налогов из «Оплатить» месяца; у услуг бухгалтера месяц — самый старый с долгом. */
  month: string | null;
  /** Сумма из окна «Оплатить»: та же, что показана там. */
  sum: number | null;
  /** Сверху — выбор «Налоги» или «Услуги бухгалтера» (из «Помощи», когда показаны оба). */
  pick: boolean;
}

/**
 * Окно «Я оплатил» (прототип v135 `pubPaidDlg`): сверху строка «это не оплата», при `pick` — «Налоги»
 * или «Услуги бухгалтера», «Сколько перевели, сом», большая кнопка «Приложить чек», «Добавить
 * комментарий» по ссылке; «Отправить чек» — когда чек приложен. Проверки — те же, что у сервера
 * (`pagePaidProblems`).
 */
function PaidDialog({
  page,
  address,
  start,
  open,
  onClose,
  onSent,
}: {
  page: Page;
  address: PageAddress;
  start: PaidStart;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useT();
  const hint = usePageHint();
  const errorText = useErrorText();
  const id = useId();
  const first = paidDefaults(page, start.purpose, start.month);
  const [purpose, setPurpose] = useState(start.purpose);
  const [month, setMonth] = useState<string | null>(first.month);
  const [sum, setSum] = useState(() => fieldSum(start.sum ?? first.sum));
  const [own, setOwn] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [noteOn, setNoteOn] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  /** Другой вид оплаты — месяц и сумма заново, приложенный чек остаётся (прототип `reset`). */
  const switchTo = (k: PayClaimPurpose) => {
    if (k === purpose) return;
    const d = paidDefaults(page, k, k === start.purpose ? start.month : null);
    setPurpose(k);
    setMonth(d.month);
    setSum(fieldSum(d.sum));
    setOwn(false);
    setErrors({ ...errors, sum: undefined, month: undefined });
  };
  const mb = 20;
  const problemText = (p: PagePaidProblem) => t(`pub.paid.err.${p.code}`, { mb });
  const submit = async () => {
    const amount = parseSom(sum) ?? 0;
    const months =
      purpose === 'tax'
        ? (page.reports?.months ?? []).filter((m) => m.left > 0).map((m) => m.month)
        : pageFeeOpen(page.fee?.months ?? []).map((m) => m.month);
    const problems = pagePaidProblems({
      amount,
      month,
      months,
      file: file ? { name: file.name, size: file.size } : null,
    });
    if (problems.length) {
      const next: FieldErrors = {};
      for (const p of problems) next[p.field] ??= problemText(p);
      return setErrors(next);
    }
    if (!file) return;
    setBusy(true);
    const failed = await sendPaid(address, { purpose, month, amount, comment: note }, file);
    setBusy(false);
    if (!failed) return onSent();
    const p = serverProblem(failed);
    setErrors(p ? { [p.field]: problemText(p) } : { file: errorText(failed) });
  };
  const pickLabel = hint('paidPick', t('cph.paid.pick'));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pub.paid.title')}
      kind="form"
      noMax
      dirty={!!file || note !== '' || own}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-pub-paid-ok=""
            className={buttonClass('cta')}
            disabled={!file || busy}
            title={file ? undefined : t('pub.paid.err.file')}
            onClick={() => void submit()}
          >
            <Icon name="send" size="sm" />
            {t('pub.paid.send')}
          </button>
        </>
      }
    >
      <FormGrid>
        <div
          data-pub-paid-note-top=""
          className="col-span-full flex items-start gap-[9px] rounded-lg border border-line bg-pane-alt px-3 py-[9px] text-[13px] leading-[1.45] text-muted max-md:text-[14px]"
        >
          <Icon name="info" size="sm" className="mt-px flex-none" />
          <span>{hint('paidNote', t('cph.paid.note'))}</span>
        </div>
        {start.pick ? (
          <Field id={`${id}-k`} label={pickLabel} full>
            {(control) => (
              <ChipSelect
                id={control.id}
                label={pickLabel}
                value={purpose}
                onChange={switchTo}
                options={[
                  { value: 'tax', label: t('pub.pay.tax') },
                  { value: 'fee', label: t('pub.pay.fee') },
                ]}
              />
            )}
          </Field>
        ) : null}
        <Field
          id={`${id}-sum`}
          label={t('pub.paid.sum')}
          required
          full
          error={errors.sum ?? errors.month}
        >
          {(control) => (
            <input
              {...control}
              data-pub-paid-sum=""
              inputMode="decimal"
              placeholder={t('pub.paid.sum_ph')}
              className={`${inputClass()} text-[20px] font-[650] tabular-nums`}
              value={sum}
              onChange={(e) => {
                setOwn(true);
                setSum(e.target.value);
                setErrors({ ...errors, sum: undefined, month: undefined });
              }}
            />
          )}
        </Field>
        <Field
          id={`${id}-f`}
          label={t('pub.paid.file')}
          required
          full
          hint={hint('paidFile', t('cph.paid.file_default'))}
          error={errors.file}
        >
          {(control) => (
            <>
              <label
                htmlFor={control.id}
                data-pub-paid-pick={file ? 'on' : ''}
                className={`${buttonClass('default')} min-h-[52px] w-full justify-center border border-dashed border-line-strong shadow-none ${file ? 'border-solid border-accent bg-sel' : ''}`}
              >
                <Icon name="clip" size="sm" />
                <span data-no-gloss="" className="max-w-full overflow-hidden text-ellipsis">
                  {file ? file.name : t('pub.paid.attach')}
                </span>
              </label>
              <input
                {...control}
                type="file"
                data-pub-paid-file=""
                accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setErrors({ ...errors, file: undefined });
                }}
              />
            </>
          )}
        </Field>
        {noteOn ? (
          <Field id={`${id}-note`} label={t('pub.paid.note')} full>
            {(control) => (
              <textarea
                {...control}
                data-pub-paid-note=""
                autoFocus
                maxLength={SENT_FILE_COMMENT_MAX}
                placeholder={t('pub.paid.note_ph')}
                className={`${inputClass()} min-h-[58px] resize-y leading-normal`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <button
            type="button"
            data-pub-paid-add-note=""
            onClick={() => setNoteOn(true)}
            className="col-span-full inline-flex cursor-pointer items-center gap-1 justify-self-start border-0 bg-transparent p-0 font-[550] text-link max-md:min-h-11"
          >
            <Icon name="plus" size="sm" />
            {t('pub.paid.add_note')}
          </button>
        )}
      </FormGrid>
    </Modal>
  );
}

type SlotData =
  { kind: 'paid'; start: PaidStart } | { kind: 'pay'; plan: PayPlan; account: PagePay };
type Slot = SlotData & { n: number };

/**
 * Окна «Оплатить» и «Я оплатил» страницы: `pay(вид, месяц)` и `paid(откуда)` открывают их, `dialogs` —
 * в разметку страницы. «Я оплатил» в окне «Оплатить» уносит его сумму и месяц. После отправки — окно с
 * итогом «что дальше» (доработки 15.11.2026, пункт 5.1) и данные страницы с сервера заново.
 */
export function usePagePaid(page: Page, address: PageAddress) {
  const t = useT();
  const hint = usePageHint();
  const toast = useToast();
  const done = useDoneDialog();
  const router = useRouter();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [open, setOpen] = useState(false);
  const upload = !!page.sent?.upload;
  const view = payView(page);
  const show = (s: SlotData) => {
    setSlot({ ...s, n: (slot?.n ?? 0) + 1 });
    setOpen(true);
  };
  const paid = (start: Partial<PaidStart> & { purpose: PayClaimPurpose }) =>
    show({ kind: 'paid', start: { month: null, sum: null, pick: false, ...start } });
  const pay = (purpose: PayClaimPurpose, month: string | null = null) => {
    const account = view[purpose]?.account ?? null;
    if (!account) return toast(t('pub.payw.no_account'), { icon: 'info' });
    show({ kind: 'pay', plan: payPlan(page, purpose, month), account });
  };
  let dialogs: ReactNode = null;
  if (slot?.kind === 'paid') {
    dialogs = (
      <PaidDialog
        key={`pub-paid-${slot.n}`}
        page={page}
        address={address}
        start={slot.start}
        open={open}
        onClose={() => setOpen(false)}
        onSent={() => {
          setOpen(false);
          done.show(t('cph.paid.done_t'), hint('paidDone', t('pub.paid.done')));
          // «Бухгалтер проверяет» и вкладка «От вас» — с сервера заново.
          router.refresh();
        }}
      />
    );
  } else if (slot?.kind === 'pay') {
    const { plan } = slot;
    dialogs = (
      <PayDialog
        key={`pub-pay-${slot.n}`}
        page={page}
        plan={plan}
        account={slot.account}
        open={open}
        onClose={() => setOpen(false)}
        onPaid={
          upload ? () => paid({ purpose: plan.purpose, month: plan.month, sum: plan.sum }) : null
        }
      />
    );
  }
  return {
    view,
    paid: upload ? paid : null,
    pay,
    dialogs: (
      <>
        {dialogs}
        {done.dialog}
      </>
    ),
  };
}
