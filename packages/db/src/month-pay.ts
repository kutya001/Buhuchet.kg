import {
  localPhoneText,
  mainTaxRequisite,
  requisiteText,
  type PaysTo,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { bankNamesOf } from './fees';
import { writeHistory } from './history';
import { listEmployeeWallets, listOrgAccounts } from './money';
import { auditLog } from './schema';
import { phoneCodeList } from './staff';

/*
 * «К оплате клиенту» за месяц (доработки 13.11.2026, задача К4; прототип v94 modules/cp-telegram.js:
 * `pgTaxAcc`, `rmPayMount`). Строки месяца — `reportMonthPlanRows` (`report-list.ts`), расчёт — правило
 * `monthToPay` домена; здесь — реквизит для налогов текстом и запись «скопирован текст» в историю.
 */

/**
 * Реквизит для налогов контрагента одной строкой (прототип `pgTaxAcc` и `rqTxt`) — тот же, что в «Как
 * оплатить» страницы контрагента: основной счёт организации для налогов или основной реквизит
 * ответственного (без отметки «Основной» — первый). null — реквизита нет.
 */
export async function contractorTaxRequisiteText(
  tx: Tx,
  o: { paysTo: PaysTo; responsibleId: string | null },
  t: Translate,
): Promise<string | null> {
  const [accounts, wallets] = await Promise.all([
    o.paysTo === 'org' ? listOrgAccounts(tx) : Promise.resolve([]),
    o.paysTo === 'emp' && o.responsibleId
      ? listEmployeeWallets(tx, o.responsibleId)
      : Promise.resolve([]),
  ]);
  const a = mainTaxRequisite(o.paysTo, accounts, wallets);
  if (!a) return null;
  const [codes, names] = await Promise.all([
    phoneCodeList(tx),
    bankNamesOf(tx, a.kind === 'phone' ? a.phoneBanks : a.bankCode ? [a.bankCode] : []),
  ]);
  return requisiteText(
    {
      kind: a.kind,
      bankNames:
        a.kind === 'phone'
          ? a.phoneBanks.map((c) => names.get(c) ?? c)
          : [a.bankCode ? (names.get(a.bankCode) ?? a.bankCode) : ''],
      accountNo: a.accountNo,
      bik: 'bik' in a ? a.bik : null,
      phoneText: a.phone ? localPhoneText(a.phone, codes) : '',
      holderName: a.holderName,
    },
    o.paysTo === 'org' ? 'org' : 'employee',
    t,
  );
}

/** Сколько минут повтор того же «Скопировать для клиента» не пишется в историю второй раз. */
export const PAY_TEXT_COPY_REPEAT_MINUTES = 5;

/**
 * «Скопировать для клиента» — в историю контрагента (прототип: «Скопирован текст «К оплате» за октябрь
 * 2026: 5 000 сом»): месяц и сумма на момент копирования. Повтор того же пользователя с тем же месяцем
 * и суммой за последние минуты запись не добавляет: метод доступен с правами просмотра, а вкладка
 * «История» показывает последние записи — их нельзя вытеснить нажатиями. Ответ — записано ли.
 */
export async function logPayTextCopy(
  tx: Tx,
  contractorId: string,
  month: YearMonth,
  total: Tyiyn,
): Promise<boolean> {
  // Одновременные нажатия одного пользователя по одному контрагенту идут по очереди: второе уже
  // видит запись первого и свою не пишет.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('pay_text_copy:' || ${contractorId} || ':' || coalesce(app.current_user_id()::text, ''), 0))`,
  );
  const [same] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'contractor'),
        eq(auditLog.entityId, contractorId),
        eq(auditLog.action, 'pay_text_copy'),
        sql`${auditLog.actorUserId} is not distinct from app.current_user_id()`,
        sql`${auditLog.at} > now() - make_interval(mins => ${PAY_TEXT_COPY_REPEAT_MINUTES})`,
        sql`${auditLog.changes} @> ${JSON.stringify([{ field: 'payText', to: { month, total } }])}::jsonb`,
      ),
    )
    .limit(1);
  if (same) return false;
  await writeHistory(tx, {
    entity: 'contractor',
    entityId: contractorId,
    action: 'pay_text_copy',
    changes: [{ field: 'payText', to: { month, total } }],
    contractorId,
  });
  return true;
}
