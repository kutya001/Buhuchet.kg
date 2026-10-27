import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  indicatorValueOwner,
  kpiContractorOf,
  kpiContractorRecords,
  loadKpiData,
  loadMonths,
  type Tx,
} from '@buhuchet/db';
import {
  activeIndicators,
  addMonths,
  canSeeContractor,
  cardRows,
  fillMonth,
  hasPermission,
  indicatorEarly,
  indicatorOn,
  indicatorStart,
  KPI_LOOKBACK_MONTHS,
  KPI_PERIOD_MAX_MONTHS,
  missingMonths,
  monthCells,
  monthRange,
  offSince,
  type AccessSubject,
} from '@buhuchet/domain';
import { KpiCard, KpiCardParams, KpiCardQuery } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePermission } from '../../middleware/access';
import type { FileSource } from '../files/sources';
import {
  canEditValues,
  currentMonthOf,
  error,
  inKpi,
  kpiColumnOf,
  kpiFail,
  kpiScopeOf,
  monthStatuses,
  noAuth,
  subjectOf,
  todayOf,
} from './common';

/*
 * Вкладка «Показатели» карточки контрагента (задача 2.27; ТЗ «Показатели контрагентов» → «В карточке
 * контрагента»; прототип modules/kpi.js: kpiCardHtml, kpiCardWhoHtml, kCardMissHtml, kPastDlg) и блок
 * «Файлы» значения показателя. Вкладку в карточку ставит задача карточки контрагента (2.11): метод
 * доступен по сети сразу, поэтому проверяет вход, право, область и функцию.
 */

export const cardRoute = createRoute({
  method: 'get',
  path: '/kpi/contractors/{id}',
  tags: ['kpi'],
  summary: 'Вкладка «Показатели» карточки контрагента',
  middleware: [requirePermission('kpiView')] as const,
  request: { params: KpiCardParams, query: KpiCardQuery },
  responses: {
    200: {
      description:
        'Показатели контрагента по месяцам периода с итогами по заполненным месяцам, «Какие показатели вести» и незаполненные месяцы',
      content: { 'application/json': { schema: KpiCard } },
    },
    400: { description: 'Период длиннее 72 месяцев', content: error },
    401: noAuth,
    403: {
      description: 'Нет права «Просматривать показатели» или функция выключена',
      content: error,
    },
    404: { description: 'Нет контрагента в области сотрудника', content: error },
  },
});

/** По умолчанию — этот год, январь — декабрь (прототип `kpiCardHtml`). */
export function cardHandler(deps: ApiDeps): RouteHandler<typeof cardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    const today = todayOf(deps);
    const current = currentMonthOf(deps);
    const year = today.slice(0, 4);
    let from = query.from ?? `${year}-01`;
    let to = query.to ?? `${year}-12`;
    if (from > to) [from, to] = [to, from];
    const months = monthRange(from, to);
    if (months.length > KPI_PERIOD_MAX_MONTHS) kpiFail(400, 'period_too_long');
    const subject = subjectOf(c);
    const body = await inKpi(deps, c, async (tx) => {
      const [record] = await kpiContractorRecords(tx, {
        scope: kpiScopeOf(subject),
        archived: true,
        ids: [id],
      });
      if (!record) return apiFail(404, 'not_found', 'Контрагент не найден');
      const kc = kpiContractorOf(record);
      const last = fillMonth(today);
      const lowest = addMonths(last, -KPI_LOOKBACK_MONTHS);
      const data = await loadKpiData(tx, {
        contractorIds: [id],
        from: from < lowest ? from : lowest,
        to: to > current ? to : current,
      });
      const columns = new Map(data.indicators.map((r) => [r.id, kpiColumnOf(r)]));
      const byId = new Map(data.book.indicators.map((i) => [i.id, i]));
      const rows = cardRows(data.book, kc, months, data.valueOf).map((r) => {
        const i = byId.get(r.indicatorId)!;
        const t = data.book.target(i.id, id);
        const totals = r.totals;
        return {
          indicator: columns.get(i.id)!,
          values: r.values,
          applies: r.applies,
          early: months.map((m) => indicatorEarly(i, t, kc, m)),
          need: r.need,
          count: totals.count,
          totals:
            'sum' in totals
              ? {
                  sum: totals.sum,
                  avg: totals.avg,
                  max: totals.max,
                  min: totals.min,
                  last: totals.last,
                }
              : { sum: null, avg: null, max: null, min: null, last: null },
          start: indicatorStart(i, t, kc),
          offSince: r.offSince,
        };
      });
      const who = activeIndicators(data.book).map((i) => {
        const t = data.book.target(i.id, id);
        return {
          indicator: columns.get(i.id)!,
          on: indicatorOn(i, t),
          start: indicatorStart(i, t, kc),
          offSince: offSince(i, data.book, id),
        };
      });
      const active = record.kind !== 'oneoff' && record.serviceStatus === 'active';
      const missing = active ? missingMonths(data.book, [kc], today) : [];
      const statuses = await monthStatuses(
        tx,
        missing.length
          ? await loadMonths(tx, { contractorIds: [id], from: missing[0]!.month, to: last })
          : [],
      );
      return {
        contractor: {
          id,
          name: record.name,
          oneOff: record.kind === 'oneoff',
          paused: record.serviceStatus === 'paused',
          archived: record.serviceStatus === 'archived',
        },
        from,
        to,
        current,
        months,
        editable: canEditValues(subject, record),
        canSetup: hasPermission(subject, 'indSetup') && record.serviceStatus !== 'archived',
        rows,
        who,
        missing: missing.length
          ? { months: missing.map((m) => m.month), overdue: missing.some((m) => m.overdueDays > 0) }
          : null,
        past: missing.map((m) => ({
          month: m.month,
          due: m.due,
          overdue: m.overdueDays > 0,
          status: statuses.get(`${id}|${m.month}`) ?? null,
          cells: monthCells(data.book, kc, m.month, data.valueOf),
        })),
      };
    });
    return c.json(body, 200);
  };
}

/**
 * Блок «Файлы» значения показателя (например, выписка): видят все с правом «Просматривать показатели»
 * в своей области (и правами группы «Файловый менеджер»), прикрепляют и удаляют — кто вносит значения
 * этого контрагента; значение показателя в архиве — только просмотр. Функция «Показатели контрагентов»
 * выключена — файлов значения не видно.
 */
export const indicatorValueSource: FileSource = {
  async resolve(tx: Tx, subject: AccessSubject, id: string | null) {
    if (id === null || !hasPermission(subject, 'kpiView')) return null;
    const scope = kpiScopeOf(subject);
    const row = await indicatorValueOwner(tx, id, scope);
    if (!row?.enabled) return null;
    const contractor = { id: row.contractorId, responsibleEmployeeId: row.responsibleEmployeeId };
    if (!canSeeContractor(subject, 'kpi', contractor)) return null;
    return {
      contractor,
      editable:
        hasPermission(subject, 'kpiEdit') && !row.indicatorArchived && !row.contractorArchived,
      history: () => ({
        entity: 'indicator_value' as const,
        entityId: row.id,
        contractorId: row.contractorId,
      }),
    };
  },
};
