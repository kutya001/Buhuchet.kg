import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  importFileName,
  insertIndicatorImport,
  writeHistory,
  KPI_IMPORT_REASON,
  kpiContractorOf,
  kpiContractorRecords,
  listIndicatorImports,
  listIndicators,
  loadKpiData,
  loadMonths,
  lockKpi,
  releaseRateLimit,
  saveIndicatorValues,
  takeRateLimit,
  type IndicatorImportRecord,
  type KpiContractorRecord,
  type KpiData,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  addMonths,
  EXPORT_ROWS_LIMIT,
  importHead,
  importInn,
  importTemplate,
  importWrites,
  KPI_IMPORT_HOURLY_LIMIT,
  KPI_IMPORT_MAX_BYTES,
  KPI_IMPORT_MAX_CONTRACTORS,
  KPI_IMPORT_MAX_MONTHS,
  KPI_MESSAGES,
  KPI_PERIOD_MAX_MONTHS,
  monthRange,
  parseImportHead,
  planImport,
  searchText,
  type ImportIndicator,
  type ImportPlan,
  type IndicatorType,
  type YearMonth,
} from '@buhuchet/domain';
import {
  KpiImportApplied,
  KpiImportApplyQuery,
  KpiImportFileQuery,
  KpiImportHistory,
  KpiImportOptions,
  KpiImportPreview,
  KpiImportTemplatePreview,
  KpiImportTemplateQuery,
  type KpiImportRecord,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent } from '../../lists/export';
