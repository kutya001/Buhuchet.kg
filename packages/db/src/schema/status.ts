import { ROLLBACK_REASON_MAX, scaleStatuses, STATUS_CAUSES, STATUS_SCALES } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { files } from './files';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/** Коды статусов шкалы строкой SQL: `'todo', 'in_progress', …` (коды — латиница и «_»). */
const codes = (list: readonly string[]) => sql.raw(list.map((c) => `'${c}'`).join(', '));

/**
 * История статусов (ТЗ «История статусов»): каждая смена статуса на шкале — отчёт (сдача), оплата,
 * задача, обслуживание контрагента, проект, месяц показателей — с автором, временем и причиной.
 * Пишется в той же транзакции, что и смена статуса (`writeStatusChange`). Записи не меняются и не
 * удаляются (миграция 0021); автор, время и организация — из контекста транзакции, как у `audit_log`.
 * Откат — шаг назад с обязательной причиной; право «Откат статусов» проверяет API.
 */
export const statusHistory = pgTable(
  'status_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Шкала: `StatusScaleKey` из @buhuchet/domain. */
    scale: text('scale', { enum: STATUS_SCALES }).notNull(),
    /** Отчёт, задача, проект, контрагент или месяц показателей. */
    entityId: uuid('entity_id').notNull(),
    /** Пусто — первая запись (запись создана в этом статусе). */
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    isRollback: boolean('is_rollback').notNull().default(false),
    /** Комментарий или причина (у отката обязательна). */
    reason: text('reason'),
    /** Что сменило статус системой (`STATUS_CAUSES`); пусто — человек или другое правило. */
    cause: text('cause', { enum: STATUS_CAUSES }),
    /** Файл к смене статуса (например, квитанция о приёме); пусто — без файла. */
    fileId: uuid('file_id'),
    /** Пусто — система (задача по расписанию). */
    actorUserId: uuid('actor_user_id')
      .default(sql`app.current_user_id()`)
      .references(() => users.id, { onDelete: 'restrict' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('status_history_entity_idx').on(t.orgId, t.scale, t.entityId, t.at),
    foreignKey({
      name: 'status_history_file_fk',
      columns: [t.fileId, t.orgId],
      foreignColumns: [files.id, files.orgId],
    }).onDelete('restrict'),
    check(
      'status_history_status_check',
      sql.join(
        STATUS_SCALES.map(
          (scale) =>
            sql`(${t.scale} = ${sql.raw(`'${scale}'`)} and ${t.toStatus} in (${codes(scaleStatuses(scale))}) and (${t.fromStatus} is null or ${t.fromStatus} in (${codes(scaleStatuses(scale))})))`,
        ),
        sql` or `,
      ),
    ),
    check('status_history_change_check', sql`${t.fromStatus} is distinct from ${t.toStatus}`),
    check(
      'status_history_rollback_reason_check',
      sql`not ${t.isRollback} or (${t.fromStatus} is not null and ${t.reason} is not null and btrim(${t.reason}) <> '')`,
    ),
    check('status_history_cause_check', sql`${t.cause} is null or ${t.cause} in (${codes(STATUS_CAUSES)})`),
    check(
      'status_history_reason_check',
      sql`${t.reason} is null or char_length(${t.reason}) <= ${sql.raw(String(ROLLBACK_REASON_MAX))}`,
    ),
    orgIsolation('status_history_isolation', t.orgId),
    pgPolicy('status_history_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.actorUserId} is not distinct from app.current_user_id() and ${t.at} = now() and app.history_actor_allowed(${t.actorUserId}, ${t.orgId})`,
    }),
  ],
).enableRLS();
