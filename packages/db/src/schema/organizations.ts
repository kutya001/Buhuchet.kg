import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';
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
    inn: text('inn'),
    isDemo: boolean('is_demo').notNull().default(false),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [orgIsolation('organizations_isolation', t.id)],
).enableRLS();