import { buildXlsx, XLSX_TYPE } from '../../lists/xlsx';
import { readSheetRows, SheetReadError, type SheetCell } from '../../lists/xlsx-read';
import { requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import {
  canEditValues,
  currentMonthOf,
  error,
  inKpi,
  kpiFail,
  kpiScopeOf,
  noAuth,
  subjectOf,
} from './common';
import { buildImportTemplate } from './import-file';

/*
 * «Ввод из Excel» (задача 2.28; ТЗ «Показатели контрагентов» → «Ввод из Excel»; прототип
 * modules/kpi-excel.js: kxDlg, kxTpl, kxParse, kxApply). Всё — с правом «Вводить показатели из Excel»;
 * шаблон — по контрагентам в области сотрудника, записываются значения только тех, кому он вносит
 * значения (право «Вносить значения показателей» и область). Загруженный файл нигде не хранится: он
 * приходит телом запроса на предпросмотр, «Применить» и файл ошибок и каждый раз разбирается заново.
 */

/** Пути загрузки файла: их предел тела — свой (`KPI_IMPORT_MAX_BYTES`), а не общий 1 МиБ. */
export const KPI_IMPORT_UPLOAD_PATHS = [
  '/api/kpi/import/preview',
  '/api/kpi/import/apply',
  '/api/kpi/import/errors',
] as const;

const noImport = {
  description: 'Нет права «Вводить показатели из Excel» или функция выключена',
  content: error,
};

const tooBigBody = () => apiError('import_file_too_big', KPI_MESSAGES.import_file_too_big);

/** Файл больше 4 МБ — 413 (общий `kpiFail` отвечает только 400…409). */
function tooBig(): never {
  throw new HTTPException(413, { res: Response.json(tooBigBody(), { status: 413 }) });
}

const importBodyLimit = bodyLimit({
  maxSize: KPI_IMPORT_MAX_BYTES,
  onError: (c) => c.json(tooBigBody(), 413),
});

/**
 * Разборы файла пользователя (предпросмотр и «Применить»): один одновременно и не больше
 * `KPI_IMPORT_HOURLY_LIMIT` за час — разбор большого файла занимает процессор, а повторять его можно
 * сколько угодно. Не отпущенный (сбой процесса) перестаёт мешать через 5 минут, как выгрузка.
 */
export const KPI_IMPORT_RATE_LIMIT: RateLimit = {
  kind: 'kpi_import',
  max: KPI_IMPORT_HOURLY_LIMIT,
  windowSeconds: 3600,
  leaseSeconds: 300,
};

/** Разбор файла по очереди: идёт прежний — 429 `import_busy`, за час уже предел — 429 `import_limit`. */
async function withImportSlot<T>(deps: ApiDeps, c: Context<AppEnv>, run: () => Promise<T>) {
  const userId = c.get('session')!.userId;
  const slot = await takeRateLimit(deps.db, KPI_IMPORT_RATE_LIMIT, userId);
  if (!slot.ok) {
    if (slot.reason === 'busy') apiFail(429, 'import_busy', KPI_MESSAGES.import_busy);
    apiFail(429, 'import_limit', KPI_MESSAGES.import_limit);
  }
  try {
    return await run();
  } finally {
    await releaseRateLimit(deps.db, KPI_IMPORT_RATE_LIMIT, userId, slot.ticket).catch(
      (err: unknown) => deps.logger.error({ err }, 'разбор файла показателей не отпущен'),
    );
  }
}

const importRateResponses = {
  429: {
    description: 'Идёт прежний разбор файла пользователя или за час их уже 60',
    content: error,
  },
} as const;

const fileBody = {
  required: true,
  content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
} as const;

/** Подпись типа значения в заголовке столбца: «сом, сумма в сом» (прототип `kxUnit`). */
function unitText(t: (key: string) => string, i: { unit: string; type: IndicatorType }) {
  const type = t(`kpi.type.${i.type}`).toLowerCase();
  return `${i.unit || type}, ${type}`;
}

/** Месяц «сентябрь 2026» — в имени файла шаблона (прототип `kxFileName`). */
const monthText = (t: (key: string) => string, m: YearMonth) =>
  `${t(`month.${Number(m.slice(5, 7))}`)} ${m.slice(0, 4)}`;

/* ───────────── Шаг 1: шаблон ───────────── */

export const importOptionsRoute = createRoute({
  method: 'get',
  path: '/kpi/import/options',
  tags: ['kpi'],
  summary: 'Ввод из Excel: показатели, ответственные и режимы для фильтра шаблона',
  middleware: [requirePermission('kpiImport')] as const,
  responses: {
    200: {
      description: 'Действующие показатели, ответственные и режимы контрагентов в области, период',
      content: { 'application/json': { schema: KpiImportOptions } },
    },
    401: noAuth,
    403: noImport,
  },
});

export function importOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof importOptionsRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const current = currentMonthOf(deps);
    const body = await inKpi(deps, c, async (tx) => {
      const records = (await kpiContractorRecords(tx, { scope: kpiScopeOf(subject) })).filter(
        (r) => r.kind !== 'oneoff',
      );
      const indicators = await listIndicators(tx);
      const responsibles = new Map<string, string>();
      const regimes = new Map<string, string>();
      for (const r of records) {
        if (r.responsibleEmployeeId) {
          responsibles.set(r.responsibleEmployeeId, r.responsibleName ?? '');
        }
        if (r.regimeCode) regimes.set(r.regimeCode, r.regimeName ?? r.regimeCode);
      }
      const byName = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name, 'ru');
      return {
        indicators: indicators.filter((i) => !i.archived).map((i) => ({ id: i.id, name: i.name })),
        responsibles: [...responsibles].map(([id, name]) => ({ id, name })).sort(byName),
        regimes: [...regimes].map(([code, name]) => ({ code, name })).sort(byName),
        defaultMonth: addMonths(current, -1),
        currentMonth: current,
      };
    });
    return c.json(body, 200);
  };
}

type TemplateQuery = z.infer<typeof KpiImportTemplateQuery>;

/**
 * Шаблон за период по фильтру: строки, столбцы и что превышен предел (прототип `kxTpl`, `kxCps`). Больше
 * 24 месяцев шаблон не скачивается, но предпросмотр, как в прототипе, считается — до 72 месяцев, как
 * «За период»; дальше — только предупреждение.
 */
