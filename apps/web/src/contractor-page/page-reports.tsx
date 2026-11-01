'use client';

import {
  formatDateRu,
  formatSom,
  monthLabel,
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
import { ChipSelect, Icon, Plate, Pill, StatusPill, inputClass } from '@buhuchet/ui';
import { useState } from 'react';
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

type Reports = NonNullable<PublicPageBody['reports']>;
type Report = Reports['items'][number];

/** Что выбрано в «Отчётах»: год, плашка-фильтр, вид показа, раскрытые плитки и месяцы. */
export interface ReportsView {
  year: string | null;
  filter: PageReportMark | null;
  mode: 'type' | 'due';
  openTypes: ReadonlySet<string>;
  /** Раскрытые месяцы «По срокам»; null — раскрыт месяц по умолчанию. */
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

const flip = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/**
 * «Отчёты» (прототип pubBody, `has('reports')`; ТЗ «Отчёты — группами по видам отчётов»): год срока
 * сдачи, плашки «Сдано», «Впереди», «Просрочено» — фильтры, «По видам» — плитки видов с пояснением и
 * «сдано N из M», «По срокам» — группы по месяцам срока (текущий раскрыт); периоды — срок, статус,
 * суммы, файлы.
 */
export function useReportsSection(
  reports: Reports,
  today: string,
  taxpay: boolean,
  view: ReportsView,
  setView: (v: ReportsView) => void,
  fileHref: (id: string) => string,
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
              <a
                key={f.id}
                href={fileHref(f.id)}
                data-pub-file=""
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12.5px] text-link underline"
              >
                <Icon name="download" size="sm" />
                {f.name}
              </a>
            ))}
          </div>
        ) : null}
      </PageRow>
    );
  };

  let list;
  if (view.mode === 'due') {
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
            onChange={(mode) => setView({ ...view, mode })}
            options={[
              { value: 'type', label: t('pub.rep.by_type') },
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
