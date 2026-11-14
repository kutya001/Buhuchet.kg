import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { writeHistory } from './history';
import { employees, roles, telegramGroups, telegramGroupTokens, users } from './schema';

/*
 * Общий рабочий чат фирмы (поток Т, задача Т8; docs/decisions.md п. Т-8; прототип v105
 * modules/tg-group.js): у организации — одна группа Telegram. Подключает и отключает владелец; вебхук
 * узнаёт организацию группы функциями `app.telegram_group_token` и `app.telegram_group_org`, остальное
 * — в контексте организации (RLS). Подключение, отключение, «бота удалили» и сводка дня — в истории
 * учётной политики организации (поля `telegramGroup`, `telegramGroupGone`, `telegramGroupSummary`).
 */

/** Общий чат организации для экрана «Настройки». */
export interface TelegramGroupRecord {
  chatId: number;
  title: string;
  linkedBy: string;
  /** Короткое имя сотрудника, который подключил группу. */
  linkedByName: string | null;
  linkedAt: Date;
  summary: boolean;
  goneAt: Date | null;
  version: number;
}

/** Общий чат организации из контекста; null — не подключён. */
export async function readTelegramGroup(tx: Tx): Promise<TelegramGroupRecord | null> {
  const [row] = await tx
    .select({
      chatId: telegramGroups.chatId,
      title: telegramGroups.title,
      linkedBy: telegramGroups.linkedBy,
      linkedByName: employees.shortName,
      linkedAt: telegramGroups.linkedAt,
      summary: telegramGroups.summary,
      goneAt: telegramGroups.goneAt,
      version: telegramGroups.version,
    })
    .from(telegramGroups)
    .leftJoin(employees, eq(employees.userId, telegramGroups.linkedBy));
  return row ?? null;
}

/**
 * Ссылка подключения: хеш ключа и кто создал; действует `minutes` минут по часам базы (как ссылка
 * привязки Telegram — срок сверяет база). Возвращает момент, до которого она действует.
 */
export async function createTelegramGroupToken(
  tx: Tx,
  o: { tokenHash: string; userId: string; minutes: number },
): Promise<Date> {
  const [row] = await tx
    .insert(telegramGroupTokens)
    .values({
      tokenHash: o.tokenHash,
      orgId: sql`app.current_org_id()`,
      createdBy: o.userId,
      expiresAt: sql`now() + make_interval(mins => ${o.minutes}::int)`,
    })
    .returning({ expiresAt: telegramGroupTokens.expiresAt });
  return row!.expiresAt;
}

/** Ссылка подключения по хешу ключа — до контекста организации. */
export interface TelegramGroupTokenInfo {
  orgId: string;
  createdBy: string;
  expired: boolean;
  used: boolean;
  orgActive: boolean;
}

export async function telegramGroupToken(
  db: Db,
  tokenHash: string,
): Promise<TelegramGroupTokenInfo | null> {
  const rows = await db.execute<{
    org_id: string;
    created_by: string;
    expired: boolean;
    used: boolean;
    org_active: boolean;
  }>(sql`select * from app.telegram_group_token(${tokenHash})`);
  const r = rows[0];
  return r
    ? {
        orgId: r.org_id,
        createdBy: r.created_by,
        expired: r.expired,
        used: r.used,
        orgActive: r.org_active,
      }
    : null;
}

/** Организация, чей общий чат — эта группа; null — группа ничья. */
export async function telegramGroupOrg(
  db: Db,
  chatId: number,
): Promise<{ orgId: string; gone: boolean } | null> {
  const rows = await db.execute<{ org_id: string; gone: boolean }>(
    sql`select * from app.telegram_group_org(${chatId}::bigint)`,
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, gone: r.gone } : null;
}

/**
 * Создавший ссылку всё ещё может подключить группу (в контексте организации ссылки): он — владелец
 * организации, сотрудник действует, учётная запись не заблокирована.
 */
export async function telegramGroupOwner(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(
        eq(employees.userId, userId),
        eq(employees.active, true),
        eq(roles.isOwner, true),
        eq(users.blocked, false),
      ),
    );
  return Boolean(row);
}

/**
 * Подключить группу по ссылке (в контексте организации от имени создавшего ссылку): ссылка блокируется
 * и проверяется ещё раз (одноразовая, срок — по часам базы), группа становится общим чатом организации вместо
 * прежней. Результат — прежняя группа (из неё бот выйдет) или отказ `invalid`. Группа — уже общий чат
 * другой организации: уникальный номер группы не даст сохранить (ошибка базы `23505`).
 */
