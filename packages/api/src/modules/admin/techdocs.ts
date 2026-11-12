import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  exportApiMethods,
  listApiMethodsPage,
  listApiMethodValues,
  permissionCatalog,
  withUserContext,
  type ApiMethodListRow,
  type ApiMethodPageRow,
} from '@buhuchet/db';
import {
  AdminApiMethodCard,
  AdminApiMethodList,
  AdminApiSchemaFields,
  AdminTechDocsMeta,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  API_DOC_ACCESS,
  type AdminApiMethod,
  type ApiDocFieldRow,
} from '@buhuchet/shared';
import type { Translate, UiTextKey } from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { translateOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import {
  methodTables,
  schemaPageHtml,
  tableNames,
  type ApiDocField,
  type ApiDocMethod,
  type ApiDocPart,
  type ApiDocs,
  type TechDocs,
} from './techdocs-source';

// Админка → «Техническая документация» (ТЗ «Админка» → «Техническая документация», решение заказчика
// 09.11.2026; прототип admin/techdocs.js): схема базы (страница db/index.html внутри модуля) и описание
// API со связями «метод → таблицы → SQL». Только администратор платформы и только чтение: из модуля
// ничего не меняется в базе и не вызывается ни один метод. Данные собраны при сборке сайта
// (techdocs-source.ts).

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const missing = {
  404: { description: 'Описание не собрано или такого метода нет', content: error },
} as const;

const P = '/admin/tech-docs';

/** Данные модуля; не собраны — 404 «Не удалось прочитать описание». */
async function docsOf(deps: ApiDeps): Promise<TechDocs> {
  const docs = (await deps.techDocs?.load()) ?? null;
  if (!docs) apiFail(404, 'techdocs_missing', 'Не удалось прочитать описание API и схемы базы');
  return docs!;
}

/** Описание API собрано по более старой версии, чем схема базы (прототип tdVer). */
function staleApi(docs: TechDocs): boolean {
  const api = docs.api.meta;
  const schema = docs.schema.meta;
  return (
    (api.schemaVersion ?? 0) < (schema.schemaVersion ?? 0) ||
    api.date < String(schema.updated ?? '')
  );
}

/** Подпись доступа (прототип TD_ACC); незнакомый код — как есть. */
const accessText = (t: Translate, code: string): string =>
  (API_DOC_ACCESS as readonly string[]).includes(code) ? t(`tdocs.acc.${code}` as UiTextKey) : code;

const fieldRow = (f: ApiDocField): ApiDocFieldRow => ({
  name: f.n,
  type: f.t,
  required: f.req === true,
  nullable: f.null === true,
  constraints: f.c ?? '',
  description: f.d ?? '',
});

/** Имена схем Zod из типов полей, у которых есть разобранные поля (прототип tdTypeHtml). */
function knownSchemas(api: ApiDocs, fields: readonly ApiDocField[]): string[] {
  const names = new Set<string>();
  for (const f of fields) {
    for (const [name] of f.t.matchAll(/\b[A-Z]\w+\b/g)) {
      if (Object.hasOwn(api.schemas, name)) names.add(name);
    }
  }
  return [...names];
}

export const techDocsMetaRoute = createRoute({
  method: 'get',
  path: P,
  tags: ['admin'],
  summary: 'Техническая документация: версия описания, число таблиц и методов',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'По какой версии продукта собрано описание и таблицы для фильтра',
      content: { 'application/json': { schema: AdminTechDocsMeta } },
    },
    ...denied,
    ...missing,
  },
});

