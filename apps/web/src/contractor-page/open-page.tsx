'use client';

import {
  bishkekDate,
  bishkekTime,
  formatSomWithUnit,
  indicatorNumberText,
  indicatorTotals,
  monthLabel,
  orgLogoLetters,
  pageDateWords,
  pageKpiMonths,
  pageLateYear,
  pageMonthTitle,
  pageSpark,
  pluralForm,
  whatsAppLink,
  type PayClaimPurpose,
} from '@buhuchet/domain';
import type { PublicPageBody } from '@buhuchet/shared';
import { buttonClass, Icon, iconButtonClass, inputClass, type IconName } from '@buhuchet/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import {
  PageFoldTile,
  PageKv,
  PageList,
  PageRow,
  PageSection,
  PageTextsContext,
  ROW1,
  TileTitle,
  usePageText,
} from './page-parts';
import { usePageUpload } from '../files/page-sent';
import {
  usePageFilesSection,
  usePageFileViewer,
  type FilesTab,
  type OpenPageFile,
} from './page-files';
import { usePageHelp, type PageHelpActions } from './page-help';
import { PageHelpContext, usePageHint } from './page-help-context';
import { pageHelpView } from './page-help-model';
import { PaySection, usePagePaid, useWaitText } from './page-pay';
import type { PayLine } from './page-pay-model';
import { REPORTS_VIEW, useReportsSection, type ReportsView } from './page-reports';
import { PageTelegramBody, usePageTelegramConnect, type PageAddress } from './page-telegram';

/*
 * Открытая страница контрагента простыми словами (доработки 17.11.2026; прототип v135 modules/cp-page.js
 * `pubBody`, `pubGo`, `pubNav`, `pubNavMark`; стили css/pages.css `.pub-*`): сверху — «Что нужно сделать»
 * (деньги с кнопкой «Оплатить», несданные в срок отчёты — спокойно) или «Всё в порядке»; дальше разделы
 * «Оплата», «Отчёты», «Файлы», «Связь», «Цифры компании». На ПК — две колонки, на телефоне — один столбец,
 * разделы, кроме «Оплаты», свёрнуты до строки с итогом, внизу — меню «Главное · Оплата · Отчёты · Файлы
 * · Помощь». Разделы приходят от сервера, только если они показаны.
 */

type Page = PublicPageBody;
type SecId = 'pay' | 'reports' | 'files' | 'acc' | 'kpi';
type NavId = 'top' | 'pay' | 'reports' | 'files' | 'help';
type Phone = { text: string; digits: string };

const NAV: readonly (readonly [NavId, IconName])[] = [
  ['top', 'home'],
  ['pay', 'wallet'],
  ['reports', 'file'],
  ['files', 'folder'],
  ['help', 'help'],
];

/** «за 2026 год», «в среднем за 2026 год» (прототип `PUB_KAGG`). */
const KPI_TOTAL_KEY = {
  sum: 'pub.kpi.total.sum',
  avg: 'pub.kpi.total.avg',
  max: 'pub.kpi.total.max',
  min: 'pub.kpi.total.min',
  last: 'pub.kpi.total.last',
} as const;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Строка «Что нужно сделать»: на ПК — столбец с чертой слева, на телефоне — строка с чертой сверху. */
const DO_ROW =
  'flex min-w-0 items-center gap-3 border-line py-3 max-md:flex-wrap max-md:border-t max-md:first:border-t-0 md:flex-col md:items-start md:justify-between md:gap-2.5 md:border-l md:px-[18px] md:pt-2.5 md:pb-4 md:first:border-l-0';

interface OpenPageProps {
  page: Page;
  /** Адрес страницы: по нему «Telegram», «Я оплатил» и «Отправить файл» шлют свои запросы. */
  address: PageAddress;
  fileHref: (id: string) => string;
}

