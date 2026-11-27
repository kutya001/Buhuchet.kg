import { parsePgSql } from '@buhuchet/adapters/sql-parser';
import {
  createDmConsoleQuery,
  deleteDmConsoleQuery,
  dmConsoleHistory,
  listDmConsoleQueries,
  updateDmConsoleQuery,
  withUserContext,
  type Tx,
} from '@buhuchet/db';
import {
  dmQueryProblem,
  dmRuleQueryProblem,
  dmSqlLex,
  dmSqlQuickMarks,
  dmSqlRules,
  dmSqlStatements,
  formatText,
  type DmQueryProblem,
} from '@buhuchet/domain';
import {
  ApiError,
  DM_CONSOLE_HISTORY_MAX,
  DmConsoleCheck,
  DmConsoleCheckInput,
  DmConsoleHistory,
  DmConsoleQuery,
  DmConsoleQueryList,
  DmConsoleQuerySave,
  DmConsoleQueryUpdate,
  type DmConsoleProblem,
} from '@buhuchet/shared';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { versionedSaveResponses } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { dmSqlProblemText } from './run';

/*
 * Консоль запросов «Витрины данных», этап 1 (доработки 27.11.2026: консоль запросов, блоки 1, 3, 4; П4–П5;
 * docs/decisions.md п. О-69). Только администратор платформы, каждый запрос — в `withUserContext`:
 * «Мои запросы» видит только автор (RLS `dm_console_queries_own`), «История» — свои последние 100 запусков
 * из журнала консоли, «проверка по ходу набора» — разборщик PostgreSQL на сервере (в браузер он не идёт),
 * текст не выполняется и в журнал не пишется.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });

const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const invalid = { 400: { description: 'Неверные данные', content: error } } as const;

const IdParam = z.object({ id: z.uuid() });
const VersionQuery = z.object({ version: z.coerce.number().int().positive() });

export const CONSOLE_QUERY_ROUTES = {
  list: createRoute({
    method: 'get',
    path: '/admin/dm/console/queries',
    tags: ['admin'],
    summary: 'Консоль → «Мои запросы»: свои сохранённые запросы',
    middleware: [requirePlatformAdmin] as const,
    responses: {
      200: {
        description: 'Свои запросы, последние изменённые — сверху',
        content: json(DmConsoleQueryList),
      },
      ...denied,
    },
  }),
  create: createRoute({
    method: 'post',
    path: '/admin/dm/console/queries',
    tags: ['admin'],
    summary: 'Консоль → «Сохранить в Мои запросы»',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmConsoleQuerySave), required: true } },
    responses: {
      201: { description: 'Сохранено', content: json(DmConsoleQuery) },
      ...invalid,
      ...denied,
    },
  }),
  update: createRoute({
    method: 'put',
    path: '/admin/dm/console/queries/{id}',
    tags: ['admin'],
    summary: 'Консоль → изменить свой запрос «Моих запросов» (с версией)',
    middleware: [requirePlatformAdmin] as const,
    request: { params: IdParam, body: { content: json(DmConsoleQueryUpdate), required: true } },
    responses: {
      200: { description: 'Изменено', content: json(DmConsoleQuery) },
      ...invalid,
      ...denied,
      ...versionedSaveResponses,
    },
  }),
  remove: createRoute({
    method: 'delete',
    path: '/admin/dm/console/queries/{id}',
    tags: ['admin'],
    summary: 'Консоль → удалить свой запрос «Моих запросов» (с версией)',
    middleware: [requirePlatformAdmin] as const,
    request: { params: IdParam, query: VersionQuery },
    responses: {
      204: { description: 'Удалено' },
      ...invalid,
      ...denied,
      ...versionedSaveResponses,
    },
  }),
  history: createRoute({
    method: 'get',
    path: '/admin/dm/console/history',
    tags: ['admin'],
    summary: 'Консоль → «История»: свои последние 100 запусков из журнала консоли',
    middleware: [requirePlatformAdmin] as const,
    responses: {
      200: { description: 'Запуски, новые — сверху', content: json(DmConsoleHistory) },
      ...denied,
    },
  }),
  check: createRoute({
    method: 'post',
    path: '/admin/dm/console/check',
    tags: ['admin'],
    summary:
      'Консоль → проверка по ходу набора: ошибки разборщика с местом в тексте, без выполнения',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmConsoleCheckInput), required: true } },
    responses: {
      200: { description: 'Ошибки текста (пусто — ошибок нет)', content: json(DmConsoleCheck) },
      ...invalid,
      ...denied,
    },
  }),
} as const;

/** Операторов в одном тексте проверка смотрит не больше: остальные — без подчёркивания. */
export const DM_CONSOLE_CHECK_STATEMENTS = 20;

type Tr = (key: string, values?: Record<string, string | number>) => string;

/**
 * Текст оператора для разборщика: параметр `:имя` → `$n` той же длины (дополняется пробелами), чтобы
 * место ошибки в ответе разборщика совпало с местом в тексте администратора; длиннее имени номер —
 * сдвиг запоминается.
 */
