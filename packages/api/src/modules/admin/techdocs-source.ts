import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from '@hono/zod-openapi';

// Данные «Технической документации» (ТЗ «Админка» → «Техническая документация», решение заказчика
// 09.11.2026; прототип admin/techdocs.js): описание API со связями «метод → таблицы → SQL», описание
// базы и страница схемы. Их собирает scripts/build-techdocs.mjs при сборке сайта в папку
// apps/web/techdocs: снимок API — скриптом прототипа spec/prototype/db/api_snapshot.py по исходникам
// продукта. Здесь — только чтение готовых файлов; код продукта при этом не выполняется.

const Field = z.object({
  n: z.string(),
  t: z.string(),
  req: z.boolean().optional(),
  null: z.boolean().optional(),
  c: z.string().optional(),
  d: z.string().optional(),
});
const Part = z.object({
  s: z.string().optional(),
  f: z.array(Field).default([]),
  ct: z.string().optional(),
  ex: z.unknown().optional(),
});
const Method = z.object({
  id: z.string(),
  m: z.string(),
  p: z.string(),
  sec: z.string(),
  sum: z.string().default(''),
  desc: z.string().nullish(),
  acc: z.string(),
  perm: z.array(z.string()).default([]),
  rate: z.string().default(''),
  req: z
    .object({
      params: Part.optional(),
      query: Part.optional(),
      headers: Part.optional(),
      body: Part.optional(),
    })
    .default({}),
  res: z.array(z.object({ code: z.string(), d: z.string().default(''), s: z.string().optional() })),
  r: z.array(z.string()).default([]),
  w: z.array(z.string()).default([]),
  v: z.array(z.string()).default([]),
  fns: z.array(z.string()).default([]),
  ctx: z.array(z.string()).default([]),
  q: z.array(z.number().int()).default([]),
  code: z
    .array(
      z.object({
        file: z.string(),
        fn: z.string().default(''),
        line: z.number().int().default(0),
        what: z.string().default(''),
      }),
    )
    .default([]),
});

/** Снимок описания API (spec/prototype/db/api_snapshot.py → apiDocs.json). */
const ApiDocs = z.object({
  meta: z.object({
    repo: z.string(),
    branch: z.string(),
    commit: z.string(),
    date: z.string(),
    methods: z.number().int(),
    schemaVersion: z.number().nullish(),
    note: z.string().default(''),
  }),
  sections: z.record(z.string(), z.string()),
  views: z.record(z.string(), z.object({ mig: z.string().default(''), r: z.array(z.string()) })),
  fns: z.record(z.string(), z.unknown()),
  schemas: z.record(z.string(), z.array(Field)),
  sql: z.array(
    z.object({
      k: z.string(),
      t: z.string(),
      f: z.string(),
      fn: z.string().default(''),
      l: z.number().int().default(0),
    }),
  ),
  methods: z.array(Method),
});
export type ApiDocs = z.infer<typeof ApiDocs>;
export type ApiDocMethod = ApiDocs['methods'][number];
export type ApiDocField = z.infer<typeof Field>;
export type ApiDocPart = z.infer<typeof Part>;

/** Описание базы (spec/prototype/db/schema.json): здесь нужны только версия и таблицы. */
const DbSchemaDoc = z
  .object({
    meta: z.object({ schemaVersion: z.number().nullish(), updated: z.string().default('') }).loose(),
    tables: z.array(
      z
        .object({ name: z.string(), ru: z.string().default(''), rls: z.string().nullish() })
        .loose(),
    ),
  })
  .loose();
export type DbSchemaDoc = z.infer<typeof DbSchemaDoc>;

export interface TechDocs {
  api: ApiDocs;
  schema: DbSchemaDoc;
  /** Страница «База данных Buhuchet.kg» (db/index.html прототипа). */
  page: string;
}

export interface TechDocsSource {
  /** Данные модуля; null — файлы не собраны или не читаются. */
  load(): Promise<TechDocs | null>;
}

/** Разобрать три файла данных; неверный состав — ошибка. */
export function parseTechDocs(files: { api: string; schema: string; page: string }): TechDocs {
  return {
    api: ApiDocs.parse(JSON.parse(files.api)),
    schema: DbSchemaDoc.parse(JSON.parse(files.schema)),
    page: files.page,
  };
}

/**
 * Данные из папки, собранной scripts/build-techdocs.mjs. Читаются один раз при первом обращении и
 * остаются в памяти: файлы меняются только со сборкой сайта. Не прочиталось — null, следующее
 * обращение пробует снова.
 */
export function fileTechDocs(dir: string, onError?: (err: unknown) => void): TechDocsSource {
  let loaded: Promise<TechDocs | null> | null = null;
  const read = async (): Promise<TechDocs | null> => {
    try {
      const [api, schema, page] = await Promise.all(
        ['api.json', 'schema.json', 'page.html'].map((name) =>
          readFile(path.join(dir, name), 'utf8'),
        ),
      );
      return parseTechDocs({ api: api!, schema: schema!, page: page! });
    } catch (err) {
      onError?.(err);
      loaded = null;
      return null;
    }
  };
  return { load: () => (loaded ??= read()) };
}

/** Русское название таблицы из описания базы; нет в описании — имя таблицы. */
export function tableNames(schema: DbSchemaDoc): (name: string) => string {
  const ru = new Map(schema.tables.map((t) => [t.name, t.ru]));
  return (name) => ru.get(name) || name;
}

/** Таблицы метода без повторов: читаемые, затем изменяемые. */
export const methodTables = (m: Pick<ApiDocMethod, 'r' | 'w'>): string[] => [
  ...new Set([...m.r, ...m.w]),
];

/**
 * Карта для страницы схемы (прототип tdIdx): какие методы читают и меняют таблицу и таблицы каждого
 * метода. Методы таблицы — по адресу, затем по методу.
 */
export function schemaPageIndex(api: ApiDocs) {
  const t: Record<string, [string, 'r' | 'w' | 'rw'][]> = {};
  const m: Record<string, { m: string; p: string; s: string; g: string; r: string[]; w: string[] }> =
    {};
  for (const x of api.methods) {
    m[x.id] = { m: x.m, p: x.p, s: x.sum, g: api.sections[x.sec] ?? x.sec, r: x.r, w: x.w };
    for (const name of methodTables(x)) {
      (t[name] ??= []).push([x.id, x.w.includes(name) ? (x.r.includes(name) ? 'rw' : 'w') : 'r']);
    }
  }
  const collator = new Intl.Collator('ru', { numeric: true });
  for (const list of Object.values(t)) {
    list.sort(
      (a, b) => collator.compare(m[a[0]]!.p, m[b[0]]!.p) || collator.compare(m[a[0]]!.m, m[b[0]]!.m),
    );
  }
  return { t, m };
}

/** Место в странице схемы, перед которым добавляются данные (начало её скрипта). */
const PAGE_SCRIPT = "<script>\n'use strict';";

/**
 * Страница схемы для рамки модуля (прототип tdFrameUrl): перед её скриптом добавляются схема, карта
 * API и тема программы (`window.TDX_IN`). null — страница не та, что ждём.
 */
export function schemaPageHtml(docs: TechDocs, theme: string): string | null {
  if (!docs.page.includes(PAGE_SCRIPT)) return null;
  const data = JSON.stringify({ schema: docs.schema, api: schemaPageIndex(docs.api), theme })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  // Функция, а не строка: «$» в данных не должен читаться как подстановка replace.
  return docs.page.replace(PAGE_SCRIPT, () => `<script>window.TDX_IN=${data};</script>${PAGE_SCRIPT}`);
}
