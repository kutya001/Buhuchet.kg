import {
  asBotMessage,
  CODE_KINDS,
  JOURNAL_CHAT_KINDS,
  JOURNAL_DIRS,
  JOURNAL_KINDS,
  JOURNAL_STATUSES,
  journalKindKey,
  OUTBOX_UNDELIVERABLE,
  type BotMessage,
  type JournalChatKind,
  type JournalDir,
  type JournalHide,
  type JournalKind,
  type JournalSource,
  type JournalStatus,
  type ListQuery,
  type OutboxKind,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { bigint, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminOrganizations } from './admin-orgs';
import type { Db, Tx } from './client';
import { writePlatformHistory } from './platform-history';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';

/*
 * Админка → «Телеграм» → «Журнал» и «Рассылка» (ТЗ «Админка» → «Модуль Телеграмм»; прототип
 * admin/telegram.js и admin/tg-log.js; задача 2.41, docs/decisions.md п. Д-13, Т-16). Журнал переписки
 * бота всех организаций в обе стороны — представление `app.admin_telegram_journal` (миграция 0163):
 * отправленное сотрудникам и в общий чат, сообщения клиентам контрагентов с кнопками и всё полученное.
 * Строки отдаются, только если в контексте — незаблокированный администратор платформы
 * (`withUserContext`); сотруднику организации и без контекста оно пусто. Объявлено здесь, а не в
 * `schema/`: представление создаёт SQL-миграция, drizzle-kit его не ведёт.
 */
export const adminTelegramJournal = pgSchema('app')
  .view('admin_telegram_journal', {
    src: text('src').$type<JournalSource>().notNull(),
    id: uuid('id').notNull(),
    dir: text('dir').$type<JournalDir>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    chatKind: text('chat_kind').$type<JournalChatKind>().notNull(),
    orgId: uuid('org_id'),
    orgName: text('org_name'),
    userId: uuid('user_id'),
    contractorId: uuid('contractor_id'),
    recipient: text('recipient'),
    kind: text('kind').$type<JournalKind>().notNull(),
    status: text('status').$type<JournalStatus>().notNull(),
    tries: integer('tries').notNull(),
    lastError: text('last_error'),
    text: text('text'),
    hide: text('hide').$type<JournalHide>(),
    payload: jsonb('payload'),
    button: text('button'),
    messageId: bigint('message_id', { mode: 'number' }),
    replyMessageId: bigint('reply_message_id', { mode: 'number' }),
    fileName: text('file_name'),
    fileSize: bigint('file_size', { mode: 'number' }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    alertJob: text('alert_job'),
  })
  .existing();

const v = adminTelegramJournal;

/**
 * Строка журнала Админки. Номера чата в ней нет: «Вся переписка» и «Раньше · Позже» сервер находит по
 * номеру самой строки. Текст — по решению заказчика 17.11.2026; у кода и одноразовой ссылки его нет
 * (`hide` — почему).
 */
export interface AdminTelegramLogRecord {
  id: string;
  src: JournalSource;
  dir: JournalDir;
  chatKind: JournalChatKind;
  /** null — сообщение администратору платформы («Платформа») или чат ни к кому не привязан. */
  orgId: string | null;
  /** У сообщения о заявке на тестовом стенде — «Тестовый стенд» (подпись словаря). */
  orgName: string | null;
  userId: string | null;
  /** Собеседник: краткое ФИО и «@имя», контрагент и имя клиента, название общего чата. */
  recipient: string;
  kind: JournalKind;
  status: JournalStatus;
  tries: number;
  /** Ответ Telegram или код итога (`recipient_unlinked`); подпись кода — по словарю на экране. */
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  text: string | null;
  hide: JournalHide | null;
  message: BotMessage | null;
  /** Подпись нажатой кнопки (у полученного нажатия). */
  button: string | null;
  fileName: string | null;
  fileSize: number | null;
}

const fields = {
  id: v.id,
  src: v.src,
  dir: v.dir,
  chatKind: v.chatKind,
  orgId: v.orgId,
  orgName: v.orgName,
  userId: v.userId,
  recipient: v.recipient,
  kind: v.kind,
  status: v.status,
  tries: v.tries,
  lastError: v.lastError,
  createdAt: v.createdAt,
  sentAt: v.sentAt,
  text: v.text,
  hide: v.hide,
  payload: v.payload,
  button: v.button,
  fileName: v.fileName,
  fileSize: v.fileSize,
};

type Row = {
  id: string | null;
  src: JournalSource | null;
  dir: JournalDir | null;
  chatKind: JournalChatKind | null;
  orgId: string | null;
  orgName: string | null;
  userId: string | null;
  recipient: string | null;
  kind: JournalKind | null;
  status: JournalStatus | null;
  tries: number | null;
  lastError: string | null;
  createdAt: Date | null;
  sentAt: Date | null;
  text: string | null;
  hide: JournalHide | null;
  payload: unknown;
  button: string | null;
  fileName: string | null;
  fileSize: number | null;
};

function toRecord(r: Row): AdminTelegramLogRecord {
  const hide = r.hide ?? null;
  return {
    id: r.id!,
    src: r.src!,
    dir: r.dir!,
    chatKind: r.chatKind!,
    orgId: r.orgId,
    orgName: r.orgName,
    userId: r.userId,
    recipient: r.recipient ?? '',
    kind: r.kind!,
    status: r.status!,
    tries: r.tries ?? 0,
    lastError: r.lastError,
    createdAt: r.createdAt!,
    sentAt: r.sentAt,
    // У скрытого сообщения текста и описания в таблицах нет; это вторая защита.
    text: hide ? null : r.text,
    hide,
    message: hide
      ? null
      : asBotMessage(typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload),
    button: r.button,
    fileName: r.fileName,
    fileSize: r.fileSize === null ? null : Number(r.fileSize),
  };
}

/** Подписи статусов (прототип: «Отправлено», «Ожидает», «Ошибка», «Обработано», «Не распознано»). */
const STATUS_ORDER: readonly JournalStatus[] = JOURNAL_STATUSES;

function caseOf(column: SQLWrapper, codes: readonly string[], label: (code: string) => string) {
  return sql`case ${sql.join(
    codes.map((c) => sql`when ${column} = ${c} then ${label(c)}`),
    sql` `,
  )} else ${column} end`;
}

/**
 * Сообщение о заявке с лендинга на тестовом стенде: «Организация» — «Тестовый стенд», а не
 * «Платформа» (прототип v74 leadNotify: `org: LAND.test ? 'Тестовый стенд' : 'Платформа'`).
 */
function standLead(stand: boolean): SQL {
  return stand ? sql`(${v.orgId} is null and ${v.kind} = 'lead')` : sql`false`;
}

/**
 * Текст строки, как в столбце «Текст» (прототип `tgTxt`): у скрытого — «Текст скрыт…», у файла —
 * «Файл «имя»», у нажатия — «Нажата кнопка «подпись»», иначе текст одной строкой. У сообщения клиенту
 * текста в таблице нет — берётся из описания сообщения (заголовок и текст).
 */
function lineText(t: ListTexts): SQL {
  const plain = sql`coalesce(${v.text}, concat_ws(' ', ${v.payload} ->> 'heading', ${v.payload} ->> 'sub', ${v.payload} ->> 'text'))`;
  return sql`case
    when ${v.hide} = 'code' then ${t('tgadm.hide.code')}::text
    when ${v.hide} = 'link' then ${t('tgadm.hide.link')}::text
    when ${v.fileName} is not null then concat_ws(' · ', replace(${t('tgadm.txt.file')}::text, '{name}', ${v.fileName}), nullif(${v.text}, ''))
    when ${v.kind} = 'in_file' then concat_ws(' · ', ${t('tgadm.txt.photo')}::text, nullif(${v.text}, ''))
    when ${v.kind} = 'in_press' then case when ${v.button} is null then ${t('tgadm.txt.press_any')}::text else replace(${t('tgadm.txt.press')}::text, '{name}', ${v.button}) end
    else regexp_replace(${plain}, '\\s+', ' ', 'g')
  end`;
}

/**
 * Столбцы журнала на сервере (прототип admin/tg-log.js, grid 'tg-log'): ключи — как у столбцов экрана.
 * «Организация» у сообщения без организации — «Платформа», у сообщения о заявке на стенде — «Тестовый
 * стенд»; «Ошибка» с кодом `recipient_unlinked` — подпись словаря.
 */
export function adminTelegramLogColumns(t: ListTexts, stand = false): ListColumns {
  const lead = standLead(stand);
  const orgValue = sql`coalesce(${v.orgId}::text, case when ${lead} then 'stand' else 'platform' end)`;
  return {
    at: { type: 'datetime', label: 'tgadm.col.at', value: v.createdAt },
    dir: {
      type: 'enum',
      label: 'tgadm.col.dir',
      value: v.dir,
      display: caseOf(v.dir, JOURNAL_DIRS, (d) => t(`tgadm.dir.${d}`)),
    },
    to: { type: 'text', label: 'tgadm.col.to', value: sql`coalesce(${v.recipient}, '')` },
    kind: {
      type: 'enum',
      label: 'tgadm.col.kind',
      value: v.kind,
      display: caseOf(v.kind, JOURNAL_KINDS, (k) => t(journalKindKey(k))),
    },
    txt: {
      type: 'text',
      label: 'tgadm.col.txt',
      value: sql`coalesce(${v.text}, '')`,
      display: lineText(t),
    },
    org: {
      type: 'enum',
      label: 'tgadm.col.org',
      value: orgValue,
      display: sql`coalesce(${v.orgName}, case when ${lead} then ${t('tgadm.org.stand')} else ${t('tgadm.org.platform')} end)`,
      sort: { value: sql`coalesce(${v.orgName}, '')`, text: true },
    },
    st: {
      type: 'enum',
      label: 'tgadm.col.st',
      value: v.status,
      display: caseOf(v.status, STATUS_ORDER, (s) => t(`tgadm.st.${s}`)),
    },
    err: {
      type: 'text',
      label: 'tgadm.col.err',
      value: sql`case when ${v.lastError} = ${OUTBOX_UNDELIVERABLE} then ${t('tgadm.err.unlinked')} else ${v.lastError} end`,
    },
    tries: { type: 'int', label: 'tgadm.col.tries', value: v.tries },
    ct: {
      type: 'enum',
      label: 'tgadm.col.ct',
      value: v.chatKind,
      display: caseOf(v.chatKind, JOURNAL_CHAT_KINDS, (k) => t(`tgadm.ct.${k}`)),
    },
  };
}

const NATURAL = [v.createdAt, v.id];
/** Сначала новые (прототип: `sort: {key: 'at', dir: -1}`); служебных столбцов у журнала нет. */
const DEFAULT_SORT = { key: 'at', dir: 'desc' } as const;

/**
 * Что показывать: направление, с какого момента (период экрана — не дольше 90 дней) и, для «Вся
 * переписка», чат строки `chatOf` — номер чата сервер берёт из неё сам и наружу не отдаёт.
 */
export interface JournalScope {
  dir: JournalDir | null;
  from: Date;
  chatOf?: string | null;
}

function journalScope(scope: JournalScope): SQL {
  const parts: SQL[] = [sql`${v.createdAt} >= ${scope.from.toISOString()}::timestamptz`];
  if (scope.dir) parts.push(sql`${v.dir} = ${scope.dir}`);
  if (scope.chatOf) {
    parts.push(
      sql`${v.chatId} = (select j.chat_id from app.admin_telegram_journal j where j.id = ${scope.chatOf}::uuid limit 1)`,
    );
  }
  return sql.join(parts, sql` and `);
}

function logFrom(tx: Tx): ListFrom {
  return (f) => tx.select(f).from(v).$dynamic();
}

function selectPage(tx: Tx, window: ListWindowFields) {
  return tx
    .select({ ...fields, ...window })
    .from(v)
    .$dynamic();
}

/**
 * Страница журнала переписки всех организаций: сортировка, страница, фильтры, поиск и группы — на
 * сервере. Не администратору журнал пуст (представление).
 */
export async function listAdminTelegramLogPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
  scope: JournalScope,
  stand = false,
): Promise<ListPageResult<AdminTelegramLogRecord>> {
  const page = await selectListPage({
    query,
    columns: adminTelegramLogColumns(t, stand),
    natural: NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: journalScope(scope),
    select: ({ window, where, orderBy, limit, offset }) =>
      selectPage(tx, window)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: logFrom(tx),
  });
  const standOrg = t('tgadm.org.stand');
  return {
    ...page,
    rows: page.rows.map((r) => {
      const rec = toRecord(r as Row);
      return stand && rec.orgId === null && rec.kind === 'lead'
        ? { ...rec, orgName: standOrg }
        : rec;
    }),
  };
}

/** Значения столбца журнала для фильтра-галочек; `q` — «Найти значение». */
export function listAdminTelegramLogValues(
  tx: Tx,
  key: string,
  t: ListTexts,
  scope: JournalScope,
  q?: string,
  stand = false,
) {
  return selectListValues({
    columns: adminTelegramLogColumns(t, stand),
    key,
    scope: journalScope(scope),
    from: logFrom(tx),
    q,
  });
}

/** Журнал для выгрузки в Excel: все строки под поиском и фильтрами, столбцы `keys` по порядку экрана. */
export function exportAdminTelegramLog(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
  scope: JournalScope,
  stand = false,
) {
  return selectListExport({
    query,
    columns: adminTelegramLogColumns(t, stand),
    keys,
    natural: NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: journalScope(scope),
    from: logFrom(tx),
  });
}

/**
 * Плашки над журналом (прототип): «В очереди», «Ошибки отправки» — за срок хранения `since`;
 * «Отправлено сегодня» и «Получено сегодня» — по дню Бишкека.
 */
export async function adminTelegramSummary(
  tx: Tx,
  today: string,
  since: Date,
): Promise<{ pending: number; errors: number; sentToday: number; receivedToday: number }> {
  const [row] = await tx
    .select({
      pending: sql<number>`count(*) filter (where ${v.dir} = 'out' and ${v.status} = 'pending')::integer`,
      errors: sql<number>`count(*) filter (where ${v.dir} = 'out' and ${v.status} = 'error')::integer`,
      sentToday: sql<number>`count(*) filter (where ${v.dir} = 'out' and ${v.status} = 'sent' and (${v.sentAt} at time zone 'Asia/Bishkek')::date = ${today}::date)::integer`,
      receivedToday: sql<number>`count(*) filter (where ${v.dir} = 'in' and (${v.createdAt} at time zone 'Asia/Bishkek')::date = ${today}::date)::integer`,
    })
    .from(v)
    .where(sql`${v.createdAt} >= ${since.toISOString()}::timestamptz`);
  return {
    pending: row?.pending ?? 0,
    errors: row?.errors ?? 0,
    sentToday: row?.sentToday ?? 0,
    receivedToday: row?.receivedToday ?? 0,
  };
}

/** Окно «Сообщение»: само сообщение, связанные с ним и соседние в том же чате. */
export interface AdminTelegramMessage {
  message: AdminTelegramLogRecord;
  /** Сообщение бота, к которому относится полученное (нажатие, ответ). */
  bot: AdminTelegramLogRecord | null;
  /** Что пришло в ответ на это сообщение бота: нажатия и ответы. */
  replies: AdminTelegramLogRecord[];
  /** Соседние сообщения того же чата: «Раньше» и «Позже». */
  prevId: string | null;
  nextId: string | null;
}

/** Сообщение журнала с окружением; null — не найдено, старше `since` или в контексте не администратор. */
export async function adminTelegramMessage(
  tx: Tx,
  id: string,
  since: Date,
  stand = false,
  standOrg = '',
): Promise<AdminTelegramMessage | null> {
  const from = sql`${since.toISOString()}::timestamptz`;
  const [own] = await tx
    .select({
      ...fields,
      chatId: v.chatId,
      messageId: v.messageId,
      replyMessageId: v.replyMessageId,
    })
    .from(v)
    .where(and(eq(v.id, id), sql`${v.createdAt} >= ${from}`))
    .limit(1);
  if (!own) return null;
  const rec = (r: Row) => {
    const out = toRecord(r);
    return stand && out.orgId === null && out.kind === 'lead' ? { ...out, orgName: standOrg } : out;
  };
  const inChat = and(eq(v.chatId, own.chatId), sql`${v.createdAt} >= ${from}`);
  const [bot] =
    own.dir === 'in' && own.replyMessageId !== null
      ? await tx
          .select(fields)
          .from(v)
          .where(and(inChat, eq(v.dir, 'out'), eq(v.messageId, own.replyMessageId)))
          .orderBy(desc(v.createdAt))
          .limit(1)
      : [];
  const replies =
    own.dir === 'out' && own.messageId !== null
      ? await tx
          .select(fields)
          .from(v)
          .where(and(inChat, eq(v.dir, 'in'), eq(v.replyMessageId, own.messageId)))
          .orderBy(asc(v.createdAt), asc(v.id))
          .limit(20)
      : [];
  // Место строки — её же значения из базы: момент в JavaScript — до миллисекунд, а в базе — до микросекунд,
  // и со сравнением по округлённому моменту строка оказалась бы «позже» самой себя.
  const self = sql`(select j.created_at, j.id from app.admin_telegram_journal j where j.id = ${own.id}::uuid limit 1)`;
  const [prev] = await tx
    .select({ id: v.id })
    .from(v)
    .where(and(inChat, sql`(${v.createdAt}, ${v.id}) < ${self}`))
    .orderBy(desc(v.createdAt), desc(v.id))
    .limit(1);
  const [next] = await tx
    .select({ id: v.id })
    .from(v)
    .where(and(inChat, sql`(${v.createdAt}, ${v.id}) > ${self}`))
    .orderBy(asc(v.createdAt), asc(v.id))
    .limit(1);
  return {
    message: rec(own),
    bot: bot ? rec(bot) : null,
    replies: replies.map(rec),
    prevId: prev?.id ?? null,
    nextId: next?.id ?? null,
  };
}

/**
 * Сообщение о сбое задачи, которое ушло администраторам около момента `at` (окно «Запуск»): номер строки
 * журнала и когда отправлено. null — такого сообщения нет.
 */
export async function adminJobAlertMessage(
  tx: Tx,
  job: string,
  at: Date,
): Promise<{ id: string; at: Date } | null> {
  const moment = sql`${at.toISOString()}::timestamptz`;
  const [row] = await tx
    .select({ id: v.id, at: v.createdAt })
    .from(v)
    .where(
      and(
        eq(v.alertJob, job),
        sql`${v.createdAt} between ${moment} - interval '1 minute' and ${moment} + interval '5 minutes'`,
      ),
    )
    .orderBy(asc(v.createdAt), asc(v.id))
    .limit(1);
  return row ?? null;
}

/**
 * «Повторить отправку» и «Повторить ошибки» (прототип `tgNoRetry`): строки с «Ошибкой», кроме кодов
 * (восстановления и замены Telegram), снова «Ожидают» (попыток 0) и уходят обычной очередью. Отвечает, сколько строк снова
 * в очереди и сколько из выбранных — коды с ошибкой (их повторно не отправляют).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-32 — повтор уходит очередью, в прежний чат — не отправляется.
export async function adminTelegramRetry(
  tx: Tx,
  ids: readonly string[],
  now: Date,
): Promise<{ queued: number; codes: number }> {
  if (!ids.length) return { queued: 0, codes: 0 };
  const [codes] = await tx
    .select({ n: sql<number>`count(*)::integer` })
    .from(v)
    .where(
      and(
        inArray(v.id, [...ids]),
        eq(v.src, 'outbox'),
        eq(v.status, 'error'),
        inArray(v.kind, [...CODE_KINDS]),
      ),
    );
  const [row] = await tx.execute<{ n: number | null }>(
    sql`select app.admin_telegram_retry(array[${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[], ${now.toISOString()}::timestamptz) as n`,
  );
  return { queued: row?.n ?? 0, codes: codes?.n ?? 0 };
}

/**
 * «Рассылка» → «Поставить в очередь»: объявление каждому активному сотруднику действующей организации
 * (`orgId` — только этой; null — всем) с привязанным Telegram. Отвечает числом сообщений в очереди;
 * null — организация не найдена или заблокирована (или в контексте не администратор). Оформленная
 * рассылка (поток Т, задача Т6) — с описанием сообщения `message`: картинка, заголовок, кнопки-ссылки;
 * `text` — простой текст того же сообщения. Кто, когда, кому и что поставил — в историю платформы в той
 * же транзакции (картинка — номером файла, кнопки — записью сайта).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-31 — кому уходит объявление.
export async function adminTelegramBroadcast(
  tx: Tx,
  input: {
    orgId: string | null;
    text: string;
    now: Date;
    message?: BotMessage | null;
    /** Для истории: заголовок, картинка, «Подробнее» и «Смотреть видео» (вид:номер записи). */
    cast?: { title: string; image: string | null; more: string | null; video: string | null };
    /**
     * Строка колокольчика (доработки 16.11.2026, блок 3) — каждому действующему сотруднику
     * действующих организаций, и без привязанного Telegram; null — без неё.
     */
    bellText?: string | null;
  },
): Promise<number | null> {
  const payload = input.message ? JSON.stringify(input.message) : null;
  const [row] = await tx.execute<{ n: number | null }>(
    sql`select app.admin_telegram_broadcast(${input.orgId}::uuid, ${input.text}, ${payload}::jsonb, ${input.now.toISOString()}::timestamptz, ${input.bellText ?? null}) as n`,
  );
  const queued = row?.n ?? null;
  if (queued === null) return null;
  const cast = input.cast;
  await writePlatformHistory(tx, {
    entity: 'telegram_broadcast',
    entityId: input.orgId ?? 'all',
    action: 'create',
    changes: [
      ...(cast?.title ? [{ field: 'title', to: cast.title }] : []),
      { field: 'text', to: input.text },
      ...(cast?.image ? [{ field: 'image', to: cast.image }] : []),
      ...(cast?.more ? [{ field: 'more', to: cast.more }] : []),
      ...(cast?.video ? [{ field: 'video', to: cast.video }] : []),
      { field: 'queued', to: queued },
    ],
  });
  return queued;
}

