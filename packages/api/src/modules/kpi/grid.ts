import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { kpiContractorOf, kpiContractorRecords, loadKpiData, loadMonths } from '@buhuchet/db';
import {
  activeIndicators,
  gridMonths,
  gridRows,
  importTemplate,
  importTooMany,
  searchText,
} from '@buhuchet/domain';
import { KpiGrid, KpiGridExport, KpiGridQuery } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { exportRateResponses, withExportSlot, xlsxContent } from '../../lists/export';
import { requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import {
  canEditValues,
  currentMonthOf,
  error,
  inKpi,
  kpiColumnOf,
  kpiFail,
  kpiScopeOf,
  noAuth,
  subjectOf,
} from './common';
import { byContractorName, templateFile, templateLines, xlsxAttachment } from './import';

/*
 * Вкладка «Ввод по месяцам» (прототип v80 modules/kpi.js: kpiGrid, kGridRows, kGridCps; kpi-excel.js:
 * kxBlob): строка — контрагент и показатель (ИНН, контрагент, показатель), столбцы — месяцы периода, до 24;
 * ввод — как в Excel, прежним `PUT /api/kpi/values` (права проверяет он). «Выгрузить в Excel» — тот же
 * вид, что у шаблона «Ввода из Excel»: файл можно заполнить и загрузить обратно.
 * ОТКЛОНЕНИЕ: docs/deviations.md#О-61
 */

const noView = {
  description: 'Нет права «Просматривать показатели» или функция выключена',
  content: error,
};

export const gridRoute = createRoute({
  method: 'get',
  path: '/kpi/grid',
  tags: ['kpi'],
  summary: '«Ввод по месяцам»: контрагент × показатель по месяцам периода',
  middleware: [requirePermission('kpiView')] as const,
  request: { query: KpiGridQuery },
  responses: {
    200: {
      description:
        'Строки «контрагент × показатель» контрагентов в области сотрудника, значения и вид ячеек по месяцам (до 24 последних месяцев периода), контрагенты и ответственные для выбора',
      content: { 'application/json': { schema: KpiGrid } },
    },
    401: noAuth,
    403: noView,
  },
});

export function gridHandler(deps: ApiDeps): RouteHandler<typeof gridRoute, AppEnv> {
  return async (c) => {
    const query = c.req.valid('query');
    const subject = subjectOf(c);
    const current = currentMonthOf(deps);
    const { from, to, months, cut } = gridMonths(query.from, query.to);
    const body = await inKpi(deps, c, async (tx) => {
      const records = (await kpiContractorRecords(tx, { scope: kpiScopeOf(subject) }))
        .filter((r) => r.kind !== 'oneoff')
        .sort(byContractorName);
      const data = await loadKpiData(tx, {
        contractorIds: records.map((r) => r.id),
        from: months[0]!,
        to: months[months.length - 1]!,
      });
      const columns = new Map(data.indicators.map((r) => [r.id, kpiColumnOf(r)]));
      const responsibles = new Map<string, string>();
      for (const r of records) {
        if (r.responsibleEmployeeId) {
          responsibles.set(r.responsibleEmployeeId, r.responsibleName ?? '');
        }
      }
      return {
        from,
        to,
        current,
        months,
        cut,
        indicators: activeIndicators(data.book).map((i) => columns.get(i.id)!),
        contractors: records.map((r) => ({
          id: r.id,
          name: r.name,
          inn: r.inn,
          responsibleId: r.responsibleEmployeeId,
          editable: canEditValues(subject, r),
        })),
        responsibles: [...responsibles].map(([id, name]) => ({ id, name })).sort(byContractorName),
        rows: gridRows(data.book, records.map(kpiContractorOf), months, data.valueOf),
      };
    });
    return c.json(body, 200);
  };
}

export const gridExportRoute = createRoute({
  method: 'post',
  path: '/kpi/grid/export',
  tags: ['kpi'],
  summary: '«Ввод по месяцам» в Excel: тот же вид, что у шаблона «Ввода из Excel»',
  middleware: [requirePermission('kpiView'), requirePermission('export')] as const,
  request: {
    body: { content: { 'application/json': { schema: KpiGridExport } }, required: true },
  },
  responses: {
    200: {
      description:
        'Лист «Показатели» (строка — контрагент и показатель, столбцы — месяцы) и лист «Подсказки»',
      content: xlsxContent,
    },
    400: {
      description:
        'Нечего выгружать или больше 1 000 контрагентов, 20 000 строк либо 480 000 ячеек',
      content: error,
    },
    ...exportRateResponses,
    401: noAuth,
    403: {
      description: 'Нет права «Просматривать показатели» или «Выгружать в Excel»',
      content: error,
    },
  },
});

/**
 * Выгрузка того, что на экране (прототип `kg-dl`): контрагенты области — выбранные (пусто — все), с
 * ответственным и поиском по названию или ИНН; показатели — выбранные действующие; строки — и с
 * внесёнными значениями, если показатель уже не ведётся (как в таблице).
 */
export function gridExportHandler(deps: ApiDeps): RouteHandler<typeof gridExportRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const current = currentMonthOf(deps);
    const { months } = gridMonths(body.from, body.to);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const r = await inKpi(
        deps,
        c,
        async (tx) => {
          const cps = new Set(body.cps);
          const q = searchText(body.q ?? '').trim();
          const records = (await kpiContractorRecords(tx, { scope: kpiScopeOf(subject) }))
            .filter(
              (x) =>
                x.kind !== 'oneoff' &&
                (!cps.size || cps.has(x.id)) &&
                (!body.resp || x.responsibleEmployeeId === body.resp) &&
                (!q || searchText(x.name).includes(q) || x.inn.includes(q)),
            )
            .sort(byContractorName);
          const ids = records.map((x) => x.id);
          const from = months[0]!;
          const to = months[months.length - 1]!;
          const [data, statuses] = await Promise.all([
            loadKpiData(tx, { contractorIds: ids, from, to }),
            loadMonths(tx, { contractorIds: ids, from, to }),
          ]);
          const checked = new Set(
            statuses
              .filter((s) => s.status === 'checked')
              .map((s) => `${s.contractorId}|${s.month}`),
          );
          const active = activeIndicators(data.book).map((i) => i.id);
          const inds = new Set(body.inds ? active.filter((id) => body.inds!.includes(id)) : active);
          const tpl = importTemplate(
            data.book,
            records.map(kpiContractorOf),
            inds,
            months,
            data.valueOf,
            (cid, m) => checked.has(`${cid}|${m}`),
            { current, withValues: true },
          );
          const rows = templateLines(tpl, new Map(records.map((x) => [x.id, x])), data);
          // Показатели в «Подсказках» — те, что есть в строках (прототип: `new Set(rows.map(x => x.i))`).
          const used = new Set(tpl.rows.map((x) => x.indicatorId));
          return {
            rows,
            tooMany: importTooMany(months.length, tpl.contractors, rows.length),
            indicators: data.indicators.filter((i) => used.has(i.id)),
          };
        },
        'export',
      );
      if (r.tooMany === 'contractors') kpiFail(400, 'import_too_many_contractors');
      if (r.tooMany === 'lines') kpiFail(400, 'import_too_many_lines');
      if (r.tooMany === 'cells') kpiFail(400, 'import_too_many_cells');
      if (!r.rows.length) kpiFail(400, 'import_empty');
      const { file, name } = await templateFile(t, months, r.rows, r.indicators);
      return xlsxAttachment(c, file, name, 'indicators.xlsx', {
        'x-import-rows': String(r.rows.length),
        'x-import-columns': String(months.length),
      });
    });
  };
}
