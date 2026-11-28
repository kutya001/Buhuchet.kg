import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { users } from './users';

const currentUserId = sql`app.current_user_id()`;

/**
 * Кнопки-фильтры панели «Уведомления»: строка вида `other` (заявки и прочее) — только во «Все»; `req` —
 * запросы администратору (доработки 28.11.2026: запросы, блок 5, пункт 5; кнопку «Запросы» и строки
 * кладёт этап 2 пакета, в домене вид появится вместе с ними).
 */
export const BELL_KINDS = ['reports', 'tasks', 'files', 'money', 'news', 'other', 'req'] as const;
export type BellKind = (typeof BELL_KINDS)[number];

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/*
 * Колокольчик уведомлений (доработки 16.11.2026, блок 3; общая основа пакета — этап 0, миграция 0157;
 * стык «Положить уведомление» потока Т — /mnt/project-files/stream-t/bell-contract.md, раздел 1). Одна
 * строка — одно событие у одного человека: всё, что он получает в Telegram (и получил бы, будь Telegram
 * привязан), а новости и заявки поток Т кладёт при чтении — от имени самого вошедшего.
 */

/**
 * Уведомление в колокольчике. «Просмотрено» (`seen_at` — открыл панель) и «прочитано» (`read_at` — нажал
 * строку) хранятся на сервере, у каждого человека свои, и не зависят от устройства. Одно событие у
 * человека — одна строка, в том числе при перезапуске расписания (`event_key`). Строки старше 90 дней
 * убирает задача потока Т функцией `app.bell_cleanup()` (миграция 0157).
 *
 * Строки организации кладёт любое действие или задача этой организации (событие доходит до ответственного),
 * а читает, отмечает и удаляет только сам получатель: ограничительные политики ниже. Поэтому `INSERT … ON
 * CONFLICT DO NOTHING` чужому человеку работает, а `RETURNING` по чужим строкам — нет; `DO UPDATE` не
 * годится (ошибка RLS выдаёт, есть ли событие у коллеги). Контекст без пользователя (задача, страница
 * контрагента, бот клиента) строки только кладёт; уборка старше 90 дней — функцией `app.bell_cleanup()`.
 * Пустой `org_id` — строка администратора платформы (режим Админка): её видит и пишет только он сам.
 */
export const bellNotifications = pgTable(
  'bell_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Пусто — администратор платформы. */
    orgId: uuid('org_id')
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Кому. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Кнопка-фильтр панели (`BELL_KINDS`). */
    kind: text('kind').notNull(),
    /** Вид события — значок и проверка «каждый вид как в Telegram» (`day_dues`, `cp_file`, `news`…). */
    event: text('event').notNull(),
    /** Что открыть по нажатию: вид и номер записи (отчёт, задача, контрагент, новость…); может быть пусто. */
    targetKind: text('target_kind'),
    targetId: text('target_id'),
    /**
     * Контрагент строки: имя в строке, область «Свои / Все» и «скрыт контрагент — строки нет». Ключ на пару
     * (contractor_id, org_id) — строки удаляются вместе с контрагентом.
     */
    contractorId: uuid('contractor_id'),
    /** Право из 40, без которого строку сейчас не видно (область — по группе этого права); пусто — без права. */
    need: text('need'),
    /** Что случилось, одной фразой, без имени контрагента (имя берётся при чтении). */
    text: text('text').notNull(),
    /** Ключ события: тот же, что у очереди Telegram, где он есть, иначе `<event>:<запись>`. */
    eventKey: text('event_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Просмотрено — открыл панель (счётчик гаснет на всех устройствах). */
    seenAt: timestamp('seen_at', { withTimezone: true }),
    /** Прочитано — нажал строку (новость — и в «Новостях»). */
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    unique('bell_notifications_event_key').on(t.userId, t.eventKey),
    foreignKey({
      name: 'bell_notifications_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'bell_notifications_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    index('bell_notifications_user_idx').on(t.userId, t.createdAt.desc()),
    // Счётчик непросмотренных — раз в минуту у каждого открытого окна.
    index('bell_notifications_unseen_idx')
      .on(t.userId)
      .where(sql`${t.seenAt} is null`),
    // Уборка строк старше 90 дней — по организации.
    index('bell_notifications_org_created_idx').on(t.orgId, t.createdAt),
    index('bell_notifications_contractor_idx')
      .on(t.orgId, t.contractorId)
      .where(sql`${t.contractorId} is not null`),
    check('bell_notifications_kind_check', sql`${t.kind} in (${inList(BELL_KINDS)})`),
    check('bell_notifications_event_check', sql`${t.event} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      'bell_notifications_target_check',
      sql`(${t.targetKind} is null) = (${t.targetId} is null) and (${t.targetKind} is null or (${t.targetKind} ~ '^[a-z][a-z0-9_]{0,39}$' and char_length(${t.targetId}) between 1 and 100))`,
    ),
    check(
      'bell_notifications_need_check',
      sql`${t.need} is null or ${t.need} ~ '^[a-zA-Z]{1,40}$'`,
    ),
    check('bell_notifications_text_check', sql`char_length(${t.text}) between 1 and 1000`),
    check('bell_notifications_event_key_check', sql`char_length(${t.eventKey}) between 1 and 200`),
    // У строки администратора платформы контрагента нет.
    check(
      'bell_notifications_contractor_check',
      sql`${t.contractorId} is null or ${t.orgId} is not null`,
    ),
    orgIsolation('bell_notifications_isolation', t.orgId),
    pgPolicy('bell_notifications_platform_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and app.is_platform_admin()`,
      withCheck: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and app.is_platform_admin()`,
    }),
    // Читает, отмечает и удаляет только получатель (DELETE без условия по столбцам политику чтения не
    // включает — нужна своя). Положить строку другому сотруднику своей организации можно (политика
    // изоляции); контекст без пользователя строк не видит и не удаляет.
    pgPolicy('bell_notifications_own_select', {
      as: 'restrictive',
      for: 'select',
      to: appRole,
      using: sql`${t.userId} = ${currentUserId}`,
    }),
    pgPolicy('bell_notifications_own_update', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: sql`${t.userId} = ${currentUserId}`,
      withCheck: sql`${t.userId} = ${currentUserId}`,
    }),
    pgPolicy('bell_notifications_own_delete', {
      as: 'restrictive',
      for: 'delete',
      to: appRole,
      using: sql`${t.userId} = ${currentUserId}`,
    }),
  ],
).enableRLS();
