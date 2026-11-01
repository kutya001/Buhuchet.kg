'use client';

import {
  formatCount,
  formatDateRu,
  formatSomWithUnit,
  homePlateTarget,
  pluralForm,
  progressPercent,
  weekdayMondayFirst,
  type HomePlate,
  type UiTextKey,
} from '@buhuchet/domain';
import type { HomeSummary, ReportRow, TaskListRow } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Icon,
  linkButtonClass,
  Note,
  Plate,
  Plates,
  StatusPill,
  type PlateProps,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { KeyboardEvent, ReactNode } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { presetHref } from '../lists/preset';
import { useModuleStats } from '../lists/stats';
import { useReportActions } from '../reports/report-actions';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { statusPillView } from '../status/status-view';
import { useTaskActions } from '../tasks/task-actions';
import { homeSummaryQuery, useHomeRefreshOnSave } from './home-data';

/** «18 октября, воскресенье» (прототип: `MONTHS_G`, `DOW`). */
function todayText(t: Translate, today: string): string {
  return t('home.hello.date', {
    d: Number(today.slice(8, 10)),
    month: t(`rule.month_gen.${Number(today.slice(5, 7))}` as UiTextKey),
    dow: t(`pdicts.cal.dow.${weekdayMondayFirst(today)}` as UiTextKey),
  });
}

/** Строка приветствия (прототип `.hello`): сегодня, что видит сотрудник, неделя «На неделе». */
function Hello({ t, s }: { t: Translate; s: HomeSummary }) {
  const dot = <span aria-hidden="true">·</span>;
  return (
    <div
      data-home-hello=""
      className="flex flex-wrap items-baseline gap-2.5 text-[13.5px] text-muted"
    >
      <span>
        {t('home.hello.today')} <b className="text-ink">{todayText(t, s.today)}</b>
      </span>
      {dot}
      <span>{t(s.seeAll ? 'home.hello.all' : 'home.hello.own')}</span>
      {dot}
      <span>
        {t('home.hello.week', {
          from: formatDateRu(s.weekFrom).slice(0, 5),
          to: formatDateRu(s.weekTo).slice(0, 5),
        })}
        {s.weekend ? ` ${t('home.hello.weekend')}` : ''}
      </span>
    </div>
  );
}

/** Плашки «Сводки» по порядку прототипа; нет части — нет плашки. */
function platesOf(t: Translate, s: HomeSummary, repConfirm: boolean): PlateProps[] {
  const p = s.plates;
  const out: PlateProps[] = [];
  if (p.ovr)
    out.push({
      id: 'ovr',
      icon: 'alert',
      color: p.ovr.count ? 'red' : 'green',
      label: t('home.plate.ovr'),
      value: formatCount(p.ovr.count),
      sub: t(p.ovr.count ? 'home.plate.ovr_sub' : 'home.plate.ovr_none'),
    });
  if (p.ovp)
    out.push({
      id: 'ovp',
      icon: 'wallet',
      color: p.ovp.count ? 'red' : 'green',
      label: t('home.plate.ovp'),
      value: formatCount(p.ovp.count),
      sub: p.ovp.count
        ? t('home.plate.ovp_sub', { amount: formatSomWithUnit(p.ovp.left) })
        : t('home.plate.ovp_none'),
    });
  if (p.wks)
    out.push({
      id: 'wks',
      icon: 'send',
      color: 'yellow',
      label: t('home.plate.wks'),
      value: formatCount(p.wks.count),
      sub: t('home.plate.wks_sub', { date: formatDateRu(s.weekTo) }),
    });
  if (p.wkp)
    out.push({
      id: 'wkp',
      icon: 'coins',
      color: 'yellow',
      label: t('home.plate.wkp'),
      value: formatCount(p.wkp.count),
      sub: formatSomWithUnit(p.wkp.left),
    });
  if (p.wait)
    out.push({
      id: 'wait',
      icon: 'hourglass',
      color: 'blue',
      label: t('home.plate.wait'),
      value: formatCount(p.wait.count),
      sub: t(repConfirm ? 'home.plate.wait_mine' : 'home.plate.wait_sub'),
    });
  if (p.tpend)
    out.push({
      id: 'tpend',
      icon: 'hourglass',
      color: p.tpend.count ? 'purple' : 'green',
      label: t('home.plate.tpend'),
      value: formatCount(p.tpend.count),
      sub: t(p.tpend.count ? 'home.plate.tpend_sub' : 'home.plate.tpend_none'),
    });
  if (p.kmiss)
    out.push({
      id: 'kmiss',
      icon: 'gauge',
      color: p.kmiss.count ? (p.kmiss.overdue ? 'red' : 'yellow') : 'green',
      label: t('home.plate.kmiss'),
      value: formatCount(p.kmiss.count),
      sub: t(
        p.kmiss.count
          ? p.kmiss.overdue
            ? 'home.plate.kmiss_over'
            : 'home.plate.kmiss_soon'
          : 'home.plate.kmiss_none',
      ),
    });
  if (p.tsk)
    out.push({
      id: 'tsk',
      icon: 'task',
      color: 'purple',
      label: t('home.plate.tsk'),
      value: formatCount(p.tsk.count),
      sub: p.tsk.overdue
        ? t('home.plate.tsk_over', { n: formatCount(p.tsk.overdue) })
        : t('home.plate.tsk_sub'),
    });
  return out;
}

