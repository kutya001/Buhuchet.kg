import { BELL_FROM, BELL_PAGE_SIZE, type BellKind } from '@buhuchet/domain';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { adminLeadsView } from './leads';
import { NEWS_BELL } from './news';
import { contractors, employees, news, orgSettings, reports, roles, tasks } from './schema';

/*
 * Колокольчик уведомлений (доработки 16.11.2026, блок 3; поток Т; стык «Положить уведомление» —
 * /mnt/project-files/stream-t/bell-contract.md): строки по расписанию, запись и чтение строк.
 */

/** Час напоминаний организации из контекста «ЧЧ:ММ» (`org_settings.digest_time`, по умолчанию 09:00). */
export async function bellDigestTime(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ at: sql<string>`to_char(${orgSettings.digestTime}, 'HH24:MI')` })
    .from(orgSettings);
  return row?.at ?? '09:00';
}

/** Строка колокольчика для записи (`putBell` модуля telegram API). */
export interface BellRowInput {
  userId: string;
  kind: string;
  event: string;
  targetKind: string | null;
  targetId: string | null;
  contractorId: string | null;
  need: string | null;
  text: string;
  eventKey: string;
}

/**
 * Положить строки в колокольчик организации из контекста (у администратора платформы — без организации):
 * в транзакции действия; строка с тем же ключом события у того же человека второй раз не кладётся.
 * Число добавленных — по счёту строк, без RETURNING: чужие строки RLS вошедшему не показывает.
 */
export async function insertBellRows(
  tx: Tx,
  rows: readonly BellRowInput[],
  now: Date,
): Promise<number> {
  if (!rows.length) return 0;
  const json = JSON.stringify(
    rows.map((r) => ({
      user_id: r.userId,
      kind: r.kind,
      event: r.event,
      target_kind: r.targetKind,
      target_id: r.targetId,
      contractor_id: r.contractorId,
      need: r.need,
      text: r.text,
      event_key: r.eventKey,
    })),
  );
  const res = await tx.execute(sql`
    insert into bell_notifications
      (org_id, user_id, kind, event, target_kind, target_id, contractor_id, need, text, created_at, event_key)
    select app.current_org_id(), r.user_id, r.kind, r.event, r.target_kind, r.target_id,
      r.contractor_id, r.need, r.text, ${now.toISOString()}::timestamptz, r.event_key
    from jsonb_to_recordset(${json}::jsonb) as r(user_id uuid, kind text, event text,
      target_kind text, target_id text, contractor_id uuid, need text, text text, event_key text)
    on conflict (user_id, event_key) do nothing`);
  return res.count ?? 0;
}

/**
 * Что вошедший видит по правам сейчас (прототип `bellSees`): строку без нужного права, со скрытым или
 * архивным контрагентом, с отчётом или задачей вне области — не видно; вернули право — снова видно.
 */
export interface BellSight {
  /** Права вошедшего из 40: право строки (`need`) должно быть среди них. */
  permissions: readonly string[];
  /** Контрагент строки — условие области на `contractors`; undefined — все контрагенты. */
  contractors: SQL | undefined;
  /** Отчёт — условие области на `reports` с `contractors`; undefined — все отчёты. */
  reports: SQL | undefined;
  /** Задача — условие на `tasks`; undefined — все; null — модуль «Задачи» выключен. */
  tasks: SQL | undefined | null;
  /** «Отправленные файлы» — функция страницы контрагента. */
  cpSent: boolean;
  /** «Обслуживание» — функция «Плата за обслуживание» и право «Видеть плату за обслуживание». */
  cpFee: boolean;
  /** Карточка сотрудника — право «Просматривать сотрудников». */
  staff: boolean;
}

const B = sql.raw('bell_notifications');
const ID_RE = /^[0-9a-f-]{36}$/;
const csv = (list: readonly string[]) => list.filter((x) => /^[A-Za-z]+$/.test(x)).join(',');

