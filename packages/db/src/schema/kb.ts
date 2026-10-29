import { KB_HOWS } from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { appRole, currentOrgId } from './rls';
import { users } from './users';

const currentUserId = sql`app.current_user_id()`;

/*
 * «База знаний»: прогресс обучения каждого пользователя на сервере (ТЗ «Прогресс хранится на сервере
 * у каждого пользователя и не зависит от устройства»; задача 2.30, docs/decisions.md п. Г-2). Содержимое
 * шагов, статей и уровней — в `platform_reference` (refDB.json), здесь — только отметки пользователя.
 * Строки видит вся организация (уровни сотрудников у владельца и в «Сотрудниках»), а добавляет и
 * меняет пользователь только свои: шаг засчитывается тому, кто сам сделал действие. У администратора
 * платформы организации нет — его строки видит только он сам и только как незаблокированный
 * администратор (`app.is_platform_admin()`).
 */

/** Строки организации видны всем её пользователям, а пишутся только свои. */
function kbPolicies(table: string, t: { orgId: AnyPgColumn; userId: AnyPgColumn }) {
  const own: SQL = sql`${t.orgId} = ${currentOrgId} and ${t.userId} = ${currentUserId}`;
  return [
    pgPolicy(`${table}_isolation`, {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`${t.orgId} = ${currentOrgId}`,
    }),
    pgPolicy(`${table}_own_insert`, {
      as: 'permissive',
      for: 'insert',
      to: appRole,
      withCheck: own,
    }),
    pgPolicy(`${table}_own_update`, {
      as: 'permissive',
      for: 'update',
      to: appRole,
      using: own,
      withCheck: own,
    }),
    pgPolicy(`${table}_platform_admin`, {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and app.is_platform_admin()`,
      withCheck: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and app.is_platform_admin()`,
    }),
  ];
}

const userColumns = () => ({
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Пусто — администратор платформы. */
  orgId: uuid('org_id')
    .default(currentOrgId)
    .references(() => organizations.id, { onDelete: 'restrict' }),
});

/**
 * Отметки шагов: выполнен (один раз и навсегда — способ и момент, ТЗ «Точные правила подсчёта») или
 * пропущен. Шаг — код из `kbSteps`; шаги, которых нет в программе пользователя, просто не считаются.
 * Удалять отметки нельзя (у роли приложения нет DELETE), менять — только способ, момент и пропуск.
 */
export const kbProgress = pgTable(
  'kb_progress',
  {
    ...userColumns(),
    stepId: text('step_id').notNull(),
    /** Как засчитан: `KbHow` из @buhuchet/domain. Пусто — не выполнен (только пропущен). */
    doneHow: text('done_how'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    /** «Пропустить»: шаг серый, в уровень не засчитывается; «Вернуть» — снова пусто. */
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'kb_progress_pk', columns: [t.userId, t.stepId] }),
    foreignKey({
      name: 'kb_progress_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('kb_progress_org_idx').on(t.orgId),
    check('kb_progress_step_check', sql`${t.stepId} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    check(
      'kb_progress_how_check',
      sql`${t.doneHow} is null or ${t.doneHow} in (${sql.raw(KB_HOWS.map((h) => `'${h}'`).join(', '))})`,
    ),
    check('kb_progress_done_check', sql`(${t.doneHow} is null) = (${t.doneAt} is null)`),
    ...kbPolicies('kb_progress', t),
  ],
).enableRLS();

/** Прочитанные статьи: открыта и прокручена до конца (ТЗ «Статья «прочитана»…»). */
export const kbArticleReads = pgTable(
  'kb_article_reads',
  {
    ...userColumns(),
    articleId: text('article_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'kb_article_reads_pk', columns: [t.userId, t.articleId] }),
    foreignKey({
      name: 'kb_article_reads_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('kb_article_reads_org_idx').on(t.orgId),
    check('kb_article_reads_article_check', sql`${t.articleId} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    ...kbPolicies('kb_article_reads', t),
  ],
).enableRLS();

/**
 * Полученные уровни с датами (ТЗ «Полученные уровни с датами»): уровень записывается, когда процент
 * его достиг, и не понижается. Номер — индекс в `kbLevels` (0 — «Новичок»).
 */
export const kbLevels = pgTable(
  'kb_levels',
  {
    ...userColumns(),
    level: smallint('level').notNull(),
    reachedAt: timestamp('reached_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'kb_levels_pk', columns: [t.userId, t.level] }),
    foreignKey({
      name: 'kb_levels_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('kb_levels_org_idx').on(t.orgId),
    check('kb_levels_level_check', sql`${t.level} between 0 and 20`),
    ...kbPolicies('kb_levels', t),
  ],
).enableRLS();
