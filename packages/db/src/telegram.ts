import {
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_MAX_PER_HOUR,
  RESET_CODE_TTL_MINUTES,
  TELEGRAM_LINK_TTL_MINUTES,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { employees, platformReference, roles, sessions, users } from './schema';

/**
 * Telegram и «Забыли пароль?» — через функции app.telegram_* и app.auth_reset_* (миграция 0011):
 * вебхук бота и восстановление пароля работают без входа, а у администратора платформы нет
 * организации. Изменение от имени пользователя — только в транзакции с его app.user_id.
 */

const asDate = (v: Date | string | null): Date | null =>
  v === null ? null : v instanceof Date ? v : new Date(v);
const asNumber = (v: number | string | null): number | null => (v === null ? null : Number(v));

/** Привязанный Telegram: куда писать и привязан ли он ещё к другим логинам. */
export interface TelegramChat {
  chatId: number;
  username: string | null;
  firstName: string | null;
  linkedAt: Date;
  /** Этот же Telegram привязан к другим логинам — в сообщениях указывается организация. */
  shared: boolean;
}

export async function telegramChat(db: Db | Tx, userId: string): Promise<TelegramChat | null> {
  const [row] = await db.execute<{
    chat_id: number | string;
    username: string | null;
    first_name: string | null;
    linked_at: Date | string;
    shared: boolean;
  }>(sql`select * from app.telegram_chat(${userId})`);
  if (!row) return null;
  return {
    chatId: Number(row.chat_id),
    username: row.username,
    firstName: row.first_name,
    linkedAt: asDate(row.linked_at)!,
    shared: row.shared,
  };
}

/** Новая ссылка привязки для пользователя из контекста (прежние перестают действовать); срок — 15 минут. */
export async function createTelegramLinkToken(tx: Tx, tokenHash: string): Promise<Date> {
  const [row] = await tx.execute<{ until: Date | string }>(
    sql`select app.telegram_link_token(${tokenHash}, ${TELEGRAM_LINK_TTL_MINUTES}) as until`,
  );
  return asDate(row!.until)!;
}

/** Чья ссылка пришла в бот: пользователь, организация и состояние учётной записи. */
export interface TelegramLinkTarget {
  userId: string;
  orgId: string | null;
  login: string;
  orgName: string | null;
  used: boolean;
  expired: boolean;
  /** Чат, к которому пользователь привязан сейчас. */
  linkedChatId: number | null;
  isPlatformAdmin: boolean;
  userBlocked: boolean;
  employeeActive: boolean | null;
  orgStatus: 'active' | 'blocked' | null;
}

export async function peekTelegramLink(
  db: Db,
  tokenHash: string,
): Promise<TelegramLinkTarget | null> {
  const [row] = await db.execute<{
    user_id: string;
    org_id: string | null;
    login: string;
    org_name: string | null;
    used: boolean;
    expired: boolean;
    linked_chat_id: number | string | null;
    is_platform_admin: boolean;
    user_blocked: boolean;
    employee_active: boolean | null;
    org_status: 'active' | 'blocked' | null;
  }>(sql`select * from app.telegram_link_peek(${tokenHash})`);
  if (!row) return null;
  return {
    userId: row.user_id,
    orgId: row.org_id,
    login: row.login,
    orgName: row.org_name,
    used: row.used,
    expired: row.expired,
    linkedChatId: asNumber(row.linked_chat_id),
    isPlatformAdmin: row.is_platform_admin,
    userBlocked: row.user_blocked,
    employeeActive: row.employee_active,
    orgStatus: row.org_status,
  };
}

/** Что было привязано до этой ссылки и привязан ли новый чат к другим логинам. */
export interface TelegramLinkResult {
  previous: { chatId: number; username: string | null; firstName: string | null } | null;
  shared: boolean;
}

/** Привязать чат по ссылке пользователю из контекста; null — ссылка уже не действует. */
export async function useTelegramLink(
  tx: Tx,
  input: { tokenHash: string; chatId: number; username: string | null; firstName: string | null },
): Promise<TelegramLinkResult | null> {
  const [row] = await tx.execute<{
    prev_username: string | null;
    prev_first_name: string | null;
    prev_chat_id: number | string | null;
    shared: boolean;
  }>(
    sql`select * from app.telegram_link_use(${input.tokenHash}, ${input.chatId}, ${input.username}, ${input.firstName})`,
  );
  if (!row) return null;
  const prevChat = asNumber(row.prev_chat_id);
  return {
    previous:
      prevChat === null
        ? null
        : { chatId: prevChat, username: row.prev_username, firstName: row.prev_first_name },
    shared: row.shared,
  };
}

/** Отвязать Telegram пользователя из контекста; null — он и не был привязан. */
export async function unlinkTelegram(
  tx: Tx,
): Promise<{ username: string | null; firstName: string | null } | null> {
  const [row] = await tx.execute<{ username: string | null; first_name: string | null }>(
    sql`select * from app.telegram_unlink()`,
  );
  return row ? { username: row.username, firstName: row.first_name } : null;
}

/** Итог запроса кода «Забыли пароль?». */
export type PasswordResetRequest =
  | { status: 'sent'; expiresAt: Date; chat: Omit<TelegramChat, 'linkedAt'> }
  | { status: 'limited'; retryAt: Date }
  | { status: 'no_telegram' | 'no_user' };

/**
 * Записать код (хеш) для пользователя: не больше 3 в час, прежние коды перестают действовать, код
 * действует 10 минут. Без привязанного Telegram код не записывается.
 */
export async function requestPasswordReset(
  db: Db,
  input: { userId: string; codeHash: string },
): Promise<PasswordResetRequest> {
  const [row] = await db.execute<{
    status: 'sent' | 'limited' | 'no_telegram' | 'no_user';
    expires_at: Date | string | null;
    retry_at: Date | string | null;
    chat_id: number | string | null;
    username: string | null;
    first_name: string | null;
    shared: boolean;
  }>(
    sql`select * from app.auth_reset_request(${input.userId}, ${input.codeHash}, ${RESET_CODE_TTL_MINUTES}, ${RESET_CODE_MAX_PER_HOUR})`,
  );
  if (!row || row.status === 'no_user') return { status: 'no_user' };
  if (row.status === 'no_telegram') return { status: 'no_telegram' };
  if (row.status === 'limited') return { status: 'limited', retryAt: asDate(row.retry_at)! };
  return {
    status: 'sent',
    expiresAt: asDate(row.expires_at)!,
    chat: {
      chatId: Number(row.chat_id),
      username: row.username,
      firstName: row.first_name,
      shared: row.shared,
    },
  };
}

/**
 * Занять ввод кода до его проверки (не больше 5 на код): одновременные запросы не переберут больше.
 * null — действующего кода нет или попытки кончились.
 */
export async function reservePasswordResetAttempt(
  db: Db,
  userId: string,
): Promise<{ resetId: string; codeHash: string } | null> {
  const [row] = await db.execute<{ reset_id: string; code_hash: string }>(
    sql`select * from app.auth_reset_attempt(${userId}, ${RESET_CODE_MAX_ATTEMPTS})`,
  );
  return row ? { resetId: row.reset_id, codeHash: row.code_hash } : null;
}

/**
 * Верный код: новый пароль пользователю из контекста, все его сеансы завершены, блокировка входа
 * снята. false — код тем временем перестал действовать.
 */
export async function completePasswordReset(
  tx: Tx,
  input: { resetId: string; passwordHash: string },
): Promise<boolean> {
  const [row] = await tx.execute<{ ok: boolean }>(
    sql`select app.auth_reset_complete(${input.resetId}, ${input.passwordHash}) as ok`,
  );
  return row?.ok === true;
}

/** Учётная запись для администратора платформы (в транзакции с его app.user_id); иначе null. */
export async function adminFindUser(
  tx: Tx,
  userId: string,
): Promise<{
  userId: string;
  orgId: string | null;
  login: string;
  isPlatformAdmin: boolean;
} | null> {
  const [row] = await tx.execute<{
    user_id: string;
    org_id: string | null;
    login: string;
    is_platform_admin: boolean;
  }>(sql`select * from app.admin_find_user(${userId})`);
  return row
    ? {
        userId: row.user_id,
        orgId: row.org_id,
        login: row.login,
        isPlatformAdmin: row.is_platform_admin,
      }
    : null;
}

/** Сотрудник организации из контекста и его учётная запись (для сброса пароля владельцем). */
export async function employeeAccount(tx: Tx, employeeId: string) {
  const [row] = await tx
    .select({
      employeeId: employees.id,
      userId: employees.userId,
      fullName: employees.fullName,
      login: users.login,
      isOwner: roles.isOwner,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(eq(employees.id, employeeId));
  return row ?? null;
}

/**
 * Временный пароль пользователю организации из контекста (сброс владельцем или администратором): при
 * входе его нужно сменить, все сеансы завершаются, блокировка входа снимается. false — нет такого.
 */
export async function setTemporaryPassword(
  tx: Tx,
  input: { userId: string; passwordHash: string },
): Promise<boolean> {
  const updated = await tx
    .update(users)
    .set({
      passwordHash: input.passwordHash,
      mustChangePassword: true,
      failedLogins: 0,
      lockedUntil: null,
      version: sql`${users.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(users.id, input.userId), eq(users.isPlatformAdmin, false)))
    .returning({ id: users.id });
  if (updated.length === 0) return false;
  await tx.delete(sessions).where(eq(sessions.userId, input.userId));
  return true;
}

/** Владелец ли организации пользователь (кто сбросит пароль, если Telegram не привязан). */
export async function isOrgOwner(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.execute<{ owner: boolean }>(
    sql`select app.auth_is_owner(${userId}) as owner`,
  );
  return row?.owner === true;
}

/** Шаблоны сообщений из «Справочников платформы» (refDB → messageTemplates): ключ → текст. */
export async function messageTemplates(db: Db | Tx): Promise<Record<string, string>> {
  const [row] = await db
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, 'messageTemplates'));
  const payload = row?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );
}
