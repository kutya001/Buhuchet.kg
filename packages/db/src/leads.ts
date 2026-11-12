import {
  LEAD_IP_LIMIT,
  LEAD_IP_WINDOW_SECONDS,
  LEAD_NOTE_TOTAL_MAX,
  LEAD_REPEAT_HOURS,
  PLATFORM_ADMIN_NAME,
  scaleStatuses,
  type LeadEventKind,
  type LeadStatus,
  type ListQuery,
} from '@buhuchet/domain';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { bigint, boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
} from './list';
import { dictLiteral, textLiteral } from './sql-text';

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

/** Заявка для Админки; `updatedByGuest` — последнюю запись истории оставил посетитель сайта. */
export type AdminLeadRecord = typeof adminLeadsView.$inferSelect & {
  updatedByGuest: boolean;
  /** Когда статус ставили в последний раз и кто: посетитель сайта (заявка) или администратор. */
  statusAt: Date | null;
  statusByGuest: boolean;
};
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
  /** Заявка с тестового стенда: в истории — «(тестовый стенд)». */
  fromStand: boolean;
  /** Заполнено поле-ловушка: засчитывается в предел по адресу, но не сохраняется (`trap`). */
  trap: boolean;
  /** Сообщение администраторам платформы в Telegram о новой заявке; null — не отправлять. */
  telegramText: string | null;
  /**
   * Сообщение о повторной заявке с того же телефона за сутки; null — не отправлять. Вместо фирмы, имени
   * и «клиентов» — метки `LEAD_REPEAT_MARKS`: их заменяют значения сохранённой заявки.
   */
  telegramRepeatText: string | null;
  now: Date;
}

/**
 * Метки в тексте о повторной заявке: функция базы заменяет их фирмой, именем и «клиентов» сохранённой
 * заявки, а не второй формы (прототип v74 `leadTgPreview(o.dup ? o.lead : o)`; миграция 0092). Знак
 * U+0001 в поля формы не пропускает проверка однострочных полей.
 */
export const LEAD_REPEAT_MARKS = {
  firm: '\u0001фирма\u0001',
  name: '\u0001имя\u0001',
  size: '\u0001клиентов\u0001',
} as const;

export type LeadSubmitOutcome = 'created' | 'repeat' | 'trap' | 'limited';

/**
 * Заявка гостя с лендинга: предел по адресу, повтор с того же телефона за сутки, очередь Telegram
 * администраторам платформы о новой и о повторной заявке — одной функцией базы в одной транзакции
 * (миграции 0089, 0092).
 */
export async function submitLead(
  db: Db,
  s: LeadSubmission,
): Promise<{ outcome: LeadSubmitOutcome; leadId: string | null }> {
  const rows = await db.execute<{ outcome: LeadSubmitOutcome; lead_id: string | null }>(sql`
    select outcome, lead_id from app.lead_submit(
      ${s.ipSubject}, ${s.name}, ${s.firm}, ${s.phone}, ${s.size}, ${s.telegram}, ${s.note},
      ${s.fromStand}, ${s.trap}, ${s.telegramText}, ${s.telegramRepeatText},
      ${s.now.toISOString()}::timestamptz,
      ${LEAD_IP_LIMIT}, ${LEAD_IP_WINDOW_SECONDS}, ${LEAD_REPEAT_HOURS}, ${LEAD_NOTE_TOTAL_MAX}
    )`);
  const row = rows[0];
  if (!row) throw new Error('app.lead_submit: нет ответа');
  return { outcome: row.outcome, leadId: row.lead_id };
}

const v = adminLeadsView;

/** Порядок статусов шкалы «Заявка» для сортировки: Новая, В работе, Подключена, Отказ. */
const LEAD_STATUS_ORDER = sql.raw(
  `case "status" ${scaleStatuses('lead')
    .map((s, i) => `when '${s}' then ${i}`)
    .join(' ')} end`,
);

/**
 * «Изменил» — посетитель сайта, если последняя запись истории заявки — его (заявка или повтор с того же
 * телефона), иначе администратор платформы: так и у демо-заявок наполнения, где автора-администратора
 * нет. Для фильтра и группы — код (`guest`) или имя (`PLATFORM_ADMIN_NAME`), без параметров запроса.
 */
