import { randomUUID } from 'node:crypto';
import {
  cancelDmConsole,
  dmErrorOf,
  dmSchemaColumns,
  explainDmConsole,
  releaseRateLimit,
  runDmConsole,
  takeRateLimit,
  withUserContext,
  writePlatformHistory,
  type DmResult,
  type RateLimit,
} from '@buhuchet/db';
import {
  bishkekDate,
  dmBind,
  dmConsoleParamTypes,
  dmQueryParamNames,
  dmQueryParseText,
  dmQueryProblem,
  dmRuleQueryProblem,
  EXPORT_ROWS_LIMIT,
  formatText,
  type DmQueryProblem,
  type HistoryChange,
} from '@buhuchet/domain';
import {
  ApiError,
  DM_CONSOLE_ROWS,
  DmConsoleExport,
  DmConsoleInput,
  DmConsolePlan,
  DmConsoleResult,
  DmConsoleStopped,
  DmSchemaMap,
  type DmSchemaTable,
} from '@buhuchet/shared';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { HTTPException } from 'hono/http-exception';
import { apiError, apiFail } from '../../errors';
import {
  exportRateResponses,
  releaseExportSlot,
  takeExportSlot,
  xlsxContent,
  xlsxResponse,
} from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { dmSqlProblemText } from './run';
import { dmCheckRules } from './sql-check';

/*
 * Консоль запросов «Витрины данных» Админки (доработки 27.11.2026: консоль запросов, блоки 1–2; этап 0,
 * П2–П3; docs/decisions.md п. О-68). Только администратор платформы, обычный вход (блок 2, пункт 10).
 * Путь «Выполнить»: проверка текста (`dmQueryProblem`: один оператор, SELECT или WITH, параметры) →
 * разборщик PostgreSQL по правилам консоли (`dmSqlRules('console')`: ожидание, блокировки, запрос из
 * строки, журнал, файлы, другие базы, настройки, сигналы — отказ) → место консоли (одно на сайт, своё,
 * места «Показать» не трогает) → `runDmConsole` (роль шаблонов Админки, только чтение, без секретов,
 * 60 с) → строка журнала консоли (история платформы, «Запрос консоли»). Экран — этап 1 (П4).
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });

/**
 * Место консоли на весь сайт (блок 2, пункт 3): одно, занято дольше предела запроса (60 с) — если
 * процесс упал, место отпустится само через `leaseSeconds`. Второй администратор ждёт (429).
 */
export const DM_CONSOLE_SLOT: RateLimit = {
  kind: 'dm_console',
  max: 1_000_000,
  windowSeconds: 60,
  leaseSeconds: 75,
};

/** Код ошибки PostgreSQL «запрос отменён» — по пределу времени или по «Остановить». */
const QUERY_CANCELED = '57014';

