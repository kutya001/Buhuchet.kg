import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { platformReadOnly } from './rls';
import { users } from './users';

/**
 * Словарь текстов интерфейса (Админка → «Локализация»): ключ → текст на языке. Общий для всех
 * организаций, поэтому без org_id; приложение только читает (меняет администратор платформы —
 * экран «Локализация», поток Д). Наполнение — раздел `localization` refDB.json и `UI_TEXTS`.
 */
export const uiTexts = pgTable(
  'ui_texts',
  {
    lang: text('lang').notNull().default('ru'),
    key: text('key').notNull(),
    text: text('text').notNull(),
    /** Раздел в списке «Локализации» (Меню, Кнопки, Списки, …). */
    section: text('section').notNull(),
    /** Кто поправил текст в Админке; null — текст из наполнения, его обновляет `db:seed --update`. */
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [primaryKey({ columns: [t.lang, t.key] }), platformReadOnly('ui_texts_read')],
).enableRLS();
