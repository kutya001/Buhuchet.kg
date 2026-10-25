import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Справочники платформы — разделы refDB.json прототипа как есть (reportTypes, holidays, taxes, …).
 * Это начальное наполнение этапа 0: модуль «Справочники платформы» разложит нужные разделы по своим
 * таблицам и добавит историю загрузок. Данные общие для всех организаций, поэтому без org_id.
 */
export const platformReference = pgTable('platform_reference', {
  key: text('key').primaryKey(),
  payload: jsonb('payload').notNull(),
  /** sha256 канонического JSON раздела: по нему видно, изменился ли раздел. */
  checksum: text('checksum').notNull(),
  version: integer('version').notNull().default(1),
  /** Откуда раздел: `refDB.json@<коммит прототипа>`. */
  source: text('source').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const GKED_LEVELS = [
  'section',
  'subsection',
  'division',
  'group',
  'class',
  'subclass',
] as const;

/** ГКЭД 2022 (gkedDB.json). У контрагента выбирается только subclass. */
export const gkedItems = pgTable(
  'gked_items',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    level: text('level', { enum: GKED_LEVELS }).notNull(),
    parentCode: text('parent_code'),
    active: boolean('active').notNull().default(true),
    note: text('note').notNull().default(''),
    sortOrder: integer('sort_order').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('gked_items_parent_idx').on(t.parentCode),
    index('gked_items_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);
