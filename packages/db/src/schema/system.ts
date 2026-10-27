import { bigint, boolean, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { platformService } from './rls';

/**
 * Запуски задач по расписанию: одна строка на задачу и слот. Первичный ключ не даёт выполнить
 * один слот дважды, даже если планировщик разбудил приложение несколько раз.
 */
export const schedulerRuns = pgTable(
  'scheduler_runs',
  {
    job: text('job').notNull(),
    slot: timestamp('slot', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok'),
    error: text('error'),
  },
  (t) => [primaryKey({ columns: [t.job, t.slot] }), platformService('scheduler_runs_service')],
).enableRLS();

/**
 * Частота действий (docs/decisions.md, п. 38): строка — одно действие вида `kind` от `subject`
 * (выгрузка «В Excel» — номер пользователя; поток Е добавит коды страницы контрагента). Действий
 * за окно — не больше предела, одновременно — одно, пока `busy_until` впереди. Роль приложения таблицу
 * не видит и не меняет: только функции app.rate_limit_* (миграция 0026), строки старше суток удаляет
 * задача очистки.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind').notNull(),
    subject: text('subject').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** Пока действие идёт — до какого момента; закончилось (или не следится) — пусто. */
    busyUntil: timestamp('busy_until', { withTimezone: true }),
  },
  (t) => [index('rate_limits_subject_idx').on(t.kind, t.subject, t.at)],
).enableRLS();