export function OpenPage({ page, address, fileHref }: OpenPageProps) {
  return (
    <PageTextsContext.Provider value={page.texts}>
      <PageHelpContext.Provider value={page.help}>
        <OpenPageBody page={page} address={address} fileHref={fileHref} />
      </PageHelpContext.Provider>
    </PageTextsContext.Provider>
  );
}

function OpenPageBody({ page, address, fileHref }: OpenPageProps) {
  const t = useT();
  const tx = usePageText();
  const hint = usePageHint();
  const { org, contractor, today } = page;
  const year = today.slice(0, 4);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [view, setView] = useState<ReportsView>(REPORTS_VIEW);
  const [payRows, setPayRows] = useState<ReadonlySet<PayClaimPurpose> | null>(null);
  const [dets, setDets] = useState<ReadonlySet<string>>(new Set());
  const [filesTab, setFilesTab] = useState<FilesTab | null>(null);
  const [kpiYear, setKpiYear] = useState<string | null>(null);
  const [openKpi, setOpenKpi] = useState<ReadonlySet<string>>(new Set());
  const [allKpi, setAllKpi] = useState<ReadonlySet<string>>(new Set());
  const [navCur, setNavCur] = useState<NavId>('top');
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  // Окно просмотра файлов — одно на страницу: «Файлы» и файлы периодов «Отчётов».
  const viewer = usePageFileViewer(fileHref);
  const money = usePagePaid(page, address);
  const pv = money.view;
  const waitText = useWaitText(today);
  const reports = useReportsSectionSafe(page, view, setView, viewer.openFile, (month) =>
    money.pay('tax', month),
  );
  const filesSection = usePageFilesSection(
    page.files,
    page.sent,
    today,
    viewer.openFile,
    filesTab,
    setFilesTab,
  );
  // После отправки — вкладка «От вас», а на телефоне раздел «Файлы» раскрыт: статус файла сразу виден
  // (прототип v135 `PUB.ft='you'; PUB.unf.add('files')`).
  const upload = usePageUpload(address, () => {
    setFilesTab('you');
    setUnfolded((s) => new Set([...s, 'files']));
  });
  const telegram = usePageTelegramConnect(page.telegram, address);
  const root = useRef<HTMLDivElement>(null);

  // Отметка текущего раздела в нижнем меню: раздел, чей заголовок последним прошёл верхнюю треть экрана;
  // у конца страницы — «Файлы», если они видны (прототип `pubNavMark`).
  useEffect(() => {
    const mark = () => {
      const lim = window.innerHeight / 3;
      let cur: NavId = 'top';
      for (const k of ['pay', 'reports', 'files'] as const) {
        const s = document.getElementById(`pub-${k}`);
        if (s && s.getBoundingClientRect().top <= lim) cur = k;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) {
        const f = document.getElementById('pub-files');
        if (f && f.getBoundingClientRect().top < window.innerHeight) cur = 'files';
      }
      setNavCur(cur);
    };
    window.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', mark);
    return () => {
      window.removeEventListener('scroll', mark);
      window.removeEventListener('resize', mark);
    };
  }, []);

  const taxDue = pv.tax?.due ?? 0;
  const feeDue = pv.fee?.due ?? 0;
  // Раскрыта строка «Оплаты», по которой есть долг, пока клиент не раскрыл и не свернул сам.
  const rows: ReadonlySet<PayClaimPurpose> =
    payRows ??
    new Set<PayClaimPurpose>([
      ...(taxDue > 0 ? (['tax'] as const) : []),
      ...(pv.fee && feeDue > 0 ? (['fee'] as const) : []),
    ]);
  const toggleIn = <T,>(s: ReadonlySet<T>, k: T): Set<T> => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  };
  const toggle = (k: string) => setUnfolded((s) => toggleIn(s, k));
  /**
   * Переход к разделу (прототип `pubGo`): «money» и «fee» (ответы «Помощи») — строки «Налоги» и «Услуги
   * бухгалтера» в «Оплате»; раздел мягко подсвечивается. При «уменьшить движение» — без плавной прокрутки.
   */
  const go = (k0: string, filter?: 'late') => {
    const po: PayClaimPurpose | null = k0 === 'money' ? 'tax' : k0 === 'fee' ? 'fee' : null;
    const k = po ? 'pay' : k0;
    if (po) setPayRows(new Set([...rows, po]));
    if (filter && page.reports) {
      const lateYear = pageLateYear(page.reports.items, today);
      setView({ ...view, filter, year: lateYear ?? view.year, openMonths: null });
    }
    setUnfolded((s) => new Set([...s, k]));
    requestAnimationFrame(() => {
      const sec = document.getElementById(`pub-${k}`);
      const target = (po ? sec?.querySelector(`[data-po="${po}"]`) : null) ?? sec;
      target?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
    clearTimeout(flashTimer.current);
    setFlash(po ? `po:${po}` : k);
    flashTimer.current = setTimeout(() => setFlash(null), 1400);
  };
  const sec = (
    id: SecId,
    title: string,
    body: ReactNode,
    o: { sum?: string; extra?: ReactNode; act?: ReactNode; fold?: boolean } = {},
  ) => (
    <PageSection
      key={id}
      id={id}
      title={title}
      what={tx(`secs.${id}`)}
      sum={o.sum}
      extra={o.extra}
      act={o.act}
      fold={o.fold ?? true}
      open={unfolded.has(id)}
      onToggle={() => toggle(id)}
      flash={flash === id}
    >
      {body}
    </PageSection>
  );

  const acc = page.accountant;
  // Кому звонить и писать: бухгалтеру, а без его телефона — в офис.
  const ph: Phone | null = acc?.phone ?? org.phone;
  const H: Partial<Record<SecId, ReactNode>> = {};
  const onPaid = money.paid;

  // «Оплата»: строки «Налоги» и «Услуги бухгалтера».
  if (pv.tax || pv.fee) {
    H.pay = sec(
      'pay',
      t('pub.sec.pay'),
      <PaySection
        page={page}
        view={pv}
        rows={rows}
        onRow={(k) => setPayRows(toggleIn(rows, k))}
        dets={dets}
        onDet={(id) => setDets((s) => toggleIn(s, id))}
        flash={flash === 'po:tax' ? 'tax' : flash === 'po:fee' ? 'fee' : null}
        onPaid={onPaid ? (k) => onPaid({ purpose: k }) : null}
      />,
      { fold: false },
    );
  }

  if (page.reports) {
    H.reports = sec('reports', t('pub.sec.reports'), reports.body, {
      sum: reports.sum,
      extra: reports.extra,
    });
  }

  // «Файлы»: «Отправить файл» видна и в свёрнутом разделе.
  if (filesSection) {
    H.files = sec('files', t('pub.sec.files'), filesSection.body, {
      sum: filesSection.sum,
      act: page.sent?.upload ? (
        <button
          type="button"
          data-pub-up=""
          onClick={upload.open}
          className={buttonClass('default', 'sm')}
        >
          <Icon name="upload" size="sm" />
          {t('pub.sent.send')}
        </button>
      ) : null,
    });
  }

  // «Связь»: бухгалтер со звонком и WhatsApp — видны и в свёрнутом; внутри — кто ещё ведёт отчёты, офис,
  // Telegram и «Ваши данные у нас».
  {
    const C = page.contacts;
    const person = (
      key: string,
      name: string | null,
      sub: string,
      phone: Phone | null,
    ): ReactNode => (
      <div key={key} className="flex flex-col gap-0.5">
        {name ? <b>{name}</b> : null}
        {sub ? <span className="text-[11.5px] text-faint">{sub}</span> : null}
        {phone ? (
          <a className="font-mono text-link" href={`tel:+${phone.digits}`}>
            {phone.text}
          </a>
        ) : null}
      </div>
    );
    const changed = tx('contacts.data') || t('pub.contacts.hint');
    const base = [
      {
        id: 'inn',
        label: t('pub.inn'),
        value: <span className="font-mono">{contractor.inn}</span>,
      },
      {
        id: 'regime',
        label: t('pub.contacts.regime'),
        value: contractor.regime ?? t('pub.regime_none'),
      },
    ];
    H.acc = sec(
      'acc',
      t('pub.sec.acc'),
      <>
        <div className="flex flex-col gap-2.5">
          {acc ? (
            person('me', acc.name, t('pub.acc.yours'), acc.phone)
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
          )}
          {(C?.people ?? [])
            .filter((p) => !p.responsible)
            .map((p) =>
              person(
                `${p.name}|${p.role}`,
                p.name,
                t('pub.acc.helps', { role: p.role, types: p.types.join(', ') }),
                p.phone,
              ),
            )}
          {C && org.phone ? person('office', null, t('pub.acc.office'), org.phone) : null}
        </div>
        {page.telegram ? (
          <PageTelegramBody telegram={page.telegram} what={tx('secs.tg')} connect={telegram} />
        ) : null}
        {C ? (
          <>
            <h4 className="m-0 mt-1.5 text-[13px]">{t('pub.contacts.yours')}</h4>
            <PageKv
              items={[
                ...base,
                { id: 'head', label: t('pub.contacts.head'), value: C.head || '—' },
                { id: 'contact', label: t('pub.contacts.contact'), value: C.contact || '—' },
                {
                  id: 'phone',
                  label: t('pub.contacts.phone'),
                  value: <span className="font-mono">{C.phone || '—'}</span>,
                },
              ]}
            />
            {ph ? (
              <a
                className="inline-flex items-center gap-1 self-start font-[550] text-link"
                href={whatsAppLink(ph.digits, '')}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="chat" size="sm" />
                {changed}
              </a>
            ) : (
              <span className="text-[11.5px] text-faint">{changed}</span>
            )}
          </>
        ) : (
          <PageKv items={base} />
        )}
      </>,
      {
        sum: acc ? acc.name.split(' ').slice(0, 2).join(' ') : org.name,
        act: ph ? (
          <>
            <a
              className={`${iconButtonClass()} text-accent`}
              href={`tel:+${ph.digits}`}
              aria-label={t('pub.acc.call')}
              title={t('pub.acc.call')}
            >
              <Icon name="phone" />
            </a>
            <a
              className={`${iconButtonClass()} text-accent`}
              href={whatsAppLink(ph.digits, '')}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('pub.acc.whatsapp')}
              title={t('pub.acc.whatsapp')}
            >
              <Icon name="chat" />
            </a>
          </>
        ) : null,
      },
    );
  }

  // «Цифры компании» — плитка на показатель: итог за год и мини-график, месяцы — по нажатию.
  if (page.kpi) {
    const K = page.kpi;
    const y = kpiYear && K.years.includes(kpiYear) ? kpiYear : year;
    const m12 = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    const ms = pageKpiMonths(y, today);
    const n = K.indicators.length;
    H.kpi = sec(
      'kpi',
      t('pub.sec.kpi'),
      n && ms.length ? (
        <div className="grid animate-fade grid-cols-2 items-start gap-2.5 max-md:grid-cols-1 motion-reduce:animate-none">
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
                onToggle={() => setOpenKpi((s) => toggleIn(s, i.id))}
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
                        <span>{pageMonthTitle(m)}</span>
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
        <span className="text-faint">{hint('emptyKpi', t('pub.kpi.none'))}</span>
      ),
      {
        sum: n
          ? K.indicators
              .slice(0, 3)
              .map((i) => i.name.toLowerCase())
              .join(', ') + (n > 3 ? '…' : '')
          : '',
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

  const col = (ks: SecId[]) => ks.map((k) => H[k] ?? null);

  // Подсказки и обучение (доработки 15.11.2026): что видно на странице и какие окна можно открыть.
  const helpActions: PageHelpActions = {
    go: (k) => go(k),
    paid: onPaid ? (purpose, pick) => onPaid({ purpose, pick }) : null,
    up: page.sent?.upload && H.files ? upload.open : null,
    tg: page.telegram && !telegram.full ? () => void telegram.connect() : null,
  };
  const help = usePageHelp({
    page,
    address,
    view: pageHelpView(page, Object.keys(H), { paid: !!onPaid }),
    actions: helpActions,
    unfolded,
    setUnfolded,
    root,
  });

  // «Что нужно сделать»: деньги с кнопкой «Оплатить» и несданные в срок отчёты со «Спросить бухгалтера»;
  // дел нет — одна зелёная строка.
  const todo: ReactNode[] = [];
  let cta = false;
  const doRow = (k: PayClaimPurpose, label: string, line: PayLine) => {
    const main = !line.waiting && !cta && !!line.account;
    if (main) cta = true;
    todo.push(
      <div key={k} data-do={k} className={DO_ROW}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span>{label}</span>
          <b
            className={`text-[26px] leading-[1.2] font-bold tabular-nums max-md:text-[24px] ${line.late ? 'text-danger' : ''}`}
          >
            {formatSomWithUnit(line.due)}
          </b>
          {line.waiting ? (
            <span className="text-[11.5px] text-faint">{waitText(line.waiting, true)}</span>
          ) : line.late ? (
            <span className="text-[11.5px] text-danger">{t('pub.do.late')}</span>
          ) : null}
        </span>
        {line.account ? (
          <button
            type="button"
            data-pub-pay={k}
            onClick={() => money.pay(k)}
            className={`${buttonClass(main ? 'cta' : 'default')} flex-none max-md:min-w-[120px]`}
          >
            <Icon name="wallet" size="sm" />
            {t('pub.pay.btn')}
          </button>
        ) : null}
      </div>,
    );
  };
  if (pv.tax && taxDue > 0) doRow('tax', t('pub.do.tax'), pv.tax);
  if (pv.fee && feeDue > 0) doRow('fee', t('pub.pay.fee'), pv.fee);
  if (page.reports && page.issues.late) {
    const n = page.issues.late;
    todo.push(
      <div key="late" data-do="late" className={DO_ROW}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button
            type="button"
            onClick={() => go('reports', 'late')}
            className="cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] font-semibold text-ink"
          >
            {t(`pub.rep.g.late.${pluralForm(n)}`, { n })}
          </button>
          <span className="text-[11.5px] text-faint">{t('pub.do.by_acc')}</span>
        </span>
        {ph ? (
          <a
            className={`${buttonClass()} flex-none max-md:min-w-[120px]`}
            href={whatsAppLink(ph.digits, '')}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="chat" size="sm" />
            {t('pub.do.ask')}
          </a>
        ) : (
          <button
            type="button"
            onClick={help.open}
            className={`${buttonClass()} flex-none max-md:min-w-[120px]`}
          >
            <Icon name="help" size="sm" />
            {t('pub.do.ask')}
          </button>
        )}
      </div>,
    );
  }
  const state = todo.length ? (
    <section
      role="status"
      data-pub-state="todo"
      aria-labelledby="pub-doh"
      className="flex flex-col rounded-xl border border-line bg-raised px-4 pt-1.5 pb-1 text-[14px] leading-[1.5] max-md:px-3.5 max-md:pt-1 max-md:pb-0.5 md:px-0 md:pb-0"
    >
      <h2 id="pub-doh" className="m-0 mt-2 mb-0.5 text-[15px] font-bold md:px-[18px]">
        {t('pub.do.title')}
      </h2>
      <div className="flex flex-col md:grid md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
        {todo}
      </div>
    </section>
  ) : (
    <div
      role="status"
      data-pub-state="ok"
      className="flex items-center gap-2.5 rounded-xl bg-ok-bg px-4 py-3 text-[14px] leading-[1.5] font-semibold text-ok"
    >
      <Icon name="ok" className="flex-none" />
      <span>{tx('state.ok') || t('pub.state.ok')}</span>
    </div>
  );

  const nav = NAV.filter(([k]) => k === 'top' || k === 'help' || !!H[k]);
  const onNav = (k: NavId) => {
    if (k === 'help') return help.open();
    if (k === 'top') {
      return window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    go(k);
  };
  const asOf = new Date(page.asOf);

  return (
    <>
      <div
        ref={root}
        data-pub-body=""
        className="flex w-[min(1120px,100%)] flex-col gap-3.5 max-md:gap-2.5"
      >
        <header id="pub-top" className="flex items-center gap-2">
          <div data-pub-brand="" className="flex min-w-0 items-center gap-2.5">
            {org.logo ? (
              <img
                src={org.logo.url}
                alt=""
                className="h-9 w-9 flex-none rounded-[10px] border border-line object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-accent text-[13px] font-bold text-on-accent"
              >
                {orgLogoLetters(org.name)}
              </span>
            )}
            <b className="overflow-hidden text-ellipsis whitespace-nowrap">{org.name}</b>
          </div>
          <span className="grow" />
          {ph ? (
            <a
              className={`${iconButtonClass()} text-accent max-md:h-11 max-md:w-11`}
              href={`tel:+${ph.digits}`}
              aria-label={t('pub.call_acc')}
              title={t('pub.call_acc')}
            >
              <Icon name="phone" />
            </a>
          ) : null}
          {help.button}
        </header>
        <h1 className="m-0 text-[24px] leading-[1.25] font-[720] max-md:text-[20px]">
          {contractor.name}
        </h1>
        {state}
        <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-3.5 max-md:flex max-md:flex-col max-md:items-stretch max-md:gap-2.5">
          <div className="flex min-w-0 flex-col gap-3.5 max-md:contents">{col(['pay', 'kpi'])}</div>
          <div className="flex min-w-0 flex-col gap-3.5 max-md:contents">
            {col(['reports', 'files', 'acc'])}
          </div>
        </div>
        {/* Нижнее меню — под окнами (z-50), всплывающими окошками (z-[70]) и уведомлениями: в прототипе
            на странице окна поднимаются над ним (pages.css: body.pub-on .cover{z-index:88}), иначе на
            телефоне меню закрывает кнопки внизу окна («Отправить чек» в «Я оплатил»). */}
        <nav
          aria-label={t('pub.nav.label')}
          className="fixed inset-x-0 bottom-0 z-[45] hidden border-t border-line bg-raised px-1 pt-0.5 pb-[calc(2px+env(safe-area-inset-bottom,0px))] max-md:flex"
        >
          {nav.map(([k, icon]) => (
            <button
              key={k}
              type="button"
              data-pub-nav={k}
              aria-current={navCur === k ? 'true' : undefined}
              onClick={() => onNav(k)}
              className={`flex min-h-[52px] min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-lg border-0 bg-transparent px-0.5 py-1.5 text-[12px] font-semibold transition-colors active:bg-row-hover motion-reduce:transition-none ${navCur === k ? 'text-accent' : 'text-muted'}`}
            >
              <Icon name={icon} className="h-[22px] w-[22px]" />
              <span>{t(`pub.nav.${k}`)}</span>
            </button>
          ))}
        </nav>
        {viewer.viewer}
        {money.dialogs}
        {upload.dialog}
        {help.layer}
      </div>
      <footer data-pub-updated="" className="text-center text-[12px] text-muted">
        {t('pub.updated', {
          date: pageDateWords(bishkekDate(asOf), today),
          time: bishkekTime(asOf),
        })}
      </footer>
    </>
  );
}

/** Хук «Отчётов» вызывается всегда в одном порядке: без раздела — с пустыми отчётами. */
function useReportsSectionSafe(
  page: Page,
  view: ReportsView,
  setView: (v: ReportsView) => void,
  openFile: OpenPageFile,
  pay: (month: string) => void,
) {
  const taxpay = page.reports?.items.some((r) => r.payStatus !== null) ?? false;
  return useReportsSection(
    page.reports ?? { types: [], items: [], months: null, send: false },
    page.today,
    taxpay,
    view,
    setView,
    openFile,
    pay,
  );
}
