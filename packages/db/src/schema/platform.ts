import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { recordVersion } from './columns';
import { platformReadOnly } from './rls';
import { users } from './users';

/**
 * Справочники платформы — разделы refDB.json прототипа как есть (reportTypes, holidays, taxes, …).
 * Это начальное наполнение этапа 0: модуль «Справочники платформы» разложит нужные разделы по своим
 * таблицам и добавит историю загрузок. Данные общие для всех организаций, поэтому без org_id.
 */
export const platformReference = pgTable(
  'platform_reference',
  {
    key: text('key').primaryKey(),
    payload: jsonb('payload').notNull(),
    /** sha256 канонического JSON раздела: по нему видно, изменился ли раздел. */
    checksum: text('checksum').notNull(),
    version: integer('version').notNull().default(1),
    /** Откуда раздел: `refDB.json@<коммит прототипа>`. */
    source: text('source').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Раздел поправил администратор платформы в Админке («Налоги и ставки», «Группы кодов ГКЭД»):
     * `db:seed --update` его не затирает.
     */
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  () => [platformReadOnly('platform_reference_read')],
).enableRLS();

export const GKED_LEVELS = [
  'section',
  'subsection',
  'division',
  'group',
  'class',
  'subclass',
] as const;

/**
 * ГКЭД 2022 (gkedDB.json). У контрагента выбирается только subclass. Ведёт администратор платформы
 * (задача 2.38): «Создано», «Создал», «Изменил» и версия — как у остальных справочников платформы;
 * «Входит в» — код этого же справочника, поэтому код с вложенными кодами не удалить.
 */
export const gkedItems = pgTable(
  'gked_items',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    level: text('level', { enum: GKED_LEVELS }).notNull(),
    parentCode: text('parent_code').references((): AnyPgColumn => gkedItems.code),
    active: boolean('active').notNull().default(true),
    note: text('note').notNull().default(''),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    /** Поправленный в Админке код `db:seed --update` не затирает. */
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: recordVersion(),
  },
  (t) => [
    index('gked_items_parent_idx').on(t.parentCode),
    index('gked_items_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
    platformReadOnly('gked_items_read'),
  ],
).enableRLS();
