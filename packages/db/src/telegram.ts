import {
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_MAX_DAILY_FAILURES,
  RESET_CODE_MAX_PER_HOUR,
  RESET_CODE_TTL_MINUTES,
  TELEGRAM_LINK_TTL_MINUTES,
  TELEGRAM_RELINK_CODE_TTL_MINUTES,
  TELEGRAM_RELINK_FREE_HOURS,
  TELEGRAM_RELINK_MAX_ATTEMPTS,
  TELEGRAM_RELINK_MAX_DAILY_FAILURES,
  TELEGRAM_RELINK_MAX_PER_HOUR,
} from '@buhuchet/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import { clearLoginAttempts } from './auth';
import type { Db, Tx } from './client';
import { employees, messageTemplateTexts, roles, sessions, users } from './schema';

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

/**
 * Прежний Telegram для подсказки в «Мой профиль» (прототип v77, docs/deviations.md п. О-20): сейчас не
 * привязан, другой чат подтверждается кодом из отвязанного. null — нет такого (или после сброса пароля
 * сутки можно без кода); имя пустое — отвязан до миграции 0104.
 */
export async function telegramPreviousChat(
  db: Db | Tx,
  userId: string,
): Promise<{ username: string | null; firstName: string | null } | null> {
  const [row] = await db.execute<{ username: string | null; first_name: string | null }>(
    sql`select * from app.telegram_previous(${userId})`,
  );
  return row ? { username: row.username, firstName: row.first_name } : null;
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
  /**
   * Прежний чат: привязанный сейчас или отвязанный последним — другой чат подтверждается кодом из
   * него (docs/deviations.md п. О-20).
   */
  confirmChatId: number | null;
  /** Сейчас Telegram привязывается без кода (после сброса пароля владельцем или администратором). */
  relinkFree: boolean;
  /** В какой чат по этой ссылке уже запрошен код замены. */
  relinkChatId: number | null;
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
    confirm_chat_id: number | string | null;
    relink_free: boolean;
    relink_chat_id: number | string | null;
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
    confirmChatId: asNumber(row.confirm_chat_id),
    relinkFree: row.relink_free,
    relinkChatId: asNumber(row.relink_chat_id),
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
  /**
   * Чат, отвязанный последним, если сейчас ничего не было привязано и привязали другой: ему тоже
   * пишется о замене (docs/deviations.md п. О-20).
   */
  unlinked: { chatId: number; shared: boolean } | null;
}

type LinkRow = {
  prev_username: string | null;
  prev_first_name: string | null;
  prev_chat_id: number | string | null;
  prev_shared: boolean;
  shared: boolean;
  guard_chat_id: number | string | null;
  guard_shared: boolean;
};

function linkResult(row: LinkRow | undefined): TelegramLinkResult | null {
  if (!row) return null;
  const prevChat = asNumber(row.prev_chat_id);
  const guardChat = asNumber(row.guard_chat_id);
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
    unlinked: guardChat === null ? null : { chatId: guardChat, shared: row.guard_shared },
  };
}

/**
 * Привязать чат по ссылке пользователю из контекста; null — ссылка уже не действует или другой чат
 * вместо прежнего нужно подтвердить кодом (`requestTelegramRelink`).
 */
export async function useTelegramLink(
  tx: Tx,
  input: { tokenHash: string; chatId: number; username: string | null; firstName: string | null },
): Promise<TelegramLinkResult | null> {
  const [row] = await tx.execute<LinkRow>(
    sql`select * from app.telegram_link_use(${input.tokenHash}, ${input.chatId}, ${input.username}, ${input.firstName})`,
  );
  return linkResult(row);
}

/** Итог запроса кода замены Telegram. */
export type TelegramRelinkRequest =
  | { status: 'sent'; expiresAt: Date; chatId: number; shared: boolean }
  | { status: 'invalid' | 'not_needed' | 'locked' | 'limited' };

/**
 * Ссылку открыли в другом чате, а прежний есть (docs/deviations.md п. О-20): ссылка использована, код
 * записан (10 минут, не больше 3 в час, 10 неверных за сутки); `chatId` — прежний чат, куда его
 * отправить. Пользователь — из контекста.
 */
export async function requestTelegramRelink(
  tx: Tx,
  input: {
    tokenHash: string;
    chatId: number;
    username: string | null;
    firstName: string | null;
    codeHash: string;
  },
): Promise<TelegramRelinkRequest> {
  const [row] = await tx.execute<{
    status: TelegramRelinkRequest['status'];
    expires_at: Date | string | null;
    chat_id: number | string | null;
    shared: boolean;
  }>(
    sql`select * from app.telegram_relink_request(${input.tokenHash}, ${input.chatId}, ${input.username}, ${input.firstName}, ${input.codeHash}, ${TELEGRAM_RELINK_CODE_TTL_MINUTES}, ${TELEGRAM_RELINK_MAX_PER_HOUR}, ${TELEGRAM_RELINK_MAX_DAILY_FAILURES})`,
  );
  if (row?.status === 'sent') {
    return {
      status: 'sent',
      expiresAt: asDate(row.expires_at)!,
      chatId: asNumber(row.chat_id)!,
      shared: row.shared,
    };
  }
  return { status: row?.status ?? 'invalid' } as TelegramRelinkRequest;
}

