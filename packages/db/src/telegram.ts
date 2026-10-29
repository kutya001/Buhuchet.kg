import {
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_MAX_DAILY_FAILURES,
  RESET_CODE_MAX_PER_HOUR,
  RESET_CODE_TTL_MINUTES,
  TELEGRAM_LINK_TTL_MINUTES,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { clearLoginAttempts } from './auth';
import type { Db, Tx } from './client';
import { messageTemplateTexts, sessions, users } from './schema';

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

/** Что было привязано до этой ссылки и привязаны ли прежний и новый чат к другим логинам. */
export interface TelegramLinkResult {
  previous: {
    chatId: number;
    username: string | null;
    firstName: string | null;
    shared: boolean;
  } | null;
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
    prev_shared: boolean;
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
        : {
            chatId: prevChat,
            username: row.prev_username,
            firstName: row.prev_first_name,
            shared: row.prev_shared,
          },
    shared: row.shared,
  };
}

/**
 * Отвязать Telegram пользователя из контекста (ожидающий код «Забыли пароль?» отменяется): что было
 * привязано и привязан ли этот чат к другим логинам; null — ничего не было привязано.
 */
export async function unlinkTelegram(tx: Tx): Promise<Omit<TelegramChat, 'linkedAt'> | null> {
  const [row] = await tx.execute<{
    chat_id: number | string;
    username: string | null;
    first_name: string | null;
    shared: boolean;
  }>(sql`select * from app.telegram_unlink()`);
  return row
    ? {
        chatId: Number(row.chat_id),
        username: row.username,
        firstName: row.first_name,
        shared: row.shared,
      }
    : null;
}

/** Почему код «Забыли пароль?» сейчас не прислать; retryAt — когда снова можно. */
export type PasswordResetRefusal =
  { status: 'limited' | 'locked'; retryAt: Date } | { status: 'no_telegram' | 'no_user' };

type ResetStatus = 'ok' | 'sent' | 'limited' | 'locked' | 'no_telegram' | 'no_user';

function resetRefusal(status: ResetStatus, retryAt: Date | string | null): PasswordResetRefusal {
  if (status === 'limited' || status === 'locked') return { status, retryAt: asDate(retryAt)! };
  return { status: status === 'no_telegram' ? 'no_telegram' : 'no_user' };
}

/**
 * Можно ли сейчас прислать код: не больше 3 в час и не больше 10 неверных вводов за сутки. Ничего не
 * меняет — спрашивается до того, как считать хеш кода (запросы сверх лимита не нагружают сервер).
 */
export async function passwordResetStatus(
  db: Db,
  userId: string,
): Promise<{ status: 'ok' } | PasswordResetRefusal> {
  const [row] = await db.execute<{ status: ResetStatus; retry_at: Date | string | null }>(
    sql`select * from app.auth_reset_status(${userId}, ${RESET_CODE_MAX_PER_HOUR}, ${RESET_CODE_MAX_DAILY_FAILURES})`,
  );
  if (row?.status === 'ok') return { status: 'ok' };
  return resetRefusal(row?.status ?? 'no_user', row?.retry_at ?? null);
}

/** Итог запроса кода «Забыли пароль?». */
export type PasswordResetRequest =
  { status: 'sent'; expiresAt: Date; chat: Omit<TelegramChat, 'linkedAt'> } | PasswordResetRefusal;

/**
 * Записать код (хеш) для пользователя: лимиты те же, что в passwordResetStatus (проверяются ещё раз
 * под блокировкой), прежние коды перестают действовать, код действует 10 минут. Без привязанного
 * Telegram код не записывается.
 */
export async function requestPasswordReset(
  db: Db,
  input: { userId: string; codeHash: string },
): Promise<PasswordResetRequest> {
  const [row] = await db.execute<{
    status: ResetStatus;
    expires_at: Date | string | null;
    retry_at: Date | string | null;
    chat_id: number | string | null;
    username: string | null;
    first_name: string | null;
    shared: boolean;
  }>(
    sql`select * from app.auth_reset_request(${input.userId}, ${input.codeHash}, ${RESET_CODE_TTL_MINUTES}, ${RESET_CODE_MAX_PER_HOUR}, ${RESET_CODE_MAX_DAILY_FAILURES})`,
  );
  if (row?.status !== 'sent') return resetRefusal(row?.status ?? 'no_user', row?.retry_at ?? null);
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
 * Занять ввод кода до его проверки (не больше 5 на код и 10 неверных за сутки): одновременные запросы
 * не переберут больше. null — действующего кода нет или попытки кончились.
 */
export async function reservePasswordResetAttempt(
  db: Db,
  userId: string,
): Promise<{ resetId: string; codeHash: string } | null> {
  const [row] = await db.execute<{ reset_id: string; code_hash: string }>(
    sql`select * from app.auth_reset_attempt(${userId}, ${RESET_CODE_MAX_ATTEMPTS}, ${RESET_CODE_MAX_DAILY_FAILURES})`,
  );
  return row ? { resetId: row.reset_id, codeHash: row.code_hash } : null;
}

/** Отменить ожидающие коды «Забыли пароль?» пользователя (пароль сменили или сбросили). */
export async function revokePasswordResetCodes(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select app.auth_reset_revoke(${userId})`);
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

/**
 * Временный пароль пользователю организации из контекста (сброс владельцем или администратором): при
 * входе его нужно сменить, все сеансы и ожидающий код «Забыли пароль?» отменяются, блокировка входа
 * снимается. Возвращает, нужно ли было сменить пароль до сброса (для истории); null — нет такого.
 */
export async function setTemporaryPassword(
  tx: Tx,
  input: { userId: string; passwordHash: string },
): Promise<{ mustChangePasswordBefore: boolean } | null> {
  const [before] = await tx
    .select({ login: users.login, mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(and(eq(users.id, input.userId), eq(users.isPlatformAdmin, false)))
    .for('update');
  if (!before) return null;
  await tx
    .update(users)
    .set({
      passwordHash: input.passwordHash,
      mustChangePassword: true,
      version: sql`${users.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, input.userId));
  await tx.delete(sessions).where(eq(sessions.userId, input.userId));
  await revokePasswordResetCodes(tx, input.userId);
  await clearLoginAttempts(tx, before.login);
  return { mustChangePasswordBefore: before.mustChangePassword };
}

/**
 * Шаблоны сообщений из «Справочников платформы» (таблица message_templates, правит Админка): ключ
 * шаблона прототипа (tgCode, tgBefore, …) → текст с подстановками как есть.
 */
export async function messageTemplates(db: Db | Tx): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: messageTemplateTexts.key, text: messageTemplateTexts.text })
    .from(messageTemplateTexts);
  return Object.fromEntries(rows.map((r) => [r.key, r.text]));
}