/** Условие видимости строки `b` вошедшему (без вкладки и страницы). */
function seen(s: BellSight): SQL {
  const task =
    s.tasks === null
      ? sql`false`
      : sql`exists (select 1 from ${tasks} where ${tasks.id}::text = b.target_id and ${s.tasks ?? sql`true`})`;
  return sql`b.user_id = app.current_user_id()
    and (b.need is null or b.need = any(string_to_array(${csv(s.permissions)}, ',')))
    and (b.contractor_id is null or exists (select 1 from ${contractors}
      where ${contractors.id} = b.contractor_id and ${contractors.serviceStatus} <> 'archived'
      and ${s.contractors ?? sql`true`}))
    and case b.target_kind
      when 'report' then exists (select 1 from ${reports}
        join ${contractors} on ${contractors.id} = ${reports.contractorId}
        where ${reports.id}::text = b.target_id and ${s.reports ?? sql`true`})
      when 'task' then ${task}
      when 'tasks_tab' then ${s.tasks === null ? sql`false` : sql`true`}
      when 'news' then exists (select 1 from ${news} where ${news.id}::text = b.target_id and ${NEWS_BELL.live})
      when 'lead' then app.is_platform_admin()
      when 'cp_sent' then ${s.cpSent}::boolean
      when 'cp_fee' then ${s.cpFee}::boolean
      when 'employee' then ${s.staff}::boolean
      else true end`;
}

/** Строка панели колокольчика. */
export interface BellItemRow {
  id: string;
  kind: BellKind;
  event: string;
  contractorId: string | null;
  contractorName: string | null;
  text: string;
  at: Date;
  read: boolean;
  targetKind: string | null;
  targetId: string | null;
}

/**
 * Страница колокольчика вошедшего: по `BELL_PAGE_SIZE`, от новых к старым; `before` — номер последней
 * показанной строки («Показать ещё»); вкладка — кнопка-фильтр (`all` — все, с «Другим»).
 */
export async function bellPage(
  tx: Tx,
  s: BellSight,
  q: { tab: BellKind | 'all'; before?: string | null },
): Promise<{ items: BellItemRow[]; more: boolean }> {
  const tab = q.tab === 'all' ? sql`true` : sql`b.kind = ${q.tab}`;
  const before =
    q.before && ID_RE.test(q.before)
      ? sql`(b.created_at, b.id) < (select x.created_at, x.id from ${B} x where x.id = ${q.before}::uuid and x.user_id = app.current_user_id())`
      : sql`true`;
  const rows = await tx.execute<{
    id: string;
    kind: BellKind;
    event: string;
    contractor_id: string | null;
    contractor_name: string | null;
    text: string;
    created_at: string | Date;
    read: boolean;
    target_kind: string | null;
    target_id: string | null;
  }>(sql`
    select b.id, b.kind, b.event, b.contractor_id,
      (select ${contractors.name} from ${contractors} where ${contractors.id} = b.contractor_id) as contractor_name,
      b.text, b.created_at, b.read_at is not null as read, b.target_kind, b.target_id
    from ${B} b
    where ${seen(s)} and ${tab} and ${before}
    order by b.created_at desc, b.id desc
    limit ${BELL_PAGE_SIZE + 1}`);
  const items = rows.slice(0, BELL_PAGE_SIZE).map((r) => ({
    id: r.id,
    kind: r.kind,
    event: r.event,
    contractorId: r.contractor_id,
    contractorName: r.contractor_name,
    text: r.text,
    at: new Date(r.created_at),
    read: r.read,
    targetKind: r.target_kind,
    targetId: r.target_id,
  }));
  return { items, more: rows.length > BELL_PAGE_SIZE };
}

/** Сколько строк вошедший ещё не видел (значок колокольчика). */
export async function bellUnseen(tx: Tx, s: BellSight): Promise<number> {
  const [row] = await tx.execute<{ n: number }>(
    sql`select count(*)::integer as n from ${B} b where b.seen_at is null and ${seen(s)}`,
  );
  return row?.n ?? 0;
}

/** Открыл панель — все свои строки просмотрены (на всех устройствах). */
export async function bellSeenAll(tx: Tx, now: Date): Promise<number> {
  const res = await tx.execute(
    sql`update ${B} set seen_at = ${now.toISOString()}::timestamptz where user_id = app.current_user_id() and seen_at is null`,
  );
  return res.count ?? 0;
}

/**
 * Нажал строку — прочитана (и просмотрена). Возвращает новость строки (её отметить прочитанной и в
 * «Новостях»); null — строки нет или она чужая.
 */
export async function bellRead(
  tx: Tx,
  id: string,
  now: Date,
): Promise<{ newsId: string | null } | null> {
  if (!ID_RE.test(id)) return null;
  const at = sql`${now.toISOString()}::timestamptz`;
  const [row] = await tx.execute<{ target_kind: string | null; target_id: string | null }>(sql`
    update ${B} set read_at = coalesce(read_at, ${at}), seen_at = coalesce(seen_at, ${at})
    where id = ${id}::uuid and user_id = app.current_user_id()
    returning target_kind, target_id`);
  if (!row) return null;
  return { newsId: row.target_kind === 'news' ? row.target_id : null };
}

