import { LEAD_STATUSES } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { recordVersion } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Что записано в историю заявки: заявка с сайта, повтор с того же телефона, смена статуса, откат
 * статуса с причиной (в «Истории статусов» — с пометкой «Откат»), заметка, создана организация.
 */
export const LEAD_EVENT_KINDS = ['created', 'repeat', 'status', 'rollback', 'note', 'org'] as const;
export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];

/**
 * Заявки с лендинга (ТЗ «Лендинг» → «Форма «Оставить заявку»», «Админка» → «Вкладка «Заявки»»;
 * прототип admin/leads.js, решение заказчика 01.11.2026). Данные платформы, а не организации, поэтому
 * без org_id: организация, созданная по заявке, — `created_org_id`. Роль приложения таблицу не видит и
 * не меняет (RLS без политик): заявку пишет только функция базы метода без входа `app.lead_submit`,
 * читает и меняет только администратор платформы — представлением `app.admin_leads` и функциями
 * `app.admin_lead_*` от владельца схемы (миграция после этой), как у `app.admin_organizations`.
 */
export const platformLeads = pgTable(
  'platform_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** «Имя и фамилия». */
    name: text('name').notNull(),
    /** «Название фирмы». */
    firm: text('firm').notNull(),
    /** «+», код страны и цифры, как телефон сотрудника; по нему узнаётся повторная заявка. */
    phone: text('phone').notNull(),
    /** «Сколько клиентов ведёте» — вариант из словаря (`land.f.size.opts`). */
    size: text('size').notNull(),
    telegram: text('telegram'),
    /** Комментарий; повторная заявка с того же телефона дописывает свой с новой строки. */
    note: text('note'),
    status: text('status', { enum: LEAD_STATUSES }).notNull().default('new'),
    /** Статус до «Отказа»: «Снять «Отказ»» возвращает заявку в него. */
    statusBefore: text('status_before', { enum: LEAD_STATUSES }),
    /** Организация, созданная по заявке («Создать организацию»). */
    createdOrgId: uuid('created_org_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    /** «Заметка администратора» — видит только администратор платформы. */
    adminNote: text('admin_note'),
    /** Заявка с тестового стенда: в истории «Заявка с сайта (тестовый стенд)», в Telegram не уходит. */
    fromStand: boolean('from_stand').notNull().default(false),
    version: recordVersion(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('platform_leads_created_idx').on(t.createdAt),
    index('platform_leads_phone_idx').on(t.phone, t.createdAt),
    check('platform_leads_status_check', sql`${t.status} in (${inList(LEAD_STATUSES)})`),
    check(
      'platform_leads_status_before_check',
      sql`${t.statusBefore} is null or ${t.statusBefore} in (${inList(LEAD_STATUSES)})`,
    ),
  ],
).enableRLS();

/**
 * История заявки: кто, когда, с какого статуса на какой, причина или комментарий (ТЗ «В историю заявки
 * пишется…»). Хранится вместе с заявкой и стирается с ней («Удалить» — заявка стирается полностью).
 * `actor_user_id` пусто — запись гостя с лендинга.
 */
export const platformLeadEvents = pgTable(
  'platform_lead_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => platformLeads.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: LEAD_EVENT_KINDS }).notNull(),
    fromStatus: text('from_status', { enum: LEAD_STATUSES }),
    toStatus: text('to_status', { enum: LEAD_STATUSES }),
    /** Причина отката и отказа, название созданной организации; у повторной заявки — её комментарий. */
    text: text('text'),
  },
  (t) => [
    index('platform_lead_events_lead_idx').on(t.leadId, t.at),
    check('platform_lead_events_kind_check', sql`${t.kind} in (${inList(LEAD_EVENT_KINDS)})`),
  ],
).enableRLS();
