import { z } from 'zod';
import { listPageSchema } from './list';

// Админка → «Техническая документация» (ТЗ «Админка» → «Техническая документация», решение заказчика
// 09.11.2026; прототип admin/techdocs.js): схема базы и описание API со связями «метод → таблицы → SQL».
// Только чтение и только администратору платформы.

/** Кто может вызвать метод (прототип TD_ACC). */
export const API_DOC_ACCESS = ['public', 'session', 'employee', 'perm', 'admin'] as const;
export type ApiDocAccess = (typeof API_DOC_ACCESS)[number];

/** Вид запроса метода: текст SQL, фрагмент кода Drizzle, определение представления (прототип TD_QK). */
export const API_DOC_QUERY_KINDS = ['sql', 'code', 'view'] as const;
export type ApiDocQueryKind = (typeof API_DOC_QUERY_KINDS)[number];

const TableRef = z.object({ name: z.string(), ru: z.string() });

/** Строка версии над вкладками и таблицы для фильтра «Таблица». */
export const AdminTechDocsMeta = z.object({
  api: z.object({
    repo: z.string(),
    branch: z.string(),
    commit: z.string(),
    date: z.string(),
    methods: z.number().int(),
  }),
  schema: z.object({
    version: z.number().nullable(),
    updated: z.string(),
    tables: z.number().int(),
  }),
  /** Описание API собрано по более старой версии, чем схема базы. */
  stale: z.boolean(),
  /** Таблицы, к которым обращаются методы, — по русскому названию. */
  tables: z.array(TableRef),
});
export type AdminTechDocsMeta = z.infer<typeof AdminTechDocsMeta>;

/** Строка списка методов API (прототип tdApiTab). */
export const AdminApiMethod = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  section: z.string(),
  summary: z.string(),
  access: z.string(),
  /** Права метода названиями через запятую. */
  permissions: z.string(),
  /** Сколько таблиц метод читает и меняет. */
  tables: z.number().int(),
  writes: z.boolean(),
  tableNames: z.string(),
  rate: z.string(),
  file: z.string(),
});
export type AdminApiMethod = z.infer<typeof AdminApiMethod>;

export const AdminApiMethodList = listPageSchema(AdminApiMethod);
export type AdminApiMethodList = z.infer<typeof AdminApiMethodList>;

/** Поле запроса, ответа или схемы Zod: тип, обязательность, ограничения, описание. */
export const ApiDocFieldRow = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  nullable: z.boolean(),
  constraints: z.string(),
  description: z.string(),
});
export type ApiDocFieldRow = z.infer<typeof ApiDocFieldRow>;

const RequestPart = z.object({
  /** Имя схемы Zod; пусто — без имени. */
  schema: z.string(),
  fields: z.array(ApiDocFieldRow),
});

/** Карточка метода API (прототип tdMethod): запрос, ответы, таблицы, SQL, код. */
export const AdminApiMethodCard = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  section: z.string(),
  summary: z.string(),
  description: z.string(),
  access: z.string(),
  permissions: z.array(z.string()),
  rate: z.string(),
  request: z.object({
    params: RequestPart.nullable(),
    query: RequestPart.nullable(),
    headers: RequestPart.nullable(),
    body: RequestPart.extend({ contentType: z.string(), example: z.string().nullable() }).nullable(),
  }),
  responses: z.array(
    z.object({
      code: z.string(),
      description: z.string(),
      schema: z.string(),
      /** Поля схемы ответа; null — схема не разобрана или её нет. */
      fields: z.array(ApiDocFieldRow).nullable(),
    }),
  ),
  /** Таблицы, которые метод только читает. */
  reads: z.array(TableRef),
  /** Таблицы, которые метод меняет: добавляет, изменяет, удаляет. */
  writes: z.array(TableRef),
  views: z.array(z.object({ name: z.string(), migration: z.string(), reads: z.array(z.string()) })),
  functions: z.array(z.string()),
  /** В каком контексте идут запросы: `org`, `user`. */
  contexts: z.array(z.string()),
  /** Правила RLS таблиц метода из описания базы. */
  rls: z.array(TableRef.extend({ rule: z.string() })),
  queries: z.array(
    z.object({
      kind: z.string(),
      text: z.string(),
      file: z.string(),
      fn: z.string(),
      line: z.number().int(),
    }),
  ),
  /** Список с фильтрами: показан вариант запроса без фильтров и сортировки. */
  filtered: z.boolean(),
  code: z.array(
    z.object({
      file: z.string(),
      fn: z.string(),
      line: z.number().int(),
      what: z.string(),
      /** Место — запрос к базе (значок базы), иначе — код маршрута или обработчика. */
      db: z.boolean(),
    }),
  ),
  repo: z.string(),
  commit: z.string(),
  /** Имена схем Zod, у которых есть разобранные поля, — в типах они открываются по нажатию. */
  schemas: z.array(z.string()),
});
export type AdminApiMethodCard = z.infer<typeof AdminApiMethodCard>;

/** Поля схемы Zod по имени (окно схемы из карточки метода). */
export const AdminApiSchemaFields = z.object({
  name: z.string(),
  fields: z.array(ApiDocFieldRow),
  schemas: z.array(z.string()),
});
export type AdminApiSchemaFields = z.infer<typeof AdminApiSchemaFields>;