async function templateOf(deps: ApiDeps, c: Context<AppEnv>, tx: Tx, query: TemplateQuery) {
  const [from, to] = query.from <= query.to ? [query.from, query.to] : [query.to, query.from];
  if (to > currentMonthOf(deps)) kpiFail(400, 'month_in_future');
  const months = monthRange(from, to);
  if (months.length > KPI_PERIOD_MAX_MONTHS) {
    return { tooMany: 'months' as const, months, rows: [], tpl: null, data: null };
  }
  const q = searchText(query.q ?? '').trim();
  const records = (await kpiContractorRecords(tx, { scope: kpiScopeOf(subjectOf(c)) })).filter(
    (r) =>
      r.kind !== 'oneoff' &&
      (!query.resp || r.responsibleEmployeeId === query.resp) &&
      (!query.reg || r.regimeCode === query.reg) &&
      (!q || searchText(r.name).includes(q) || r.inn.includes(q)),
  );
  const ids = records.map((r) => r.id);
  const [data, statuses] = await Promise.all([
    loadKpiData(tx, { contractorIds: ids, from, to }),
    loadMonths(tx, { contractorIds: ids, from, to }),
  ]);
  const checked = new Set(
    statuses.filter((s) => s.status === 'checked').map((s) => `${s.contractorId}|${s.month}`),
  );
  const tpl = importTemplate(
    data.book,
    records.map(kpiContractorOf),
    new Set(query.inds),
    months,
    data.valueOf,
    (cid, m) => checked.has(`${cid}|${m}`),
  );
  const byId = new Map(records.map((r) => [r.id, r]));
  const rows = tpl.contractors.map((k, n) => ({
    inn: byId.get(k.id)!.inn,
    name: byId.get(k.id)!.name,
    cells: tpl.cells[n]!,
  }));
  const tooMany =
    months.length > KPI_IMPORT_MAX_MONTHS
      ? ('months' as const)
      : rows.length > KPI_IMPORT_MAX_CONTRACTORS
        ? ('contractors' as const)
        : null;
  return { tooMany, months, rows, tpl, data };
}

/** Заголовки столбцов показателей: «Выручка · 09.2026» и подпись типа. */
function headOf(
  t: (key: string) => string,
  data: KpiData,
  columns: readonly { indicatorId: string; month: YearMonth }[],
) {
  const byId = new Map(data.indicators.map((i) => [i.id, i]));
  return columns.map((col) => {
    const i = byId.get(col.indicatorId)!;
    return {
      indicatorId: i.id,
      month: col.month,
      title: importHead(i.name, col.month),
      unit: unitText(t, i),
      type: i.type,
    };
  });
}

export const templatePreviewRoute = createRoute({
  method: 'get',
  path: '/kpi/import/template/preview',
  tags: ['kpi'],
  summary: 'Ввод из Excel: сколько строк и столбцов в шаблоне и первые строки',
  middleware: [requirePermission('kpiImport')] as const,
  request: { query: KpiImportTemplateQuery },
  responses: {
    200: {
      description: 'Предпросмотр листа «Показатели»',
      content: { 'application/json': { schema: KpiImportTemplatePreview } },
    },
    400: { description: 'Неверный период или фильтр', content: error },
    401: noAuth,
    403: noImport,
  },
});

/** Сколько строк шаблона показывает предпросмотр (прототип: «первые 8 строк из N»). */
const PREVIEW_ROWS = 8;

export function templatePreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof templatePreviewRoute, AppEnv> {
  return async (c) => {
    const query = c.req.valid('query');
    const t = await serverTexts(deps);
    const body = await inKpi(deps, c, async (tx) => {
      const r = await templateOf(deps, c, tx, query);
      if (!r.tpl) {
        return { contractors: 0, columns: 0, tooMany: r.tooMany, head: [], rows: [] };
      }
      return {
        contractors: r.rows.length,
        columns: r.tpl.columns.length,
        tooMany: r.tooMany,
        head: headOf(t, r.data, r.tpl.columns),
        rows: r.rows.slice(0, PREVIEW_ROWS).map((row) => ({
          ...row,
          cells: row.cells.map((cell) =>
            cell.kind === 'off' ? { kind: 'off' as const, value: null } : cell,
          ),
        })),
      };
    });
    return c.json(body, 200);
  };
}

