import {
  DM_ACCESS,
  DM_AUDIENCES,
  DM_CODE_RE,
  DM_MODULES,
  DM_QUERY_MAX,
  DM_REQUEST_OUTCOMES,
  DM_REQUEST_VIA,
  DM_TEMPLATE_STATES,
  DM_TOKEN_MAX_DAYS,
  DM_TOKEN_PREFIX_RE,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/**
 * «Витрина данных» (доработки 20.11.2026: Витрина данных; миграция 0165, этап 0): шаблоны SQL
 * администратора платформы, доступ организаций к шаблону, API-токены и журнал запросов. Запрос
 * шаблона выполняет только исполнитель Витрины своей ролью базы только для чтения (отдельный PR
 * этапа 0); роль приложения текста запроса у организации не показывает — он лежит отдельно
 * (`dm_template_sql`), только для администратора платформы.
 */

const currentUserId = sql`app.current_user_id()`;
const isPlatformAdmin = sql`app.is_platform_admin()`;
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
/** Админка вне контекста организации. */
const adminOutsideOrg = sql`${currentOrgId} is null and ${isPlatformAdmin}`;

/**
 * Шаблон (блок 2): название, код для адреса, описание, вид, параметры, столбцы, модуль, доступ и
 * состояние. Параметры — `[{ code, name, type, required, default }]`, столбцы — `[{ code, name, type,
 * total, contractor }]` (`contractor` — столбец «Контрагент» для области «Свои»). Организация видит
 * только опубликованные шаблоны «Для организаций», разрешённые ей (права модуля проверяет API).
 */
export const dmTemplates = pgTable(
  'dm_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    audience: text('audience', { enum: DM_AUDIENCES }).notNull().default('org'),
    params: jsonb('params')
      .notNull()
      .default(sql`'[]'::jsonb`),
    columns: jsonb('columns')
      .notNull()
      .default(sql`'[]'::jsonb`),
    module: text('module', { enum: DM_MODULES }).notNull(),
    /** Ещё одно обязательное право из 40 (например, «Видеть плату за обслуживание»). */
    needPermission: text('need_permission'),
    access: text('access', { enum: DM_ACCESS }).notNull().default('all'),
    state: text('state', { enum: DM_TEMPLATE_STATES }).notNull().default('draft'),
    /** Готовый шаблон платформы (блок 7). */
    builtin: boolean('builtin').notNull().default(false),
    copiedFrom: uuid('copied_from'),
    /** Последняя проверка (блок 3, пункт 1; блок 8, пункт 7): когда, на какой организации, итог. */
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    checkedOrgId: uuid('checked_org_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    checkError: text('check_error'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    check(
      'dm_templates_fields_check',
      sql`${t.code} ~ ${sql.raw(`'${DM_CODE_RE}'`)} and char_length(${t.name}) between 1 and 200 and char_length(coalesce(${t.description}, '')) <= 2000 and char_length(coalesce(${t.checkError}, '')) <= 2000 and (${t.needPermission} is null or ${t.needPermission} ~ '^[A-Za-z]{1,40}$')`,
    ),
    check(
      'dm_templates_enum_check',
      sql`${t.audience} in (${oneOf(DM_AUDIENCES)}) and ${t.access} in (${oneOf(DM_ACCESS)}) and ${t.state} in (${oneOf(DM_TEMPLATE_STATES)}) and ${t.module} in (${oneOf(DM_MODULES)})`,
    ),
    check(
      'dm_templates_json_check',
      sql`jsonb_typeof(${t.params}) = 'array' and jsonb_typeof(${t.columns}) = 'array'`,
    ),
    index('dm_templates_state_idx').on(t.audience, t.state),
    pgPolicy('dm_templates_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
    pgPolicy('dm_templates_org_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`${currentOrgId} is not null and ${t.audience} = 'org' and ${t.state} = 'published' and (${t.access} = 'all' or exists (select 1 from public.dm_template_orgs o where o.template_id = ${t.id} and o.org_id = ${currentOrgId}))`,
    }),
  ],
).enableRLS();

/** Текст запроса шаблона — один SELECT (блок 2, пункт 3); видит и меняет только администратор платформы. */
export const dmTemplateSql = pgTable(
  'dm_template_sql',
  {
    templateId: uuid('template_id')
      .primaryKey()
      .references(() => dmTemplates.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'dm_template_sql_query_check',
      sql`char_length(${t.query}) between 1 and ${sql.raw(String(DM_QUERY_MAX))}`,
    ),
    pgPolicy('dm_template_sql_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
  ],
).enableRLS();

/** Выбранные организации шаблона с доступом «Выбранные» (блок 2, пункт 2). */
export const dmTemplateOrgs = pgTable(
  'dm_template_orgs',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => dmTemplates.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'dm_template_orgs_pk', columns: [t.templateId, t.orgId] }),
    index('dm_template_orgs_org_idx').on(t.orgId),
    // Организация видит, к каким шаблонам у неё доступ; даёт и снимает доступ только администратор.
    orgIsolation('dm_template_orgs_isolation', t.orgId),
    pgPolicy('dm_template_orgs_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
    pgPolicy('dm_template_orgs_admin_insert', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: isPlatformAdmin,
    }),
    pgPolicy('dm_template_orgs_admin_update', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
    pgPolicy('dm_template_orgs_admin_delete', {
      as: 'restrictive',
      for: 'delete',
      to: appRole,
      using: isPlatformAdmin,
    }),
  ],
).enableRLS();

