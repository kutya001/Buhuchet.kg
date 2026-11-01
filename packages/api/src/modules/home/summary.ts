import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  feeDebtors,
  homeMonthProgress,
  kpiMissingRows,
  listReportsPage,
  listTasksPage,
  orgHasNoContractors,
  orgMenuSettings,
  taskPendingStats,
  upcomingReports,
  withOrgContext,
  type ReportListOptions,
  type Tx,
} from '@buhuchet/db';
import {
  addDays,
  hasPermission,
  HOME_TASKS_MAX,
  HOME_UPCOMING_MAX,
  homePlateTarget,
  reportWeek,
  scopeOf,
  weekdayMondayFirst,
  type AccessSubject,
  type HomePlate,
  type HomePlateContext,
  type IsoDate,
  type ListQuery,
} from '@buhuchet/domain';
import { HomeSummary } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requireEmployee } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { scopeSqlOf, subjectOf, todayOf } from '../contractors/common';
import { kpiScopeOf } from '../kpi/common';
import { reportRowBody } from '../reports/list';
import { error, reportScopeOf } from '../reports/common';
import { listRowBody, viewerOf } from '../tasks/common';

/*
 * «Главная» → «Сводка» (задача 2.34; ТЗ «Главная»; прототип modules/home.js, `renderHome`). Модуль своих
 * прав не имеет: каждая плашка и блок — только тому, кому их разрешают права и функции других модулей
 * (ТЗ «Права»: «в них видно то, что разрешают права других модулей»), в области сотрудника. Число на
 * плашке считает тот же список с тем же фильтром (`homePlateTarget`), что откроется по нажатию.
 */

/** Страница списка с фильтром плашки: из неё — число строк (и итоги сумм). */
const plateQuery = (
  plate: HomePlate,
  ctx: HomePlateContext,
  sort: ListQuery['sort'] = undefined,
): ListQuery => ({
  sort,
  page: 1,
  size: 25,
  filters: homePlateTarget(plate, ctx).filters,
});

/** «Отчеты для сдачи»: «Просрочено», «На неделе», «Ожидают подтверждения» — как список вкладки. */
async function reportParts(
  deps: ApiDeps,
  tx: Tx,
  o: {
    subject: AccessSubject;
    ctx: HomePlateContext;
    taxpay: boolean;
    reportConfirm: boolean;
  },
) {
  const { subject, ctx, taxpay, reportConfirm } = o;
  const t = await serverTexts(deps);
  const scope = reportScopeOf(subject);
  const base = (tab: ReportListOptions['tab']): ReportListOptions => ({
    t,
    today: ctx.today,
    scope,
    tab,
    quick: 'all',
    // Как вкладка «Ожидают подтверждения» (`waitingView`): без права подтверждать — только свои.
    waiting: hasPermission(subject, 'repConfirm')
      ? { confirm: reportConfirm, own: null }
      : { confirm: reportConfirm && !!subject.employeeId, own: subject.employeeId },
    taxpay,
  });
  const count = async (plate: HomePlate) => {
    const target = homePlateTarget(plate, ctx);
    const page = await listReportsPage(
      tx,
      plateQuery(plate, ctx),
      base(target.tab as ReportListOptions['tab']),
    );
    return { count: page.total, left: page.totals.left ?? 0 };
  };
  const [ovr, ovp, wks, wkp, wait, upcoming] = await Promise.all([
    count('ovr'),
    taxpay ? count('ovp') : null,
    count('wks'),
    taxpay ? count('wkp') : null,
    reportConfirm ? count('wait') : null,
    upcomingReports(tx, { t, today: ctx.today, scope, taxpay, limit: HOME_UPCOMING_MAX }),
  ]);
  const progress = await homeMonthProgress(tx, {
    today: ctx.today,
    employeeId: scopeOf(subject, 'reports') === 'all' ? null : subject.employeeId,
  });
  return {
    ovr: { count: ovr.count },
    ovp,
    wks: { count: wks.count },
    wkp,
    wait: wait ? { count: wait.count } : null,
    upcoming: upcoming.map(reportRowBody),
    progress,
  };
}

