import { weekDayOf, type WeekDay } from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { orgTelegramNotices } from './schema';

/**
 * Строки блока «Telegram-уведомления» (пакет 14.11.2026, блок 3; таблица org_telegram_notices): дни и
 * время сообщений, которых нет в учётной политике. Включено ли сообщение — по-прежнему в org_settings и
 * telegram_groups; строки нет — у сообщения прежние дни и время. Строка недельной сводки сотрудникам —
 * `staff_week` (её день); строки контрагентов (`cp_pay`, `cp_fee`) заполняет поток К (этап 2).
 */

/** Код строки недельной сводки сотрудникам. */
export const STAFF_WEEK_NOTICE = 'staff_week';

/**
 * День недельной сводки организации из контекста (`app.current_org_id()`, кроме RLS — и условием
 * запроса); строки нет — понедельник, как было.
 */
export async function staffWeekDay(tx: Tx): Promise<WeekDay> {
  const [row] = await tx
    .select({ weekday: orgTelegramNotices.weekday })
    .from(orgTelegramNotices)
    .where(
      and(
        eq(orgTelegramNotices.orgId, sql`app.current_org_id()`),
        eq(orgTelegramNotices.code, STAFF_WEEK_NOTICE),
      ),
    );
  return weekDayOf(row?.weekday);
}

/**
 * Записать день недельной сводки: строка `staff_week` создаётся или меняется. Зовёт только правка
 * учётной политики (`PATCH /api/org/policy`) после записи в её историю — под блокировкой строки
 * org_settings, поэтому две правки одного дня не идут одновременно.
 */
export async function setStaffWeekDay(tx: Tx, orgId: string, weekDay: WeekDay): Promise<void> {
  await tx
    .insert(orgTelegramNotices)
    .values({
      orgId,
      code: STAFF_WEEK_NOTICE,
      weekday: weekDay,
      updatedBy: sql`app.current_user_id()`,
    })
    .onConflictDoUpdate({
      target: [orgTelegramNotices.orgId, orgTelegramNotices.code],
      set: {
        weekday: weekDay,
        version: sql`${orgTelegramNotices.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      },
    });
}
