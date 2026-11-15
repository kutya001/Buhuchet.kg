'use client';

import {
  addMonths,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  monthOf,
  pageMonthGroups,
  pageOpenMonth,
  pageReportCounts,
  pageReportMark,
  pageReportStatus,
  pageReportYears,
  pageTypeTiles,
  pageYearReports,
  pluralForm,
  type PageReportMark,
} from '@buhuchet/domain';
import type { PublicPageBody } from '@buhuchet/shared';
import { buttonClass, ChipSelect, Icon, Plate, Pill, StatusPill, inputClass } from '@buhuchet/ui';
import { useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import { statusPillView } from '../status/status-view';
import {
  LateMark,
  PageFoldTile,
  PageList,
  PageRow,
  ROW1,
  ROW2,
  TileTitle,
  TipPill,
  usePageText,
} from './page-parts';
import type { OpenPageFile } from './page-files';
import { MonthPayPill } from './page-pay';

type Reports = NonNullable<PublicPageBody['reports']>;
type Report = Reports['items'][number];

/** Что выбрано в «Отчётах»: год, плашка-фильтр, вид показа, раскрытые плитки и месяцы. */
export interface ReportsView {
  year: string | null;
  filter: PageReportMark | null;
  mode: 'type' | 'month' | 'due';
  openTypes: ReadonlySet<string>;
  /** Раскрытые месяцы «По месяцам» и «По срокам»; null — раскрыт месяц по умолчанию. */
  openMonths: ReadonlySet<string> | null;
}

export const REPORTS_VIEW: ReportsView = {
  year: null,
  filter: null,
  mode: 'type',
  openTypes: new Set(),
  openMonths: null,
};

/**
 * Плашки «Отчётов» на телефоне (прототип `.plates.pub-pl`): три в ряд, поля 9×10, подпись 11 px
 * переносится под значок, чтобы «Просрочено» не выходило за плашку.
 */
const PLATES_PHONE = [
  'max-md:[&_[data-plate]]:px-2.5 max-md:[&_[data-plate]]:py-[9px]',
  'max-md:[&_[data-plate-label]]:min-w-0 max-md:[&_[data-plate-label]]:flex-wrap',
  'max-md:[&_[data-plate-label]]:gap-1 max-md:[&_[data-plate-label]]:text-[11px]',
].join(' ');

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
  return text.split(/\{(\w+)\}/).map((piece, i) => (i % 2 ? (parts[piece] ?? piece) : piece));
}

const flip = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/**
 * «Отчёты» (прототип pubBody, `has('reports')`; ТЗ «Отчёты — группами по видам отчётов»): год срока
 * сдачи, плашки «Сдано», «Впереди», «Просрочено» — фильтры, «По видам» — плитки видов с пояснением и
 * «сдано N из M», «По месяцам» — группы по месяцу, за который отчёт (правило «к сдаче и к оплате по
 * месяцам»), в шапке — «к оплате», «оплачено», «осталось» и пометка оплаты месяца, у месяца с остатком
 * — «Перечислить» (доработки 14.11.2026, блок 6, пункт 3; прототип v116 `pgMonthPay`), «По срокам» —
 * группы по месяцам срока (текущий раскрыт); периоды — срок, статус, суммы, файлы.
 */