function parseTextOf(stmt: string): { text: string; toSource: (pos: number) => number } {
  const names: string[] = [];
  const shifts: { at: number; by: number }[] = [];
  let text = '';
  for (const t of dmSqlLex(stmt)) {
    if (t.kind === 'param' && t.text.startsWith(':')) {
      let k = names.indexOf(t.text);
      if (k < 0) k = names.push(t.text) - 1;
      const num = `$${k + 1}`;
      if (num.length <= t.text.length) text += num.padEnd(t.text.length, ' ');
      else {
        shifts.push({ at: text.length + t.text.length, by: num.length - t.text.length });
        text += num;
      }
    } else text += t.text;
  }
  return {
    text,
    toSource: (pos) => {
      let p = pos;
      for (const s of shifts) if (pos >= s.at) p -= s.by;
      return Math.max(0, p);
    },
  };
}

/** Место в дереве разбора — в байтах UTF-8; на экране — знаки. */
function charAt(text: string, bytes: number): number {
  const enc = new TextEncoder();
  let b = 0;
  let i = 0;
  for (const ch of text) {
    if (b >= bytes) break;
    b += enc.encode(ch).length;
    i += ch.length;
  }
  return i;
}

/** Код быстрой проверки → причина окна шаблона (те же тексты словаря). */
const quickProblem = (code: string): DmQueryProblem =>
  code === 'unclosed_paren' || code === 'extra_paren' ? { code: 'parens' } : { code: 'unclosed' };

/** Ошибки текста консоли с местом: быстрая проверка, правила текста, разборщик и правила консоли. */
export async function dmConsoleProblems(sql: string, tr: Tr): Promise<DmConsoleProblem[]> {
  const out: DmConsoleProblem[] = [];
  const push = (from: number, to: number, p: DmQueryProblem) =>
    out.push({
      from,
      to: Math.max(to, from + 1),
      code: `dm_sql_${p.code}`,
      message: dmSqlProblemText(tr, p),
    });
  const quick = dmSqlQuickMarks(sql);
  for (const m of quick) push(m.from, m.to, quickProblem(m.code));
  if (quick.length) return out;
  for (const s of dmSqlStatements(sql).slice(0, DM_CONSOLE_CHECK_STATEMENTS)) {
    const stmt = sql.slice(s.from, s.to);
    const first = dmQueryProblem(stmt);
    // Позиционный «$1» и прочее, что видно без разборщика, — подчёркивается начало оператора.
    if (first && first.code !== 'syntax' && first.code !== 'forbidden') {
      const head = dmSqlLex(stmt).find((t) => t.kind !== 'space' && t.kind !== 'comment');
      push(s.from, s.from + (head?.text.length ?? 1), first);
      continue;
    }
    const { text, toSource } = parseTextOf(stmt);
    const parsed = await parsePgSql(text);
    if (!parsed.ok) {
      // Разборщика нет — подчёркивать нечем: проверит «Выполнить».
      if (parsed.unavailable) return out;
      const at = s.from + toSource(parsed.position);
      const word = dmSqlLex(sql.slice(at)).find((t) => t.kind !== 'space');
      push(at, at + (word?.text.length ?? 1), { code: 'syntax', error: parsed.message });
      continue;
    }
    const rule = dmSqlRules(parsed.tree, 'console');
    if (rule) {
      const at = s.from + toSource(charAt(text, rule.position));
      const word = dmSqlLex(sql.slice(at)).find((t) => t.kind !== 'space');
      const p = dmRuleQueryProblem(rule);
      if (p.code === 'forbidden') {
        out.push({
          from: at,
          to: at + (word?.text.length ?? 1),
          code: 'dm_console_forbidden',
          message: tr('err.dm_console_forbidden', { word: p.word }),
        });
      } else push(at, at + (word?.text.length ?? 1), p);
    }
  }
  return out;
}

export function consoleQueryHandlers(deps: ApiDeps) {
  const adminOf = (c: Context<AppEnv>) => c.get('session')!.userId;
  const asAdmin = <T>(c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>) =>
    withUserContext(deps.db, adminOf(c), fn);

  const list: RouteHandler<typeof CONSOLE_QUERY_ROUTES.list, AppEnv> = async (c) =>
    c.json({ items: await asAdmin(c, (tx) => listDmConsoleQueries(tx)) }, 200);

  const create: RouteHandler<typeof CONSOLE_QUERY_ROUTES.create, AppEnv> = async (c) => {
    const v = c.req.valid('json');
    return c.json(await asAdmin(c, (tx) => createDmConsoleQuery(tx, v)), 201);
  };

  const update: RouteHandler<typeof CONSOLE_QUERY_ROUTES.update, AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const v = c.req.valid('json');
    return c.json(await asAdmin(c, (tx) => updateDmConsoleQuery(tx, id, v)), 200);
  };

  const remove: RouteHandler<typeof CONSOLE_QUERY_ROUTES.remove, AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    await asAdmin(c, (tx) => deleteDmConsoleQuery(tx, id, version));
    return c.body(null, 204);
  };

  const history: RouteHandler<typeof CONSOLE_QUERY_ROUTES.history, AppEnv> = async (c) =>
    c.json({ items: await asAdmin(c, (tx) => dmConsoleHistory(tx, DM_CONSOLE_HISTORY_MAX)) }, 200);

  const check: RouteHandler<typeof CONSOLE_QUERY_ROUTES.check, AppEnv> = async (c) => {
    const { query } = c.req.valid('json');
    const t = await serverTexts(deps);
    const tr: Tr = (key, values) => formatText(t(key), values ?? {});
    return c.json({ problems: await dmConsoleProblems(query, tr) }, 200);
  };

  return { list, create, update, remove, history, check };
}