export function techDocsMetaHandler(deps: ApiDeps): RouteHandler<typeof techDocsMetaRoute, AppEnv> {
  return async (c) => {
    const docs = await docsOf(deps);
    const ru = tableNames(docs.schema);
    const collator = new Intl.Collator('ru', { numeric: true });
    const used = [...new Set(docs.api.methods.flatMap(methodTables))]
      .map((name) => ({ name, ru: ru(name) }))
      .sort((a, b) => collator.compare(a.ru, b.ru) || collator.compare(a.name, b.name));
    const { repo, branch, commit, date } = docs.api.meta;
    return c.json(
      {
        api: { repo, branch, commit, date, methods: docs.api.methods.length },
        schema: {
          version: docs.schema.meta.schemaVersion ?? null,
          updated: String(docs.schema.meta.updated ?? ''),
          tables: docs.schema.tables.length,
        },
        stale: staleApi(docs),
        tables: used,
      },
      200,
    );
  };
}

/* ───────────── «API»: список методов ───────────── */

const TableParam = z.string().trim().min(1).max(80).optional();

/** Строки списка: подписи раздела, доступа и прав — как на экране (по ним ищет поиск). */
async function methodRows(deps: ApiDeps, docs: TechDocs): Promise<ApiMethodListRow[]> {
  const t = await translateOf(deps);
  const perms = new Map((await permissionCatalog(deps.db)).map((p) => [p.id as string, p.name]));
  const ru = tableNames(docs.schema);
  return docs.api.methods.map((m) => {
    const tables = methodTables(m);
    return {
      id: m.id,
      m: m.m,
      p: m.p,
      sec: m.sec,
      secText: docs.api.sections[m.sec] ?? m.sec,
      sum: m.sum,
      acc: m.acc,
      accText: accessText(t, m.acc),
      perm: m.perm.map((p) => perms.get(p) ?? p).join(', '),
      writes: m.w.length > 0,
      writesText: t(m.w.length > 0 ? 'tdocs.yes' : 'tdocs.no'),
      tables,
      tablesRu: tables.map(ru),
      rate: m.rate,
      file: m.code[0]?.file ?? '',
    };
  });
}

const methodBody = (r: ApiMethodPageRow): AdminApiMethod => ({
  id: r.id,
  method: r.m,
  path: r.p,
  section: r.sec,
  summary: r.sum,
  access: r.acc,
  permissions: r.perm,
  tables: r.n,
  writes: r.w === 'yes',
  tableNames: r.tb,
  rate: r.rate,
  file: r.file,
});

export const listApiMethodsRoute = createRoute({
  method: 'get',
  path: `${P}/methods`,
  tags: ['admin'],
  summary: 'Техническая документация → «API»: страница списка методов',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams.extend({ table: TableParam }) },
  responses: {
    200: {
      description:
        'Методы API: сортировка, страница, фильтры, поиск и группы — на сервере; `table` — методы таблицы',
      content: { 'application/json': { schema: AdminApiMethodList } },
    },
    ...listQueryResponses,
    ...denied,
    ...missing,
  },
});

export function listApiMethodsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listApiMethodsRoute, AppEnv> {
  return async (c) => {
    const { table, ...params } = c.req.valid('query');
    const query = listQueryOf(params);
    const rows = await methodRows(deps, await docsOf(deps));
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listApiMethodsPage(tx, rows, query, table),
    );
    return c.json(
      {
        items: page.rows.map(methodBody),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const apiMethodValuesRoute = createRoute({
  method: 'get',
  path: `${P}/methods/values`,
  tags: ['admin'],
  summary: 'Значения столбца списка методов для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery.extend({ table: TableParam }) },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом методов',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
    ...missing,
  },
});

export function apiMethodValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof apiMethodValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, table } = c.req.valid('query');
    const rows = await methodRows(deps, await docsOf(deps));
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listApiMethodValues(tx, rows, col, q, table),
    );
    return c.json(values, 200);
  };
}