export async function linkTelegramGroup(
  tx: Tx,
  o: { tokenHash: string; chatId: number; title: string; now: Date },
): Promise<{ status: 'ok'; previousChatId: number | null } | { status: 'invalid' }> {
  const [token] = await tx
    .select({ createdBy: telegramGroupTokens.createdBy })
    .from(telegramGroupTokens)
    .where(
      and(
        eq(telegramGroupTokens.tokenHash, o.tokenHash),
        isNull(telegramGroupTokens.usedAt),
        gt(telegramGroupTokens.expiresAt, sql`now()`),
      ),
    )
    .for('update');
  if (!token) return { status: 'invalid' };
  await tx
    .update(telegramGroupTokens)
    .set({ usedAt: o.now })
    .where(eq(telegramGroupTokens.tokenHash, o.tokenHash));
  const before = await readTelegramGroup(tx);
  const values = {
    chatId: o.chatId,
    title: o.title,
    linkedBy: token.createdBy,
    linkedAt: o.now,
    goneAt: null,
    updatedBy: token.createdBy,
    updatedAt: o.now,
  };
  if (before) {
    await tx
      .update(telegramGroups)
      .set({ ...values, version: sql`${telegramGroups.version} + 1` })
      .where(eq(telegramGroups.orgId, sql`app.current_org_id()`));
  } else {
    await tx.insert(telegramGroups).values({ ...values, orgId: sql`app.current_org_id()` });
  }
  await writeHistory(tx, {
    entity: 'org_settings',
    entityId: (await currentOrgId(tx))!,
    action: 'update',
    changes: [{ field: 'telegramGroup', from: before?.title ?? null, to: o.title }],
  });
  return {
    status: 'ok',
    previousChatId: before && before.chatId !== o.chatId && !before.goneAt ? before.chatId : null,
  };
}

const currentOrgId = async (tx: Tx) => {
  const rows = await tx.execute<{ id: string | null }>(sql`select app.current_org_id() as id`);
  return rows[0]?.id ?? null;
};

/** Запись общего чата под блокировкой со сверкой версии: устаревшая версия — «изменено другим». */
async function lockGroup(tx: Tx, version: number): Promise<TelegramGroupRecord> {
  const orgId = (await currentOrgId(tx))!;
  const [row] = await tx
    .select({ version: telegramGroups.version })
    .from(telegramGroups)
    .for('update');
  if (!row) throw new RecordNotFoundError('telegram_groups', orgId);
  if (row.version !== version) throw new RecordChangedError('telegram_groups', orgId, row.version);
  return (await readTelegramGroup(tx))!;
}

/** «Сводка дня в группу» — включить или выключить (владелец, сразу). */
export async function setTelegramGroupSummary(
  tx: Tx,
  o: { version: number; summary: boolean; userId: string },
): Promise<void> {
  const current = await lockGroup(tx, o.version);
  if (current.summary === o.summary) return;
  await tx
    .update(telegramGroups)
    .set({
      summary: o.summary,
      updatedBy: o.userId,
      updatedAt: sql`now()`,
      version: sql`${telegramGroups.version} + 1`,
    })
    .where(eq(telegramGroups.orgId, sql`app.current_org_id()`));
  await writeHistory(tx, {
    entity: 'org_settings',
    entityId: (await currentOrgId(tx))!,
    action: 'update',
    changes: [{ field: 'telegramGroupSummary', from: current.summary, to: o.summary }],
  });
}

/**
 * «Отключить группу» (владелец): запись удаляется, в истории — «отключён». Возвращает группу — бот
 * напишет в неё «отключён» и выйдет, если он ещё там.
 */
export async function unlinkTelegramGroup(
  tx: Tx,
  o: { version: number },
): Promise<{ chatId: number; gone: boolean }> {
  const current = await lockGroup(tx, o.version);
  await tx.delete(telegramGroups).where(eq(telegramGroups.orgId, sql`app.current_org_id()`));
  await writeHistory(tx, {
    entity: 'org_settings',
    entityId: (await currentOrgId(tx))!,
    action: 'update',
    changes: [{ field: 'telegramGroup', from: current.title, to: null }],
  });
  return { chatId: current.chatId, gone: current.goneAt !== null };
}

/** Бота удалили из группы (обновление Telegram `my_chat_member`): сводки прекращаются. */
export async function markTelegramGroupGone(
  tx: Tx,
  o: { chatId: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(telegramGroups)
    .set({ goneAt: o.now, updatedAt: o.now, version: sql`${telegramGroups.version} + 1` })
    .where(and(eq(telegramGroups.chatId, o.chatId), isNull(telegramGroups.goneAt)))
    .returning({ title: telegramGroups.title });
  if (!rows.length) return false;
  await writeHistory(tx, {
    entity: 'org_settings',
    entityId: (await currentOrgId(tx))!,
    action: 'update',
    changes: [{ field: 'telegramGroupGone', to: rows[0]!.title }],
  });
  return true;
}

/** Группа стала супергруппой: у Telegram у неё новый номер (`migrate_to_chat_id`). */
export async function moveTelegramGroup(tx: Tx, o: { from: number; to: number }): Promise<boolean> {
  const rows = await tx
    .update(telegramGroups)
    .set({ chatId: o.to, updatedAt: sql`now()`, version: sql`${telegramGroups.version} + 1` })
    .where(eq(telegramGroups.chatId, o.from))
    .returning({ chatId: telegramGroups.chatId });
  return rows.length > 0;
}