/** Занятая попытка ввести код замены Telegram в новом чате. */
export type TelegramRelinkAttempt =
  | { status: 'none' }
  | { status: 'spent' }
  | {
      status: 'ok';
      codeId: string;
      codeHash: string;
      /** Сколько попыток останется, если этот код неверный. */
      triesLeft: number;
      /** Имя в Telegram из сообщения со ссылкой. */
      username: string | null;
      firstName: string | null;
      userId: string;
      orgId: string | null;
      login: string;
      orgName: string | null;
      isPlatformAdmin: boolean;
      userBlocked: boolean;
      employeeActive: boolean | null;
      orgStatus: 'active' | 'blocked' | null;
    };

/**
 * Сообщение с кодом в чате бота (без входа): попытка занимается до проверки (не больше 5 на код и 10
 * неверных за сутки). `none` — для этого чата кода нет, `spent` — код истёк или попытки кончились.
 */
export async function reserveTelegramRelinkAttempt(
  db: Db,
  chatId: number,
): Promise<TelegramRelinkAttempt> {
  const [row] = await db.execute<{
    status: 'none' | 'spent' | 'ok';
    code_id: string | null;
    code_hash: string | null;
    tries_left: number | null;
    username: string | null;
    first_name: string | null;
    user_id: string | null;
    org_id: string | null;
    login: string | null;
    org_name: string | null;
    is_platform_admin: boolean | null;
    user_blocked: boolean | null;
    employee_active: boolean | null;
    org_status: 'active' | 'blocked' | null;
  }>(
    sql`select * from app.telegram_relink_attempt(${chatId}, ${TELEGRAM_RELINK_MAX_ATTEMPTS}, ${TELEGRAM_RELINK_MAX_DAILY_FAILURES})`,
  );
  if (row?.status === 'spent') return { status: 'spent' };
  if (row?.status !== 'ok') return { status: 'none' };
  return {
    status: 'ok',
    codeId: row.code_id!,
    codeHash: row.code_hash!,
    triesLeft: row.tries_left ?? 0,
    username: row.username,
    firstName: row.first_name,
    userId: row.user_id!,
    orgId: row.org_id,
    login: row.login!,
    orgName: row.org_name,
    isPlatformAdmin: row.is_platform_admin === true,
    userBlocked: row.user_blocked === true,
    employeeActive: row.employee_active,
    orgStatus: row.org_status,
  };
}

/** Верный код замены: привязать чат из кода пользователю из контекста; null — код уже не действует. */
export async function useTelegramRelink(
  tx: Tx,
  codeId: string,
): Promise<TelegramLinkResult | null> {
  const [row] = await tx.execute<LinkRow>(sql`select * from app.telegram_relink_use(${codeId})`);
  return linkResult(row);
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
 * Действующие владельцы организации `orgId` (она же — организация контекста, RLS), кроме
 * `exceptUserId`: кому сообщить, что администратор платформы сбросил пароль сотрудника (ревью
 * безопасности 06.11.2026, п. Р-2; docs/deviations.md п. О-13).
 */
export async function activeOwnerUserIds(
  tx: Tx,
  orgId: string,
  exceptUserId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ userId: users.id })
    .from(users)
    .innerJoin(employees, eq(employees.userId, users.id))
    .innerJoin(roles, and(eq(roles.id, employees.roleId), eq(roles.orgId, employees.orgId)))
    .where(
      and(
        eq(employees.orgId, orgId),
        eq(roles.isOwner, true),
        eq(employees.active, true),
        eq(users.blocked, false),
        ne(users.id, exceptUserId),
      ),
    );
  return rows.map((r) => r.userId);
}

/**
 * Временный пароль пользователю организации из контекста (сброс владельцем или администратором): при
 * входе его нужно сменить, все сеансы и ожидающий код «Забыли пароль?» отменяются, блокировка входа
 * снимается — и на 15 минут по логину, и после 10 неверных паролей подряд, — сутки Telegram
 * привязывается без кода из прежнего чата (ссылки привязки и коды замены, выданные до сброса,
 * отменяются, а код «Забыли пароль?» эти сутки не уходит). Возвращает, нужно ли было сменить пароль и
 * был ли закрыт вход до сброса (для истории); null — нет такого.
 */
export async function setTemporaryPassword(
  tx: Tx,
  input: { userId: string; passwordHash: string },
): Promise<{ mustChangePasswordBefore: boolean; loginLockedBefore: boolean } | null> {
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
  // Доступа к прежнему Telegram у пользователя может не быть: сутки новый привязывается без кода из
  // прежнего (docs/deviations.md п. О-20).
  await tx.execute(
    sql`select app.telegram_relink_allow(${input.userId}, ${TELEGRAM_RELINK_FREE_HOURS})`,
  );
  // Блокировку входа после 10 неверных паролей снимает именно новый пароль (миграция 0095).
  const [unlock] = await tx.execute<{ was: boolean }>(
    sql`select app.auth_account_unlock(${input.userId}) as was`,
  );
  return {
    mustChangePasswordBefore: before.mustChangePassword,
    loginLockedBefore: unlock?.was === true,
  };
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
