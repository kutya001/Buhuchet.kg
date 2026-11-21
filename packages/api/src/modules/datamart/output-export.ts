import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  dmListType,
  dmOutList,
  dmOutRows,
  dmShownColumns,
  dmText,
  EXPORT_ROWS_LIMIT,
  type DmOutColumn,
  type DmOutTexts,
  type DmValue,
  type ListQuery,
} from '@buhuchet/domain';
import { ApiError, DmAdminOutExport, DmOutExport } from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import type { XlsxCell } from '../../lists/xlsx';
import { requirePermission, requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { adminOutput, orgOutput, outputFail, withRunSlot, type OutputRun } from './output';
import { withDmPoolSlot } from './run';

/*
 * «Витрина данных» → «Вывод» → «В Excel» (доработки 20.11.2026: Витрина данных, блок 4, пункт 5; общий
 * план 20.11, этап 2, П6; прототип v155 `dmDraw`: общий список с «В Excel»). Шаблон выполняется заново
 * тем же путём, что «Показать» (`orgOutput`, `adminOutput`: права, область «Свои», журнал, у Админки —
 * открытие «глазами организации» в истории), строки — с фильтрами, поиском и сортировкой таблицы
 * (`dmOutList` домена — те же правила, что на экране), столбцы — видимые по порядку экрана. Выгрузка —
 * в очереди запусков человека (`withRunSlot`), на месте пула запусков сайта (`withDmPoolSlot`, п. О-96)
 * и в очереди выгрузок (`withExportSlot`) — в этом порядке: занятый запуск или пул выгрузку из 20 в час
 * не тратят.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const fails = {
  400: {
    description:
      'Неверный параметр (`dm_bad_param`), не выбрана организация, неверный запрос списка или столбец',
    content: error,
  },
  401: { description: 'Нет входа', content: error },
  404: { description: 'Шаблон не найден или недоступен', content: error },
  409: { description: 'Шаблон временно не работает (`dm_template_broken`)', content: error },
  ...exportRateResponses,
  503: { description: 'Запрос выполнялся слишком долго (`dm_timeout`)', content: error },
} as const;

export const OUTPUT_EXPORT_ROUTES = {
  export: createRoute({
    method: 'post',
    path: '/dm/output/export',
    tags: ['datamart'],
    summary: '«Вывод» → «В Excel»: результат шаблона с фильтрами и столбцами таблицы',
    middleware: [requirePermission('dmView'), requirePermission('export')] as const,
    request: { body: { content: json(DmOutExport), required: true } },
    responses: {
      200: { description: 'Файл .xlsx', content: xlsxContent },
      403: {
        description: 'Нет права «Смотреть витрину данных» или «Выгружать в Excel»',
        content: error,
      },
      ...fails,
    },
  }),
  adminExport: createRoute({
    method: 'post',
    path: '/admin/dm/output/export',
    tags: ['admin'],
    summary: '«Вывод» Админки → «В Excel»; шаблон организаций — «глазами организации»',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmAdminOutExport), required: true } },
    responses: {
      200: { description: 'Файл .xlsx', content: xlsxContent },
      403: { description: 'Не администратор платформы', content: error },
      ...fails,
    },
  }),
} as const;

/** Видимые столбцы по порядку экрана: неизвестный код или служебный «Контрагент» — 400. */
function exportColumns(
  columns: readonly DmOutColumn[],
  cols: string,
): { col: DmOutColumn; index: number }[] {
  const shown = dmShownColumns(columns);
  return cols.split(',').map((key) => {
    const found = shown.find((s) => s.col.code === key);
    if (!found) apiFail(400, 'validation_failed', 'Неизвестный столбец');
    return found;
  });
}

/**
 * Сортировка, фильтры, поиск, группы и итоги — только по столбцам вывода, как `cols`: неизвестный ключ —
 * 400, а не тихий пропуск (правило списков API).
 */
function checkListKeys(columns: readonly DmOutColumn[], query: ListQuery): void {
  const known = new Set(dmShownColumns(columns).map((s) => s.col.code));
  const keys = [
    ...(query.sort ? [query.sort.key] : []),
    ...Object.keys(query.filters),
    ...(query.search?.keys ?? []),
    ...(query.group ?? []),
    ...Object.keys(query.agg ?? {}),
  ];
  if (keys.some((k) => !known.has(k))) apiFail(400, 'validation_failed', 'Неизвестный столбец');
}

/** Значение ячейки файла: деньги — тыйыны, число — числом, остальное — как на экране. */
function cellOf(col: DmOutColumn, value: DmValue, texts: DmOutTexts): XlsxCell {
  if (value === null) return null;
  if ((col.type === 'money' || col.type === 'num') && typeof value === 'number') return value;
  return dmText(col.type, value, texts);
}

/** Файл по итогу запуска (отказ запуска — ответ метода). */
function fileOf(
  c: Context<AppEnv>,
  deps: ApiDeps,
  run: OutputRun,
  query: ListQuery,
  cols: string,
  t: (key: string) => string,
) {
  const { tpl, out, side } = run;
  if (!out.ok) outputFail(tpl, out, t, side);
  const columns: DmOutColumn[] = out.columns.map((col) => ({
    code: col.code,
    name: col.name,
    type: col.type,
    total: col.total,
  }));
  const shown = exportColumns(columns, cols);
  checkListKeys(columns, query);
  const texts: DmOutTexts = { yes: t('dm.out.yes'), no: t('dm.out.no') };
  const rows = dmOutList(dmOutRows(columns, out.rows), columns, query, texts);
  const kept = rows.slice(0, EXPORT_ROWS_LIMIT);
  return xlsxResponse(c, {
    title: tpl.name,
    today: deps.clock.now(),
    columns: shown.map((s) => ({ label: s.col.name, type: dmListType(s.col.type) })),
    rows: kept.map((r) => shown.map((s) => cellOf(s.col, r.v[s.index] ?? null, texts))),
    more: out.more || rows.length > kept.length,
    total: rows.length,
    // Заголовки столбцов — названия из шаблона, а не ключи словаря.
    t: (label) => label,
  });
}

export function outputExportHandlers(deps: ApiDeps) {
  const exportOrg: RouteHandler<typeof OUTPUT_EXPORT_ROUTES.export, AppEnv> = async (c) => {
    const { list, ...input } = c.req.valid('json');
    const query = listQueryOf(list);
    const userId = c.get('session')!.userId;
    const t = await serverTexts(deps);
    // Сначала очередь запуска и пул: пока идёт «Показать» или пул занят, выгрузка не тратит одну из 20 в час.
    return withRunSlot(deps, userId, t, () =>
      withDmPoolSlot(deps, t, () =>
        withExportSlot(deps, userId, async () =>
          fileOf(c, deps, await orgOutput(deps, c, input, { exported: true }), query, list.cols, t),
        ),
      ),
    );
  };

  const exportAdmin: RouteHandler<typeof OUTPUT_EXPORT_ROUTES.adminExport, AppEnv> = async (c) => {
    const { list, ...input } = c.req.valid('json');
    const query = listQueryOf(list);
    const userId = c.get('session')!.userId;
    const t = await serverTexts(deps);
    return withRunSlot(deps, userId, t, () =>
      withDmPoolSlot(deps, t, () =>
        withExportSlot(deps, userId, async () =>
          fileOf(
            c,
            deps,
            await adminOutput(deps, c, input, { exported: true }),
            query,
            list.cols,
            t,
          ),
        ),
      ),
    );
  };

  return { exportOrg, exportAdmin };
}