const sqlFails = {
  400: {
    description:
      'Текст не годится: пусто, не SELECT, два оператора, кавычки и скобки (`dm_sql_*`), запрещённая функция (`dm_console_forbidden`), ошибка базы (`dm_console_error`), неверный параметр',
    content: error,
  },
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;

export const CONSOLE_ROUTES = {
  run: createRoute({
    method: 'post',
    path: '/admin/dm/console/run',
    tags: ['admin'],
    summary: 'Консоль «Витрины данных» → «Выполнить»: один оператор, до 1 000 строк, до 60 с',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmConsoleInput), required: true } },
    responses: {
      200: { description: 'Результат запроса', content: json(DmConsoleResult) },
      ...sqlFails,
      409: { description: 'Запрос остановлен («Остановить»)', content: error },
      429: { description: 'Идёт запрос консоли другого администратора', content: error },
      503: { description: 'Запрос выполнялся дольше 60 секунд', content: error },
    },
  }),
  explain: createRoute({
    method: 'post',
    path: '/admin/dm/console/explain',
    tags: ['admin'],
    summary: 'Консоль → «План запроса»: оценка базой без выполнения (EXPLAIN)',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmConsoleInput), required: true } },
    responses: {
      200: { description: 'План запроса (EXPLAIN FORMAT JSON)', content: json(DmConsolePlan) },
      ...sqlFails,
    },
  }),
  stop: createRoute({
    method: 'post',
    path: '/admin/dm/console/stop',
    tags: ['admin'],
    summary: 'Консоль → «Остановить»: отменить свой идущий запрос консоли',
    middleware: [requirePlatformAdmin] as const,
    responses: {
      200: { description: 'Сколько запросов отменено', content: json(DmConsoleStopped) },
      401: { description: 'Нет входа', content: error },
      403: { description: 'Не администратор платформы', content: error },
    },
  }),
  export: createRoute({
    method: 'post',
    path: '/admin/dm/console/export',
    tags: ['admin'],
    summary: 'Консоль → «В Excel»: файл .xlsx до 50 000 строк, тем же путём, что «Вывод»',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmConsoleExport), required: true } },
    responses: {
      200: { description: 'Файл .xlsx', content: xlsxContent },
      ...sqlFails,
      409: { description: 'Запрос остановлен («Остановить»)', content: error },
      ...exportRateResponses,
      503: { description: 'Запрос выполнялся дольше 60 секунд', content: error },
    },
  }),
  schema: createRoute({
    method: 'get',
    path: '/admin/dm/console/schema',
    tags: ['admin'],
    summary: 'Карта базы для подсказок консоли: таблицы и поля, открытые роли шаблонов Админки',
    middleware: [requirePlatformAdmin] as const,
    responses: {
      200: { description: 'Таблицы, поля, связи, названия и описания', content: json(DmSchemaMap) },
      401: { description: 'Нет входа', content: error },
      403: { description: 'Не администратор платформы', content: error },
    },
  }),
} as const;

type Tr = (key: string, values?: Record<string, string | number>) => string;

/** Готовый к запуску текст консоли: проверки и разборщик; отказ — 400 с причиной словами. */
interface Prepared {
  text: string;
  params: (string | null)[];
  names: string[];
}

/** Отказ разборщика или проверки — словами словаря консоли. */
function sqlRefusal(tr: Tr, p: DmQueryProblem): never {
  if (p.code === 'forbidden') {
    apiFail(400, 'dm_console_forbidden', tr('err.dm_console_forbidden', { word: p.word }), {
      word: p.word,
    });
  }
  apiFail(400, `dm_sql_${p.code}`, dmSqlProblemText(tr, p), { field: 'query' });
}

async function prepare(
  deps: ApiDeps,
  tr: Tr,
  input: DmConsoleInput,
  refused: (why: string) => Promise<void>,
): Promise<Prepared> {
  const fail = async (p: DmQueryProblem): Promise<never> => {
    await refused(dmSqlProblemText(tr, p));
    sqlRefusal(tr, p);
  };
  const first = dmQueryProblem(input.query);
  if (first) return fail(first);
  const text = dmQueryParseText(input.query);
  if (text === null) return fail({ code: 'parens' });
  const rules = await dmCheckRules(text, 'console');
  if (!rules.ok) {
    // Без разборщика консоль не работает: проверить запрос нечем.
    if ('unavailable' in rules) return fail({ code: 'syntax', error: rules.message });
    return fail(dmRuleQueryProblem(rules.problem));
  }
  const names = dmQueryParamNames(input.query) as string[];
  const types = dmConsoleParamTypes(names, input.types);
  const defs = names.map((k, i) => ({ k, type: types[i]!, req: false, def: null }));
  const bound = dmBind(input.query, defs, input.params, bishkekDate(deps.clock.now()));
  if (!bound.ok) {
    if (bound.error === 'sql') return fail({ code: bound.problem } as DmQueryProblem);
    await refused(formatText(tr('err.dm_bad_param'), { param: bound.param }));
    apiFail(400, 'dm_bad_param', tr('err.dm_bad_param', { param: bound.param }), {
      param: bound.param,
      why: bound.why,
    });
  }
  return { text: bound.text, params: bound.params, names };
}

