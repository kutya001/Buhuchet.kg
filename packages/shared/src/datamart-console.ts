import { DM_PARAM_TYPES, DM_QUERY_MAX, DM_TEXT_PARAM_MAX } from '@buhuchet/domain';
import { z } from 'zod';

/*
 * Консоль запросов «Витрины данных» Админки (доработки 27.11.2026: консоль запросов, блоки 1–2; этап 0,
 * П2–П3; docs/decisions.md п. О-68). Только администратор платформы: `POST /api/admin/dm/console/run`
 * («Выполнить»), `…/explain` («План запроса»), `…/stop` («Остановить»), `…/export` («В Excel»),
 * `GET …/schema` (карта базы для подсказок). Экран — этап 1 (П4).
 */

/** Предел строк на экране консоли (блок 2, пункт 3). */
export const DM_CONSOLE_ROWS = 1000;

/** Один оператор консоли и значения его параметров `:имя` (уходят в базу данными, не текстом). */
export const DmConsoleInput = z.object({
  query: z.string().min(1).max(DM_QUERY_MAX),
  params: z
    .record(z.string().max(60), z.string().max(DM_TEXT_PARAM_MAX).nullable())
    // Исполнитель принимает до 20 значений (`dm.run_admin`), журнал пишет их целиком.
    .refine((o) => Object.keys(o).length <= 20)
    .default({}),
  /**
   * Типы параметров шаблона, открытого в консоли («Открыть в консоли»): `:date_from` уходит датой,
   * `:contractor` — номером. Нет типа — по имени (`dmConsoleParamType`).
   */
  types: z
    .record(z.string().max(60), z.enum(DM_PARAM_TYPES))
    .refine((o) => Object.keys(o).length <= 20)
    .optional(),
  /**
   * «Выполнять как: Организация …» (этап 2, П7; docs/decisions.md п. О-70): запрос идёт ролью организаций
   * от этой организации — тем же путём и с теми же пределами, что «Показать» (15 с, 50 000 строк, место
   * «Показать»). Нет — «Администратор» (роль шаблонов Админки, 60 с). На «План запроса» не влияет.
   */
  orgId: z.uuid().optional(),
});
export type DmConsoleInput = z.infer<typeof DmConsoleInput>;

/** «Выгрузить в Excel» консоли: тот же запрос, до 50 000 строк. */
export const DmConsoleExport = DmConsoleInput;
export type DmConsoleExport = z.infer<typeof DmConsoleExport>;

/** Результат «Выполнить»: имена столбцов, строки (деньги — тыйыны), «есть ещё», время. */
export const DmConsoleResult = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  more: z.boolean(),
  max: z.number().int().positive(),
  ms: z.number().int().nonnegative(),
  /** Параметры запроса по порядку — для полоски над результатом. */
  params: z.array(z.string()),
});
export type DmConsoleResult = z.infer<typeof DmConsoleResult>;

/** «План запроса»: ответ EXPLAIN (FORMAT JSON) базы как есть. */
export const DmConsolePlan = z.object({ plan: z.unknown() });
export type DmConsolePlan = z.infer<typeof DmConsolePlan>;

/** «Остановить»: сколько запросов консоли этого администратора отменено (0 — нечего). */
export const DmConsoleStopped = z.object({ stopped: z.number().int().nonnegative() });
export type DmConsoleStopped = z.infer<typeof DmConsoleStopped>;

/** Поле таблицы на карте базы: тип из базы, русское название и описание из схемы прототипа. */
export const DmSchemaField = z.object({
  name: z.string(),
  type: z.string(),
  /** Русское название; нет в схеме — пусто, экран пишет «нет описания». */
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** Связь: таблица и поле, на которые ссылается это поле. */
  ref: z.object({ table: z.string(), field: z.string() }).nullable(),
  /** Открыто ли поле роли организаций («Выполнять как: Организация …», этап 2, П7). */
  orgVisible: z.boolean(),
});
export type DmSchemaField = z.infer<typeof DmSchemaField>;

/** Таблица на карте базы: только то, что роль шаблонов Админки может прочитать. */
export const DmSchemaTable = z.object({
  name: z.string(),
  group: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** Открыта ли таблица роли организаций (шаблону «Для организаций», блок 2, пункт 8). */
  orgVisible: z.boolean(),
  fields: z.array(DmSchemaField),
});
export type DmSchemaTable = z.infer<typeof DmSchemaTable>;

