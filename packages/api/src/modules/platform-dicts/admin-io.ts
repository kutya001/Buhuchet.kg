import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { createHash, randomBytes } from 'node:crypto';
import {
  adminDictCreate,
  adminDictSetActive,
  adminDictUpdate,
  adminTypeReportCounts,
  dictValueTakenField,
  dueCatalog,
  enqueueDuesRecalc,
  exportDictLoads,
  getDictLoad,
  insertDictLoad,
  ioRecords,
  ioRefs,
  listDictLoadsPage,
  listDictLoadValues,
  lockDictLoads,
  mergeRedueScopes,
  rollbackDictLoad,
  withUserContext,
  type AdminDictSaveResult,
  type DictLoadAdded,
  type DictLoadBefore,
  type DictLoadRecord,
  type DueCatalog,
  type IoRecord,
  type RedueScope,
  type Tx,
} from '@buhuchet/db';
import {
  ADMIN_DICT_META,
  DICT_NOTE_MAX,
  formatText,
  IO_COLUMNS,
  ioChanges,
  ioCodeValid,
  ioHeader,
  ioMerge,
  ioNewValue,
  ioRow,
  parseIoRows,
  parseIoText,
  UI_TEXTS,
  type AdminValueDict,
  type IoContext,
  type IoValue,
  type Translate,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  AdminDictImportApplied,
  AdminDictImportApplyQuery,
  AdminDictImportPreview,
  AdminDictIoFile,
  AdminDictLoad,
  AdminDictLoadIdParam,
  AdminDictLoadList,
  AdminDictValueForm,
  AdminValueDictParam,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { buildXlsx, XLSX_TYPE } from '../../lists/xlsx';
import {
  readSheetRows,
  SheetReadError,
  type SheetCell,
  type SheetLimits,
} from '../../lists/xlsx-read';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { previewDues, recalcQueued, withPreviewSlot } from './admin-dues';
import { requiredProblem, saveProblem, valueInputOf, type FieldProblem } from './admin';

/*
 * Админка → «Справочники платформы» → «Выгрузить», «Загрузить» и «Загрузки» (задача 2.37; ТЗ «Выгрузка
 * и загрузка справочников»; прототип admin/platform-dicts-io.js: exportDlg, importDictDlg, renderLoads,
 * rollbackLoad). Файл загрузки — тот же, что выгрузка: строки сопоставляются по коду, удаления нет —
 * только «Нет» в «Активно». Сравнение — та же запись значений, что у «ОК, применить», в транзакции,
 * которая откатывается: числа и ошибки в окне совпадают с тем, что сделает «Применить». Файл нигде не
 * хранится: он приходит телом запроса и разбирается заново. Только администратору платформы.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

/** Тексты словаря с подстановками — для ячеек файла и ошибок строк. */
async function translator(deps: ApiDeps): Promise<Translate> {
  const raw = await serverTexts(deps);
  return (key, params) => formatText(raw(key), params);
}

const adminTx = <T>(deps: ApiDeps, c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>) =>
  withUserContext(deps.db, c.get('session')!.userId, fn, 'export');

/* ───────────── Выгрузить ───────────── */

const IO_PATH = '/admin/platform-dicts-io/{dict}';

async function fileOf(tx: Tx, dict: AdminValueDict, t: Translate) {
  const ctx: IoContext = { t, refs: await ioRefs(tx) };
  const records = await ioRecords(tx, dict);
  return { header: ioHeader(dict, t), rows: records.map((x) => ioRow(dict, x, ctx)) };
}

export const adminDictIoFileRoute = createRoute({
  method: 'get',
  path: IO_PATH,
  tags: ['platform-dicts'],
  summary: '«Выгрузить»: справочник в формате загрузки',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam },
  responses: {
    200: {
      description: 'Заголовки столбцов и строки — текстом ячеек, все значения справочника',
      content: json(AdminDictIoFile),
    },
    ...denied,
  },
});

/** Окно «Выгрузка» (прототип exportDlg): текст для «Скопировать» и число строк. */
export function adminDictIoFileHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminDictIoFileRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const t = await translator(deps);
    return c.json(await adminTx(deps, c, (tx) => fileOf(tx, dict, t)), 200);
  };
}