/**
 * Сколько получателей у рассылки сейчас — для окна подтверждения (прототип `tgCastCount`): то же
 * условие, что у постановки в очередь. null — организация не найдена или заблокирована.
 */
export async function adminTelegramBroadcastCount(
  tx: Tx,
  orgId: string | null,
): Promise<number | null> {
  const [row] = await tx.execute<{ n: number | null }>(
    sql`select app.admin_telegram_broadcast_count(${orgId}::uuid) as n`,
  );
  return row?.n ?? null;
}

/** Действующие организации для «Кому» (прототип `ORGS.filter(o => o.active)`), по названию. */
export async function adminTelegramOrgs(tx: Tx): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: adminOrganizations.id, name: adminOrganizations.name })
    .from(adminOrganizations)
    .where(eq(adminOrganizations.status, 'active'))
    .orderBy(asc(adminOrganizations.name), asc(adminOrganizations.id));
}

/** Строка без организации, взятая на отправку (как `ClaimedOutbox`). */
export interface ClaimedPlatformOutbox {
  id: string;
  chatId: number;
  kind: OutboxKind;
  text: string;
  tries: number;
  /** Описание сообщения с таблицами и кнопками (заявка с сайта, задача Т6); пусто — обычный текст. */
  message: BotMessage | null;
  /** Получатель включил «Сообщения простым текстом». */
  plain: boolean;
}