/** «Задачи»: «Мои задачи на сегодня» (плашка и блок), «Ждут подтверждения». */
async function taskParts(
  deps: ApiDeps,
  tx: Tx,
  o: { subject: AccessSubject; ctx: HomePlateContext; reportConfirm: boolean },
) {
  const { subject, ctx } = o;
  const viewer = viewerOf(subject);
  const options = {
    t: await serverTexts(deps),
    today: ctx.today,
    reportConfirm: o.reportConfirm,
    viewer,
    tab: 'mine' as const,
  };
  const yesterday = { ...ctx, today: addDays(ctx.today, -1) };
  const [mine, overdue, pending] = await Promise.all([
    // ОТКЛОНЕНИЕ: docs/deviations.md#Г-12 — блок «Мои задачи на сегодня» по сроку.
    listTasksPage(tx, plateQuery('tsk', ctx, { key: 'date', dir: 'asc' }), options),
    listTasksPage(tx, plateQuery('tsk', yesterday), options),
    hasPermission(subject, 'tasksConfirm') ? taskPendingStats(tx, viewer) : null,
  ]);
  const sums = hasPermission(subject, 'changeStatus');
  return {
    tsk: { count: mine.total, overdue: overdue.total },
    // Прототип: `taskPend(t) && t.exec !== S.me` — выполненные задачи других сотрудников.
    tpend: pending ? { count: pending.canConfirm } : null,
    tasks: mine.rows.slice(0, HOME_TASKS_MAX).map((r) => listRowBody(r, ctx.today, sums)),
  };
}

export const homeSummaryRoute = createRoute({
  method: 'get',
  path: '/home/summary',
  tags: ['home'],
  summary: '«Главная» → «Сводка»: плашки и блоки',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description:
        'Плашки и блоки «Сводки» в области сотрудника; часть, которой не видно по правам или выключенной функции, — null',
      content: { 'application/json': { schema: HomeSummary } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

export function homeSummaryHandler(deps: ApiDeps): RouteHandler<typeof homeSummaryRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const today: IsoDate = todayOf(deps);
    const week = reportWeek(today);
    const ctx: HomePlateContext = {
      week,
      today,
      tasksAll: hasPermission(subject, 'tasksAll'),
    };
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(subject, p);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const settings = await orgMenuSettings(tx, orgContextOf(c).orgId);
      const f = settings.features;
      const [noContractors, reportsPart, tasksPart, kmiss, debtors] = await Promise.all([
        orgHasNoContractors(tx),
        // ОТКЛОНЕНИЕ: docs/deviations.md#Г-12 — части отчётов только с «Просматривать отчёты».
        can('repView')
          ? reportParts(deps, tx, {
              subject,
              ctx,
              taxpay: f.taxpay,
              reportConfirm: settings.reportConfirm,
            })
          : null,
        f.tasks
          ? taskParts(deps, tx, { subject, ctx, reportConfirm: settings.reportConfirm })
          : null,
        f.indicators && can('kpiView')
          ? kpiMissingRows(tx, { scope: kpiScopeOf(subject), today })
          : null,
        f.fee && can('fee') ? feeDebtors(tx, { scope: scopeSqlOf(subject), today }) : null,
      ]);
      const missing = kmiss
        ? {
            count: new Set(kmiss.map((r) => r.contractorId)).size,
            overdue: kmiss.some((r) => r.overdueDays > 0),
          }
        : null;
      return {
        today,
        weekFrom: week.from,
        weekTo: week.to,
        weekend: weekdayMondayFirst(today) >= 5,
        seeAll: scopeOf(subject, 'reports') === 'all',
        noContractors,
        plates: {
          ovr: reportsPart?.ovr ?? null,
          ovp: reportsPart?.ovp ?? null,
          wks: reportsPart?.wks ?? null,
          wkp: reportsPart?.wkp ?? null,
          wait: reportsPart?.wait ?? null,
          tpend: tasksPart?.tpend ?? null,
          kmiss: missing,
          tsk: tasksPart?.tsk ?? null,
        },
        upcoming: reportsPart?.upcoming ?? null,
        progress: reportsPart?.progress ?? null,
        tasks: tasksPart?.tasks ?? null,
        debtors,
      };
    });
    return c.json(body, 200);
  };
}