// Столбец заявки с именем представления: в подзапросе Drizzle пишет имя столбца без него.
const LEAD_ID = sql.raw('"admin_leads"."id"');
const BY_GUEST = sql<boolean>`coalesce((select le.kind in ('created', 'repeat')
  from app.admin_lead_events le where le.lead_id = ${LEAD_ID}
  order by le.at desc, le.id desc limit 1), true)`;
/**
 * Последняя смена статуса заявки (прототип `stSince` для `lead`: под компактной шкалой — когда и кто):
 * заявка посетителя («Новая») или смена статуса, откат и «Подключена» при создании организации.
 */
const STATUS_EVENT = sql`from app.admin_lead_events le where le.lead_id = ${LEAD_ID}
  and (le.kind = 'created'
    or (le.kind in ('status', 'rollback', 'org') and le.from_status is distinct from le.to_status))
  order by le.at desc, le.id desc limit 1`;
const STATUS_AT = sql<Date | null>`(select le.at ${STATUS_EVENT})`.mapWith((x: unknown) =>
  x === null || x === undefined ? null : new Date(x as string),
);
const STATUS_BY_GUEST = sql<boolean>`coalesce((select le.kind = 'created' ${STATUS_EVENT}), true)`;
const GUEST = textLiteral('guest');
const ADMIN = textLiteral(PLATFORM_ADMIN_NAME);
const UPDATED_BY = sql`case when ${BY_GUEST} then ${GUEST} else ${ADMIN} end`;

/**
 * Столбцы вкладки «Заявки» на сервере (прототип admin/leads.js, renderLeads): дата, имя, фирма,
 * телефон, клиентов, Telegram, комментарий, статус, организация; ключи — как у столбцов экрана.
 * Телефон ищется без пробелов и «+» (`compact`), статус сортируется по шкале, «Создал» — посетитель
 * сайта (`leads.guest`), «Изменил» — администратор платформы или посетитель (повторная заявка).
 */
export function adminLeadListColumns(t: ListTexts): ListColumns {
  const statusText = sql`case ${v.status} ${sql.join(
    scaleStatuses('lead').map(
      (s) => sql`when ${textLiteral(s)} then ${dictLiteral(t(`status.lead.${s}`))}`,
    ),
    sql` `,
  )} end`;
  const guest = dictLiteral(t('leads.guest'));
  return {
    // Прототип (renderLeads): «Дата» — текстовый столбец (фильтр по тексту «01.11.2026 10:42»),
    // сортируется по времени заявки.
    at: {
      type: 'text',
      label: 'leads.col.at',
      value: sql`to_char(${v.createdAt} at time zone 'Asia/Bishkek', 'DD.MM.YYYY HH24:MI')`,
      sort: { value: v.createdAt, text: false },
    },
    name: { type: 'text', label: 'leads.col.name', value: v.name },
    firm: { type: 'text', label: 'leads.col.firm', value: v.firm },
    phone: { type: 'text', label: 'leads.col.phone', value: v.phone, compact: true },
    size: { type: 'enum', label: 'leads.col.size', value: v.size },
    telegram: { type: 'text', label: 'leads.col.telegram', value: v.telegram, compact: true },
    note: { type: 'text', label: 'leads.col.note', value: v.note },
    status: {
      type: 'enum',
      label: 'leads.col.status',
      value: v.status,
      display: statusText,
      sort: { value: LEAD_STATUS_ORDER, text: false },
    },
    org: { type: 'text', label: 'leads.col.org', value: v.orgName },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: v.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: v.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: GUEST, display: guest },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: UPDATED_BY,
      display: sql`case when ${BY_GUEST} then ${guest} else ${ADMIN} end`,
    },
  };
}

const NATURAL = [v.createdAt, v.id];

const LEAD_FIELDS = {
  id: v.id,
  createdAt: v.createdAt,
  name: v.name,
  firm: v.firm,
  phone: v.phone,
  size: v.size,
  telegram: v.telegram,
  note: v.note,
  status: v.status,
  statusBefore: v.statusBefore,
  createdOrgId: v.createdOrgId,
  orgName: v.orgName,
  adminNote: v.adminNote,
  fromStand: v.fromStand,
  version: v.version,
  updatedAt: v.updatedAt,
  updatedBy: v.updatedBy,
  updatedByGuest: BY_GUEST,
  statusAt: STATUS_AT,
  statusByGuest: STATUS_BY_GUEST,
};