/**
 * Строки без организации (сообщения администраторам платформы, снова поставленные в очередь «Повторить
 * отправку»): взять на отправку до `limit` строк, как `claimOutbox`. Под RLS их не видно ни в одной
 * организации, поэтому — функцией базы.
 */
export async function claimPlatformOutbox(
  db: Db,
  o: { now: Date; limit: number; leaseSeconds: number },
): Promise<ClaimedPlatformOutbox[]> {
  const rows = await db.execute<{
    id: string;
    chat_id: string | number;
    kind: OutboxKind;
    text: string;
    tries: number;
    payload: unknown;
    plain: boolean | null;
  }>(
    sql`select id, chat_id, kind, text, tries, payload, plain from app.telegram_platform_claim(${o.now.toISOString()}::timestamptz, ${o.limit}, ${o.leaseSeconds})`,
  );
  return rows.map((r) => ({
    id: r.id,
    chatId: Number(r.chat_id),
    kind: r.kind,
    text: r.text,
    tries: r.tries,
    message: asBotMessage(r.payload),
    plain: r.plain === true,
  }));
}

/**
 * Итоги попыток строк без организации (как `finishOutbox`): у отправленного сообщения с кнопками
 * запоминается номер в чате — по нему бот находит сообщение при нажатии.
 */
export async function finishPlatformOutbox(
  db: Db,
  outcomes: readonly (
    | { id: string; result: 'sent'; at: Date; messageId?: number }
    | { id: string; result: 'retry'; at: Date; error: string }
    | { id: string; result: 'error'; error: string }
  )[],
): Promise<void> {
  for (const o of outcomes) {
    const status = o.result === 'sent' ? 'sent' : o.result === 'retry' ? 'pending' : 'error';
    const nextAt = o.result === 'retry' ? o.at.toISOString() : null;
    const error = o.result === 'sent' ? null : o.error;
    const sentAt = o.result === 'sent' ? o.at.toISOString() : null;
    const messageId = o.result === 'sent' ? (o.messageId ?? null) : null;
    await db.execute(
      sql`select app.telegram_platform_finish(${o.id}::uuid, ${status}, ${nextAt}::timestamptz, ${error}, ${sentAt}::timestamptz, ${messageId}::bigint)`,
    );
  }
}
