import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { platformService } from './rls';

/**
 * Запуски задач по расписанию: одна строка на задачу и слот. Первичный ключ не даёт выполнить
 * один слот дважды, даже если планировщик разбудил приложение несколько раз. Упавший или зависший
 * слот повторяется в окне догоняния (docs/decisions.md, п. О-30): строку снова занимает тот, кто
 * поднял `attempts`, — так повтор тоже выполняется один раз.
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
    /** Какая это попытка слота: 1 — первый запуск, дальше — повторы после ошибки или зависания. */
    attempts: integer('attempts').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.job, t.slot] }),
    // Каждую минуту ищутся зависшие попытки: без индекса — весь журнал за 30 дней.
    index('scheduler_runs_unfinished_idx')
      .on(t.startedAt)
      .where(sql`${t.finishedAt} is null`),
    check('scheduler_runs_attempts_check', sql`${t.attempts} >= 1`),
    platformService('scheduler_runs_service'),
  ],
).enableRLS();

/**
 * Состояние задачи по расписанию для оповещений администратору платформы (docs/decisions.md,
 * п. О-30): последний занятый слот (по нему видно, что задача давно не запускалась), неудачи подряд и
 * открытое оповещение — «падает» или «не запускалась». Одна строка на задачу; журнал запусков
 * чистится через 30 дней, а состояние остаётся.
 */
export const schedulerJobs = pgTable(
  'scheduler_jobs',
  {
    job: text('job').primaryKey(),
    lastSlot: timestamp('last_slot', { withTimezone: true }),
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
    /** Неудачных попыток подряд (ошибка или зависание); успешная попытка сбрасывает в 0. */
    fails: integer('fails').notNull().default(0),
    lastError: text('last_error'),
    /** Открытое оповещение: `failing` — падает, `missed` — не запускалась; пусто — всё хорошо. */
    alert: text('alert', { enum: ['failing', 'missed'] }),
    alertedAt: timestamp('alerted_at', { withTimezone: true }),
  },
  (t) => [
    check('scheduler_jobs_fails_check', sql`${t.fails} >= 0`),
    check('scheduler_jobs_alert_check', sql`${t.alert} in ('failing', 'missed')`),
    platformService('scheduler_jobs_service'),
  ],
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