/** Строка блока (прототип `.li`): нажатие и Enter открывают запись. */
function Row({
  onOpen,
  children,
  ...data
}: {
  onOpen: () => void;
  children: ReactNode;
  [key: `data-${string}`]: string;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') onOpen();
  };
  return (
    <div
      {...data}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className="flex min-w-0 cursor-pointer items-center gap-2.5 border-b border-line px-0.5 py-[9px] last:border-b-0 hover:bg-row-hover"
    >
      {children}
    </div>
  );
}

const LINE1 = 'truncate text-[13px] font-semibold';
const LINE2 = 'truncate text-[12px] text-faint';

/** «Ближайшие сроки сдачи» (прототип: девять несданных отчётов со сроком с сегодня). */
function UpcomingBox({
  t,
  rows,
  onOpen,
  onAll,
}: {
  t: Translate;
  rows: readonly ReportRow[];
  onOpen: (id: string) => void;
  onAll: () => void;
}) {
  return (
    <Box
      title={t('home.upcoming.title')}
      actions={
        <button
          type="button"
          className={`${linkButtonClass()} text-[12.5px] tracking-normal normal-case`}
          onClick={onAll}
        >
          {t('home.upcoming.all')}
        </button>
      }
    >
      <div data-home-upcoming="" className="flex flex-col">
        {rows.length ? (
          rows.map((r) => {
            const month = t(`rule.month_gen.${Number(r.dueDate.slice(5, 7))}` as UiTextKey);
            return (
              <Row key={r.id} data-home-report={r.id} onOpen={() => onOpen(r.id)}>
                <div
                  className={`w-[42px] flex-none rounded-lg border py-[3px] text-center leading-[1.1] ${r.overdue ? 'border-transparent bg-danger-bg text-danger' : 'border-line bg-pane-alt'}`}
                >
                  <b className="block text-[15px] tabular-nums">{Number(r.dueDate.slice(8, 10))}</b>
                  <span className="text-[10px] tracking-[.05em] text-faint uppercase">
                    {month.slice(0, 3)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className={LINE1}>
                    {r.type.shortName} · {r.contractor.name}
                  </div>
                  <div className={LINE2}>
                    {r.periodFull} · {r.responsible?.shortName ?? t('home.upcoming.no_resp')}
                    {r.overdue ? (
                      <>
                        {' · '}
                        <span className="text-danger">{t('home.upcoming.overdue')}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <StatusPill {...statusPillView(t, 'report', r.status)} />
              </Row>
            );
          })
        ) : (
          <div className="text-muted">{t('home.upcoming.empty')}</div>
        )}
      </div>
    </Box>
  );
}

/** «Отчёты со сроком в этом месяце: сдано» (прототип `.prog`). */
function ProgressBox({ t, rows }: { t: Translate; rows: NonNullable<HomeSummary['progress']> }) {
  return (
    <Box title={t('home.progress.title')}>
      <div data-home-progress="" className="flex flex-col gap-2.5">
        {rows.length ? (
          rows.map((p) => (
            <div
              key={p.employeeId}
              className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_64px] items-center gap-2.5 py-1.5 text-[13px]"
            >
              <span className="truncate">{p.name}</span>
              <div
                role="progressbar"
                aria-valuenow={p.done}
                aria-valuemax={p.all}
                className="h-2 overflow-hidden rounded-full bg-pane-alt shadow-[inset_0_0_0_1px_var(--bu-border)]"
              >
                <i
                  className="block h-full rounded-full bg-ok"
                  style={{ width: `${progressPercent(p)}%` }}
                />
              </div>
              <span className="text-right text-[12.5px] text-muted tabular-nums">
                {t('home.progress.n', { done: p.done, all: p.all })}
              </span>
            </div>
          ))
        ) : (
          <div className="text-muted">{t('home.progress.empty')}</div>
        )}
      </div>
    </Box>
  );
}

/** «Мои задачи на сегодня» — до пяти (прототип: блок только когда задачи есть). */
function TasksBox({
  t,
  rows,
  today,
  onOpen,
}: {
  t: Translate;
  rows: readonly TaskListRow[];
  today: string;
  onOpen: (task: TaskListRow) => void;
}) {
  return (
    <Box title={t('home.tasks.title')}>
      <div data-home-tasks="" className="flex flex-col">
        {rows.map((r) => {
          const status =
            r.kind === 'regular'
              ? statusPillView(t, 'report', r.report.status)
              : statusPillView(t, 'task', r.status);
          return (
            <Row key={r.id} data-home-task={r.id} onOpen={() => onOpen(r)}>
              <Icon
                name={r.kind === 'regular' ? 'file' : 'task'}
                className="flex-none text-muted"
              />
              <div className="min-w-0 flex-1">
                <div className={LINE1}>{r.title}</div>
                <div className={LINE2}>
                  {r.dueDate < today ? (
                    <>
                      <span className="text-danger">{t('home.tasks.overdue')}</span>
                      {' · '}
                    </>
                  ) : null}
                  {formatDateRu(r.dueDate)}
                  {r.category.name ? ` · ${r.category.name}` : ''}
                </div>
              </div>
              <StatusPill {...status} />
            </Row>
          );
        })}
      </div>
    </Box>
  );
}

/**
 * «Главная» → «Сводка» (ТЗ «Главная»; прототип modules/home.js, `renderHome`): строка приветствия;
 * организации без контрагентов — подсказка «Добавьте контрагентов…» и та же сводка с нулями, без
 * чек-листов и обучающих плашек; плашки (нажатие открывает список с тем же фильтром — в нём столько же
 * строк, сколько на плашке); под ними «Ближайшие сроки сдачи», «Сдано за месяц», «Мои задачи на
 * сегодня», «Должники по обслуживанию». Что не разрешают права и функции, не приходит с сервера и не
 * показывается.
 */
export function HomeSummaryTab() {
  const t = useT();
  const router = useRouter();
  const { access } = useShell();
  const stats = useModuleStats('home');
  const summary = useQuery(homeSummaryQuery);
  const reports = useReportActions();
  const tasks = useTaskActions();
  useHomeRefreshOnSave();
  const s = summary.data;

  if (summary.isError) {
    return (
      <Note tone="bad" icon="alert">
        {t('home.load_error')}{' '}
        <button type="button" className={linkButtonClass()} onClick={() => void summary.refetch()}>
          {t('grid.retry')}
        </button>
      </Note>
    );
  }
  if (!s) return <div data-home-loading="" className="min-h-[200px]" aria-busy="true" />;

  const goPlate = (plate: HomePlate) => {
    const target = homePlateTarget(plate, {
      week: { from: s.weekFrom, to: s.weekTo },
      today: s.today,
      tasksAll: access.can('tasksAll'),
    });
    router.push(presetHref(target.module, target.tab, target.filters));
  };
  const plates = platesOf(t, s, access.can('repConfirm'));
  const canAddCp = access.can('createCp') || access.can('cpImport');

  return (
    <div data-home-summary="" className="flex flex-col gap-3.5">
      <Hello t={t} s={s} />
      {s.noContractors ? (
        <div data-home-empty="">
          <Note icon="building" center>
            <div className="flex flex-wrap items-center gap-[9px]">
              <span className="min-w-0 grow">{t('home.empty.text')}</span>
              {canAddCp ? (
                <button
                  type="button"
                  className={`${buttonClass('cta', 'sm')} shrink-0`}
                  onClick={() => router.push(tabHref('cps', 'all'))}
                >
                  <Icon name="plus" size="sm" />
                  {t('home.empty.go')}
                </button>
              ) : null}
            </div>
          </Note>
        </div>
      ) : null}
      {plates.length ? (
        <Plates shown={stats.shown}>
          {plates.map((p) => (
            <Plate key={p.id} {...p} onClick={() => goPlate(p.id as HomePlate)} />
          ))}
        </Plates>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3.5 max-[900px]:grid-cols-1">
        {s.upcoming ? (
          <UpcomingBox
            t={t}
            rows={s.upcoming}
            onOpen={(id) => reports.openCard({ id })}
            onAll={() => router.push(tabHref('reports', 'all'))}
          />
        ) : null}
        <div className="flex min-w-0 flex-col gap-3.5">
          {s.progress ? <ProgressBox t={t} rows={s.progress} /> : null}
          {s.tasks?.length ? (
            <TasksBox t={t} rows={s.tasks} today={s.today} onOpen={tasks.openCard} />
          ) : null}
          {s.debtors?.count ? (
            <Box
              title={t('home.debtors.title')}
              actions={
                <button
                  type="button"
                  className={`${linkButtonClass()} text-[12.5px] tracking-normal normal-case`}
                  onClick={() => router.push(tabHref('cps', 'debtors'))}
                >
                  {t('home.debtors.open')}
                </button>
              }
            >
              <div data-home-debtors="" className="flex flex-wrap items-center gap-2.5">
                <span className="text-[22px] leading-[1.05] font-[720] tracking-[-0.025em] tabular-nums">
                  {formatSomWithUnit(s.debtors.sum)}
                </span>
                <span className="text-muted">
                  {t(`cp.count.${pluralForm(s.debtors.count)}`, {
                    n: formatCount(s.debtors.count),
                  })}
                </span>
              </div>
            </Box>
          ) : null}
        </div>
      </div>
      {reports.dialogs}
      {tasks.dialogs}
    </div>
  );
}
