import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

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
  (t) => [primaryKey({ columns: [t.job, t.slot] })],
);