export const adminDictIoXlsxRoute = createRoute({
  method: 'get',
  path: `${IO_PATH}/xlsx`,
  tags: ['platform-dicts'],
  summary: '«Скачать для Excel»: справочник в формате загрузки',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam },
  responses: {
    200: { description: 'Файл Excel: все значения справочника, все поля', content: xlsxContent },
    ...exportRateResponses,
    ...denied,
  },
});

/** Числа срока — числами, остальное — текстом ячейки (как вставка в Excel). */
export function adminDictIoXlsxHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminDictIoXlsxRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await translator(deps);
      const file = await adminTx(deps, c, (tx) => fileOf(tx, dict, t));
      const numeric = IO_COLUMNS[dict].map((col) => col.field.type === 'int');
      const xlsx = await buildXlsx(
        t(`pdicts.title.${dict}` as UiTextKey),
        file.header.map((title, i) => ({ title, kind: numeric[i] ? 'number' : 'text' })),
        file.rows.map((r) => r.map((v, i) => (numeric[i] && v !== '' ? Number(v) : v))),
      );
      const name = `${t(`pdicts.title.${dict}` as UiTextKey)}.xlsx`;
      return c.body(new Uint8Array(xlsx), 200, {
        'content-type': XLSX_TYPE,
        'content-disposition': `attachment; filename="dict.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'no-store',
      });
    });
  };
}

/* ───────────── Загрузить ───────────── */

/**
 * Пределы файла загрузки: справочник — сотни строк и до полусотни столбцов; текст ячейки — до длины
 * пояснения значения (длиннее — обрезан с «…» и не пройдёт проверку строки, а не сохранится обрезанным).
 */
const IMPORT_SHEET_LIMITS: Partial<SheetLimits> = {
  rows: 5_000,
  columns: 200,
  cells: 200_000,
  area: 500_000,
  text: DICT_NOTE_MAX,
};

const cellString = (v: SheetCell | undefined) => (v === null || v === undefined ? '' : String(v));

/**
 * Таблица из тела запроса. Вставка из Excel (`text/plain`) — текстом: разделитель — табуляция, «;» или
 * «,». Файл — .xlsx (первый лист, как «Скачать для Excel») или CSV (UTF-8, иначе Windows-1251, как
 * сохраняет Excel), как в «Вводе из Excel». Пустые строки пропускаются. Пусто — 400, не читается или
 * слишком большой — 400.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-16 — файл и .xlsx, не только CSV.
async function tableOf(c: Context<AppEnv>): Promise<string[][]> {
  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (!bytes.length) importFail('import_empty');
  if (c.req.header('content-type')?.toLowerCase().startsWith('text/plain')) {
    const table = parseIoText(new TextDecoder('utf-8').decode(bytes));
    // Вставке — те же пределы строк и столбцов, что файлу.
    const { rows = 0, columns = 0 } = IMPORT_SHEET_LIMITS;
    if (table.length > rows || table.some((r) => r.length > columns)) importFail('import_too_big');
    return table;
  }
  let rows: SheetCell[][];
  try {
    rows = readSheetRows(bytes, IMPORT_SHEET_LIMITS);
  } catch (err) {
    if (!(err instanceof SheetReadError)) throw err;
    importFail(err.code === 'sheet_too_big' ? 'import_too_big' : 'import_unreadable');
  }
  return rows.map((row) => Array.from(row, cellString)).filter((row) => row.some((x) => x.trim()));
}

const IMPORT_MESSAGES = {
  import_empty: 'Вставьте данные или выберите файл',
  import_unreadable: 'Не удалось прочитать файл: нужен файл .xlsx или CSV в формате выгрузки',
  import_too_big: 'В файле слишком много строк или столбцов для справочника',
  import_no_rows: 'Нужна строка заголовков и хотя бы одна строка данных',
  import_no_code: 'Нет столбца «{col}»: без кода строки не сопоставить',
  import_changed: 'Справочник или файл изменились после сравнения — сравните заново',
  import_nothing: 'Нечего применять: нет строк, которые добавят, изменят или отключат значение',
} as const;

function importFail(
  code: keyof typeof IMPORT_MESSAGES,
  status: 400 | 409 = 400,
  params?: Record<string, string>,
): never {
  const message = params ? formatText(IMPORT_MESSAGES[code], params) : IMPORT_MESSAGES[code];
  return apiFail(status, code, message, params);
}

const fileBody = {
  required: true,
  content: {
    'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) },
    'text/plain': { schema: z.string() },
  },
} as const;

/** Текст ошибки поля: из словаря (`err.<код>`), иначе текст по умолчанию. */
function problemText(t: Translate, p: FieldProblem): string {
  const key = `err.${p.code}`;
  return key in UI_TEXTS ? t(key as UiTextKey) : p.message;
}

/** «Столбец: что не так»; поля нет в столбцах файла — только «что не так». */
function cellError(dict: AdminValueDict, t: Translate, field: string, text: string): string {
  const col = IO_COLUMNS[dict].find((c) => c.key === field);
  return col ? t('pdicts.io.err.cell', { col: t(col.title), text }) : text;
}

/**
 * Проверка значения после строки — как у окна правки: схема формы (длины, числа, формат кода ГНС, маска
 * страны), «Тип» справочника и обязательные поля.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-16 — строка проверяется, как окно значения.
function rowProblems(dict: AdminValueDict, x: IoValue, t: Translate) {
  const parsed = AdminDictValueForm.safeParse({ name: x.name, ...x.data });
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((i) => {
        const key = i.message as UiTextKey;
        const text = key in UI_TEXTS ? t(key) : t('pdicts.io.err.invalid');
        return cellError(dict, t, String(i.path[0] ?? ''), text);
      }),
    };
  }
  const result = valueInputOf(dict, parsed.data);
  if ('problem' in result) {
    return { errors: [cellError(dict, t, result.problem.field, problemText(t, result.problem))] };
  }
  const required = requiredProblem(dict, result.input);
  if (required) return { errors: [cellError(dict, t, required.field, problemText(t, required))] };
  return { input: result.input };
}

/** Отказ записи строки — в ошибку строки (откатывает только её точку сохранения). */
class RowFail extends Error {
  constructor(readonly result: Exclude<AdminDictSaveResult, { ok: true }>) {
    super(result.reason);
  }
}

/** Текст отказа записи: под полем — «Столбец: что не так»; запись изменили — «изменено другим». */
function failText(dict: AdminValueDict, t: Translate, result: RowFail['result']): string {
  const problem = saveProblem(result);
  if (problem) return cellError(dict, t, problem.field, problemText(t, problem));
  if (result.reason === 'fixed') return t('pdicts.io.err.fixed');
  return t('pdicts.io.err.changed');
}

interface ImportOutcome {
  preview: AdminDictImportPreview;
  before: DictLoadBefore[];
  added: DictLoadAdded[];
  /** Сроки каких отчётов пересчитать и каталог после записи (для предпросмотра). */
  redue: RedueScope | null;
  catalog: DueCatalog | null;
  /** Виды отчётов, у которых меняется «Что нужно сделать». */
  actTypes: string[];
}

/** Отметка справочника и файла: версии значений и строки файла. */
const stampOf = (dict: AdminValueDict, records: readonly IoRecord[], table: string[][]) =>
  createHash('sha256')
    .update(JSON.stringify([dict, records.map((x) => [x.code, x.version]), table]))
    .digest('hex');

/** Почему код новой строки не подходит: у кодов стран — две латинские буквы, у ключей — латиница. */
function newCodeError(dict: AdminValueDict): UiTextKey {
  if (dict === 'phones') return 'pdicts.io.err.code_country';
  return 'key' in ADMIN_DICT_META[dict].code ? 'pdicts.io.err.code_key' : 'pdicts.io.err.code';
}

/**
 * Сравнение и запись строк (прототип importDictDlg: `compare` и «ОК, применить»): каждая строка без
 * ошибок разбора проверяется как окно правки и записывается в своей точке сохранения — отказ базы
 * (повтор названия, отключённая связь) становится ошибкой строки, остальные строки записываются.
 * Новое значение — с кодом из файла; «Нет» в «Активно» — «Будет отключено».
 */
async function runImport(
  tx: Tx,
  dict: AdminValueDict,
  table: string[][],
  t: Translate,
): Promise<ImportOutcome> {
  const ctx: IoContext = { t, refs: await ioRefs(tx) };
  const parsed = parseIoRows(dict, table, ctx);
  // Нет столбца кода — с его названием: у УГНС это «Ключ», у кодов стран — «Код страны» (прототип).
  if ('fatal' in parsed) {
    importFail(`import_${parsed.fatal}`, 400, { col: t(IO_COLUMNS[dict][0]!.title) });
  }
  const records = await ioRecords(tx, dict);
  const byCode = new Map(records.map((x) => [x.code, x]));
  const preview: AdminDictImportPreview = {
    rows: parsed.rows.length,
    add: [],
    change: [],
    off: [],
    errors: [],
    same: 0,
    stamp: stampOf(dict, records, table),
    dues: { reports: 0, orgs: 0 },
    act: { types: 0, reports: 0 },
  };
  const before: DictLoadBefore[] = [];
  const added: DictLoadAdded[] = [];
  const redue: (RedueScope | null | undefined)[] = [];
  const actTypes: string[] = [];
  const random = () => randomBytes(4).toString('hex');
  for (const row of parsed.rows) {
    const fail = (errors: string[]) =>
      preview.errors.push({ line: row.line, code: row.code, errors });
    if (row.errors.length) {
      fail(row.errors);
      continue;
    }
    const base = byCode.get(row.code);
    if (!base && !ioCodeValid(dict, row.code)) {
      fail([t(newCodeError(dict))]);
      continue;
    }
    const after = ioMerge(base ?? ioNewValue(dict, row.code), row.values);
    const changes = base ? ioChanges(parsed.columns, base, after, ctx) : [];
    if (base && !changes.length) {
      preview.same++;
      continue;
    }
    const checked = rowProblems(dict, after, t);
    if (!checked.input) {
      fail(checked.errors);
      continue;
    }
    const input = checked.input;
    try {
      const written = await tx.transaction(async (sp) => {
        const saved = base
          ? await adminDictUpdate(sp, dict, row.code, input, base.version)
          : await adminDictCreate(sp, dict, input, random, row.code);
        if (!saved.ok) throw new RowFail(saved);
        if (saved.record.active === after.active) return { record: saved.record, redue: [saved] };
        const active = await adminDictSetActive(
          sp,
          dict,
          row.code,
          after.active,
          saved.record.version,
        );
        if (!active.ok) throw new RowFail(active);
        return { record: active.record, redue: [saved, active] };
      });
      const record = written.record;
      redue.push(...written.redue.map((x) => x.redue));
      const name = after.name;
      // Вид сразу после загрузки: по нему откат узнаёт значение, которое вернул откат следующей загрузки.
      const loaded = { name: record.name, active: record.active, data: record.data };
      const version = record.version;
      if (!base) {
        preview.add.push({ line: row.line, code: row.code, name });
        added.push({ code: row.code, version, after: loaded });
        continue;
      }
      const shown = changes.map(({ title, from, to }) => ({ title, from, to }));
      if (dict === 'types' && changes.some((x) => x.key === 'act')) actTypes.push(base.code);
      const off = base.active && !after.active;
      (off ? preview.off : preview.change).push({
        line: row.line,
        code: row.code,
        name: off ? base.name : name,
        changes: shown,
      });
      before.push({
        code: base.code,
        name: base.name,
        active: base.active,
        data: { ...base.data },
        version,
        after: loaded,
      });
    } catch (err) {
      if (err instanceof RowFail) {
        fail([failText(dict, t, err.result)]);
        continue;
      }
      // Такое же название успели сохранить между проверкой и записью.
      const taken = dictValueTakenField(err);
      if (!taken) throw err;
      fail([
        failText(dict, t, {
          ok: false,
          reason: 'taken',
          problems: [{ field: taken, code: 'taken' }],
        }),
      ]);
    }
  }
  const scope = mergeRedueScopes(redue.map((x) => x ?? null));
  return {
    preview,
    before,
    added,
    redue: scope,
    catalog: scope ? await dueCatalog(tx) : null,
    actTypes,
  };
}

/**
 * Что покажет сравнение сверх строк (прототип df.dues, df.actR): у скольких несданных отчётов в
 * скольких организациях изменятся сроки и сколько отчётов уже создано по видам, у которых меняется
 * «Что нужно сделать».
 */
async function withDues(deps: ApiDeps, outcome: ImportOutcome): Promise<AdminDictImportPreview> {
  const { preview, redue, catalog, actTypes } = outcome;
  const dues = catalog ? await previewDues(deps, redue, catalog) : preview.dues;
  if (!actTypes.length) return { ...preview, dues };
  const counts = await adminTypeReportCounts(deps.db);
  const reports = actTypes.reduce((n, code) => n + (counts.get(code)?.total ?? 0), 0);
  return { ...preview, dues, act: { types: actTypes.length, reports } };
}

/** Сравнение без записи: та же запись в транзакции, которая откатывается. */
class DryRun extends Error {
  constructor(readonly outcome: ImportOutcome) {
    super('dry run');
  }
}

const uploadResponses = {
  400: {
    description: 'Пусто, нет строки заголовков и данных или нет столбца «Код»',
    content: error,
  },
  ...denied,
} as const;

export const adminDictImportPreviewRoute = createRoute({
  method: 'post',
  path: `${IO_PATH}/preview`,
  tags: ['platform-dicts'],
  summary: '«Загрузить» → «Сравнить»: что будет добавлено, изменено и отключено',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam, body: fileBody },
  responses: {
    200: {
      description: 'Строки: добавится, изменится («было → стало»), отключится, ошибки',
      content: json(AdminDictImportPreview),
    },
    ...uploadResponses,
    429: {
      description:
        'Идёт прежнее сравнение или расчёт сроков пользователя, или за час их слишком много',
      content: error,
    },
    503: { description: 'Расчёт сроков дольше предела', content: error },
  },
});

export function adminDictImportPreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminDictImportPreviewRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const table = await tableOf(c);
    const t = await translator(deps);
    // Сравнение обходит все организации (сроки) — по очереди предпросмотров пользователя.
    return withPreviewSlot(deps, c, async () => {
      try {
        await adminTx(deps, c, async (tx) => {
          throw new DryRun(await runImport(tx, dict, table, t));
        });
      } catch (err) {
        if (err instanceof DryRun) return c.json(await withDues(deps, err.outcome), 200);
        throw err;
      }
      throw new Error('сравнение без результата');
    });
  };
}

export const adminDictImportApplyRoute = createRoute({
  method: 'post',
  path: `${IO_PATH}/apply`,
  tags: ['platform-dicts'],
  summary: '«ОК, применить»: записать строки без ошибок',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam, query: AdminDictImportApplyQuery, body: fileBody },
  responses: {
    200: {
      description: 'Запись «Загрузок» и что было в файле',
      content: json(AdminDictImportApplied),
    },
    ...uploadResponses,
    409: {
      description: 'Справочник или файл изменились после сравнения; нечего применять',
      content: error,
    },
  },
});

const loadBody = (x: DictLoadRecord): AdminDictLoad => ({
  ...x,
  at: x.at.toISOString(),
  rolledBackAt: x.rolledBackAt?.toISOString() ?? null,
});

/**
 * «ОК, применить»: файл разбирается и проверяется заново; справочник или файл другие, чем при
 * сравнении, — 409, сравнить заново. Записываются строки без ошибок; загрузка — в «Загрузки» и
 * строкой «Истории изменений» справочника.
 */
export function adminDictImportApplyHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminDictImportApplyRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const { stamp } = c.req.valid('query');
    const table = await tableOf(c);
    const t = await translator(deps);
    const body = await adminTx(deps, c, async (tx) => {
      await lockDictLoads(tx);
      const outcome = await runImport(tx, dict, table, t);
      const { preview } = outcome;
      // ОТКЛОНЕНИЕ: docs/deviations.md#Д-16 — справочник или файл изменились после сравнения.
      if (preview.stamp !== stamp) importFail('import_changed', 409);
      if (!preview.add.length && !preview.change.length && !preview.off.length) {
        importFail('import_nothing', 409);
      }
      const id = await insertDictLoad(tx, {
        dict,
        rows: preview.rows,
        errors: preview.errors.length,
        changed: preview.change.length,
        disabled: preview.off.length,
        before: outcome.before,
        added: outcome.added,
      });
      const queued = outcome.redue ? await enqueueDuesRecalc(tx, outcome.redue) : undefined;
      return { load: loadBody((await getDictLoad(tx, id))!), preview, queued };
    });
    // Сроки несданных отчётов — после записи загрузки, каждая организация своей транзакцией.
    const { reports, orgs, pending } = await recalcQueued(deps, body.queued);
    return c.json(
      { load: body.load, preview: { ...body.preview, dues: { reports, orgs } }, pending },
      200,
    );
  };
}

/* ───────────── Загрузки ───────────── */

const LOADS_PATH = '/admin/platform-dict-loads';

export const listDictLoadsRoute = createRoute({
  method: 'get',
  path: LOADS_PATH,
  tags: ['platform-dicts'],
  summary: '«Загрузки»: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: { description: 'Загрузки справочников из Excel', content: json(AdminDictLoadList) },
    ...listQueryResponses,
    ...denied,
  },
});

export function listDictLoadsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listDictLoadsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listDictLoadsPage(tx, query, t),
    );
    return c.json({ ...page, items: page.rows.map(loadBody) }, 200);
  };
}

export const dictLoadValuesRoute = createRoute({
  method: 'get',
  path: `${LOADS_PATH}/values`,
  tags: ['platform-dicts'],
  summary: '«Загрузки»: значения столбца для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с числом загрузок', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function dictLoadValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof dictLoadValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listDictLoadValues(tx, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const exportDictLoadsRoute = createRoute({
  method: 'get',
  path: `${LOADS_PATH}/export`,
  tags: ['platform-dicts'],
  summary: '«Загрузки» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel с загрузками под фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportDictLoadsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportDictLoadsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportDictLoads(tx, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('pdicts.loads.file'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

export const rollbackDictLoadRoute = createRoute({
  method: 'post',
  path: `${LOADS_PATH}/{id}/rollback`,
  tags: ['platform-dicts'],
  summary: '«Откатить» последнюю загрузку',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminDictLoadIdParam },
  responses: {
    200: { description: 'Справочник вернулся к виду до загрузки', content: json(AdminDictLoad) },
    404: { description: 'Нет такой загрузки или она уже откачена', content: error },
    409: {
      description: 'Не последняя загрузка; значение изменили после неё; прежнее не сохраняется',
      content: error,
    },
    ...denied,
  },
});

/**
 * «Откатить» (прототип rollbackLoad): только последнюю загрузку; значение, изменённое после неё, —
 * 409 с его названием, справочник не меняется.
 */
export function rollbackDictLoadHandler(
  deps: ApiDeps,
): RouteHandler<typeof rollbackDictLoadRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await translator(deps);
    // Отказ — внутри транзакции: уже восстановленные значения откатываются вместе с ней.
    const rolled = await adminTx(deps, c, async (tx) => {
      const result = await rollbackDictLoad(tx, id);
      if (result.ok) {
        return { ...result, queued: result.redue ? await enqueueDuesRecalc(tx, result.redue) : '' };
      }
      if (result.reason === 'not_found') {
        return apiFail(404, 'not_found', 'Загрузка не найдена или уже откачена');
      }
      if (result.reason === 'not_last') {
        return apiFail(409, 'load_not_last', t('err.load_not_last'));
      }
      const { name } = result;
      const code = result.reason === 'changed_after' ? 'load_changed_after' : 'load_restore_failed';
      return apiFail(409, code, t(`err.${code}`, { name }), { name });
    });
    await recalcQueued(deps, rolled.queued || undefined);
    return c.json(loadBody(rolled.load), 200);
  };
}