export function useReportsSection(
  reports: Reports,
  today: string,
  taxpay: boolean,
  view: ReportsView,
  setView: (v: ReportsView) => void,
  openFile: OpenPageFile,
  send: (month: string) => void,
) {
  const t = useT();
  const tx = usePageText();
  const [allOf, setAllOf] = useState<ReadonlySet<string>>(new Set());
  const years = pageReportYears(reports.items, today);
  const year = view.year && years.includes(view.year) ? view.year : today.slice(0, 4);
  const yr = pageYearReports(reports.items, year);
  const counts = pageReportCounts(yr, today);
  const shown = view.filter
    ? yr.filter((r) => pageReportMark({ status: r.status, due: r.due }, today) === view.filter)
    : yr;
  const types = new Map(reports.types.map((x) => [x.code, x]));
  const more = (n: number) => t('pub.more', { n: n - 5 });
  const showAll = (key: string) => setAllOf(new Set([...allOf, key]));
  const late = (n: number) => t(`pub.late.${pluralForm(n)}`, { n });

  const row = (r: Report, withType: boolean) => {
    const type = types.get(r.type);
    const status = pageReportStatus(r.status);
    const lt = pageReportMark({ status: r.status, due: r.due }, today) === 'late';
    const pill = statusPillView(t, 'report', status);
    return (
      <PageRow key={r.id} late={lt} inner={!withType}>
        <div className={ROW1}>
          {withType && type ? (
            <>
              <b title={type.name}>{type.short}</b>
              <span className="text-faint">·</span>
            </>
          ) : null}
          <span>{r.period}</span>
          <span className="grow" />
          <TipPill
            pill={<StatusPill {...pill} size="sm" />}
            label={pill.label}
            text={tx(`report.${status}`)}
          />
        </div>
        <div className={ROW2}>
          <span className={lt ? 'inline-flex items-center gap-1 font-semibold text-danger' : ''}>
            {lt ? <Icon name="alert" size="sm" /> : null}
            {t('pub.rep.due', { date: formatDateRu(r.due) })}
          </span>
          {status === 'submitted' && r.submittedOn ? (
            <span>{t('pub.rep.submitted', { date: formatDateRu(r.submittedOn) })}</span>
          ) : null}
          {r.hasSum ? (
            <span>
              {r.sum !== null ? (
                <>
                  {t('pub.rep.amount')} <b className="tabular-nums">{formatSom(r.sum, 'auto')}</b>
                </>
              ) : (
                <span className="text-faint">{t('pub.rep.no_amount')}</span>
              )}
            </span>
          ) : null}
          {r.hasSum && taxpay && r.payStatus ? (
            <TipPill
              pill={<StatusPill {...statusPillView(t, 'payment', r.payStatus)} size="sm" />}
              label={t(`status.payment.${r.payStatus}`)}
              text={tx(`taxPay.${r.payStatus}`)}
            />
          ) : null}
        </div>
        {r.files.length ? (
          <div className="flex flex-wrap gap-x-2.5 gap-y-1">
            {r.files.map((f) => (
              // Прототип v74 `[data-pub-file]` → `pubFileOpen`: картинка и PDF — в окне просмотра.
              <button
                key={f.id}
                type="button"
                data-pub-file={f.id}
                title={f.preview ? t('pub.files.view') : t('pub.files.download')}
                onClick={() => openFile(f, t('pub.files.viewer'))}
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

  let list;
  if (view.mode === 'month') {
    const months = [...new Set(shown.map((r) => r.month))].sort();
    // Раскрыт месяц, за который сдают сейчас (прошлый), или ближайший следующий, иначе последний.
    const now = addMonths(monthOf(today), -1);
    const first = months.find((m) => m >= now) ?? months[months.length - 1];
    const open = view.openMonths ?? new Set(first ? [first] : []);
    const pays = new Map((reports.months ?? []).map((m) => [m.month, m]));
    const b = (v: number) => <b className="text-ink tabular-nums">{formatSom(v, 'auto')}</b>;
    list = (
      <div className="flex min-w-0 flex-col gap-2">
        {months.map((m) => {
          const rs = shown.filter((r) => r.month === m);
          const lateN = rs.filter(
            (r) => pageReportMark({ status: r.status, due: r.due }, today) === 'late',
          ).length;
          const o = open.has(m);
          const pp = reports.months ? pays.get(m) : undefined;
          // Без «Учёта оплаты налогов» — только «к оплате» по отчётам месяца.
          const plain = reports.months
            ? 0
            : rs.reduce((a, r) => a + (r.hasSum && r.sum !== null && r.sum > 0 ? r.sum : 0), 0);
          return (
            <PageFoldTile
              key={m}
              id={m}
              open={o}
              onToggle={() => setView({ ...view, openMonths: flip(open, m) })}
              head={
                <TileTitle open={o}>
                  <b>{t('pub.rep.month_title', { month: monthLabel(m).toLowerCase() })}</b>
                  <span className="text-[11.5px] text-faint">
                    {t(`pub.rep.count.${pluralForm(rs.length)}`, { n: rs.length })}
                  </span>
                  {pp && pp.sum > 0 ? (
                    <>
                      <span data-pub-month-pay="" className="text-[11.5px] text-faint">
                        {richText(
                          t('pub.rep.month_pay', { sum: '{sum}', got: '{got}', left: '{left}' }),
                          { sum: b(pp.sum), got: b(pp.got), left: b(pp.left) },
                        )}
                      </span>
                      {pp.status ? <MonthPayPill status={pp.status} /> : null}
                    </>
                  ) : plain > 0 ? (
                    <span className="text-[11.5px] text-faint">
                      {richText(t('pub.rep.month_sum', { sum: '{sum}' }), { sum: b(plain) })}
                    </span>
                  ) : null}
                  {lateN ? <LateMark text={late(lateN)} /> : null}
                </TileTitle>
              }
            >
              {pp && pp.left > 0 && reports.send ? (
                <div className="flex flex-wrap items-center gap-2.5 rounded-lg bg-pane-alt px-2.5 py-2">
                  <span>
                    {t('pub.send.left')}{' '}
                    <b className="tabular-nums">{formatSomWithUnit(pp.left)}</b>
                  </span>
                  <span className="grow" />
                  <button
                    type="button"
                    data-pub-send={m}
                    className={buttonClass('cta', 'sm')}
                    onClick={() => send(m)}
                  >
                    <Icon name="send" size="sm" />
                    {t('pub.send.btn')}
                  </button>
                </div>
              ) : null}
              <PageList
                count={rs.length}
                all={allOf.has(`rm:${m}`)}
                onAll={() => showAll(`rm:${m}`)}
                more={more(rs.length)}
              >
                {rs.map((r) => row(r, true))}
              </PageList>
            </PageFoldTile>
          );
        })}
      </div>
    );
  } else if (view.mode === 'due') {
    const groups = pageMonthGroups(shown, today);
    const open =
      view.openMonths ??
      new Set(
        [
          pageOpenMonth(
            groups.map((g) => g.month),
            today,
          ),
        ].filter((m): m is string => m !== null),
      );
    list = (
      <div className="flex min-w-0 flex-col gap-2">
        {groups.map((g) => {
          const o = open.has(g.month);
          return (
            <PageFoldTile
              key={g.month}
              id={g.month}
              open={o}
              onToggle={() => setView({ ...view, openMonths: flip(open, g.month) })}
              head={
                <TileTitle open={o}>
                  <b>{monthLabel(g.month)}</b>
                  <span className="text-[11.5px] text-faint">
                    {t(`pub.rep.count.${pluralForm(g.reports.length)}`, { n: g.reports.length })}
                  </span>
                  {g.late ? <LateMark text={late(g.late)} /> : null}
                </TileTitle>
              }
            >
              <PageList
                count={g.reports.length}
                all={allOf.has(`m:${g.month}`)}
                onAll={() => showAll(`m:${g.month}`)}
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
                    <b title={type?.name}>{type?.short ?? tile.type}</b>
                    {type?.organ ? <Pill size="sm">{type.organ}</Pill> : null}
                    {type ? (
                      <span className="text-[11.5px] text-faint">
                        {t(PER_KEY[type.periodicity])}
                      </span>
                    ) : null}
                  </TileTitle>
                  {type?.note ? (
                    <span className="text-[13px] leading-[1.45] text-muted">{type.note}</span>
                  ) : null}
                  <span className={`${ROW2} gap-x-3`}>
                    <b>{t('pub.rep.sum', { n: tile.submitted, m: tile.total })}</b>
                    {tile.late ? <LateMark text={late(tile.late)} /> : null}
                    {tile.next ? (
                      <span>{t('pub.rep.next_due', { date: formatDateRu(tile.next) })}</span>
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

  const plate = (
    k: PageReportMark,
    icon: 'check' | 'clock' | 'alert',
    color: 'green' | 'blue' | 'red',
  ) => (
    <div key={k} title={tx(`report.${k}`) || undefined} className="grid min-w-0">
      <Plate
        id={`pub-${k}`}
        icon={icon}
        color={color}
        label={t(`pub.rep.${k}`)}
        value={String(counts[k])}
        on={view.filter === k}
        onClick={() => setView({ ...view, filter: view.filter === k ? null : k })}
      />
    </div>
  );
  const lateAfter = counts.late
    ? ` · ${t(`pub.late_after.${pluralForm(counts.late)}`, { n: counts.late })}`
    : '';

  return {
    sum: `${t('pub.rep.sum', { n: counts.sub, m: yr.length })}${lateAfter}`,
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
        <div
          data-plates=""
          data-static=""
          className={`group/plates grid grid-cols-3 gap-2.5 max-md:gap-2 ${PLATES_PHONE}`}
        >
          {plate('sub', 'check', 'green')}
          {plate('next', 'clock', 'blue')}
          {plate('late', 'alert', counts.late ? 'red' : 'green')}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ChipSelect
            label={t('pub.rep.mode_label')}
            value={view.mode}
            onChange={(mode) => setView({ ...view, mode, openMonths: null })}
            options={[
              { value: 'type', label: t('pub.rep.by_type') },
              { value: 'month', label: t('pub.rep.by_month') },
              { value: 'due', label: t('pub.rep.by_due') },
            ]}
          />
          {view.filter ? (
            <button
              type="button"
              onClick={() => setView({ ...view, filter: null })}
              className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-[550] text-link"
            >
              <Icon name="x" size="sm" />
              {t('pub.rep.show_all')}
            </button>
          ) : null}
        </div>
        {shown.length ? (
          list
        ) : (
          <span className="text-faint">
            {view.filter
              ? t('pub.rep.none_mark', { mark: t(`pub.rep.${view.filter}`), y: year })
              : t('pub.rep.none', { y: year })}
          </span>
        )}
      </>
    ),
  };
}
