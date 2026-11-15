import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { employees, roles } from './schema';

/*
 * Telegram заявителя и пароль владельца по ссылке (доработки 14.11.2026, блок 1; поток Т; прототип v113
 * modules/tg-lead.js) — функциями app.lead_tg_* и app.password_setup_* (миграция 0149): таблицы ссылок
 * роль приложения не видит. Сюда приходят только SHA-256 ключей; сами ключи — в API.
 */

const iso = (d: Date) => d.toISOString();

/** Ссылка «Подключить Telegram» в подаче заявки: новая, прежняя этого браузера или «уже подключён». */
export type LeadTgIssue = { outcome: 'new' | 'same'; till: Date } | { outcome: 'linked' };

/**
 * В транзакции подачи заявки (тот же `now`, что у `submitLead`): новой заявке — ключ `hash` на `ttlHours`
 * часов; повтору — только ссылка браузера, который её получил (`priorHash`). null — ссылки нет.
 */
export async function issueLeadTgToken(
  tx: Tx,
  p: { leadId: string; hash: string; priorHash: string | null; now: Date; ttlHours: number },
): Promise<LeadTgIssue | null> {
  const [row] = await tx.execute<{ outcome: string; till: Date | string | null }>(sql`
    select outcome, till from app.lead_tg_issue(${p.leadId}::uuid, ${p.hash}, ${p.priorHash},
      ${iso(p.now)}::timestamptz, ${p.ttlHours})`);
  if (!row) return null;
  if (row.outcome === 'linked') return { outcome: 'linked' };
  if ((row.outcome === 'new' || row.outcome === 'same') && row.till !== null) {
    return { outcome: row.outcome, till: new Date(row.till) };
  }
  return null;
}

export type LeadTgStart =
  | { outcome: 'linked'; firm: string }
  | { outcome: 'refused'; firm: string; reason: string }
  | { outcome: 'again' | 'bad' };

/** «Старт» по ссылке заявителя — одной транзакцией функции базы. */
export async function startLeadTelegram(
  db: Db | Tx,
  p: {
    hash: string;
    chatId: number;
    username: string | null;
    firstName: string | null;
    /** Для истории заявки: «Telegram подключён: <имя>». */
    name: string;
    now: Date;
  },
): Promise<LeadTgStart> {
  const [row] = await db.execute<{ outcome: string; firm: string | null; reason: string | null }>(
    sql`select outcome, firm, reason from app.lead_tg_start(${p.hash}, ${p.chatId}::bigint,
      ${p.username}, ${p.firstName}, ${p.name}, ${iso(p.now)}::timestamptz)`,
  );
  if (row?.outcome === 'linked') return { outcome: 'linked', firm: row.firm ?? '' };
  if (row?.outcome === 'refused' && row.reason) {
    return { outcome: 'refused', firm: row.firm ?? '', reason: row.reason };
  }
  return { outcome: row?.outcome === 'again' ? 'again' : 'bad' };
}

/** Причина отказа, которую бот ещё не присылал заявителю; берётся один раз. */
export async function takeLeadRefusal(
  db: Db | Tx,
  leadId: string,
): Promise<{ chatId: number; firm: string; reason: string } | null> {
  const [row] = await db.execute<{ chat_id: string | number; firm: string; reason: string }>(
    sql`select chat_id, firm, reason from app.lead_tg_refusal_take(${leadId}::uuid)`,
  );
  return row ? { chatId: Number(row.chat_id), firm: row.firm, reason: row.reason } : null;
}

/**
 * «Одобрить»: Telegram заявителя — Telegram владельца (в транзакции создания организации от имени
 * администратора платформы). false — Telegram не подключён или это не владелец организации заявки.
 */
export async function linkLeadOwnerTelegramRow(
  tx: Tx,
  p: { leadId: string; userId: string },
): Promise<boolean> {
  const [row] = await tx.execute<{ ok: boolean }>(
    sql`select app.lead_owner_tg_link(${p.leadId}::uuid, ${p.userId}::uuid) as ok`,
  );
  return row?.ok === true;
}

export type PasswordSetupIssue =
  | { outcome: 'ok'; chatId: number; login: string; orgName: string; first: boolean }
  | { outcome: 'no_telegram'; login: string; orgName: string; first: boolean };

/** Ссылка «Задать пароль» владельцу (администратор платформы в контексте); null — нельзя. */
export async function issuePasswordSetup(
  tx: Tx,
  p: { userId: string; hash: string; now: Date; days: number },
): Promise<PasswordSetupIssue | null> {
  const [row] = await tx.execute<{
    outcome: string;
    chat_id: string | number | null;
    login: string;
    org_name: string;
    first: boolean;
  }>(sql`select outcome, chat_id, login, org_name, first from app.password_setup_issue(
    ${p.userId}::uuid, ${p.hash}, ${iso(p.now)}::timestamptz, ${p.days})`);
  if (!row) return null;
  if (row.outcome === 'ok' && row.chat_id !== null) {
    return {
      outcome: 'ok',
      chatId: Number(row.chat_id),
      login: row.login,
      orgName: row.org_name,
      first: row.first,
    };
  }
  if (row.outcome === 'no_telegram') {
    return { outcome: 'no_telegram', login: row.login, orgName: row.org_name, first: row.first };
  }
  return null;
}

/** Действующая ссылка «Задать пароль»: чья она. Ссылку не тратит. */
export async function peekPasswordSetup(
  db: Db | Tx,
  p: { hash: string; now: Date },
): Promise<{ userId: string; orgId: string; login: string; orgName: string } | null> {
  const [row] = await db.execute<{
    user_id: string;
    org_id: string;
    login: string;
    org_name: string;
  }>(sql`select user_id, org_id, login, org_name from app.password_setup_peek(${p.hash},
    ${iso(p.now)}::timestamptz)`);
  return row
    ? { userId: row.user_id, orgId: row.org_id, login: row.login, orgName: row.org_name }
    : null;
}

/** «Задать пароль» в контексте организации владельца: логин; null — ссылка не подошла. */
export async function completePasswordSetup(
  tx: Tx,
  p: { hash: string; passwordHash: string; now: Date },
): Promise<string | null> {
  const [row] = await tx.execute<{ login: string | null }>(
    sql`select app.password_setup_complete(${p.hash}, ${p.passwordHash},
      ${iso(p.now)}::timestamptz) as login`,
  );
  return row?.login ?? null;
}

/** Владелец организации из контекста (`withOrgContext`); null — нет. */
export async function orgOwnerUserId(tx: Tx): Promise<string | null> {
  const [row] = await tx
    .select({ userId: employees.userId })
    .from(employees)
    .innerJoin(roles, and(eq(roles.id, employees.roleId), eq(roles.orgId, employees.orgId)))
    .where(eq(roles.isOwner, true))
    .orderBy(asc(employees.createdAt), asc(employees.id))
    .limit(1);
  return row?.userId ?? null;
}
