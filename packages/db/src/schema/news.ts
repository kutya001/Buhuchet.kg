import { NEWS_AUDIENCES, NEWS_STATUSES, NEWS_TYPES } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { appRole, currentOrgId } from './rls';
import { users } from './users';

const currentUserId = sql`app.current_user_id()`;
const isPlatformAdmin = sql`app.is_platform_admin()`;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/*
 * «Новости» Базы знаний (ТЗ «База знаний» → «Новости»; «Админка → База знаний (содержимое) →
 * Новости»; задача 2.32, docs/decisions.md п. Г-3). Новости — общие данные платформы: ведёт только
 * администратор платформы, видят все пользователи всех организаций. Прочитанность — у каждого
 * пользователя своя.
 */

/**
 * Новость: черновик → опубликована; «Снято с публикации» — отметка `off`. Опубликованную видят
 * пользователи с даты публикации в 09:00 по Бишкеку (так считает и политика чтения — задачи по
 * расписанию не нужно); «Только режим Админка» — только администраторы платформы. Черновик и снятую
 * видит только администратор платформы; удалить можно только черновик.
 */
export const news = pgTable(
  'news',
  {
    /** Код: `v1` … из refDB.json, у новых — `n` и случайные буквы. */
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    /** `NewsType` из @buhuchet/domain. */
    type: text('type').notNull(),
    /** «Версия» (например, «1.4»); у объявлений можно без неё. */
    release: text('release'),
    /** Дата публикации; будущая — новость появится сама в этот день в 09:00 по Бишкеку. */
    publishDate: date('publish_date', { mode: 'string' }).notNull(),
    /** Краткое описание для ленты. */
    short: text('short').notNull(),
    /** Подробное описание в markdown. */
    md: text('md').notNull(),
    /** «Подробнее»: статья (`art`) или модуль (`mod`) Базы знаний. */
    linkKind: text('link_kind'),
    linkId: text('link_id'),
    pinned: boolean('pinned').notNull().default(false),
    /** «Показывать при входе» — в окне «Что нового», пока пользователь её не прочитал. */
    showOnLogin: boolean('show_on_login').notNull().default(true),
    /** «Для кого»: `all` — все пользователи, `adm` — только режим Админка. */
    audience: text('audience').notNull().default('all'),
    /** `draft` или `published`. */
    status: text('status').notNull().default('draft'),
    /** «Снято с публикации». */
    off: boolean('off').notNull().default(false),
    /** Когда нажали «Опубликовать» (порядок в один день; «вышла» для прочитанности). */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** «Изменено ДД.ММ.ГГГГ» — правка уже опубликованной новости. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    index('news_publish_idx').on(t.publishDate),
    check('news_id_check', sql`${t.id} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    check('news_type_check', sql`${t.type} in (${inList(NEWS_TYPES)})`),
    check('news_audience_check', sql`${t.audience} in (${inList(NEWS_AUDIENCES)})`),
    check('news_status_check', sql`${t.status} in (${inList(NEWS_STATUSES)})`),
    check(
      'news_link_check',
      sql`(${t.linkKind} is null and ${t.linkId} is null) or (${t.linkKind} in ('art', 'mod') and ${t.linkId} ~ '^[A-Za-z0-9_-]{1,64}$')`,
    ),
    check(
      'news_published_check',
      sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`,
    ),
    // Пользователям — опубликованные, не снятые, с наступившей датой (в 09:00 по Бишкеку), для всех.
    pgPolicy('news_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`${isPlatformAdmin} or (${t.status} = 'published' and not ${t.off} and ${t.audience} = 'all' and (${t.publishDate} + time '09:00') at time zone 'Asia/Bishkek' <= now())`,
    }),
    pgPolicy('news_admin_insert', {
      as: 'permissive',
      for: 'insert',
      to: appRole,
      withCheck: isPlatformAdmin,
    }),
    pgPolicy('news_admin_update', {
      as: 'permissive',
      for: 'update',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
    // Удалить можно только черновик (ТЗ): опубликованную — только снять с публикации.
    pgPolicy('news_admin_delete', {
      as: 'permissive',
      for: 'delete',
      to: appRole,
      using: sql`${isPlatformAdmin} and ${t.status} = 'draft'`,
    }),
  ],
).enableRLS();

/**
 * Прочитанные новости: открыта в ленте, показана в окне «Что нового» или «Отметить все прочитанными».
 * Отметку пользователь ставит только себе и видит только свои; администратор платформы видит все — для
 * столбца «Прочитали». Отметки не меняются и не удаляются (миграция: права UPDATE и DELETE отозваны).
 */
export const newsReads = pgTable(
  'news_reads',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Пусто — администратор платформы. */
    orgId: uuid('org_id')
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    newsId: text('news_id')
      .notNull()
      .references(() => news.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'news_reads_pk', columns: [t.userId, t.newsId] }),
    foreignKey({
      name: 'news_reads_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('news_reads_news_idx').on(t.newsId),
    index('news_reads_org_idx').on(t.orgId),
    // Свои отметки — в своей организации (меняют и удаляют их только вместе с пользователем: UPDATE
    // и DELETE отозваны, миграция news_grants); у администратора платформы организации нет.
    pgPolicy('news_reads_own', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.orgId} = ${currentOrgId} and ${t.userId} = ${currentUserId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId} and ${t.userId} = ${currentUserId}`,
    }),
    pgPolicy('news_reads_platform_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and ${isPlatformAdmin}`,
      withCheck: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and ${isPlatformAdmin}`,
    }),
    // «Прочитали» в списке Админки — число отметок всех пользователей.
    pgPolicy('news_reads_admin_count', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: isPlatformAdmin,
    }),
  ],
).enableRLS();