export const templateRoute = createRoute({
  method: 'get',
  path: '/kpi/import/template',
  tags: ['kpi'],
  summary: 'Ввод из Excel: скачать шаблон .xlsx',
  middleware: [requirePermission('kpiImport')] as const,
  request: { query: KpiImportTemplateQuery },
  responses: {
    200: { description: 'Шаблон: лист «Показатели» и лист «Подсказки»', content: xlsxContent },
    400: {
      description: 'Больше 24 месяцев или 1 000 контрагентов, шаблон пуст, месяц не наступил',
      content: error,
    },
    ...exportRateResponses,
    401: noAuth,
    403: noImport,
  },
});

export function templateHandler(deps: ApiDeps): RouteHandler<typeof templateRoute, AppEnv> {
  return async (c) => {
    const query = c.req.valid('query');
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const r = await inKpi(deps, c, (tx) => templateOf(deps, c, tx, query), 'export');
      if (r.tooMany === 'months') kpiFail(400, 'import_too_many_months');
      if (r.tooMany === 'contractors') kpiFail(400, 'import_too_many_contractors');
      if (!r.tpl || !r.rows.length || !r.tpl.columns.length) kpiFail(400, 'import_empty');
      const head = headOf(t, r.data!, r.tpl.columns);
      const indicators = r.data!.indicators.filter((i) => query.inds.includes(i.id) && !i.archived);
      const tips = [
        t('kpi.import.tips.title'),
        '',
        t('kpi.import.tips.rows'),
        t('kpi.import.tips.columns'),
        t('kpi.import.tips.off'),
        t('kpi.import.tips.checked'),
        '',
        t('kpi.import.tips.numbers'),
        t('kpi.import.tips.empty'),
        t('kpi.import.tips.heads'),
        '',
        t('kpi.import.tips.list'),
        ...indicators.map(
          (i) => `${i.name} — ${unitText(t, i)}${i.description ? `. ${i.description}` : ''}`,
        ),
      ];
      const file = await buildImportTemplate({
        sheet: t('kpi.import.sheet'),
        tipsSheet: t('kpi.import.tips_sheet'),
        head: [
          t('kpi.import.inn'),
          t('kpi.import.contractor'),
          ...head.map((h) => `${h.title} (${h.unit})`),
        ],
        rows: r.rows,
        tips,
      });
      const from = r.months[0]!;
      const to = r.months[r.months.length - 1]!;
      const period =
        from === to ? monthText(t, from) : `${monthText(t, from)} — ${monthText(t, to)}`;
      const name = `${t('kpi.import.file')} ${period}.xlsx`;
      return c.body(new Uint8Array(file), 200, {
        'content-type': XLSX_TYPE,
        'content-disposition': `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'no-store',
        'x-import-rows': String(r.rows.length),
        'x-import-columns': String(r.tpl.columns.length),
      });
    });
  };
}

/* ───────────── Шаг 2: загрузка заполненного шаблона ───────────── */

/**
 * Таблица из тела запроса: больше 4 МБ — 413; не читается или больше пределов листа (строк, столбцов,
 * ячеек; распакованный — больше 24 МБ) — 400.
 */
async function sheetOf(c: Context<AppEnv>): Promise<SheetCell[][]> {
  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (bytes.length > KPI_IMPORT_MAX_BYTES) tooBig();
  if (!bytes.length) kpiFail(400, 'import_file_unreadable');
  try {
    return readSheetRows(bytes);
  } catch (err) {
    if (err instanceof SheetReadError) {
      kpiFail(
        400,
        err.code === 'sheet_too_big' ? 'import_sheet_too_big' : 'import_file_unreadable',
      );
    }
    throw err;
  }
}

interface Planned {
  plan: ImportPlan;
  data: KpiData;
  records: Map<string, KpiContractorRecord>;
  indicators: Map<string, { name: string; unit: string; type: IndicatorType }>;
}

/**
 * Разбор файла по данным организации: контрагент — по ИНН среди всех контрагентов организации (вне
 * области — «нет доступа к контрагенту»), значения и статусы месяцев — только по найденным и месяцам
 * из заголовков.
 */
async function planOf(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tx: Tx,
  rows: SheetCell[][],
): Promise<Planned> {
  const subject = subjectOf(c);
  const head = rows[0] ?? [];
  const innCol = head.findIndex((h) => searchText(String(h ?? '')).trim() === 'инн');
  const months = head
    .map((h) => (h == null ? null : parseImportHead(String(h))?.month))
    .filter((m): m is YearMonth => !!m)
    .sort();
  const all = await kpiContractorRecords(tx, { scope: undefined, archived: true });
  const byInn = new Map<string, KpiContractorRecord>();
  for (const r of all) if (!byInn.has(r.inn)) byInn.set(r.inn, r);
  const used = new Map<string, KpiContractorRecord>();
  if (innCol >= 0) {
    for (const row of rows.slice(1)) {
      const r = row && byInn.get(importInn(row[innCol]));
      if (r && canEditValues(subject, r)) used.set(r.id, r);
    }
  }
  const ids = [...used.keys()];
  const current = currentMonthOf(deps);
  const from = months[0] ?? current;
  const to = months[months.length - 1] ?? current;
  const [data, statuses] = await Promise.all([
    loadKpiData(tx, { contractorIds: ids, from, to }),
    loadMonths(tx, { contractorIds: ids, from, to }),
  ]);
  const checked = new Set(
    statuses.filter((s) => s.status === 'checked').map((s) => `${s.contractorId}|${s.month}`),
  );
  const byId = new Map(data.indicators.map((i) => [i.id, i]));
  const indicators: ImportIndicator[] = data.book.indicators.map((i) => ({
    ...i,
    name: byId.get(i.id)!.name,
    type: byId.get(i.id)!.type,
  }));
  const plan = planImport(rows, {
    book: data.book,
    indicators,
    contractorByInn: (inn) => {
      const r = byInn.get(inn);
      if (!r) return undefined;
      return { contractor: kpiContractorOf(r), editable: used.has(r.id) };
    },
    valueOf: data.valueOf,
    checked: (cid, m) => checked.has(`${cid}|${m}`),
    currentMonth: current,
  });
  return { plan, data, records: used, indicators: byId };
}

/** Сколько строк каждого вида уходит в предпросмотр; в файл ошибок — как в выгрузку списка. */
const PREVIEW_ITEMS = 500;
const PREVIEW_ERRORS = 1000;

/** Ошибки файла с названием контрагента (если он найден и доступен) — первые `limit`. */
function errorsOf(p: Planned, limit: number) {
  return p.plan.errors.slice(0, limit).map((e) => ({
    ref: e.ref,
    row: e.row,
    col: e.ref.replace(/\d+$/, ''),
    contractor: e.contractorId ? (p.records.get(e.contractorId)?.name ?? null) : null,
    value: e.value,
    problem: e.problem,
  }));
}

function previewOf(p: Planned) {
  const item = (x: ImportPlan['added'][number]) => {
    const i = p.indicators.get(x.indicatorId)!;
    return {
      ref: x.ref,
      contractor: p.records.get(x.contractorId)!.name,
      indicator: i.name,
      type: i.type,
      unit: i.unit,
      month: x.month,
      old: x.old,
      value: x.value,
      checked: x.checked,
    };
  };
  return {
    added: p.plan.added.length,
    changed: p.plan.changed.length,
    changedChecked: p.plan.changed.filter((x) => x.checked).length,
    same: p.plan.same,
    skipped: p.plan.skipped,
    errorCount: p.plan.errorCount,
    errors: errorsOf(p, PREVIEW_ERRORS),
    addedItems: p.plan.added.slice(0, PREVIEW_ITEMS).map(item),
    changedItems: p.plan.changed.slice(0, PREVIEW_ITEMS).map(item),
  };
}

const uploadResponses = {
  400: {
    description: 'Файл не читается как таблица или в нём больше строк, столбцов, ячеек, чем можно',
    content: error,
  },
  401: noAuth,
  403: noImport,
  413: { description: 'Файл больше 4 МБ', content: error },
} as const;

export const importPreviewRoute = createRoute({
  method: 'post',
  path: '/kpi/import/preview',
  tags: ['kpi'],
  summary: 'Ввод из Excel: предпросмотр загруженного файла',
  middleware: [requirePermission('kpiImport'), importBodyLimit] as const,
  request: { query: KpiImportFileQuery, body: fileBody },
  responses: {
    200: {
      description: '«Новые», «Изменённые», «Без изменений», «Ошибки» с ячейкой и причиной',
      content: { 'application/json': { schema: KpiImportPreview } },
    },
    ...uploadResponses,
    ...importRateResponses,
  },
});

export function importPreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof importPreviewRoute, AppEnv> {
  return async (c) => {
    const body = await withImportSlot(deps, c, async () => {
      const rows = await sheetOf(c);
      return inKpi(deps, c, async (tx) => previewOf(await planOf(deps, c, tx, rows)));
    });
    return c.json(body, 200);
  };
}

const recordBody = (r: IndicatorImportRecord): KpiImportRecord => ({
  ...r,
  at: r.at.toISOString(),
});

export const importApplyRoute = createRoute({
  method: 'post',
  path: '/kpi/import/apply',
  tags: ['kpi'],
  summary: 'Ввод из Excel: «Применить» — записать значения без ошибок',
  middleware: [requirePermission('kpiImport'), importBodyLimit] as const,
  request: { query: KpiImportApplyQuery, body: fileBody },
  responses: {
    200: {
      description: 'Запись «Истории загрузок» и ошибки, которые остались в файле',
      content: { 'application/json': { schema: KpiImportApplied } },
    },
    ...uploadResponses,
    ...importRateResponses,
  },
});

/**
 * «Применить» (прототип `kxApply`): файл разбирается заново под блокировкой показателей организации,
 * записываются строки без ошибок — новые и изменённые; изменения проверенных — только с `withChecked`
 * (иначе пропускаются). В истории значения — пометка «Из Excel», статусы месяцев пересчитываются.
 */
export function importApplyHandler(deps: ApiDeps): RouteHandler<typeof importApplyRoute, AppEnv> {
  return async (c) => {
    const { file, withChecked } = c.req.valid('query');
    const body = await withImportSlot(deps, c, async () => {
      const rows = await sheetOf(c);
      return inKpi(deps, c, async (tx) => {
        await lockKpi(tx);
        const p = await planOf(deps, c, tx, rows);
        if (!p.plan.added.length && !p.plan.changed.length) kpiFail(400, 'import_nothing');
        const items = importWrites(p.plan, withChecked);
        const contractors = new Map([...p.records.values()].map((r) => [r.id, kpiContractorOf(r)]));
        const saved = await saveIndicatorValues(
          tx,
          p.data,
          contractors,
          items.map((x) => ({
            contractorId: x.contractorId,
            indicatorId: x.indicatorId,
            month: x.month,
            value: x.value,
          })),
          KPI_IMPORT_REASON,
        );
        const isNew = new Set(
          items
            .filter((x) => x.old === null)
            .map((x) => `${x.contractorId}|${x.indicatorId}|${x.month}`),
        );
        const added = saved.changed.filter((w) =>
          isNew.has(`${w.contractorId}|${w.indicatorId}|${w.month}`),
        ).length;
        const rec = {
          fileName: file,
          from: p.plan.months[0] ?? null,
          to: p.plan.months[p.plan.months.length - 1] ?? null,
          added,
          changed: saved.changed.length - added,
          errors: p.plan.errorCount,
          skippedChecked: withChecked ? 0 : p.plan.changed.filter((x) => x.checked).length,
        };
        const { id, at } = await insertIndicatorImport(tx, rec);
        // Прототип: запись истории «Ввод показателей из Excel «файл»: новых, изменённых, ошибок».
        await writeHistory(tx, {
          entity: 'indicator_import',
          entityId: id,
          action: 'create',
          changes: [
            { field: 'fileName', to: importFileName(file) },
            { field: 'added', to: rec.added },
            { field: 'changed', to: rec.changed },
            { field: 'errors', to: rec.errors },
          ],
        });
        const [me] = (await listIndicatorImports(tx)).filter((r) => r.id === id);
        return {
          record: recordBody(me ?? { ...rec, id, at, actor: null, fileName: file }),
          preview: previewOf(p),
        };
      });
    });
    return c.json(body, 200);
  };
}

export const importErrorsRoute = createRoute({
  method: 'post',
  path: '/kpi/import/errors',
  tags: ['kpi'],
  summary: 'Ввод из Excel: ошибки загруженного файла файлом .xlsx',
  middleware: [requirePermission('kpiImport'), importBodyLimit] as const,
  request: { query: KpiImportFileQuery, body: fileBody },
  responses: {
    200: {
      description: 'Лист «Ошибки»: ячейка, строка, столбец, контрагент, значение, причина',
      content: xlsxContent,
    },
    ...uploadResponses,
    ...exportRateResponses,
  },
});

export function importErrorsHandler(deps: ApiDeps): RouteHandler<typeof importErrorsRoute, AppEnv> {
  return async (c) =>
    withExportSlot(deps, c.get('session')!.userId, async () => {
      const rows = await sheetOf(c);
      const t = await serverTexts(deps);
      const errors = await inKpi(deps, c, async (tx) =>
        errorsOf(await planOf(deps, c, tx, rows), EXPORT_ROWS_LIMIT),
      );
      const file = await buildXlsx(
        t('kpi.import.errors.sheet'),
        [
          { title: t('kpi.import.errors.ref'), kind: 'text' },
          { title: t('kpi.import.errors.row'), kind: 'number' },
          { title: t('kpi.import.errors.col'), kind: 'text' },
          { title: t('kpi.import.contractor'), kind: 'text', width: 34 },
          { title: t('kpi.import.errors.value'), kind: 'text', width: 20 },
          { title: t('kpi.import.errors.problem'), kind: 'text', width: 40 },
        ],
        errors.map((e) => [
          e.ref,
          e.row,
          e.col,
          e.contractor ?? '',
          e.value,
          t(`kpi.import.problem.${e.problem}`),
        ]),
      );
      const name = `${t('kpi.import.errors.file')}.xlsx`;
      return c.body(new Uint8Array(file), 200, {
        'content-type': XLSX_TYPE,
        'content-disposition': `attachment; filename="errors.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'no-store',
      });
    });
}

export const importHistoryRoute = createRoute({
  method: 'get',
  path: '/kpi/import/history',
  tags: ['kpi'],
  summary: 'Ввод из Excel: «История загрузок»',
  middleware: [requirePermission('kpiImport')] as const,
  responses: {
    200: {
      description: 'Кто, когда, файл, период, сколько новых, изменённых и ошибок — сначала новые',
      content: { 'application/json': { schema: KpiImportHistory } },
    },
    401: noAuth,
    403: noImport,
  },
});

export function importHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof importHistoryRoute, AppEnv> {
  return async (c) => {
    const items = await inKpi(deps, c, (tx) => listIndicatorImports(tx));
    return c.json({ items: items.map(recordBody) }, 200);
  };
}
