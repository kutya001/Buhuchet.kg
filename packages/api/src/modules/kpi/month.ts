import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  kpiContractorOf,
  kpiContractorRecords,
  loadKpiData,
  loadMonths,
  lockFillMonth,
  readStatusHistory,
  saveIndicatorValues,
  setFillStatus,
  valueHistory,
  type ValueWrite,
} from '@buhuchet/db';
import {
  addMonths,
  cellState,
  fillDue,
  fillMonth,
  fillStats,
  hasPermission,
  KPI_LOOKBACK_MONTHS,
  missingByMonth,
  missingMonths,
  monthCells,
  monthChoices,
  monthContractors,
  monthIndicators,
  rollbackRefusal,
  scaleBack,
  type FillStatus,
  type YearMonth,
} from '@buhuchet/domain';
import {
  KpiEntry,
  KpiEntryQuery,
  KpiMonth,
  KpiMonthCheck,
  KpiMonthQuery,
  KpiMonthRollback,
  KpiValuesSave,
  KpiValuesSaved,
  MonthStatus,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { requirePermission } from '../../middleware/access';
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
 * «Ввод за месяц» и окно значения контрагента за месяц (задача 2.27; ТЗ «Показатели контрагентов» →
 * «Значение показателя», «Вкладка «Ввод за месяц»»; прототип modules/kpi.js: kpiMonth, kEditDlg, kSet,
 * kSync). Видят все с правом «Просматривать показатели» в своей области; вносят — право «Вносить
 * значения показателей»; «Проверено» — право «Проверять показатели»; откат — «Откат статусов».
 */

const noView = { description: 'Нет права или функция выключена', content: error };
const notFound = () => apiFail(404, 'not_found', 'Запись не найдена');

export const monthRoute = createRoute({
  method: 'get',
  path: '/kpi/month',
  tags: ['kpi'],
  summary: '«Ввод за месяц»: контрагенты × показатели',
  middleware: [requirePermission('kpiView')] as const,
  request: { query: KpiMonthQuery },
  responses: {
    200: {
      description:
        'Контрагенты в области сотрудника, у которых за месяц нужен хотя бы один показатель или месяц раньше «с <месяц>», ячейки, статусы месяца и статистика',
      content: { 'application/json': { schema: KpiMonth } },
    },
    400: { description: 'Месяц ещё не наступил', content: error },
    401: noAuth,
    403: noView,
  },
});

/** Таблица «Ввода за месяц» (прототип `kpiMonth`); по умолчанию — текущий месяц заполнения. */
export function monthHandler(deps: ApiDeps): RouteHandler<typeof monthRoute, AppEnv> {
  return async (c) => {
    const today = todayOf(deps);
    const current = currentMonthOf(deps);
    const month = c.req.valid('query').month ?? fillMonth(today);
    if (month > current) kpiFail(400, 'month_in_future');
    const subject = subjectOf(c);
    const body = await inKpi(deps, c, async (tx) => {
      const records = (await kpiContractorRecords(tx, { scope: kpiScopeOf(subject) })).filter(
        (r) => r.kind !== 'oneoff',
      );
      const ids = records.map((r) => r.id);
      const last = fillMonth(today);
      const from = month < addMonths(last, -KPI_LOOKBACK_MONTHS) ? month : undefined;
      const data = await loadKpiData(tx, {
        contractorIds: ids,
        ...(from ? { from } : {}),
        to: month > last ? month : last,
        filled: true,
      });
      const contractors = records.map(kpiContractorOf);
      const missing = missingMonths(
        data.book,
        records.filter((r) => r.serviceStatus === 'active').map(kpiContractorOf),
        today,
      );
      const counts = missingByMonth(missing);
      const inMonth = new Set(monthContractors(data.book, contractors, month).map((x) => x.id));
      const rows = records.filter((r) => inMonth.has(r.id));
      const statusRows = await loadMonths(tx, {
        contractorIds: rows.map((r) => r.id),
        from: month,
        to: month,
      });
      const statuses = await monthStatuses(tx, statusRows);
      const statusOf = (id: string) => statuses.get(`${id}|${month}`);
      return {
        month,
        current,
        choices: monthChoices(missing, today).map((m) => ({
          month: m,
          missing: counts.get(m) ?? 0,
        })),
        indicators: data.indicators.filter((i) => !i.archived).map(kpiColumnOf),
        rows: rows.map((r) => {
          const kc = kpiContractorOf(r);
          const due = fillDue(data.book, kc, month);
          const status = statusOf(r.id) ?? null;
          const needed = monthIndicators(data.book, kc, month).length > 0;
          return {
            contractorId: r.id,
            name: r.name,
            responsibleName: r.responsibleName,
            editable: canEditValues(subject, r),
            due,
            overdue: needed && (status?.code ?? 'empty') === 'empty' && today > due,
            status,
            cells: monthCells(data.book, kc, month, data.valueOf),
          };
        }),
        stats: fillStats(data.book, contractors, month, today, (id) => statusOf(id)?.code),
      };
    });
    return c.json(body, 200);
  };
}

export const saveValuesRoute = createRoute({
  method: 'put',
  path: '/kpi/values',
  tags: ['kpi'],
  summary: 'Внести значения показателей',
  middleware: [requirePermission('kpiEdit')] as const,
  request: {
    body: { content: { 'application/json': { schema: KpiValuesSave } }, required: true },
  },
  responses: {
    200: {
      description: 'Сколько значений изменилось и новые статусы месяцев',
      content: { 'application/json': { schema: KpiValuesSaved } },
    },
    400: {
      description:
        'Не число для типа показателя, показатель в архиве, ячейка недоступна или месяц ещё не наступил',
      content: error,
    },
    401: noAuth,
    403: { description: 'Нет права «Вносить значения показателей»', content: error },
    404: { description: 'Нет контрагента в области сотрудника или показателя', content: error },
    409: {
      description: 'Значение изменил другой сотрудник (`prev` не совпал): ничего не записано',
      content: error,
    },
  },
});

/**
 * Значения ячеек, блока из Excel или окна значения (прототип `kSet`): пусто — «не заполнено», 0 —
 * «внесено, равно нулю»; каждое изменение — в историю; статус месяца пересчитывается («Заполнено», когда
 * внесены все обязательные; правка в «Проверено» возвращает на «Заполнено»). Любая неверная ячейка —
 * 400 для всего запроса, ничего не записано; значение, которое уже изменил другой (`prev`), — 409.
 */
export function saveValuesHandler(deps: ApiDeps): RouteHandler<typeof saveValuesRoute, AppEnv> {
  return async (c) => {
    const { values } = c.req.valid('json');
    const current = currentMonthOf(deps);
    if (values.some((v) => v.month > current)) kpiFail(400, 'month_in_future');
    const subject = subjectOf(c);
    const result = await inKpi(deps, c, async (tx) => {
      const ids = [...new Set(values.map((v) => v.contractorId))];
      const records = await kpiContractorRecords(tx, { scope: kpiScopeOf(subject), ids });
      if (records.length !== ids.length) notFound();
      if (records.some((r) => !canEditValues(subject, r))) notFound();
      const months = values.map((v) => v.month).sort();
      const data = await loadKpiData(tx, {
        contractorIds: ids,
        from: months[0]!,
        to: months[months.length - 1]!,
      });
      const indicators = new Map(data.indicators.map((i) => [i.id, i]));
      const contractors = new Map(records.map((r) => [r.id, kpiContractorOf(r)]));
      const writes: ValueWrite[] = values.map((v) => {
        const r = indicators.get(v.indicatorId);
        if (!r) return notFound();
        if (r.archived) kpiFail(400, 'indicator_archived');
        if (r.type === 'int' && v.value !== null && v.value % 100 !== 0) {
          kpiFail(400, 'value_invalid');
        }
        const i = data.book.indicators.find((x) => x.id === r.id)!;
        const state = cellState(data.book, i, contractors.get(v.contractorId)!, v.month);
        // Значение невключённого показателя (внесённое, пока он вёлся) можно поправить в окне значения.
        const row = data.valueRow(v.contractorId, v.indicatorId, v.month);
        if (state === 'off' && !row) kpiFail(400, 'cell_off');
        return {
          contractorId: v.contractorId,
          indicatorId: v.indicatorId,
          month: v.month,
          value: v.value,
          ...(v.note !== undefined ? { note: v.note.trim() } : {}),
          ...(v.prev !== undefined ? { prev: v.prev } : {}),
          ...(v.prevNote !== undefined ? { prevNote: v.prevNote.trim() } : {}),
        };
      });
      const saved = await saveIndicatorValues(tx, data, contractors, writes);
      return {
        changed: saved.changed.length,
        statuses: saved.statuses.map((s) => ({
          contractorId: s.contractorId,
          month: s.month,
          status: s.to,
        })),
      };
    });
    return c.json(result, 200);
  };
}

export const entryRoute = createRoute({
  method: 'get',
  path: '/kpi/entry',
  tags: ['kpi'],
  summary: 'Окно значения: показатели контрагента за месяц',
  middleware: [requirePermission('kpiView')] as const,
  request: { query: KpiEntryQuery },
  responses: {
    200: {
      description:
        'Показатели, которые ведутся или по которым есть значения, комментарии, статус месяца с историей и история значений',
      content: { 'application/json': { schema: KpiEntry } },
    },
    400: { description: 'Месяц ещё не наступил', content: error },
    401: noAuth,
    403: noView,
    404: { description: 'Нет контрагента в области сотрудника', content: error },
  },
});

/** Окно «<контрагент> · Показатели за <месяц>» (прототип `kEditDlg`). */
export function entryHandler(deps: ApiDeps): RouteHandler<typeof entryRoute, AppEnv> {
  return async (c) => {
    const { contractorId, month } = c.req.valid('query');
    if (month > currentMonthOf(deps)) kpiFail(400, 'month_in_future');
    const subject = subjectOf(c);
    const body = await inKpi(deps, c, async (tx, features) => {
      const [record] = await kpiContractorRecords(tx, {
        scope: kpiScopeOf(subject),
        archived: true,
        ids: [contractorId],
      });
      if (!record) return notFound();
      const kc = kpiContractorOf(record);
      const data = await loadKpiData(tx, { contractorIds: [contractorId], from: month, to: month });
      const [statusRow] = await loadMonths(tx, {
        contractorIds: [contractorId],
        from: month,
        to: month,
      });
      const status = statusRow
        ? ((await monthStatuses(tx, [statusRow])).get(`${contractorId}|${month}`) ?? null)
        : null;
      const history = statusRow ? await readStatusHistory(tx, 'indicator', statusRow.id) : [];
      const items = data.indicators.flatMap((r) => {
        const i = data.book.indicators.find((x) => x.id === r.id)!;
        const state = cellState(data.book, i, kc, month);
        const row = data.valueRow(contractorId, r.id, month);
        if (state === 'off' && (row?.value ?? null) === null) return [];
        return [
          {
            indicator: kpiColumnOf(r),
            state,
            start:
              monthCells(data.book, kc, month, data.valueOf).find((x) => x.indicatorId === r.id)
                ?.start ?? month,
            value: row?.value ?? null,
            note: row?.note ?? '',
            valueId: row?.id ?? null,
            updatedBy: row && row.value !== null ? row.updatedBy : null,
            updatedAt: row && row.value !== null ? row.updatedAt.toISOString() : null,
          },
        ];
      });
      const code = status?.code ?? null;
      return {
        contractor: { id: record.id, name: record.name },
        month,
        due: fillDue(data.book, kc, month),
        editable: canEditValues(subject, record),
        files: features.files,
        items,
        status,
        statusHistory: history.map((h) => ({
          at: h.at.toISOString(),
          from: h.from,
          to: h.to,
          rollback: h.rollback,
          reason: h.reason,
          actor: h.actor,
          file: h.file,
        })),
        canCheck: hasPermission(subject, 'indCheck') && code === 'filled',
        back:
          code && hasPermission(subject, 'rollback')
            ? (scaleBack('indicator', code) as FillStatus | null)
            : null,
        history: (await valueHistory(tx, contractorId, month)).map((h) => ({
          ...h,
          at: h.at.toISOString(),
        })),
      };
    });
    return c.json(body, 200);
  };
}

const statusResponses = {
  200: {
    description: 'Статус месяца после смены',
    content: { 'application/json': { schema: MonthStatus } },
  },
  401: noAuth,
  ...versionedSaveResponses,
};

/** Статус месяца контрагента в области сотрудника (под блокировкой) или 404. */
async function lockedMonth(
  tx: Parameters<typeof lockFillMonth>[0],
  scope: ReturnType<typeof kpiScopeOf>,
  contractorId: string,
  month: YearMonth,
) {
  const [record] = await kpiContractorRecords(tx, { scope, archived: true, ids: [contractorId] });
  if (!record) return notFound();
  const row = await lockFillMonth(tx, contractorId, month);
  if (!row) return notFound();
  return row;
}

export const checkMonthRoute = createRoute({
  method: 'post',
  path: '/kpi/months/check',
  tags: ['kpi'],
  summary: '«Проверено»: статус месяца контрагента',
  middleware: [requirePermission('kpiView'), requirePermission('indCheck')] as const,
  request: {
    body: { content: { 'application/json': { schema: KpiMonthCheck } }, required: true },
  },
  responses: {
    ...statusResponses,
    403: { description: 'Нет права «Проверять показатели»', content: error },
    409: { description: 'Месяц не «Заполнено» или запись изменена', content: error },
  },
});

/** «Проверено» ставит главный бухгалтер или владелец; после этого правка значения вернёт «Заполнено». */
export function checkMonthHandler(deps: ApiDeps): RouteHandler<typeof checkMonthRoute, AppEnv> {
  return async (c) => {
    const { contractorId, month, version } = c.req.valid('json');
    const status = await inKpi(deps, c, async (tx) => {
      const row = await lockedMonth(tx, kpiScopeOf(subjectOf(c)), contractorId, month);
      if (row.status !== 'filled') kpiFail(409, 'check_not_filled');
      const updated = await setFillStatus(tx, row, 'checked', { version });
      return (await monthStatuses(tx, [updated])).get(`${contractorId}|${month}`)!;
    });
    return c.json(status, 200);
  };
}

const ROLLBACK_MESSAGES = {
  no_right: 'Нет права «Откат статусов»',
  not_back_step: 'Откатить можно только на один шаг назад',
  reason_required: 'Укажите причину',
} as const;

export const rollbackMonthRoute = createRoute({
  method: 'post',
  path: '/kpi/months/rollback',
  tags: ['kpi'],
  summary: 'Откат статуса месяца на шаг назад',
  middleware: [requirePermission('kpiView'), requirePermission('rollback')] as const,
  request: {
    body: { content: { 'application/json': { schema: KpiMonthRollback } }, required: true },
  },
  responses: {
    ...statusResponses,
    400: { description: 'Не на шаг назад или без причины', content: error },
    403: { description: 'Нет права «Откат статусов»', content: error },
  },
});

/** Откат «Проверено» → «Заполнено» по общим правилам: с правом «Откат статусов» и причиной. */
export function rollbackMonthHandler(
  deps: ApiDeps,
): RouteHandler<typeof rollbackMonthRoute, AppEnv> {
  return async (c) => {
    const { contractorId, month, version, to, reason } = c.req.valid('json');
    const status = await inKpi(deps, c, async (tx) => {
      const row = await lockedMonth(tx, kpiScopeOf(subjectOf(c)), contractorId, month);
      const refusal = rollbackRefusal({
        canRollback: true,
        back: scaleBack('indicator', row.status),
        to,
        reason,
      });
      if (refusal) apiFail(400, refusal, ROLLBACK_MESSAGES[refusal]);
      const updated = await setFillStatus(tx, row, to, {
        version,
        reason,
        rollback: true,
      });
      return (await monthStatuses(tx, [updated])).get(`${contractorId}|${month}`)!;
    });
    return c.json(status, 200);
  };
}
