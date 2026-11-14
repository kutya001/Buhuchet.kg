import type { IsoDate } from '@buhuchet/domain';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { employees, reports, telegramLinks, telegramWidgets, users } from './schema';
import { commandReports, type CommandReportRow } from './telegram-commands';

/*
 * Виджет «Мои отчёты на неделю» (поток Т, задача Т9; прототип v106 modules/tg-widget.js). Всё — в
 * контексте организации (RLS): вебхук находит виджет по учётным записям, к которым привязан чат.
 */

export interface TelegramWidgetRecord {
  userId: string;
  chatId: number;
  messageId: number;
  items: string[];
  data: string;
  sentOn: IsoDate;
}

const COLUMNS = {
  userId: telegramWidgets.userId,
  chatId: telegramWidgets.chatId,
  messageId: telegramWidgets.messageId,
  items: telegramWidgets.items,
  data: telegramWidgets.data,
  sentOn: telegramWidgets.sentOn,
};

/**
 * Записать новый виджет сотрудника; прежний (его чат и номер сообщения) возвращается — бот пометит его
 * «устарел». У сотрудника один действующий виджет.
 */
export async function saveTelegramWidget(
  tx: Tx,
  w: TelegramWidgetRecord,
): Promise<{ chatId: number; messageId: number } | null> {
  const [prev] = await tx
    .select({ chatId: telegramWidgets.chatId, messageId: telegramWidgets.messageId })
    .from(telegramWidgets)
    .where(eq(telegramWidgets.userId, w.userId))
    .for('update');
  const values = {
    chatId: w.chatId,
    messageId: w.messageId,
    items: w.items,
    data: w.data,
    sentOn: w.sentOn,
    updatedAt: sql`now()`,
  };
  await tx
    .insert(telegramWidgets)
    .values({ ...values, userId: w.userId, orgId: sql`app.current_org_id()` })
    .onConflictDoUpdate({ target: telegramWidgets.userId, set: values });
  return prev && (prev.chatId !== w.chatId || prev.messageId !== w.messageId) ? prev : null;
}

/** Действующий виджет сотрудника в этом чате и сообщении (под блокировкой); null — не он или устарел. */
export async function lockTelegramWidget(
  tx: Tx,
  o: { userId: string; chatId: number; messageId: number },
): Promise<TelegramWidgetRecord | null> {
  const [row] = await tx
    .select(COLUMNS)
    .from(telegramWidgets)
    .where(
      and(
        eq(telegramWidgets.userId, o.userId),
        eq(telegramWidgets.chatId, o.chatId),
        eq(telegramWidgets.messageId, o.messageId),
      ),
    )
    .for('update');
  return row ?? null;
}

/** Статус отчёта строки виджета (в организации контекста); null — отчёта нет. */
export async function widgetReportStatus(tx: Tx, reportId: string): Promise<string | null> {
  const [row] = await tx
    .select({ status: reports.status })
    .from(reports)
    .where(eq(reports.id, reportId));
  return row?.status ?? null;
}

/** Новые строки и данные виджета (после галочки или обновления). */
export async function updateTelegramWidget(
  tx: Tx,
  userId: string,
  o: { items: string[]; data: string },
): Promise<void> {
  await tx
    .update(telegramWidgets)
    .set({ items: o.items, data: o.data, updatedAt: sql`now()` })
    .where(eq(telegramWidgets.userId, userId));
}

/** Виджеты организации, присланные не раньше `since`: их бот обновляет утром. */
export function telegramWidgetsSince(tx: Tx, since: IsoDate): Promise<TelegramWidgetRecord[]> {
  return tx.select(COLUMNS).from(telegramWidgets).where(gte(telegramWidgets.sentOn, since));
}

/**
 * Свои отчёты сотрудника для виджета: где он ответственный, несданные, со сроком не позже `horizon` (и
 * просроченные); правила те же, что у команд меню (`commandReports`: действующие версии, контрагенты не в
 * архиве). Налоги к оплате отбирает вызывающий — в виджете их нет.
 */
export function widgetReports(
  tx: Tx,
  o: { employeeId: string; horizon: IsoDate },
): Promise<CommandReportRow[]> {
  return commandReports(tx, {
    scope: eq(reports.responsibleEmployeeId, o.employeeId),
    horizon: o.horizon,
  });
}

/**
 * Действующий сотрудник учётной записи (не заблокированный, пароль не временный) и чат, привязанный к ней
 * сейчас; null — сотрудника нет, он уволен или пароль сброшен. Для утреннего обновления виджета: после
 * сброса пароля прежний чат мог остаться у постороннего.
 */
export async function widgetEmployee(
  tx: Tx,
  userId: string,
): Promise<{ employeeId: string; chatId: number | null } | null> {
  const [row] = await tx
    .select({ employeeId: employees.id, chatId: telegramLinks.chatId })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .leftJoin(telegramLinks, eq(telegramLinks.userId, employees.userId))
    .where(
      and(
        eq(employees.userId, userId),
        eq(employees.active, true),
        eq(users.blocked, false),
        eq(users.mustChangePassword, false),
      ),
    );
  return row ?? null;
}
