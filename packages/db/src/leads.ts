import {
  LEAD_IP_LIMIT,
  LEAD_IP_WINDOW_SECONDS,
  LEAD_NOTE_TOTAL_MAX,
  LEAD_REPEAT_HOURS,
  type LeadStatus,
} from '@buhuchet/domain';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { bigint, boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import type { LeadEventKind } from './schema';

/*
 * Заявки с лендинга (ТЗ «Лендинг» → «Форма «Оставить заявку»», «Админка» → «Вкладка «Заявки»»;
 * прототип modules/landing.js, admin/leads.js). Таблицы заявок роль приложения не видит (RLS без
 * политик): заявку гостя пишет функция `app.lead_submit`, список и окно заявки Админки — представления
 * `app.admin_leads` и `app.admin_lead_events`, правки — функции `app.admin_lead_*` (миграция 0089).
 * Представления и функции отдают и меняют строки, только если в контексте (`withUserContext`) —
 * незаблокированный администратор платформы.
 */

const app = pgSchema('app');

export const adminLeadsView = app
  .view('admin_leads', {
    id: uuid('id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    name: text('name').notNull(),
    firm: text('firm').notNull(),
    phone: text('phone').notNull(),
    size: text('size').notNull(),
    telegram: text('telegram'),
    note: text('note'),
    status: text('status').$type<LeadStatus>().notNull(),
    statusBefore: text('status_before').$type<LeadStatus>(),
    createdOrgId: uuid('created_org_id'),
    orgName: text('org_name'),
    adminNote: text('admin_note'),
    fromStand: boolean('from_stand').notNull(),
    version: integer('version').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    /** Кто изменил последним (администратор платформы); null — гость с лендинга. */
    updatedBy: uuid('updated_by'),
  })
  .existing();

export const adminLeadEventsView = app
  .view('admin_lead_events', {
    id: bigint('id', { mode: 'number' }).notNull(),
    leadId: uuid('lead_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    actorUserId: uuid('actor_user_id'),
    actorLogin: text('actor_login'),
    kind: text('kind').$type<LeadEventKind>().notNull(),
    fromStatus: text('from_status').$type<LeadStatus>(),
    toStatus: text('to_status').$type<LeadStatus>(),
    text: text('text'),
  })
  .existing();

export type AdminLeadRecord = typeof adminLeadsView.$inferSelect;
export type AdminLeadEventRecord = typeof adminLeadEventsView.$inferSelect;

export interface LeadSubmission {
  /** Субъект предела по адресу: хеш адреса (сам адрес не хранится). */
  ipSubject: string;
  name: string;
  firm: string;
  phone: string;
  size: string;
  telegram: string;
  note: string;
  /** Заявка с тестового стенда: в истории — «(тестовый стенд)», в Telegram не уходит. */
  fromStand: boolean;
  /** Заполнено поле-ловушка: засчитывается в предел по адресу, но не сохраняется (`trap`). */
  trap: boolean;
  /** Сообщение администраторам платформы в Telegram; null — не отправлять. */
  telegramText: string | null;
  now: Date;
}

export type LeadSubmitOutcome = 'created' | 'repeat' | 'trap' | 'limited';

/**
 * Заявка гостя с лендинга: предел по адресу, повтор с того же телефона за сутки, очередь Telegram
 * администраторам платформы — одной функцией базы в одной транзакции (миграция 0089).
 */
export async function submitLead(
  db: Db,
  s: LeadSubmission,
): Promise<{ outcome: LeadSubmitOutcome; leadId: string | null }> {
  const rows = await db.execute<{ outcome: LeadSubmitOutcome; lead_id: string | null }>(sql`
    select outcome, lead_id from app.lead_submit(
      ${s.ipSubject}, ${s.name}, ${s.firm}, ${s.phone}, ${s.size}, ${s.telegram}, ${s.note},
      ${s.fromStand}, ${s.trap}, ${s.telegramText}, ${s.now.toISOString()}::timestamptz,
      ${LEAD_IP_LIMIT}, ${LEAD_IP_WINDOW_SECONDS}, ${LEAD_REPEAT_HOURS}, ${LEAD_NOTE_TOTAL_MAX}
    )`);
  const row = rows[0];
  if (!row) throw new Error('app.lead_submit: нет ответа');
  return { outcome: row.outcome, leadId: row.lead_id };
}

/** Все заявки, от новых к старым (столбцы вкладки «Заявки»); не администратору — пусто. */
export async function adminLeadList(tx: Tx): Promise<AdminLeadRecord[]> {
  return tx.select().from(adminLeadsView).orderBy(desc(adminLeadsView.createdAt));
}

/** Заявка для окна; нет такой (или не администратор) — null. */
export async function adminLeadById(tx: Tx, id: string): Promise<AdminLeadRecord | null> {
  const [row] = await tx.select().from(adminLeadsView).where(eq(adminLeadsView.id, id));
  return row ?? null;
}

/** История заявки по порядку. */
export async function adminLeadEvents(tx: Tx, leadId: string): Promise<AdminLeadEventRecord[]> {
  return tx
    .select()
    .from(adminLeadEventsView)
    .where(eq(adminLeadEventsView.leadId, leadId))
    .orderBy(asc(adminLeadEventsView.at), asc(adminLeadEventsView.id));
}

/** Сколько заявок «Новая»: счётчик на вкладке и плитка «Заявки с сайта». */
export async function adminNewLeadCount(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(adminLeadsView)
    .where(eq(adminLeadsView.status, 'new'));
  return row?.n ?? 0;
}

/**
 * Смена статуса заявки (шаг шкалы, «Отказ», откат, «Подключена» после создания организации).
 * Допустимость шага проверяет вызывающий; `version` null — без сверки версии. Новая версия; null — не
 * администратор, заявки нет или её уже изменили.
 */
export async function setLeadStatus(
  tx: Tx,
  p: {
    id: string;
    version: number | null;
    to: LeadStatus;
    before: LeadStatus | null;
    /** Откат с причиной: в истории — «Откат». */
    rollback?: boolean;
    orgId?: string | null;
    text?: string | null;
    now: Date;
  },
): Promise<number | null> {
  const rows = await tx.execute<{ v: number | null }>(sql`
    select app.admin_lead_status(${p.id}::uuid, ${p.version}::integer, ${p.to}, ${p.before},
      ${p.rollback ?? false}, ${p.orgId ?? null}::uuid, ${p.text ?? null},
      ${p.now.toISOString()}::timestamptz) as v`);
  return rows[0]?.v ?? null;
}

/** «Заметка администратора»; ответ — как у `setLeadStatus`. */
export async function setLeadAdminNote(
  tx: Tx,
  p: { id: string; version: number; note: string; now: Date },
): Promise<number | null> {
  const rows = await tx.execute<{ v: number | null }>(sql`
    select app.admin_lead_note(${p.id}::uuid, ${p.version}::integer, ${p.note},
      ${p.now.toISOString()}::timestamptz) as v`);
  return rows[0]?.v ?? null;
}

/** «Удалить» — заявка стирается вместе с историей; false — не администратор или заявки нет. */
export async function deleteLead(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(
    sql`select app.admin_lead_delete(${id}::uuid) as ok`,
  );
  return rows[0]?.ok === true;
}
