import { ONBOARDING_STATES, type OnboardingAnswers } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/*
 * Первый запуск организации (задача 2.33; ТЗ «Моя организация» → «Первый запуск организации»;
 * docs/decisions.md п. Г-4).
 */

/**
 * Приветствие и опросник организации — строка есть только у организаций, созданных с приветствием
 * (`createOrganization`): организации, созданные раньше, его не получают (ТЗ «Организации, созданные
 * до этой версии, не меняются»). `new` — приветствие с опросником ещё откроется владельцу, `later` —
 * опросник отложен «Позже», `done` — пройден (ответы — в `answers`).
 */
export const orgOnboarding = pgTable(
  'org_onboarding',
  {
    orgId: uuid('org_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    state: text('state').notNull().default('new'),
    /** Ответы опросника: код вопроса → `yes`, `no`, `unk` (последний пройденный). */
    answers: jsonb('answers').$type<OnboardingAnswers>().notNull().default({}),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: uuid('done_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    check(
      'org_onboarding_state_check',
      sql`${t.state} in (${sql.raw(ONBOARDING_STATES.map((s) => `'${s}'`).join(', '))})`,
    ),
    orgIsolation('org_onboarding_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Кто уже видел приветствие: сотрудник новой организации видит его при самом первом входе (ТЗ
 * «Сотрудники организации при первом входе видят экраны 1, 2 и 5»). Пишет и читает пользователь только
 * свою строку; менять и удалять нельзя (права — миграция `onboarding_grants`).
 */
export const welcomeSeen = pgTable(
  'welcome_seen',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    const own = sql`${t.orgId} = ${currentOrgId} and ${t.userId} = app.current_user_id()`;
    return [
      foreignKey({
        name: 'welcome_seen_user_org_fk',
        columns: [t.userId, t.orgId],
        foreignColumns: [users.id, users.orgId],
      }).onDelete('cascade'),
      index('welcome_seen_org_idx').on(t.orgId),
      // Одна политика на чтение и запись своей строки; менять и удалять не дают права (миграция
      // `onboarding_grants`).
      pgPolicy('welcome_seen_own', {
        as: 'permissive',
        for: 'all',
        to: appRole,
        using: own,
        withCheck: own,
      }),
    ];
  },
).enableRLS();
