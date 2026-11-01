'use client';

import {
  formatDateRu,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  indicatorNumberText,
  indicatorTotals,
  monthLabel,
  orgLogoLetters,
  pageKpiMonths,
  pageLateYear,
  pageNav,
  pageSpark,
  pageStateTone,
  pageTiles,
  pluralForm,
  whatsAppLink,
  type PageNavItem,
  type PageTipId,
} from '@buhuchet/domain';
import type { PagePay, PublicPageBody } from '@buhuchet/shared';
import {
  buttonClass,
  Icon,
  inputClass,
  KeyValues,
  StatusPill,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import { statusPillView } from '../status/status-view';
import {
  PageFoldTile,
  PageKv,
  PageList,
  PageRow,
  PageSection,
  PageTextsContext,
  PageTip,
  ROW1,
  ROW2,
  TileTitle,
  TipPill,
  usePageText,
} from './page-parts';
import { REPORTS_VIEW, useReportsSection, type ReportsView } from './page-reports';

/*
 * Открытая страница контрагента (задача 2.43; ТЗ «Страница контрагента по ссылке» → «Что видит
 * контрагент», «Компоновка страницы»; прототип modules/cp-page.js, pubBody, pubClick, pubGo; стили
 * css/pages.css `.pub-*`). Разделы приходят от сервера, только если они показаны; на ПК — две колонки,
 * на телефоне — один столбец в порядке ТЗ, разделы, кроме «Главного» и «Как оплатить», свёрнуты, внизу
 * — панель разделов.
 */

type Page = PublicPageBody;
type SecId = 'main' | 'pay' | 'acc' | 'reports' | 'money' | 'fee' | 'kpi' | 'contacts';

const STATE_CLASS = {
  ok: 'bg-ok-bg text-ok font-semibold',
  warn: 'bg-caution-bg text-caution',
  bad: 'bg-danger-bg text-danger',
} as const;

const NAV_ICON: Record<PageNavItem, IconName> = {
  main: 'home',
  pay: 'wallet',
  reports: 'file',
  kpi: 'gauge',
  contacts: 'users',
};

const KPI_TOTAL_KEY = {
  sum: 'pub.kpi.total.sum',
  avg: 'pub.kpi.total.avg',
  max: 'pub.kpi.total.max',
  min: 'pub.kpi.total.min',
  last: 'pub.kpi.total.last',
} as const;

const linkBtn =
  'inline cursor-pointer border-0 bg-transparent p-0 text-left font-semibold text-inherit underline decoration-1 underline-offset-2';

export function OpenPage({ page, fileHref }: { page: Page; fileHref: (id: string) => string }) {
  return (
    <PageTextsContext.Provider value={page.texts}>
      <OpenPageBody page={page} fileHref={fileHref} />
    </PageTextsContext.Provider>
  );
}

function OpenPageBody({ page, fileHref }: { page: Page; fileHref: (id: string) => string }) {
  const t = useT();
  const tx = usePageText();
  const toast = useToast();
  const { org, contractor, today } = page;
  const year = today.slice(0, 4);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [view, setView] = useState<ReportsView>(REPORTS_VIEW);
  const [allMoney, setAllMoney] = useState(false);
  const [allFee, setAllFee] = useState(false);
  const [kpiYear, setKpiYear] = useState<string | null>(null);
  const [openKpi, setOpenKpi] = useState<ReadonlySet<string>>(new Set());
  const [allKpi, setAllKpi] = useState<ReadonlySet<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const reports = useReportsSectionSafe(page, view, setView, fileHref);

  const open = (k: string) => setUnfolded((s) => new Set([...s, k]));
  const toggle = (k: string) =>
    setUnfolded((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  /** Плитка «Главного», замечание строки состояния и панель разделов ведут в свой раздел. */
  const go = (k: string, filter?: 'late') => {
    if (filter && page.reports) {
      const lateYear = pageLateYear(page.reports.items, today);
      setView({ ...view, filter, mode: 'type', year: lateYear ?? view.year });
    }
    open(k);
    requestAnimationFrame(() => {
      document.getElementById(`pub-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    clearTimeout(flashTimer.current);
    setFlash(k);
    flashTimer.current = setTimeout(() => setFlash(null), 1400);
  };
  // ОТКЛОНЕНИЕ: docs/deviations.md#Е-6
  const copy = async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Буфер обмена недоступен: номер виден крупно, его можно выделить.
      return;
    }
    toast(done, { icon: 'copy' });
  };
  const sec = (
    id: SecId,
    icon: IconName,
    title: string,
    body: ReactNode,
    o: { sum?: string; extra?: ReactNode; fold?: boolean; what?: string } = {},
  ) => (
    <PageSection
      key={id}
      id={id}
      icon={icon}
      title={title}
      what={o.what ?? tx(`secs.${id}`)}
      sum={o.sum}
      extra={o.extra}
      fold={o.fold ?? true}
      open={unfolded.has(id)}
      onToggle={() => toggle(id)}
      flash={flash === id}
    >
      {body}
    </PageSection>
  );

  // Строка состояния: каждое замечание — ссылка на свой раздел.
  const issues: { go: string; filter?: 'late'; text: string }[] = [];
  if (page.issues.late) {
    const n = page.issues.late;
    issues.push({
      go: 'reports',
      filter: 'late',
      text: t(`pub.state.late.${pluralForm(n)}`, { n }),
    });
  }
  if (page.issues.short) {
    issues.push({
      go: 'money',
      text: t('pub.state.short', { amount: formatSomWithUnit(page.issues.short) }),
    });
  }
  if (page.issues.feeDebt) {
    issues.push({
      go: 'fee',
      text: t('pub.state.fee_debt', { amount: formatSomWithUnit(page.issues.feeDebt) }),
    });
  }
  const tone = pageStateTone(page.issues);
  const state =
    tone === 'ok' ? (
      <div
        role="status"
        data-pub-state="ok"
        className={`flex items-start gap-2.5 rounded-xl px-3.5 py-[11px] text-[14px] leading-[1.5] ${STATE_CLASS.ok}`}
      >
        <Icon name="ok" className="mt-0.5" />
        <span>{tx('state.ok') || t('pub.state.ok')}</span>
      </div>
    ) : (
      <div
        role="status"
        data-pub-state={tone}
        className={`flex items-start gap-2.5 rounded-xl px-3.5 py-[11px] text-[14px] leading-[1.5] ${STATE_CLASS[tone]}`}
      >
        <Icon name="alert" className="mt-0.5" />
        <span className="grow">
          <b>{t('pub.state.attention')}</b>{' '}
          {issues.map((i, j) => (
            <span key={i.go}>
              {j ? <span className="text-faint"> · </span> : null}
              <button type="button" className={linkBtn} onClick={() => go(i.go, i.filter)}>
                {i.text}
              </button>
            </span>
          ))}
        </span>
        <PageTip label={t('pub.state.attention')} text={tx('state.attention')} />
      </div>
    );

  const H: Partial<Record<string, ReactNode>> = {};

  // «Главное» — плитки-итоги; нажатие открывает раздел. Нет плиток — нет раздела, как в прототипе.
  // ОТКЛОНЕНИЕ: docs/deviations.md#Е-5
  const tiles = pageTiles({
    reports: page.main.reports !== null,
    taxes: page.main.taxes !== null,
    fee: page.main.fee !== null,
  });
  if (tiles.length) {
    const tile = (
      key: string,
      goTo: string,
      tip: PageTipId,
      wide: boolean,
      label: string,
      value: ReactNode,
      sub: ReactNode,
      bad = false,
    ) => (
      <button
        key={key}
        type="button"
        data-pub-tile-main={key}
        title={tx(tip) || undefined}
        onClick={() => go(goTo)}
        className={`flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-xl border border-line bg-pane-alt px-3.5 py-3 text-left font-[inherit] text-inherit hover:border-line-strong hover:shadow-pane max-md:px-3 max-md:py-2.5 ${wide ? 'col-span-full' : ''}`}
      >
        <span className="text-[12.5px] font-semibold text-muted">{label}</span>
        <span
          className={`text-[24px] leading-[1.15] font-bold max-md:text-[20px] ${bad ? 'text-danger' : ''}`}
        >
          {value}
        </span>
        {sub ? (
          <span className="flex flex-col gap-1.5 text-[12.5px] leading-[1.35] text-muted">
            {sub}
          </span>
        ) : null}
      </button>
    );
    const small = (text: string) => (
      <small className="text-[14px] font-semibold text-muted"> {text}</small>
    );
    const T = tiles.map((x) => {
      const m = page.main;
      if (x.key === 'reports' && m.reports) {
        const { submitted: n, total } = m.reports;
        const pc = total ? Math.round((n / total) * 100) : 0;
        return tile(
          'reports',
          'reports',
          'main.reports',
          x.wide,
          t('pub.tile.reports', { year }),
          <>
            {n}
            {small(t('pub.of', { n: total }))}
          </>,
          <>
            <span
              role="progressbar"
              aria-label={t('pub.tile.reports_bar')}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={n}
              className="mt-0.5 block h-2 overflow-hidden rounded-full bg-pane-alt shadow-[inset_0_0_0_1px_var(--bu-border)]"
            >
              <i className="block h-full rounded-full bg-ok" style={{ width: `${pc}%` }} />
            </span>
            {page.issues.late ? (
              <span className="inline-flex items-center gap-1 font-semibold text-danger">
                <Icon name="alert" size="sm" />
                {t(`pub.late.${pluralForm(page.issues.late)}`, { n: page.issues.late })}
              </span>
            ) : null}
          </>,
        );
      }
      if (x.key === 'next' && m.reports) {
        const nx = m.reports.next;
        return tile(
          'next',
          'reports',
          'main.next',
          x.wide,
          t('pub.tile.next'),
          nx ? t('pub.tile.next_due', { date: formatDateRu(nx.due) }) : '—',
          nx
            ? t('pub.tile.next_what', { type: nx.type, period: nx.period })
            : t('pub.tile.next_none'),
        );
      }
      if (x.key === 'taxes' && m.taxes) {
        const f3: [string, number][] = [[t('pub.tile.taxes_due'), m.taxes.due]];
        if (m.taxes.got !== null) f3.push([t('pub.tile.taxes_got'), m.taxes.got]);
        if (m.taxes.paid !== null) f3.push([t('pub.tile.taxes_paid'), m.taxes.paid]);
        return tile(
          'taxes',
          m.taxes.go,
          'main.taxes',
          true,
          t('pub.tile.taxes', { year }),
          <span className="grid grid-cols-3 gap-2.5">
            {f3.map(([l, v]) => (
              <span key={l} className="flex min-w-0 flex-col gap-0.5">
                <small className="text-[12px] font-semibold text-muted">{l}</small>
                <b className="text-[20px] tabular-nums max-md:text-[16px]">
                  {formatSom(v, 'auto')}
                </b>
              </span>
            ))}
          </span>,
          null,
        );
      }
      if (x.key === 'fee' && m.fee) {
        const { debt, paidTill } = m.fee;
        return debt > 0
          ? tile(
              'fee',
              'fee',
              'main.fee',
              x.wide,
              t('pub.tile.fee_debt'),
              <>
                {formatSom(debt, 'auto')}
                {small(t('pub.som'))}
              </>,
              null,
              true,
            )
          : tile(
              'fee',
              'fee',
              'main.fee',
              x.wide,
              paidTill ? t('pub.tile.fee_till') : t('pub.tile.fee'),
              paidTill ? monthLabel(paidTill) : t('pub.tile.fee_none'),
              null,
            );
      }
      return null;
    });
    H.main = sec(
      'main',
      'home',
      t('pub.sec.main'),
      <div className="grid grid-cols-2 gap-2.5">{T}</div>,
      { fold: false },
    );
  }

  // «Как оплатить» — налоги и обслуживание.
  if (page.pay) {
    const P: ReactNode[] = [];
    if (page.pay.tax) P.push(payCard('tax', t('pub.pay.tax'), 'wallet', page.pay.tax));
    if (page.pay.fee) P.push(payCard('fee', t('pub.pay.fee'), 'coins', page.pay.fee));
    if (P.length) {
      H.pay = sec(
        'pay',
        'wallet',
        t('pub.sec.pay'),
        <div className="flex flex-col gap-2.5">{P}</div>,
        {
          fold: false,
        },
      );
    }
  }
  function payCard(k: 'tax' | 'fee', title: string, icon: IconName, a: PagePay) {
    const phone = a.kind === 'phone';
    const btn = (value: string, done: string, label: string) => (
      <button
        type="button"
        aria-label={label}
        onClick={() => void copy(value, done)}
        className={buttonClass('default', 'sm')}
      >
        <Icon name="copy" size="sm" />
        {t('pub.pay.copy')}
      </button>
    );
    const what = tx(`pay.${k}`);
    return (
      <div
        key={k}
        data-pay={k}
        className="flex flex-col gap-2 rounded-xl border border-line bg-pane-alt px-3.5 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Icon name={icon} className="text-accent" />
          <b>{title}</b>
          <span className="ml-auto text-[11.5px] text-faint">{t(`pub.pay.kind.${a.kind}`)}</span>
        </div>
        {phone ? null : <span className="font-semibold">{a.bank}</span>}
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            data-pay-number=""
            className="font-mono text-[22px] font-bold tracking-[.02em] [overflow-wrap:anywhere] max-md:text-[20px]"
          >
            {a.number}
          </span>
          {btn(
            a.copy,
            phone ? t('pub.pay.copied_phone') : t('pub.pay.copied_account'),
            phone ? t('pub.pay.copy_phone') : t('pub.pay.copy_account'),
          )}
        </div>
        {phone ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-[11.5px] text-faint">{t('pub.pay.from')}</span>
            {a.banks.map((b) => (
              <span
                key={b}
                className="rounded-full bg-label-bg px-2 py-px text-[11.5px] font-semibold text-label"
              >
                {b}
              </span>
            ))}
            <PageTip label={t('pub.pay.from')} text={tx('pay.banks')} />
          </div>
        ) : null}
        {a.bik ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-[11.5px] text-faint">{t('pub.pay.bik')}</span>
            <span className="font-mono">{a.bik}</span>
            {btn(a.bik, t('pub.pay.copied_bik'), t('pub.pay.copy_bik'))}
          </div>
        ) : null}
        {a.holder ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-[11.5px] text-faint">{t('pub.pay.holder')}</span>
            <b>{a.holder}</b>
          </div>
        ) : null}
        {what ? <p className="m-0 text-[13px] leading-[1.45] text-muted">{what}</p> : null}
      </div>
    );
  }

  // «Ваш бухгалтер» — всегда.
  const acc = page.accountant;
  const tel = (phone: { text: string; digits: string } | null) =>
    phone ? (
      <div className="flex flex-wrap gap-2">
        <a className={buttonClass('default', 'sm')} href={`tel:+${phone.digits}`}>
          <Icon name="phone" size="sm" />
          {t('pub.acc.call')}
        </a>
        <a
          className={buttonClass('default', 'sm')}
          href={whatsAppLink(phone.digits, '')}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="chat" size="sm" />
          {t('pub.acc.whatsapp')}
        </a>
      </div>
    ) : null;
  H.acc = sec(
    'acc',
    'user',
    t('pub.sec.acc'),
    acc ? (
      <>
        <div className="flex flex-col gap-0.5">
          <b>{acc.name}</b>
          <span className="text-[11.5px] text-faint">{acc.role}</span>
          {acc.phone ? <span className="font-mono">{acc.phone.text}</span> : null}
        </div>
        {tel(acc.phone)}
      </>
    ) : (
      <span className="text-faint">
        {t('pub.acc.none', { org: org.name })}
        {org.phone ? (
          <>
            {': '}
            <a className="font-mono text-link" href={`tel:+${org.phone.digits}`}>
              {org.phone.text}
            </a>
          </>
        ) : null}
      </span>
    ),
    { sum: acc?.name },
  );

  if (page.reports) {
    H.reports = sec('reports', 'file', t('pub.sec.reports'), reports.body, {
      sum: reports.sum,
      extra: reports.extra,
    });
  }

  // «Деньги на налоги».
  if (page.money) {
    const M = page.money;
    const v = M.verdict;
    const label = t(`pub.money.${v}`);
    const amount =
      v === 'short'
        ? formatSomWithUnit(M.amount)
        : v === 'enough'
          ? formatSomWithUnit(0)
          : `+${formatSomWithUnit(M.amount)}`;
    const verdictClass =
      v === 'short'
        ? 'bg-danger-bg text-danger'
        : v === 'surplus'
          ? 'bg-info-bg text-info'
          : 'bg-ok-bg text-ok';
    const kv = (id: string, l: string, tip: PageTipId, value: ReactNode) => ({
      id,
      label: (
        <>
          {l}
          <PageTip label={l} text={tx(tip)} />
        </>
      ),
      value,
    });
    H.money = sec(
      'money',
      'wallet',
      t('pub.sec.money'),
      <>
        <div
          data-verdict={v}
          className={`flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 font-semibold ${verdictClass}`}
        >
          <Icon name={v === 'short' ? 'alert' : v === 'surplus' ? 'info' : 'ok'} />
          <span>{label}</span>
          <PageTip label={label} text={tx(`money.${v}`)} />
          <span className="ml-auto text-[20px] font-bold tabular-nums">{amount}</span>
        </div>
        <PageKv
          items={[
            kv(
              'need',
              t('pub.money.need', { date: formatDateRu(M.monthEnd) }),
              'money.need',
              <b>{formatSomWithUnit(M.dueSum)}</b>,
            ),
            kv('got', t('pub.money.got', { y: year }), 'money.got', formatSomWithUnit(M.got)),
            kv('paid', t('pub.money.paid', { y: year }), 'money.paid', formatSomWithUnit(M.paid)),
          ]}
        />
        {M.due.length ? (
          <PageList
            count={M.due.length}
            all={allMoney}
            onAll={() => setAllMoney(true)}
            more={t('pub.more', { n: M.due.length - 5 })}
          >
            {M.due.map((r) => {
              const lt = r.payDue < today;
              return (
                <PageRow key={r.id} late={lt}>
                  <div className={ROW1}>
                    <b>{r.type}</b>
                    <span className="text-faint">·</span>
                    <span>{r.period}</span>
                    <span className="grow" />
                    <b className="tabular-nums">{formatSomWithUnit(r.left)}</b>
                  </div>
                  <div className={ROW2}>
                    <span
                      className={
                        lt ? 'inline-flex items-center gap-1 font-semibold text-danger' : ''
                      }
                    >
                      {lt ? <Icon name="alert" size="sm" /> : null}
                      {t('pub.money.pay_due', { date: formatDateRu(r.payDue) })}
                    </span>
                  </div>
                </PageRow>
              );
            })}
          </PageList>
        ) : (
          <span className="text-faint">{t('pub.money.none')}</span>
        )}
      </>,
      {
        sum:
          v === 'short'
            ? t('pub.money.sum_short', { amount: formatSomWithUnit(M.amount) })
            : label.toLowerCase(),
      },
    );
  }

  // «Оплата за обслуживание».
  if (page.fee) {
    const F = page.fee;
    const kvRow = (id: string, l: string, tip: PageTipId, value: ReactNode, bad = false) => ({
      id,
      label: (
        <>
          {l}
          <PageTip label={l} text={tx(tip)} />
        </>
      ),
      value,
      className: bad ? 'font-semibold text-danger' : '',
    });
    H.fee = sec(
      'fee',
      'coins',
      t('pub.sec.fee'),
      <>
        <PageKv
          items={[
            kvRow(
              'tariff',
              t('pub.fee.tariff'),
              'fee.tariff',
              F.tariff ? (
                <>
                  {t(F.tariff.period === 'Y' ? 'pub.fee.per.y' : 'pub.fee.per.m', {
                    amount: formatSomWithUnit(F.tariff.amount),
                  })}
                  <div className="text-[11.5px] text-faint">
                    {t('pub.fee.day', { day: F.feeDay })}
                  </div>
                </>
              ) : (
                '—'
              ),
            ),
            kvRow('debt', t('pub.fee.debt'), 'fee.debt', formatSomWithUnit(F.debt), F.debt > 0),
          ]}
        />
        {F.months.length ? (
          <PageList
            count={F.months.length}
            all={allFee}
            onAll={() => setAllFee(true)}
            more={t('pub.more', { n: F.months.length - 5 })}
          >
            {F.months.map((m) => {
              const pill = statusPillView(t, 'payment', m.status);
              return (
                <PageRow key={m.month}>
                  <div className={ROW1}>
                    <span>{monthLabel(m.month)}</span>
                    <span className="grow" />
                    <TipPill
                      pill={<StatusPill {...pill} size="sm" />}
                      label={pill.label}
                      text={tx(`fee.${m.status}`)}
                    />
                  </div>
                  <div className={ROW2}>
                    <span>
                      {t('pub.fee.charged')}{' '}
                      <b className="tabular-nums">{formatSomWithUnit(m.charge)}</b>
                    </span>
                    <span>
                      {t('pub.fee.paid')} <b className="tabular-nums">{formatSomWithUnit(m.got)}</b>
                    </span>
                  </div>
                </PageRow>
              );
            })}
          </PageList>
        ) : null}
        {page.pay?.fee ? (
          <button
            type="button"
            onClick={() => go('pay')}
            className="inline-flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 font-[550] text-link"
          >
            <Icon name="wallet" size="sm" />
            {t('pub.fee.to_pay')}
          </button>
        ) : null}
      </>,
      {
        sum:
          F.debt > 0
            ? t('pub.fee.sum_debt', { amount: formatSomWithUnit(F.debt) })
            : F.paidTill
              ? t('pub.fee.sum_till', { month: monthLabel(F.paidTill).toLowerCase() })
              : '',
      },
    );
  }

  // «Показатели» — плитка на показатель: итог за год и мини-график, месяцы — по нажатию.
  if (page.kpi) {
    const K = page.kpi;
    const y = kpiYear && K.years.includes(kpiYear) ? kpiYear : year;
    const m12 = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    const ms = pageKpiMonths(y, today);
    const n = K.indicators.length;
    H.kpi = sec(
      'kpi',
      'gauge',
      t('pub.sec.kpi'),
      n && ms.length ? (
        <div className="grid grid-cols-2 items-start gap-2.5 max-md:grid-cols-1">
          {K.indicators.map((i) => {
            const byMonth = new Map(i.values.map((v) => [v.month, v.value]));
            const vals = ms.map((m) => byMonth.get(m) ?? null);
            const totals = indicatorTotals(vals);
            const o = openKpi.has(i.id);
            const spark = pageSpark(
              m12.map((m) => (m <= ms[ms.length - 1]! ? (byMonth.get(m) ?? null) : undefined)),
            );
            return (
              <PageFoldTile
                key={i.id}
                id={i.id}
                open={o}
                onToggle={() =>
                  setOpenKpi((s) => {
                    const x = new Set(s);
                    if (x.has(i.id)) x.delete(i.id);
                    else x.add(i.id);
                    return x;
                  })
                }
                head={
                  <>
                    <TileTitle open={o}>
                      <b>{i.name}</b>
                      {i.unit ? <span className="text-[11.5px] text-faint">{i.unit}</span> : null}
                    </TileTitle>
                    <span className="text-[22px] leading-[1.2] font-bold max-md:text-[20px]">
                      {'sum' in totals ? indicatorNumberText(i.type, totals[i.total]) : '—'}
                    </span>
                    <span className="text-[11.5px] text-faint">
                      {t('pub.kpi.total', { total: t(KPI_TOTAL_KEY[i.total]), y })}
                    </span>
                    <svg
                      viewBox="0 0 96 30"
                      preserveAspectRatio="none"
                      role="img"
                      aria-label={t('pub.kpi.chart', { name: i.name })}
                      className="mt-1 block h-[34px] w-full"
                    >
                      {spark.map((b, j) =>
                        b ? (
                          <rect
                            key={m12[j]}
                            x={b.x}
                            y={30 - b.h}
                            width={6}
                            height={b.h}
                            rx={1}
                            className={
                              b.kind === 'empty'
                                ? 'fill-line'
                                : b.kind === 'current'
                                  ? 'fill-accent'
                                  : 'fill-line-strong'
                            }
                          >
                            <title>
                              {`${monthLabel(m12[j]!)}: ${
                                byMonth.has(m12[j]!)
                                  ? indicatorNumberText(i.type, byMonth.get(m12[j]!)!)
                                  : t('pub.kpi.no_data')
                              }`}
                            </title>
                          </rect>
                        ) : null,
                      )}
                    </svg>
                  </>
                }
              >
                <PageList
                  count={ms.length}
                  all={allKpi.has(i.id)}
                  onAll={() => setAllKpi((s) => new Set([...s, i.id]))}
                  more={t('pub.more', { n: ms.length - 5 })}
                >
                  {[...ms].reverse().map((m) => (
                    <PageRow key={m} inner>
                      <div className={ROW1}>
                        <span>{monthLabel(m)}</span>
                        <span className="grow" />
                        <b className="tabular-nums">
                          {byMonth.has(m) ? (
                            indicatorNumberText(i.type, byMonth.get(m)!)
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </b>
                      </div>
                    </PageRow>
                  ))}
                </PageList>
              </PageFoldTile>
            );
          })}
        </div>
      ) : (
        <span className="text-faint">{t('pub.kpi.none')}</span>
      ),
      {
        sum: n ? t(`pub.kpi.count.${pluralForm(n)}`, { n }) : '',
        extra: (
          <select
            aria-label={t('pub.kpi.year_label')}
            value={y}
            onChange={(e) => setKpiYear(e.target.value)}
            className={`${inputClass({ full: false })} min-h-[30px] px-2 py-[3px] text-[13px]`}
          >
            {K.years.map((x) => (
              <option key={x} value={x}>
                {t('pub.rep.year', { y: x })}
              </option>
            ))}
          </select>
        ),
      },
    );
  }

  // «Контакты».
  if (page.contacts) {
    const C = page.contacts;
    const person = (name: string, sub: string, phone: { text: string; digits: string } | null) => (
      <div key={`${name}|${sub}`} className="flex flex-col gap-0.5">
        <b>{name}</b>
        <span className="text-[11.5px] text-faint">{sub}</span>
        {phone ? (
          <a className="font-mono text-link" href={`tel:+${phone.digits}`}>
            {phone.text}
          </a>
        ) : null}
      </div>
    );
    const what = (p: (typeof C.people)[number]) =>
      p.responsible
        ? [t('pub.contacts.responsible'), ...(p.types.length ? [p.types.join(', ')] : [])].join(
            ' · ',
          )
        : p.types.join(', ');
    const n = C.people.length;
    H.contacts = sec(
      'contacts',
      'users',
      t('pub.sec.contacts'),
      <>
        <div className="flex flex-col gap-2.5">
          {C.people.map((p) => person(p.name, `${p.role} · ${what(p)}`, p.phone))}
          {org.phone ? person(org.name, t('pub.contacts.org_phone'), org.phone) : null}
        </div>
        <h4 className="m-0 mt-1.5 text-[13px]">{t('pub.contacts.yours')}</h4>
        <KeyValues
          items={[
            { id: 'head', label: t('pub.contacts.head'), value: C.head || '—' },
            { id: 'contact', label: t('pub.contacts.contact'), value: C.contact || '—' },
            { id: 'phone', label: t('pub.contacts.phone'), value: C.phone || '—', mono: true },
          ]}
        />
        <span className="text-[11.5px] text-faint">
          {tx('contacts.data') || t('pub.contacts.hint')}
        </span>
      </>,
      { sum: n ? t(`pub.contacts.count.${pluralForm(n)}`, { n }) : '' },
    );
  }

  const nav = pageNav(new Set(Object.keys(H).filter((k): k is PageNavItem => k in NAV_ICON)));
  const col = (ks: string[]) => ks.map((k) => H[k] ?? null);

  return (
    <div data-pub-body="" className="flex w-[min(1120px,100%)] flex-col gap-3.5 max-md:gap-2.5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {org.logo ? (
            <img
              src={org.logo.url}
              alt=""
              className="h-10 w-10 flex-none rounded-[10px] border border-line object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-accent font-bold text-on-accent"
            >
              {orgLogoLetters(org.name)}
            </span>
          )}
          <span className="flex flex-col">
            <b>{org.name}</b>
            <span className="text-[11.5px] text-faint">{t('pub.org_hint')}</span>
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-faint">
          {t('pub.as_of', { at: formatMomentRu(new Date(page.asOf)) })}
          <PageTip label={t('pub.as_of', { at: '' }).trim()} text={tx('head.as_of')} />
        </span>
      </header>
      <div>
        <h1 className="m-0 mb-1 text-[24px] leading-[1.25] font-[720] max-md:text-[20px]">
          {contractor.name}
        </h1>
        <span className="text-muted">
          {t('pub.inn')} <span className="font-mono">{contractor.inn}</span>
          {' · '}
          {contractor.regime ?? t('pub.regime_none')}
        </span>
      </div>
      {state}
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-3.5 max-md:flex max-md:flex-col max-md:items-stretch max-md:gap-2.5">
        <div className="flex min-w-0 flex-col gap-3.5 max-md:contents">
          {col(['main', 'reports', 'kpi'])}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5 max-md:contents">
          {col(['pay', 'acc', 'money', 'fee', 'contacts'])}
        </div>
      </div>
      {nav.length ? (
        <nav
          aria-label={t('pub.nav.label')}
          className="fixed inset-x-0 bottom-0 z-[86] hidden border-t border-line bg-raised px-1 pt-0.5 pb-[calc(2px+env(safe-area-inset-bottom,0px))] max-md:flex"
        >
          {nav.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => go(k)}
              className="flex min-h-[52px] min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 border-0 bg-transparent px-0.5 py-1.5 text-[11px] font-semibold text-muted"
            >
              <Icon name={NAV_ICON[k]} className="h-5 w-5" />
              <span>{t(`pub.nav.${k}`)}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/** Хук «Отчётов» вызывается всегда в одном порядке: без раздела — с пустыми отчётами. */
function useReportsSectionSafe(
  page: Page,
  view: ReportsView,
  setView: (v: ReportsView) => void,
  fileHref: (id: string) => string,
) {
  const taxpay = page.reports?.items.some((r) => r.payStatus !== null) ?? false;
  return useReportsSection(
    page.reports ?? { types: [], items: [] },
    page.today,
    taxpay,
    view,
    setView,
    fileHref,
  );
}