/** Все заявки, от новых к старым (столбцы вкладки «Заявки»); не администратору — пусто. */
export async function adminLeadList(tx: Tx): Promise<AdminLeadRecord[]> {
  return tx.select(LEAD_FIELDS).from(v).orderBy(desc(v.createdAt));
}

/**
 * Заявка с сайта, по которой создана организация (карточка организации в Админке → «Из заявки»):
 * самая ранняя; null — организация создана без заявки или в контексте не администратор платформы.
 */
export async function adminLeadOfOrganization(
  tx: Tx,
  orgId: string,
): Promise<{ id: string; title: string; at: Date } | null> {
  const [row] = await tx
    .select({ id: v.id, firm: v.firm, name: v.name, at: v.createdAt })
    .from(v)
    .where(eq(v.createdOrgId, orgId))
    .orderBy(asc(v.createdAt))
    .limit(1);
  return row ? { id: row.id, title: row.firm || row.name, at: row.at } : null;
}

function leadFrom(tx: Tx): ListFrom {
  return (f) => tx.select(f).from(v).$dynamic();
}

/**
 * Страница вкладки «Заявки»: сортировка, страница, фильтры, поиск и группы — на сервере. Не
 * администратору список пуст (представление).
 */
export async function listAdminLeadsPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<AdminLeadRecord>> {
  const page = await selectListPage({
    query,
    columns: adminLeadListColumns(t),
    natural: NATURAL,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...LEAD_FIELDS, ...window })
        .from(v)
        .$dynamic()
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: leadFrom(tx),
  });
  return page;
}

/** Значения столбца вкладки «Заявки» для фильтра-галочек; `q` — «Найти значение». */
export function listAdminLeadValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: adminLeadListColumns(t),
    key,
    scope: undefined,
    from: leadFrom(tx),
    q,
  });
}

/** Заявки для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys` по порядку экрана. */
export function exportAdminLeads(tx: Tx, query: ListQuery, keys: readonly string[], t: ListTexts) {
  return selectListExport({
    query,
    columns: adminLeadListColumns(t),
    keys,
    natural: NATURAL,
    scope: undefined,
    from: leadFrom(tx),
  });
}

/** Заявка для окна; нет такой (или не администратор) — null. */
export async function adminLeadById(tx: Tx, id: string): Promise<AdminLeadRecord | null> {
  const [row] = await tx.select(LEAD_FIELDS).from(v).where(eq(v.id, id));
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

/**
 * Сколько незаблокированных администраторов платформы с привязанным Telegram получат сообщение о
 * заявке: 0 — предупреждение над вкладкой «Заявки» (прототип v74, миграция 0092). Не администратору — 0.
 */
export async function adminLeadRecipients(tx: Tx): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`select app.admin_lead_recipients() as n`);
  return Number(rows[0]?.n ?? 0);
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

/** По заявке нельзя создать организацию: её нет (или не администратор) либо организация уже создана. */
export class LeadLinkError extends Error {
  constructor(readonly reason: 'not_found' | 'org_exists') {
    super(reason === 'not_found' ? 'Заявка не найдена' : 'По заявке уже создана организация');
    this.name = 'LeadLinkError';
  }
}

/**
 * Организация создана по заявке (прототип addOrgDlg): заявка получает «Подключена» и ссылку на
 * организацию, в истории — «Статус: … → Подключена, создана организация «…»», а у уже «Подключена» —
 * «Создана организация «…»». Вызывается в транзакции создания организации.
 */
export async function connectLeadToOrganization(
  tx: Tx,
  p: { id: string; orgId: string; orgName: string; now: Date },
): Promise<number> {
  const lead = await adminLeadById(tx, p.id);
  if (!lead) throw new LeadLinkError('not_found');
  if (lead.createdOrgId) throw new LeadLinkError('org_exists');
  const version = await setLeadStatus(tx, {
    id: p.id,
    version: null,
    to: 'connected',
    before: null,
    orgId: p.orgId,
    text: p.orgName,
    now: p.now,
  });
  if (version === null) throw new LeadLinkError('org_exists');
  return version;
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