/** «Прочитать все»: все свои строки, без вкладки. Возвращает новости — отметить и в «Новостях». */
export async function bellReadAll(tx: Tx, now: Date): Promise<string[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const rows = await tx.execute<{ target_kind: string | null; target_id: string | null }>(sql`
    update ${B} set read_at = ${at}, seen_at = coalesce(seen_at, ${at})
    where user_id = app.current_user_id() and read_at is null
    returning target_kind, target_id`);
  return rows.filter((r) => r.target_kind === 'news' && r.target_id).map((r) => r.target_id!);
}

/**
 * Новости — в колокольчик вошедшего при чтении (прототип `bellNews`): каждая опубликованная с
 * `BELL_FROM`, которую он видит; прочитанная в «Новостях» — прочитана и здесь, в том числе раньше
 * положенная строка. Время строки — появление новости (09:00 по Бишкеку дня публикации).
 */
export async function bellSyncNews(tx: Tx, now: Date): Promise<void> {
  const at = sql`${now.toISOString()}::timestamptz`;
  await tx.execute(sql`
    insert into ${B} (org_id, user_id, kind, event, target_kind, target_id, text, created_at, event_key, seen_at, read_at)
    select app.current_org_id(), app.current_user_id(), 'news', 'news', 'news', ${news.id}::text,
      left(${news.title}, 1000), ${NEWS_BELL.at}, 'news:' || ${news.id},
      case when ${NEWS_BELL.read} then ${at} end, case when ${NEWS_BELL.read} then ${at} end
    from ${news}
    where ${NEWS_BELL.live} and ${news.publishDate} >= ${BELL_FROM}::date
    on conflict (user_id, event_key) do nothing`);
  await tx.execute(sql`
    update ${B} b set read_at = ${at}, seen_at = coalesce(b.seen_at, ${at})
    where b.user_id = app.current_user_id() and b.event = 'news' and b.read_at is null
      and exists (select 1 from ${news} where ${news.id}::text = b.target_id and ${NEWS_BELL.read})`);
}

/**
 * Режим Админка: новые заявки с лендинга — в колокольчик администратора платформы при чтении (прототип
 * `bellLeads`): со статусом «Новая» и поданные не раньше `BELL_FROM`. Строка без организации; фраза —
 * `template` с `{name}` (название фирмы из заявки).
 */
export async function bellSyncLeads(tx: Tx, template: string): Promise<void> {
  await tx.execute(sql`
    insert into ${B} (org_id, user_id, kind, event, target_kind, target_id, text, created_at, event_key)
    select null, app.current_user_id(), 'other', 'lead', 'lead', ${adminLeadsView.id}::text,
      left(replace(${template}::text, '{name}', ${adminLeadsView.firm}), 1000), ${adminLeadsView.createdAt},
      'lead:' || ${adminLeadsView.id}
    from ${adminLeadsView}
    where ${adminLeadsView.status} = 'new'
      and (${adminLeadsView.createdAt} at time zone 'Asia/Bishkek')::date >= ${BELL_FROM}::date
    on conflict (user_id, event_key) do nothing`);
}

/**
 * Уборка строк старше 90 дней (`app.bell_cleanup`, миграция этапа 0): в контексте организации без
 * пользователя — её строки, без организации — строки администраторов платформы. Сама задача строк не
 * видит (RLS: читает и удаляет только получатель). Отвечает, сколько удалено.
 */
export async function bellCleanup(db: Db | Tx): Promise<number> {
  const [row] = await db.execute<{ n: number | string | null }>(
    sql`select app.bell_cleanup() as n`,
  );
  return Number(row?.n ?? 0);
}

/** Ответственный контрагента и действующие владельцы организации по порядку (для `bellContractorUsers`). */
export async function contractorBellStaff(
  tx: Tx,
  contractorId: string,
): Promise<{ responsibleId: string | null; ownerIds: string[] } | null> {
  const [cp] = await tx
    .select({ responsibleId: contractors.responsibleEmployeeId })
    .from(contractors)
    .where(eq(contractors.id, contractorId));
  if (!cp) return null;
  const owners = await tx
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(and(eq(roles.isOwner, true), eq(employees.active, true)))
    .orderBy(asc(employees.createdAt), asc(employees.id));
  return { responsibleId: cp.responsibleId, ownerIds: owners.map((o) => o.id) };
}