/** Карта базы для подсказок консоли (П3): таблицы и поля, закрытое ролям не отдаётся. */
export const DmSchemaMap = z.object({
  tables: z.array(DmSchemaTable),
  /** Версия схемы описаний (`schema.json` прототипа); нет файла — пусто. */
  described: z.string().nullable(),
});
export type DmSchemaMap = z.infer<typeof DmSchemaMap>;

/*
 * Этап 1 (П4–П5; docs/decisions.md п. О-69): «Мои запросы» — личные запросы администратора
 * (`/api/admin/dm/console/queries`), «История» — свои последние 100 запусков из журнала консоли,
 * проверка по ходу набора — `POST …/console/check` (ошибки разборщика с местом в тексте).
 */

/** Сколько запусков показывает «История» (блок 4, пункт 2). */
export const DM_CONSOLE_HISTORY_MAX = 100;
/** Название запроса «Моих запросов» и предел текста (таблица `dm_console_queries`). */
export const DM_CONSOLE_QUERY_NAME_MAX = 200;
export const DM_CONSOLE_QUERY_TEXT_MAX = 20_000;

const ConsoleParams = z
  .record(z.string().max(60), z.string().max(DM_TEXT_PARAM_MAX).nullable())
  .refine((o) => Object.keys(o).length <= 20);

/** Запрос «Моих запросов». */
export const DmConsoleQuery = z.object({
  id: z.uuid(),
  name: z.string(),
  query: z.string(),
  params: z.record(z.string(), z.string().nullable()),
  updatedAt: z.string(),
  version: z.number().int().positive(),
});
export type DmConsoleQuery = z.infer<typeof DmConsoleQuery>;

/** «Сохранить в Мои запросы»: название, текст, значения параметров; изменить — ещё и версия. */
export const DmConsoleQuerySave = z.object({
  name: z.string().trim().min(1).max(DM_CONSOLE_QUERY_NAME_MAX),
  query: z.string().min(1).max(DM_CONSOLE_QUERY_TEXT_MAX),
  params: ConsoleParams.default({}),
});
export type DmConsoleQuerySave = z.infer<typeof DmConsoleQuerySave>;

export const DmConsoleQueryUpdate = DmConsoleQuerySave.extend({
  version: z.number().int().positive(),
});
export type DmConsoleQueryUpdate = z.infer<typeof DmConsoleQueryUpdate>;

export const DmConsoleQueryList = z.object({ items: z.array(DmConsoleQuery) });
export type DmConsoleQueryList = z.infer<typeof DmConsoleQueryList>;

/** Строка «Истории»: запуск из журнала консоли. */
export const DmConsoleRun = z.object({
  id: z.number().int(),
  at: z.string(),
  action: z.enum(['dm_console_run', 'dm_console_export']),
  query: z.string(),
  params: z.record(z.string(), z.string().nullable()),
  outcome: z.enum(['ok', 'error', 'timeout', 'stopped', 'refused']),
  rows: z.number().int().nullable(),
  ms: z.number().int().nullable(),
  error: z.string().nullable(),
  /** От какой организации шёл запрос («Выполнять как», этап 2, П7); от администратора — пусто. */
  org: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type DmConsoleRun = z.infer<typeof DmConsoleRun>;

export const DmConsoleHistory = z.object({ items: z.array(DmConsoleRun) });
export type DmConsoleHistory = z.infer<typeof DmConsoleHistory>;

/** Проверка по ходу набора: текст оператора (не выполняется и в журнал не пишется). */
export const DmConsoleCheckInput = z.object({ query: z.string().max(DM_QUERY_MAX) });
export type DmConsoleCheckInput = z.infer<typeof DmConsoleCheckInput>;

/** Ошибка текста с местом (с нуля, `to` — не включая) и словами. */
export const DmConsoleProblem = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  code: z.string(),
  message: z.string(),
});
export type DmConsoleProblem = z.infer<typeof DmConsoleProblem>;

export const DmConsoleCheck = z.object({ problems: z.array(DmConsoleProblem) });
export type DmConsoleCheck = z.infer<typeof DmConsoleCheck>;
