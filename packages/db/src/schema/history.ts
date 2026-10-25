import type { HistoryChange } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/**
 * История изменений (ТЗ «Общие правила для всей платформы»: кто, когда, что было и что стало).
 * Пишется в той же транзакции, что и правка (`writeHistory`, `updateWithHistory`). Записи не меняются
 * и не удаляются: у роли приложения нет прав UPDATE и DELETE (миграция 0006). Организация и автор
 * по умолчанию берутся из контекста транзакции (`withOrgContext`), подставить чужие нельзя.
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
    /** Контрагент, к которому относится запись, — для истории в карточке контрагента. */
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
  ],
).enableRLS();