/** Итог запуска для журнала консоли. */
type Outcome = 'ok' | 'error' | 'timeout' | 'stopped' | 'refused';

export function consoleHandlers(deps: ApiDeps) {
  const adminOf = (c: Context<AppEnv>) => c.get('session')!.userId;

  /** Строка журнала консоли (блок 2, пункт 9): кто и когда — из контекста, своей транзакцией. */
  async function journal(
    adminId: string,
    action: 'dm_console_run' | 'dm_console_export',
    input: DmConsoleInput,
    outcome: Outcome,
    extra: { rows?: number; ms?: number; error?: string },
  ) {
    const changes: HistoryChange[] = [
      { field: 'query', to: input.query },
      { field: 'params', to: input.params },
      { field: 'outcome', to: outcome },
    ];
    if (extra.rows !== undefined) changes.push({ field: 'rows', to: extra.rows });
    if (extra.ms !== undefined) changes.push({ field: 'ms', to: extra.ms });
    if (extra.error) changes.push({ field: 'error', to: extra.error.slice(0, 2000) });
    await withUserContext(deps.db, adminId, (tx) =>
      writePlatformHistory(tx, { entity: 'dm_console', entityId: randomUUID(), action, changes }),
    );
  }

  /** Выполнить на месте консоли; ошибки базы — ответ словами и строка журнала. */
  async function execute(
    adminId: string,
    tr: Tr,
    action: 'dm_console_run' | 'dm_console_export',
    input: DmConsoleInput,
    p: Prepared,
    maxRows: number,
  ): Promise<DmResult> {
    const slot = await takeRateLimit(deps.db, DM_CONSOLE_SLOT, 'site');
    if (!slot.ok) apiFail(429, 'dm_console_busy', tr('err.dm_console_busy'));
    const started = Date.now();
    try {
      const res = await runDmConsole(deps.db, adminId, {
        text: p.text,
        params: p.params,
        maxRows,
      });
      await journal(adminId, action, input, 'ok', { rows: res.rows.length, ms: res.ms });
      return res;
    } catch (err) {
      const pg = dmErrorOf(err);
      if (!pg) throw err;
      if (pg.code === QUERY_CANCELED) {
        // Отмену по пределу и по «Остановить» база различает только временем.
        const stopped = Date.now() - started < 59_000;
        await journal(adminId, action, input, stopped ? 'stopped' : 'timeout', {});
        if (stopped) apiFail(409, 'dm_console_stopped', tr('err.dm_console_stopped'));
        throw new HTTPException(503, {
          res: Response.json(apiError('dm_console_timeout', tr('err.dm_console_timeout')), {
            status: 503,
          }),
        });
      }
      const detail = `${pg.code}: ${pg.message}`;
      await journal(adminId, action, input, 'error', { error: detail });
      apiFail(400, 'dm_console_error', tr('err.dm_console_error', { error: detail }), {
        code: pg.code,
      });
    } finally {
      await releaseRateLimit(deps.db, DM_CONSOLE_SLOT, 'site', slot.ticket).catch((err: unknown) =>
        deps.logger.error({ err }, 'консоль витрины: место запуска не отпущено'),
      );
    }
  }

  const texts = async () => {
    const t = await serverTexts(deps);
    const tr: Tr = (key, values) => formatText(t(key), values ?? {});
    return { t, tr };
  };

  const run: RouteHandler<typeof CONSOLE_ROUTES.run, AppEnv> = async (c) => {
    const adminId = adminOf(c);
    const input = c.req.valid('json');
    const { tr } = await texts();
    const p = await prepare(deps, tr, input, (why) =>
      journal(adminId, 'dm_console_run', input, 'refused', { error: why }),
    );
    const res = await execute(adminId, tr, 'dm_console_run', input, p, DM_CONSOLE_ROWS);
    return c.json(
      {
        columns: res.columns,
        rows: res.rows,
        more: res.more,
        max: DM_CONSOLE_ROWS,
        ms: res.ms,
        params: p.names,
      },
      200,
    );
  };

  const explain: RouteHandler<typeof CONSOLE_ROUTES.explain, AppEnv> = async (c) => {
    const adminId = adminOf(c);
    const input = c.req.valid('json');
    const { tr } = await texts();
    const p = await prepare(deps, tr, input, async () => {});
    try {
      const plan = await explainDmConsole(deps.db, adminId, { text: p.text, params: p.params });
      return c.json({ plan }, 200);
    } catch (err) {
      const pg = dmErrorOf(err);
      if (!pg) throw err;
      const detail = `${pg.code}: ${pg.message}`;
      apiFail(400, 'dm_console_error', tr('err.dm_console_error', { error: detail }), {
        code: pg.code,
      });
    }
  };

  const stop: RouteHandler<typeof CONSOLE_ROUTES.stop, AppEnv> = async (c) => {
    const stopped = await cancelDmConsole(deps.db, adminOf(c));
    return c.json({ stopped }, 200);
  };

  const exportFile: RouteHandler<typeof CONSOLE_ROUTES.export, AppEnv> = async (c) => {
    const adminId = adminOf(c);
    const input = c.req.valid('json');
    const { t, tr } = await texts();
    const p = await prepare(deps, tr, input, (why) =>
      journal(adminId, 'dm_console_export', input, 'refused', { error: why }),
    );
    // Место выгрузки — раньше места консоли: выгрузки человека за час считаются, как у «Вывода».
    const ticket = await takeExportSlot(deps, adminId);
    try {
      const res = await execute(adminId, tr, 'dm_console_export', input, p, EXPORT_ROWS_LIMIT);
      return xlsxResponse(c, {
        title: t('dm.console.title'),
        today: deps.clock.now(),
        columns: res.columns.map((label) => ({ label, type: 'text' as const })),
        rows: res.rows.map((row) =>
          row.map((v) =>
            v === null || v === undefined
              ? null
              : typeof v === 'number'
                ? v
                : typeof v === 'object'
                  ? JSON.stringify(v)
                  : String(v),
          ),
        ),
        more: res.more,
        total: res.rows.length,
        t: (label) => label,
      });
    } finally {
      await releaseExportSlot(deps, adminId, ticket);
    }
  };

  const schema: RouteHandler<typeof CONSOLE_ROUTES.schema, AppEnv> = async (c) => {
    const adminId = adminOf(c);
    const [rows, docs] = await Promise.all([
      dmSchemaColumns(deps.db, adminId),
      deps.techDocs?.load() ?? Promise.resolve(null),
    ]);
    const described = new Map((docs?.schema.tables ?? []).map((t) => [t.name, t]));
    const groups = new Map((docs?.schema.groups ?? []).map((g) => [g.id, g.ru]));
    const tables: DmSchemaTable[] = [];
    for (const r of rows) {
      let table = tables[tables.length - 1];
      if (!table || table.name !== r.table) {
        const d = described.get(r.table);
        table = {
          name: r.table,
          group: d?.group ? (groups.get(d.group) ?? d.group) : null,
          title: d?.ru || null,
          description: d?.desc || null,
          orgVisible: r.orgVisible,
          fields: [],
        };
        tables.push(table);
      }
      const f = described.get(r.table)?.columns.find((col) => col.name === r.column);
      table.fields.push({
        name: r.column,
        type: r.type,
        title: f?.ru || null,
        description: f?.desc || null,
        ref: r.refTable && r.refColumn ? { table: r.refTable, field: r.refColumn } : null,
      });
    }
    const meta = docs?.schema.meta;
    return c.json(
      {
        tables,
        described: meta ? `${meta.schemaVersion ?? ''} ${meta.updated}`.trim() || null : null,
      },
      200,
    );
  };

  return { run, explain, stop, exportFile, schema };
}
