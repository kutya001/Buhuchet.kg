import type { HistoryChange } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/**
 * История изменений (ТЗ «Общие правила для всей платформы»: кто, когда, что было и что стало).
 * Пишется в той же транзакции, что и правка (`writeHistory`, `updateWithHistory`). Записи не меняются
 * и не удаляются: у роли приложения нет прав UPDATE и DELETE (миграция 0007). Организация, автор и
 * время берутся из контекста транзакции (`withOrgContext`); ограничивающая политика вставки не даёт
 * подставить другого автора, пользователя чужой организации или другое время.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Какая запись: `HistoryEntity` из @buhuchet/domain. */
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    /**
     * Контрагент, к которому относится запись, — для истории в карточке контрагента. Ключ на пару
     * (contractor_id, org_id) появится вместе с таблицей контрагентов.
     */
    contractorId: uuid('contractor_id'),
    /** `HistoryAction` из @buhuchet/domain. */
    action: text('action').notNull(),
    /** Изменённые поля: было → стало. */
    changes: jsonb('changes').$type<HistoryChange[]>().notNull().default([]),
    reason: text('reason'),
    /** Пусто — система (задача по расписанию). */
    actorUserId: uuid('actor_user_id')
      .default(sql`app.current_user_id()`)
      .references(() => users.id, { onDelete: 'restrict' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.orgId, t.entity, t.entityId, t.at),
    index('audit_log_contractor_idx')
      .on(t.orgId, t.contractorId, t.at)
      .where(sql`${t.contractorId} is not null`),
    orgIsolation('audit_log_isolation', t.orgId),
    pgPolicy('audit_log_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.actorUserId} is not distinct from app.current_user_id() and ${t.at} = now() and app.history_actor_allowed(${t.actorUserId}, ${t.orgId})`,
    }),
  ],
).enableRLS();

/**
 * История изменений общих данных платформы, которые правит Админка (тексты «Локализации», дальше —
 * справочники платформы): как `audit_log`, но без организации — у администратора платформы её нет.
 * Читает и пишет только незаблокированный администратор платформы (`app.is_platform_admin()`), автор и
 * время — из контекста транзакции; записи не меняются и не удаляются (миграция 0036: права UPDATE и
 * DELETE у роли приложения отозваны).
 */
export const platformAuditLog = pgTable(
  'platform_audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Какая запись: `HistoryEntity` из @buhuchet/domain (`ui_text`). */
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    /** `HistoryAction` из @buhuchet/domain. */
    action: text('action').notNull(),
    /** Изменённые поля: было → стало. */
    changes: jsonb('changes').$type<HistoryChange[]>().notNull().default([]),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => users.id, { onDelete: 'restrict' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('platform_audit_log_entity_idx').on(t.entity, t.entityId, t.at),
    pgPolicy('platform_audit_log_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`app.is_platform_admin()`,
    }),
    pgPolicy('platform_audit_log_insert', {
      as: 'permissive',
      for: 'insert',
      to: appRole,
      withCheck: sql`app.is_platform_admin() and ${t.actorUserId} = app.current_user_id() and ${t.at} = now()`,
    }),
  ],
).enableRLS();
