import { PAGE_SECTIONS } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { orgIsolation } from './rls';
import { users } from './users';

const orgColumn = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' });

/**
 * Страница контрагента по ссылке (задача 2.42; ТЗ «Контрагенты» → «Страница контрагента по ссылке» →
 * «Защита», «Включение»; прототип modules/cp-page.js, `c.page`): строка на контрагента, у которого
 * страницу хоть раз включали. Выключение строку не удаляет, повторное включение — с новым кодом.
 * Страницу без входа находит и проверяет код только база (функции app.contractor_page_*, миграция
 * guards): код наружу не отдаётся. Роль приложения меняет только столбцы включения, кода, разделов и
 * счёта неверных кодов — сбросить его при «Сменить код» и «Включить».
 */
export const contractorPages = pgTable(
  'contractor_pages',
  {
    contractorId: uuid('contractor_id').primaryKey(),
    orgId: orgColumn(),
    enabled: boolean('enabled').notNull().default(true),
    /** Код доступа, 6 цифр: сотрудник видит его в карточке (ТЗ «сотрудник видит код в карточке»). */
    // ОТКЛОНЕНИЕ: docs/deviations.md#Е-1
    code: text('code').notNull(),
    /**
     * Номер кода: «Сменить код» и повторное включение повышают его, и все браузеры, где код запомнен
     * (`contractor_page_grants`), сразу теряют доступ.
     */
    codeVersion: integer('code_version').notNull().default(1),
    /** Разделы страницы, скрытые у этого контрагента (`PAGE_SECTIONS`), по порядку страницы. */
    hiddenSections: text('hidden_sections')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Неверные коды подряд по этой ссылке — счёт ведёт функция проверки кода. */
    failures: integer('failures').notNull().default(0),
    /** До какого момента ввод кода по ссылке закрыт (5 неверных подряд — 15 минут). */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    foreignKey({
      name: 'contractor_pages_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    check('contractor_pages_code_check', sql`${t.code} ~ '^[0-9]{6}$'`),
    check(
      'contractor_pages_hidden_check',
      sql`${t.hiddenSections} <@ array[${sql.raw(PAGE_SECTIONS.map((s) => `'${s}'`).join(', '))}]::text[]`,
    ),
    check('contractor_pages_failures_check', sql`${t.failures} >= 0`),
    orgIsolation('contractor_pages_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Браузеры, где верный код запомнен на 30 дней (ТЗ «Верный код запоминается в этом браузере на 30
 * дней»): в cookie страницы — случайный токен, здесь — его SHA-256 и номер кода, при котором он выдан.
 * Роль приложения таблицу не видит и не меняет: только функции app.contractor_page_* (миграция guards).
 */
export const contractorPageGrants = pgTable(
  'contractor_page_grants',
  {
    tokenHash: text('token_hash').primaryKey(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id')
      .notNull()
      .references(() => contractorPages.contractorId, { onDelete: 'cascade' }),
    codeVersion: integer('code_version').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contractor_page_grants_expires_idx').on(t.expiresAt),
    index('contractor_page_grants_contractor_idx').on(t.contractorId),
    orgIsolation('contractor_page_grants_isolation', t.orgId),
  ],
).enableRLS();
