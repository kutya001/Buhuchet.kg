import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { orgIsolation } from './rls';

/** Организации (тенанты). Поля профиля добавляются модулем «Моя организация» (этап 1). */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Адрес страницы организации: buhuchet.kg/<slug>/inn/<ИНН>. */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** 14 цифр; второй организации с таким ИНН быть не может. */
    inn: text('inn').unique(),
    isDemo: boolean('is_demo').notNull().default(false),
    /**
     * active или blocked: заблокированную организацию (например, за неоплату) администратор платформы
     * блокирует с причиной; сотрудники не входят, данные сохраняются (ТЗ «Админка» → «Блокировка
     * организации»).
     */
    status: text('status').notNull().default('active'),
    blockedReason: text('blocked_reason'),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    check('organizations_status_check', sql`${t.status} in ('active', 'blocked')`),
    check(
      'organizations_blocked_reason_check',
      sql`${t.status} <> 'blocked' or ${t.blockedReason} is not null`,
    ),
    orgIsolation('organizations_isolation', t.id),
  ],
).enableRLS();