/**
 * API-токен (блок 5): один токен — один шаблон, до 180 дней, показывается один раз — в базе только
 * хеш SHA-256 и начало «bk_a1b2». Токен организации (`org_id`) выпускает её сотрудник с правом
 * «Управлять API-токенами», токен Админки (`org_id` пусто) — администратор платформы для шаблона «Для
 * администратора»; выпустить токен за организацию администратор не может, а отозвать любой — может.
 * Перевыпуск: у старого — `replaced_by` и `grace_until` (ещё 24 часа). Токен по запросу ищет
 * функция исполнителя Витрины — роль приложения без входа токенов не видит.
 */
export const dmTokens = pgTable(
  'dm_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Организация токена; пусто — токен Админки (в контексте без организации). */
    orgId: uuid('org_id')
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => dmTemplates.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** SHA-256 токена, 64 знака hex. */
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id),
    replacedBy: uuid('replaced_by'),
    graceUntil: timestamp('grace_until', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastIp: text('last_ip'),
    createdBy: uuid('created_by')
      .notNull()
      .default(currentUserId)
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'dm_tokens_fields_check',
      sql`char_length(${t.name}) between 1 and 100 and ${t.tokenHash} ~ '^[0-9a-f]{64}$' and ${t.prefix} ~ ${sql.raw(`'${DM_TOKEN_PREFIX_RE}'`)} and char_length(coalesce(${t.lastIp}, '')) <= 64`,
    ),
    check(
      'dm_tokens_term_check',
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '${sql.raw(String(DM_TOKEN_MAX_DAYS))} days'`,
    ),
    check(
      'dm_tokens_revoke_check',
      sql`(${t.revokedAt} is null) = (${t.revokedBy} is null) and (${t.replacedBy} is null) = (${t.graceUntil} is null)`,
    ),
    index('dm_tokens_org_idx').on(t.orgId, t.createdAt),
    index('dm_tokens_template_idx').on(t.templateId),
    pgPolicy('dm_tokens_own_org', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
    // Админка: свои токены и список токенов всех организаций (отозвать при утечке).
    pgPolicy('dm_tokens_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: adminOutsideOrg,
      withCheck: adminOutsideOrg,
    }),
    // Выпускает токен тот, кто вошёл: организация — свой, администратор — только токен Админки.
    pgPolicy('dm_tokens_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.createdBy} = ${currentUserId} and ${t.revokedAt} is null and ${t.replacedBy} is null and ((${t.orgId} is not null and not ${isPlatformAdmin}) or (${t.orgId} is null and ${isPlatformAdmin}))`,
    }),
    // Отозванный токен не возвращается; отзывает тот, кто вошёл.
    pgPolicy('dm_tokens_update_guard', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: sql`${t.revokedAt} is null`,
      withCheck: sql`${t.revokedAt} is null or ${t.revokedBy} = ${currentUserId}`,
    }),
    // Токены не удаляются: журнал запросов ссылается на них.
    pgPolicy('dm_tokens_no_delete', {
      as: 'restrictive',
      for: 'delete',
      to: appRole,
      using: sql`false`,
    }),
  ],
).enableRLS();

/**
 * Журнал запросов (блок 6, пункт 7): когда, каким токеном или с какого экрана, какой шаблон,
 * параметры, сколько строк, время, итог, адрес; хранится 90 дней. Пишет исполнитель Витрины своей
 * функцией; организация читает свои строки, Админка — все. Строки не меняются.
 */
export const dmRequests = pgTable(
  'dm_requests',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id').references(() => dmTokens.id, { onDelete: 'set null' }),
    templateId: uuid('template_id').references(() => dmTemplates.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    via: text('via', { enum: DM_REQUEST_VIA }).notNull(),
    params: jsonb('params')
      .notNull()
      .default(sql`'{}'::jsonb`),
    rowCount: integer('row_count'),
    durationMs: integer('duration_ms'),
    outcome: text('outcome', { enum: DM_REQUEST_OUTCOMES }).notNull(),
    ip: text('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'dm_requests_fields_check',
      sql`${t.via} in (${oneOf(DM_REQUEST_VIA)}) and ${t.outcome} in (${oneOf(DM_REQUEST_OUTCOMES)}) and jsonb_typeof(${t.params}) = 'object' and (${t.rowCount} is null or ${t.rowCount} >= 0) and (${t.durationMs} is null or ${t.durationMs} >= 0) and char_length(coalesce(${t.ip}, '')) <= 64`,
    ),
    index('dm_requests_org_idx').on(t.orgId, t.at),
    index('dm_requests_token_idx').on(t.tokenId, t.at),
    index('dm_requests_at_idx').on(t.at),
    // Писать роль приложения не может (права отозваны в миграции): только читать свои строки.
    orgIsolation('dm_requests_isolation', t.orgId),
    pgPolicy('dm_requests_admin_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: adminOutsideOrg,
    }),
  ],
).enableRLS();