export const exportApiMethodsRoute = createRoute({
  method: 'get',
  path: `${P}/methods/export`,
  tags: ['admin'],
  summary: 'Список методов API в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams.extend({ table: TableParam }) },
  responses: {
    200: { description: 'Файл Excel с методами под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
    ...missing,
  },
});

export function exportApiMethodsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportApiMethodsRoute, AppEnv> {
  return async (c) => {
    const { table, ...params } = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    const rows = await methodRows(deps, await docsOf(deps));
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportApiMethods(tx, rows, query, keys, table),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tdocs.export.title'),
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

/* ───────────── Карточка метода ───────────── */

const part = (api: ApiDocs, p: ApiDocPart | undefined) =>
  p && p.f.length ? { schema: p.s ?? '', fields: p.f.map(fieldRow) } : null;

function methodCard(docs: TechDocs, m: ApiDocMethod): AdminApiMethodCard {
  const { api, schema } = docs;
  const ru = tableNames(schema);
  const rls = new Map(schema.tables.map((t) => [t.name, t.rls ?? '']));
  const ref = (name: string) => ({ name, ru: ru(name) });
  const body = m.req.body;
  const fields = [
    ...(m.req.params?.f ?? []),
    ...(m.req.query?.f ?? []),
    ...(m.req.headers?.f ?? []),
    ...(body?.f ?? []),
    ...m.res.flatMap((r) => (r.s ? (api.schemas[r.s] ?? []) : [])),
  ];
  const example = body?.ex;
  const hasExample =
    example !== null && typeof example === 'object' && Object.keys(example).length > 0;
  return {
    id: m.id,
    method: m.m,
    path: m.p,
    section: api.sections[m.sec] ?? m.sec,
    summary: m.sum,
    description: m.desc ?? '',
    access: m.acc,
    permissions: m.perm,
    rate: m.rate,
    request: {
      params: part(api, m.req.params),
      query: part(api, m.req.query),
      headers: part(api, m.req.headers),
      body: body
        ? {
            schema: body.s ?? '',
            fields: body.f.map(fieldRow),
            contentType: body.ct ?? '',
            example: hasExample ? JSON.stringify(example, null, 2) : null,
          }
        : null,
    },
    responses: m.res.map((r) => ({
      code: r.code,
      description: r.d,
      schema: r.s ?? '',
      fields: r.s && api.schemas[r.s] ? api.schemas[r.s]!.map(fieldRow) : null,
    })),
    reads: m.r.filter((name) => !m.w.includes(name)).map(ref),
    writes: m.w.map(ref),
    views: m.v.map((name) => ({
      name,
      migration: api.views[name]?.mig ?? '',
      reads: (api.views[name]?.r ?? []).map(ru),
    })),
    functions: m.fns,
    contexts: m.ctx,
    rls: methodTables(m).map((name) => ({ ...ref(name), rule: rls.get(name) ?? '' })),
    queries: m.q.flatMap((i) => {
      const q = api.sql[i];
      return q ? [{ kind: q.k, text: q.t, file: q.f, fn: q.fn, line: q.l }] : [];
    }),
    filtered: m.m === 'GET' && (m.req.query?.f.length ?? 0) > 0,
    code: m.code,
    repo: api.meta.repo,
    commit: api.meta.commit,
    schemas: knownSchemas(api, fields),
  };
}

export const apiMethodCardRoute = createRoute({
  method: 'get',
  path: `${P}/method`,
  tags: ['admin'],
  summary: 'Карточка метода API: запрос, ответы, таблицы, SQL, код',
  middleware: [requirePlatformAdmin] as const,
  // Номер метода — «GET /admin/users/{id}»: в адрес не помещается, поэтому параметром.
  request: { query: z.object({ id: z.string().min(1).max(300) }) },
  responses: {
    200: {
      description: 'Метод со связями: какие таблицы читает и меняет, какой SQL выполняет',
      content: { 'application/json': { schema: AdminApiMethodCard } },
    },
    400: { description: 'Неверный параметр', content: error },
    ...denied,
    ...missing,
  },
});

export function apiMethodCardHandler(
  deps: ApiDeps,
): RouteHandler<typeof apiMethodCardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('query');
    const docs = await docsOf(deps);
    const method = docs.api.methods.find((m) => m.id === id);
    if (!method) apiFail(404, 'not_found', 'Метод не найден в описании API');
    return c.json(methodCard(docs, method!), 200);
  };
}

export const apiSchemaFieldsRoute = createRoute({
  method: 'get',
  path: `${P}/zod`,
  tags: ['admin'],
  summary: 'Поля схемы Zod из описания API',
  middleware: [requirePlatformAdmin] as const,
  request: { query: z.object({ name: z.string().regex(/^[A-Za-z]\w{0,99}$/) }) },
  responses: {
    200: {
      description: 'Поля схемы: тип, обязательность, ограничения, описание',
      content: { 'application/json': { schema: AdminApiSchemaFields } },
    },
    400: { description: 'Неверный параметр', content: error },
    ...denied,
    ...missing,
  },
});

export function apiSchemaFieldsHandler(
  deps: ApiDeps,
): RouteHandler<typeof apiSchemaFieldsRoute, AppEnv> {
  return async (c) => {
    const { name } = c.req.valid('query');
    const { api } = await docsOf(deps);
    const fields = Object.hasOwn(api.schemas, name) ? api.schemas[name] : undefined;
    if (!fields) apiFail(404, 'not_found', 'Схема не найдена в описании API');
    return c.json(
      { name, fields: fields!.map(fieldRow), schemas: knownSchemas(api, fields!) },
      200,
    );
  };
}

/* ───────────── «Схема базы»: страница для рамки ───────────── */

/**
 * Страница схемы приходит из репозитория прототипа и работает в рамке без прав сайта: `sandbox` без
 * `allow-same-origin` (cookie и методы API ей недоступны), ничего не загружает и никуда не отправляет.
 * Показать её может только сам сайт.
 */
export const SCHEMA_PAGE_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

export const schemaPageRoute = createRoute({
  method: 'get',
  path: `${P}/schema-page`,
  tags: ['admin'],
  summary: 'Страница «База данных Buhuchet.kg» для рамки модуля',
  middleware: [requirePlatformAdmin] as const,
  request: { query: z.object({ theme: z.enum(['auto', 'light', 'dark']).default('auto') }) },
  responses: {
    200: {
      description: 'Страница схемы со встроенным описанием базы и картой «таблица → методы API»',
      content: { 'text/html': { schema: z.string() } },
    },
    400: { description: 'Неверный параметр', content: error },
    ...denied,
    ...missing,
  },
});

export function schemaPageHandler(deps: ApiDeps): RouteHandler<typeof schemaPageRoute, AppEnv> {
  return async (c) => {
    const { theme } = c.req.valid('query');
    const html = schemaPageHtml(await docsOf(deps), theme);
    if (html === null) apiFail(404, 'techdocs_missing', 'Не удалось прочитать страницу схемы базы');
    return c.body(html!, 200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': SCHEMA_PAGE_CSP,
      'x-frame-options': 'SAMEORIGIN',
    });
  };
}

