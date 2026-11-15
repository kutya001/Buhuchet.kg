import { cpNoticeSettings, type CpNoticeSettings, type WeekDay } from '@buhuchet/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { orgTelegramNotices } from './schema';

/**
 * Строки «К оплате» и «Оплата за обслуживание» блока «Telegram-уведомления» (доработки 14.11.2026,
 * блок 3, этап 2, поток К; таблица `org_telegram_notices`): дни «за N» до срока, время отправки и день
 * напоминания о долге. Включено ли сообщение — по-прежнему в `org_settings` (`cp_tg_pay`, `cp_tg_debt`);
 * нет строки — «за 5 дней» в 10:00, долг — по понедельникам.
 */

export const CP_PAY_NOTICE = 'cp_pay';
export const CP_FEE_NOTICE = 'cp_fee';
export type CpNoticeCode = typeof CP_PAY_NOTICE | typeof CP_FEE_NOTICE;

/**
 * Настройки строк организации: `orgId` или организации из контекста (`app.current_org_id()`); кроме
 * RLS — и условием запроса.
 */
export async function cpNoticeSettingsOf(tx: Tx, orgId?: string): Promise<CpNoticeSettings> {
  const rows = await tx
    .select({
      code: orgTelegramNotices.code,
      days: orgTelegramNotices.days,
      atTime: orgTelegramNotices.atTime,
      weekday: orgTelegramNotices.weekday,
    })
    .from(orgTelegramNotices)
    .where(
      and(
        eq(orgTelegramNotices.orgId, orgId ?? sql`app.current_org_id()`),
        inArray(orgTelegramNotices.code, [CP_PAY_NOTICE, CP_FEE_NOTICE]),
      ),
    );
  return cpNoticeSettings({
    pay: rows.find((r) => r.code === CP_PAY_NOTICE),
    fee: rows.find((r) => r.code === CP_FEE_NOTICE),
  });
}

/**
 * Записать строку: создаётся или меняется целиком (дни, время, у «Оплаты за обслуживание» — день долга).
 * Зовёт только правка учётной политики (`PATCH /api/org/policy`) после записи в её историю — под
 * блокировкой строки org_settings, поэтому две правки не идут одновременно. Значения уже проверены:
 * дни — 1–5, время — «ЧЧ:ММ», день недели — 1–7 (ограничения таблицы проверяют ещё раз).
 */
export async function setCpNotice(
  tx: Tx,
  orgId: string,
  code: CpNoticeCode,
  value: { days: readonly number[]; at: string; weekDay?: WeekDay },
): Promise<void> {
  const weekday = code === CP_FEE_NOTICE ? (value.weekDay ?? 1) : null;
  await tx
    .insert(orgTelegramNotices)
    .values({
      orgId,
      code,
      days: [...value.days],
      atTime: value.at,
      weekday,
      updatedBy: sql`app.current_user_id()`,
    })
    .onConflictDoUpdate({
      target: [orgTelegramNotices.orgId, orgTelegramNotices.code],
      set: {
        days: [...value.days],
        atTime: value.at,
        weekday,
        version: sql`${orgTelegramNotices.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      },
    });
}
