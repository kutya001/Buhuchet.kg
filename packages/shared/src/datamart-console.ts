import { DM_QUERY_MAX, DM_TEXT_PARAM_MAX } from '@buhuchet/domain';
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
  params: z.record(z.string().max(60), z.string().max(DM_TEXT_PARAM_MAX).nullable()).default({}),
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