/* ───────────── «Скачать OpenAPI» ───────────── */

const PRIMITIVES: Readonly<Record<string, Record<string, string>>> = {
  string: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  object: { type: 'object' },
  record: { type: 'object' },
  Uuid: { type: 'string', format: 'uuid' },
  IsoDate: { type: 'string', format: 'date' },
  'string(datetime)': { type: 'string', format: 'date-time' },
  RecordVersion: { type: 'integer' },
  Tyiyn: { type: 'integer', description: 'Деньги в тыйынах' },
  Count: { type: 'integer' },
  Positive: { type: 'integer' },
  Day: { type: 'integer' },
  Month: { type: 'integer' },
  YearMonth: { type: 'string' },
};

type Json = Record<string, unknown>;

function openApiType(type: string, api: ApiDocs): Json {
  const array = /^array<(.+)>$/.exec(type);
  if (array) return { type: 'array', items: openApiType(array[1]!, api) };
  if (type === 'array') return { type: 'array' };
  if (Object.hasOwn(PRIMITIVES, type)) return { ...PRIMITIVES[type] };
  if (Object.hasOwn(api.schemas, type)) return { $ref: `#/components/schemas/${type}` };
  return { type: 'string', description: type };
}

function openApiObject(fields: readonly ApiDocField[], api: ApiDocs): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const f of fields) {
    const p = openApiType(f.t, api);
    if (f.d) p.description = p.description ? `${String(p.description)}. ${f.d}` : f.d;
    if (f.null) p.nullable = true;
    properties[f.n] = p;
    if (f.req) required.push(f.n);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/**
 * openapi.json из описания API (прототип tdOpenApi): OpenAPI 3.1 с дополнительными полями у методов —
 * `x-tables` (таблицы чтения и записи), `x-access` (доступ), `x-permissions` (права).
 */
export function openApiDocument(api: ApiDocs, accessText: (code: string) => string): Json {
  const paths: Record<string, Json> = {};
  for (const m of api.methods) {
    const op: Json = {
      summary: m.sum,
      tags: [api.sections[m.sec] ?? m.sec],
      operationId: m.code[0]?.fn || m.id,
    };
    if (m.desc) op.description = m.desc;
    const parameters = (
      [
        ['params', 'path'],
        ['query', 'query'],
        ['headers', 'header'],
      ] as const
    ).flatMap(([key, place]) =>
      (m.req[key]?.f ?? []).map((f) => ({
        name: f.n,
        in: place,
        required: place === 'path' || f.req === true,
        schema: openApiType(f.t, api),
        ...(f.d ? { description: f.d } : {}),
      })),
    );
    if (parameters.length) op.parameters = parameters;
    const body = m.req.body;
    if (body) {
      op.requestBody = {
        required: true,
        content: {
          [body.ct || 'application/json']: {
            schema:
              body.s && Object.hasOwn(api.schemas, body.s)
                ? { $ref: `#/components/schemas/${body.s}` }
                : openApiObject(body.f, api),
          },
        },
      };
    }
    op.responses = Object.fromEntries(
      m.res.map((r) => [
        r.code,
        {
          description: r.d,
          ...(r.s
            ? {
                content: {
                  'application/json': {
                    schema: Object.hasOwn(api.schemas, r.s)
                      ? { $ref: `#/components/schemas/${r.s}` }
                      : { type: 'object', description: r.s },
                  },
                },
              }
            : {}),
        },
      ]),
    );
    op['x-access'] = accessText(m.acc);
    if (m.perm.length) op['x-permissions'] = m.perm;
    op['x-tables'] = { read: m.r, write: m.w };
    (paths[m.p] ??= {})[m.m.toLowerCase()] = op;
  }
  const { repo, branch, commit, date, note } = api.meta;
  return {
    openapi: '3.1.0',
    info: {
      title: 'Buhuchet.kg API',
      version: commit,
      description: `Описание API продукта ${repo}, ветка ${branch}, коммит ${commit} от ${date}. ${note}`,
    },
    servers: [{ url: '/api' }],
    paths,
    components: {
      schemas: Object.fromEntries(
        Object.entries(api.schemas).map(([name, fields]) => [name, openApiObject(fields, api)]),
      ),
    },
  };
}

export const techDocsOpenApiRoute = createRoute({
  method: 'get',
  path: `${P}/openapi`,
  tags: ['admin'],
  summary: '«Скачать OpenAPI»: openapi.json с таблицами, доступом и правами методов',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Документ OpenAPI 3.1 с полями x-tables, x-access, x-permissions у методов',
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
    ...denied,
    ...missing,
  },
});

export function techDocsOpenApiHandler(
  deps: ApiDeps,
): RouteHandler<typeof techDocsOpenApiRoute, AppEnv> {
  return async (c) => {
    const { api } = await docsOf(deps);
    const t = await translateOf(deps);
    c.header('content-disposition', 'attachment; filename="openapi.json"');
    return c.json(
      openApiDocument(api, (code) => accessText(t, code)),
      200,
    );
  };
}
