import type { PayClaimPurpose, Tyiyn, YearMonth } from '@buhuchet/domain';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { contractorPayClaims, contractorTelegramMessages } from './schema';

/**
 * «Оплатил» в Telegram и чек к нему (доработки 14.11.2026, блок 4, пункт 4, этап 2, поток К; таблица
 * `contractor_pay_claims`): клиент сообщает, что перевёл деньги. Пока сообщение не отклонено, само «К
 * оплате» и «Оплата за обслуживание до …» за этот месяц больше не уходят (прототип v115 `pgPaidMark`).
 * Всё — в транзакции организации без пользователя (клиент — не сотрудник): роль приложения вставляет
 * только ждущее подтверждения и меняет у него только чек.
 */

/** Месяцы, за которые клиент сообщил об оплате и сообщение не отклонено. */
export async function payClaimMonths(
  tx: Tx,
  contractorId: string,
  purpose: PayClaimPurpose,
): Promise<Set<YearMonth>> {
  const rows = await tx
    .select({ month: contractorPayClaims.month })
    .from(contractorPayClaims)
    .where(
      and(
        eq(contractorPayClaims.contractorId, contractorId),
        eq(contractorPayClaims.purpose, purpose),
        isNotNull(contractorPayClaims.month),
        inArray(contractorPayClaims.status, ['wait', 'done']),
      ),
    );
  return new Set(rows.map((r) => r.month!));
}

export interface TelegramPayClaimInput {
  contractorId: string;
  purpose: PayClaimPurpose;
  month: YearMonth | null;
  amount: Tyiyn | null;
  /** Сообщение «К оплате» или «Оплата за обслуживание», под которым нажали «Оплатил» или «Прислать чек». */
  tgMessageId: string;
  sentFileId?: string | null;
}

/** «Оплатил» в Telegram: строка «ждёт подтверждения». Возвращает её номер. */
export async function insertTelegramPayClaim(tx: Tx, o: TelegramPayClaimInput): Promise<string> {
  const [row] = await tx
    .insert(contractorPayClaims)
    .values({
      orgId: sql`app.current_org_id()`,
      contractorId: o.contractorId,
      source: 'telegram',
      purpose: o.purpose,
      month: o.month,
      amount: o.amount && o.amount > 0 ? o.amount : null,
      tgMessageId: o.tgMessageId,
      sentFileId: o.sentFileId ?? null,
    })
    .returning({ id: contractorPayClaims.id });
  return row!.id;
}

/**
 * Чек пришёл: он становится чеком последнего «Оплатил» под этим сообщением, у которого чека ещё нет и
 * которое ждёт подтверждения; такого нет («Прислать чек» без «Оплатил» или чек уже есть) — новое
 * «Оплатил» с этим чеком (чек — тоже сообщение клиента об оплате). Строка блокируется: два чека подряд
 * не лягут в одну.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-11
export async function attachPayClaimReceipt(
  tx: Tx,
  o: TelegramPayClaimInput & { sentFileId: string },
): Promise<string> {
  const [open] = await tx
    .select({ id: contractorPayClaims.id })
    .from(contractorPayClaims)
    .where(
      and(
        eq(contractorPayClaims.contractorId, o.contractorId),
        eq(contractorPayClaims.tgMessageId, o.tgMessageId),
        eq(contractorPayClaims.status, 'wait'),
        isNull(contractorPayClaims.sentFileId),
      ),
    )
    .orderBy(sql`${contractorPayClaims.createdAt} desc`, contractorPayClaims.id)
    .limit(1)
    .for('update');
  if (open) {
    await tx
      .update(contractorPayClaims)
      // Версия растёт: сотрудник, открывший «Оплатил» до чека, получит «запись изменена».
      .set({
        sentFileId: o.sentFileId,
        updatedAt: sql`now()`,
        version: sql`${contractorPayClaims.version} + 1`,
      })
      .where(eq(contractorPayClaims.id, open.id));
    return open.id;
  }
  return insertTelegramPayClaim(tx, o);
}

/** Чек к оплате: что оплачено, за какой месяц и сколько (для «Принять» в «Файлах от контрагентов»). */
export interface SentFilePay {
  purpose: PayClaimPurpose;
  month: YearMonth | null;
  amount: Tyiyn | null;
}

/** Чеки среди отправленных файлов: номер файла → что оплачено. */
export async function sentFilePays(
  tx: Tx,
  sentFileIds: readonly string[],
): Promise<Map<string, SentFilePay>> {
  if (!sentFileIds.length) return new Map();
  const rows = await tx
    .select({
      fileId: contractorPayClaims.sentFileId,
      purpose: contractorPayClaims.purpose,
      month: contractorPayClaims.month,
      amount: contractorPayClaims.amount,
    })
    .from(contractorPayClaims)
    .where(inArray(contractorPayClaims.sentFileId, [...sentFileIds]));
  return new Map(
    rows.map((r) => [r.fileId!, { purpose: r.purpose, month: r.month, amount: r.amount }]),
  );
}

/**
 * Подключения, которым в этот день уже записано само «Оплата за обслуживание до …» (одно на чат в день —
 * ключ в базе). Не ушедшее не повторяется: следующий отмеченный день отправит новое.
 */
export async function autoFeeLinkIds(
  tx: Tx,
  contractorId: string,
  day: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ linkId: contractorTelegramMessages.linkId })
    .from(contractorTelegramMessages)
    .where(
      and(
        eq(contractorTelegramMessages.contractorId, contractorId),
        eq(contractorTelegramMessages.kind, 'fee'),
        eq(contractorTelegramMessages.auto, true),
        eq(contractorTelegramMessages.day, day),
      ),
    );
  return new Set(rows.map((r) => r.linkId));
}
