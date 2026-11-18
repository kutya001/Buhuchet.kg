'use client';

import {
  formatSom,
  formatSomWithUnit,
  pageDateWords,
  pageMonthGroups,
  pageMonthTitle,
  pageOpenMonth,
  pageOpenPayMonth,
  pageOrganKind,
  pageReportCounts,
  pageReportMark,
  pageReportStatus,
  pageReportsByDue,
  pageReportYears,
  pageTypeTiles,
  pageYearReports,
  pluralForm,
  type PageReportMark,
} from '@buhuchet/domain';
import type { PublicPageBody } from '@buhuchet/shared';
import {
  ActionList,
  buttonClass,
  Icon,
  Popover,
  StatusPill,
  inputClass,
  type IconName,
} from '@buhuchet/ui';
import { Fragment, useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import { statusPillView } from '../status/status-view';
import { PageFoldTile, PageList, PageRow, ROW1, ROW2, TileTitle } from './page-parts';
import type { OpenPageFile } from './page-files';
import { usePageHint } from './page-help-context';

type Reports = NonNullable<PublicPageBody['reports']>;
type Report = Reports['items'][number];
type Mode = 'month' | 'type' | 'due';

/** Что выбрано в «Отчётах»: год, плашка-фильтр, вид показа, раскрытые плитки и месяцы. */
export interface ReportsView {
  year: string | null;
  filter: PageReportMark | null;
  mode: Mode;
  openTypes: ReadonlySet<string>;
  /** Раскрытые месяцы «По месяцам» и «По срокам»; null — раскрыт месяц по умолчанию. */
  openMonths: ReadonlySet<string> | null;
}

/** Сразу — «По месяцам»: там деньги и «Оплатить» (прототип v135 `pubReset`, `mode:'month'`). */
export const REPORTS_VIEW: ReportsView = {
  year: null,
  filter: null,
  mode: 'month',
  openTypes: new Set(),
  openMonths: null,
};

/** Вид показа в меню (прототип `pubViewMenu`). */
const MODES: readonly { mode: Mode; icon: IconName }[] = [
  { mode: 'month', icon: 'calendar' },
  { mode: 'type', icon: 'file' },
  { mode: 'due', icon: 'clock' },
];

/** Периодичность вида на плитке (прототип `pubPer`). */
const PER_KEY = {
  M: 'pub.rep.per.m',
  Q: 'pub.rep.per.q',
  H: 'pub.rep.per.h',
  Y: 'pub.rep.per.y',
  oneoff: 'pub.rep.per.oneoff',
} as const;

/** Текст словаря с вставками-элементами вместо `{имя}` (суммы жирным, как `<b>` прототипа). */
function richText(text: string, parts: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return text
    .split(/\{(\w+)\}/)
    .map((piece, i) => <Fragment key={i}>{i % 2 ? (parts[piece] ?? piece) : piece}</Fragment>);
}

const flip = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

const CALM = 'text-caution';
const GSUM = 'min-w-0 text-right text-[13.5px] text-muted';
const LINE3 = 'flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted';

/**
 * «Отчёты» простыми словами (доработки 17.11.2026; прототип v135 `pubBody`, `has('reports')`): год
 * срока сдачи, плашки-фильтры «Сдано», «Впереди», «Не сданы в срок» строкой, вид показа — в меню: «По
 * месяцам» (сразу; в шапке месяца — «осталось N» или «оплачено», внутри — «к оплате · оплачено ·
 * осталось» и «Оплатить»), «По видам» и «По срокам». Несданные в срок — спокойно, без красного: отчёты
 * сдаёт бухгалтер.
 */
export function useReportsSection(
  reports: Reports,
  today: string,
  taxpay: boolean,
  view: ReportsView,
  setView: (v: ReportsView) => void,
  openFile: OpenPageFile,
  pay: (month: string) => void,
) {
  const t = useT();
  const hint = usePageHint();
  const [allOf, setAllOf] = useState<ReadonlySet<string>>(new Set());
  const years = pageReportYears(reports.items, today);
  const cy = today.slice(0, 4);
  const year = view.year && years.includes(view.year) ? view.year : cy;
  const yr = pageYearReports(reports.items, year);
  const counts = pageReportCounts(yr, today);
  const mark = (r: Report) => pageReportMark({ status: r.status, due: r.due }, today);
  const shown = view.filter ? yr.filter((r) => mark(r) === view.filter) : yr;
  const types = new Map(reports.types.map((x) => [x.code, x]));
  const more = (n: number) => t('pub.more', { n: n - 5 });
  const showAll = (key: string) => setAllOf(new Set([...allOf, key]));
  const dw = (date: string) => pageDateWords(date, today);
  const b = (v: number) => <b className="text-ink tabular-nums">{formatSomWithUnit(v)}</b>;
  const bm = (v: number) => <b className="text-ink tabular-nums">{formatSom(v, 'auto')}</b>;

  const row = (r: Report, withType: boolean) => {
    const type = types.get(r.type);
    const status = pageReportStatus(r.status);
    const lt = mark(r) === 'late';
    const pill = statusPillView(t, 'report', status);
    return (
      <PageRow key={r.id} late={lt} inner>
        <div className={ROW1}>
          {withType && type ? (
            <>
              <b>{type.name}</b>
              <span className="text-faint">·</span>
            </>
          ) : null}
          <span>{r.period}</span>
          <span className="grow" />
          <StatusPill {...pill} size="sm" />
        </div>
        <div className={ROW2}>
          {status === 'submitted' && r.submittedOn ? (
            <span>{t('pub.rep.submitted', { date: dw(r.submittedOn) })}</span>
          ) : (
            <span data-pub-due="" className={lt ? `font-bold ${CALM}` : ''}>
              {t(lt ? 'pub.rep.due_was' : 'pub.rep.due', { date: dw(r.due) })}
            </span>
          )}
          {r.hasSum ? (
            <span>
              {r.sum !== null ? (
                richText(t('pub.rep.tax', { sum: '{sum}' }), { sum: b(r.sum) })
              ) : (
                <span className="text-faint">{t('pub.rep.no_amount')}</span>
              )}
            </span>
          ) : null}
          {r.hasSum && taxpay && r.payStatus && (r.sum ?? 0) > 0 ? (
            <StatusPill {...statusPillView(t, 'payment', r.payStatus)} size="sm" />
          ) : null}
        </div>
        {r.files.length ? (
          <div data-no-gloss="" className="flex flex-wrap gap-x-2.5 gap-y-1">
            {r.files.map((f, i) => (
              // Прототип v127 `[data-pub-file]` → `pubFileOpen`: окно просмотра, «‹ ›» по файлам отчёта.
              <button
                key={f.id}
                type="button"
                data-pub-file={f.id}
                title={t('pub.files.view')}
                onClick={() => openFile(r.files, i, () => t('pub.files.viewer'))}
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left font-[inherit] text-[12.5px] text-link underline"
              >
                <Icon name="download" size="sm" />
                {f.name}
              </button>
            ))}
          </div>
        ) : null}
      </PageRow>
    );
  };

  const lateText = (n: number) => t(`pub.rep.g.late.${pluralForm(n)}`, { n });

  let list: ReactNode;
  if (view.mode === 'month' || view.mode === 'due') {
    const byMonth = view.mode === 'month';
    const groups = byMonth
      ? [...new Set(shown.map((r) => r.month))].sort().map((month) => {
          const rs = shown.filter((r) => r.month === month);
          return { month, reports: rs, late: rs.filter((r) => mark(r) === 'late').length };
        })
      : pageMonthGroups(shown, today);
    const months = groups.map((g) => g.month);
    const first = byMonth ? pageOpenPayMonth(months, today) : pageOpenMonth(months, today);
    const open = view.openMonths ?? new Set(first ? [first] : []);
    const pays = new Map((reports.months ?? []).map((m) => [m.month, m]));
    list = (
      <div className="flex min-w-0 flex-col gap-2">
        {groups.map((g) => {
          const m = g.month;
          const o = open.has(m);
          const pp = byMonth && reports.months ? pays.get(m) : undefined;
          // Без «Учёта оплаты налогов» — только «к оплате» по отчётам месяца.
          const plain =
            byMonth && !reports.months
              ? g.reports.reduce(
                  (a, r) => a + (r.hasSum && r.sum !== null && r.sum > 0 ? r.sum : 0),
                  0,
                )
              : 0;
          const waiting = !!pp && pp.left > 0 && pp.status === 'wait';
          return (
            <PageFoldTile
              key={m}
              id={m}
              open={o}
              onToggle={() => setView({ ...view, openMonths: flip(open, m) })}
              head={
                <>
                  <TileTitle open={o}>
                    <b>{pageMonthTitle(m)}</b>
                    <span className="grow" />
                    {pp && pp.sum > 0 ? (
                      pp.left > 0 ? (
                        <span data-pub-month-left="" className={GSUM}>
                          {richText(t('pub.rep.g.left', { sum: '{sum}' }), { sum: b(pp.left) })}
                        </span>
                      ) : (
                        <span data-pub-month-paid="" className={`${GSUM} text-ok`}>
                          {t('pub.rep.g.paid')}
                        </span>
                      )
                    ) : plain > 0 ? (
                      <span className={GSUM}>
                        {richText(t('pub.rep.g.sum', { sum: '{sum}' }), { sum: b(plain) })}
                      </span>
                    ) : null}
                  </TileTitle>
                  {g.late || waiting ? (
                    <span className={LINE3}>
                      {waiting ? (
                        <span data-pub-month-wait="" className="text-info">
                          {t('pub.rep.g.wait')}
                        </span>
                      ) : null}
                      {g.late ? (
                        <span data-pub-late="" className={CALM}>
                          {lateText(g.late)}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </>
              }
            >
              {pp && pp.sum > 0 ? (
                <div
                  data-pub-month-pay=""
                  className="flex flex-wrap items-center gap-2.5 rounded-lg bg-pane-alt px-2.5 py-2"
                >
                  <span className="text-[11.5px] text-faint">
                    {richText(
                      t('pub.rep.month_pay', { sum: '{sum}', got: '{got}', left: '{left}' }),
                      { sum: bm(pp.sum), got: bm(pp.got), left: bm(pp.left) },
                    )}
                  </span>
                  {pp.left > 0 && reports.send ? (
                    <>
                      <span className="grow" />
                      <button
                        type="button"
                        data-pub-send={m}
                        className={buttonClass('default', 'sm')}
                        onClick={() => pay(m)}
                      >
                        <Icon name="wallet" size="sm" />
                        {t('pub.pay.btn')}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
              <PageList
                count={g.reports.length}
                all={allOf.has(`m:${m}`)}
                onAll={() => showAll(`m:${m}`)}
                more={more(g.reports.length)}
              >
                {g.reports.map((r) => row(r, true))}
              </PageList>
            </PageFoldTile>
          );
        })}
      </div>
    );
  } else {
    const tiles = pageTypeTiles(
      yr,
      shown,
      reports.types.map((x) => x.code),
      today,
    );
    list = (
      <PageList
        count={tiles.length}
        all={allOf.has('types')}
        onAll={() => showAll('types')}
        more={more(tiles.length)}
      >
        {tiles.map((tile) => {
          const type = types.get(tile.type);
          const o = view.openTypes.has(tile.type);
          const where = type?.organ
            ? t('pub.rep.organ', {
                where:
                  pageOrganKind(type.organ) === 'tax'
                    ? t('pub.rep.organ.tax')
                    : t('pub.rep.organ.other', { organ: type.organ }),
              })
            : '';
          const note = [where, type?.note ?? ''].filter(Boolean).join(' ');
          return (
            <PageFoldTile
              key={tile.type}
              id={tile.type}
              late={tile.late > 0}
              open={o}
              onToggle={() => setView({ ...view, openTypes: flip(view.openTypes, tile.type) })}
              head={
                <>
                  <TileTitle open={o}>
                    <b>{type?.name ?? tile.type}</b>
                    {type ? (
                      <span className="text-[11.5px] text-faint">
                        {t(PER_KEY[type.periodicity])}
                      </span>
                    ) : null}
                  </TileTitle>
                  <span className={LINE3}>
                    <b className="text-ink">
                      {t('pub.rep.sum', { n: tile.submitted, m: tile.total })}
                    </b>
                    {tile.late ? (
                      <span data-pub-late="" className={CALM}>
                        {t(`pub.rep.t.late.${pluralForm(tile.late)}`, { n: tile.late })}
                      </span>
                    ) : null}
                    {tile.next ? (
                      <span>{t('pub.rep.next_due', { date: dw(tile.next) })}</span>
                    ) : tile.submitted === tile.total ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <Icon name="check" size="sm" />
                        {t('pub.rep.all_done')}
                      </span>
                    ) : null}
                  </span>
                </>
              }
            >
              {note ? (
                <span data-pub-type-note="" className="text-[13px] leading-[1.45] text-muted">
                  {note}
                </span>
              ) : null}
              <PageList
                count={tile.reports.length}
                all={allOf.has(`t:${tile.type}`)}
                onAll={() => showAll(`t:${tile.type}`)}
                more={more(tile.reports.length)}
              >
                {tile.reports.map((r) => row(r, false))}
              </PageList>
            </PageFoldTile>
          );
        })}
      </PageList>
    );
  }

  const chip = (k: PageReportMark) => {
    const on = view.filter === k;
    return (
      <button
        key={k}
        type="button"
        data-pub-chip={k}
        aria-pressed={on}
        onClick={() => setView({ ...view, filter: on ? null : k, openMonths: null })}
        className={`inline-flex min-h-8 cursor-pointer items-center gap-[5px] rounded-full border px-3 py-1 font-[inherit] text-[13px] text-ink transition-colors max-md:min-h-10 ${on ? 'border-accent bg-sel' : 'border-line bg-raised hover:border-line-strong'}`}
      >
        {t(`pub.rep.${k}`)}{' '}
        <b className={`font-[650] ${k === 'late' && counts.late ? CALM : 'text-muted'}`}>
          {counts[k]}
        </b>
      </button>
    );
  };

  // «следующий до …» — по всем отчётам, только у текущего года (прототип `y===cy&&nx`).
  const next = year === cy ? pageReportsByDue(reports.items).find((r) => mark(r) === 'next') : null;

  return {
    sum: `${t('pub.rep.sum', { n: counts.sub, m: yr.length })}${
      next ? t('pub.rep.sum_next', { date: dw(next.due) }) : ''
    }`,
    extra: (
      <select
        aria-label={t('pub.rep.year_label')}
        value={year}
        onChange={(e) => setView({ ...view, year: e.target.value, openMonths: null })}
        className={`${inputClass({ full: false })} min-h-[30px] px-2 py-[3px] text-[13px]`}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {t('pub.rep.year', { y })}
          </option>
        ))}
      </select>
    ),
    body: (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('pub.rep.chips')} className="flex flex-wrap gap-1.5">
            {chip('sub')}
            {chip('next')}
            {chip('late')}
          </div>
          <span className="grow" />
          <Popover
            label={t('pub.rep.mode_label')}
            role="menu"
            placement="bottom-end"
            className="relative inline-flex"
            trigger={({ open, toggle, id }) => (
              <button
                type="button"
                data-pub-mode={view.mode}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={id}
                title={t('pub.rep.mode_label')}
                onClick={toggle}
                className={`${buttonClass('ghost', 'sm')} max-md:min-h-10`}
              >
                {t(`pub.rep.by_${view.mode}`)}
                <Icon name="more" size="sm" />
              </button>
            )}
          >
            {(close) => (
              <ActionList
                onPick={close}
                items={MODES.map(({ mode, icon }) => ({
                  id: mode,
                  label: t(`pub.rep.by_${mode}`),
                  icon: view.mode === mode ? 'check' : icon,
                  on: view.mode === mode,
                  run: () => {
                    if (view.mode !== mode) setView({ ...view, mode, openMonths: null });
                  },
                }))}
              />
            )}
          </Popover>
        </div>
        <div key={`${year}|${view.mode}|${view.filter ?? ''}`} className="animate-fade">
          {shown.length ? (
            list
          ) : (
            <span data-pub-rep-none="" className="text-faint">
              {view.filter
                ? t('pub.rep.none_mark', { mark: t(`pub.rep.${view.filter}`), y: year })
                : // Пустой раздел объясняет, что здесь появится (доработки 15.11.2026, пункт 5.5).
                  hint('emptyReports', t('pub.rep.none', { y: year }), { год: year })}
            </span>
          )}
        </div>
      </>
    ),
  };
}
