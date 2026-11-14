import type { IsoDate } from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { writeContractorPageHistory } from './contractor-page';
import { updateWithHistory } from './history';
import { featureSet } from './org';
import {
  contractorPages,
  contractorTelegramLinks,
  contractorTelegramMessages,
  orgSettings,
} from './schema';

/*
 * Напоминание клиенту о долге в Telegram (доработки 13.11.2026, задача К5; прототип v94
 * modules/cp-telegram.js: `pgDebt`, `pgDebtTo`, `pgDebtMsg`, `tgAct('cp-nodebt')`, `pgDebtRow`).
 * Три выключателя: организация (`org_settings.cp_tg_debt`), сотрудник у контрагента
 * (`contractor_pages.tg_debt_off`), клиент у своего чата (`contractor_telegram_links.no_debt`).
 * Сообщения — в `contractor_telegram_messages` (вид `debt`, одно на неделю и чат).
 */

/**
 * «Напоминать контрагентам о долге» у организации из контекста: настройка и функции. `fee` и `taxpay`
 * — из чего складывается долг (без обеих напоминать не о чем).
 */
export async function contractorTelegramDebtSettings(
  tx: Tx,
): Promise<{ on: boolean; fee: boolean; taxpay: boolean; available: boolean }> {
  const [row] = await tx
    .select({ on: orgSettings.cpTgDebt, features: orgSettings.features })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, sql`app.current_org_id()`));
  const features = featureSet(row?.features ?? {});
  const available = features.telegram && features.cppage && (features.fee || features.taxpay);
  return { on: !!row?.on && available, fee: features.fee, taxpay: features.taxpay, available };
}

/** «Напоминать о долге в Telegram» у контрагента: выключено ли сотрудником и версия записи страницы. */
export async function contractorDebtSwitch(
  tx: Tx,
  contractorId: string,
): Promise<{ off: boolean; version: number } | null> {
  const [row] = await tx
    .select({ off: contractorPages.tgDebtOff, version: contractorPages.version })
    .from(contractorPages)
    .where(eq(contractorPages.contractorId, contractorId));
  return row ?? null;
}

/**
 * Сотрудник включил или выключил напоминание о долге у контрагента (прототип pgTgBoxClick, `debt`):
 * по версии записи страницы, с записью в историю контрагента.
 */
export async function setContractorDebtOff(
  tx: Tx,
  contractorId: string,
  off: boolean,
  version: number,
): Promise<void> {
  await updateWithHistory(tx, {
    table: contractorPages,
    entity: 'contractor_page',
    key: contractorPages.contractorId,
    id: contractorId,
    version,
    patch: { tgDebtOff: off },
    contractorId,
  });
}

/**
 * Клиент выключил («Не напоминать») или снова включил («Напоминать») напоминания о долге у своего
 * чата: только подключённая строка этого чата, история контрагента — в той же транзакции. `null` —
 * строки нет или отметка уже такая.
 */
export async function setContractorTelegramNoDebt(
  tx: Tx,
  input: { linkId: string; chatId: number; noDebt: boolean },
): Promise<{ contractorId: string; name: string } | null> {
  const [row] = await tx
    .update(contractorTelegramLinks)
    .set({ noDebt: input.noDebt })
    .where(
      and(
        eq(contractorTelegramLinks.id, input.linkId),
        eq(contractorTelegramLinks.chatId, input.chatId),
        eq(contractorTelegramLinks.status, 'on'),
        eq(contractorTelegramLinks.noDebt, !input.noDebt),
      ),
    )
    .returning({
      contractorId: contractorTelegramLinks.contractorId,
      name: contractorTelegramLinks.name,
    });
  if (!row) return null;
  await writeContractorPageHistory(
    tx,
    row.contractorId,
    input.noDebt ? 'page_tg_nodebt' : 'page_tg_debt_on',
    { changes: [{ field: 'telegram', to: row.name }] },
  );
  return row;
}

/** Каким подключениям напоминание о долге за неделю уже записано (ушло или ждёт повтора). */
export async function debtLinkIds(
  tx: Tx,
  contractorId: string,
  week: IsoDate,
): Promise<Set<string>> {
  const rows = await tx
    .select({ linkId: contractorTelegramMessages.linkId })
    .from(contractorTelegramMessages)
    .where(
      and(
        eq(contractorTelegramMessages.contractorId, contractorId),
        eq(contractorTelegramMessages.kind, 'debt'),
        eq(contractorTelegramMessages.week, week),
      ),
    );
  return new Set(rows.map((r) => r.linkId));
}

/** Напоминание о долге этой недели, которое ещё не ушло и не исчерпало попытки: задача повторит. */
export async function unsentDebtMessages(
  tx: Tx,
  contractorId: string,
  week: IsoDate,
  maxAttempts: number,
): Promise<{ id: string; linkId: string; chatId: number }[]> {
  return tx
    .select({
      id: contractorTelegramMessages.id,
      linkId: contractorTelegramMessages.linkId,
      chatId: contractorTelegramMessages.chatId,
    })
    .from(contractorTelegramMessages)
    .where(
      and(
        eq(contractorTelegramMessages.contractorId, contractorId),
        eq(contractorTelegramMessages.kind, 'debt'),
        eq(contractorTelegramMessages.week, week),
        sql`${contractorTelegramMessages.messageId} is null`,
        sql`${contractorTelegramMessages.attempts} < ${maxAttempts}`,
      ),
    );
}
