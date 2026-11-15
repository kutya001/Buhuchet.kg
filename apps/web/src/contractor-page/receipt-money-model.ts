import type { YearMonth } from '@buhuchet/domain';
import type { SentFilePay } from '@buhuchet/shared';
import type { Translate } from '../l10n/translate';
import type { ReceiptPreset } from '../money/receipt-preset';
import { contractorPlan, monthName } from '../reports/report-months-model';

/*
 * «Принять» у чека из Telegram (доработки 14.11.2026, блок 4, пункт 4, этап 2; прототип v115
 * `pgRcptMoney`): сразу «Принять деньги» с суммой из оплаченного сообщения — налоги месяца разнесены по
 * отчётам от старых к новым, излишек — аванс; за обслуживание — «Принять оплату за обслуживание».
 */

type PlanRow = Parameters<typeof contractorPlan>[0][number];

/**
 * Окно «Поступление от контрагента» по чеку за налоги месяца (прототип `rmRecvPlan(rmRecvMonths(c, m))`
 * и `inDlg` с `pre.list`, `pre.total`): отчёты месяца, по которым ещё ждут деньги, общая сумма — из
 * сообщения. `null` — деньги на налоги за этот месяц уже получены.
 */
export function taxReceiptPreset<R extends PlanRow>(
  t: Translate,
  rows: readonly R[],
  pay: SentFilePay,
  lastMonth: YearMonth,
): ReceiptPreset | null {
  if (pay.purpose !== 'tax' || !pay.month) return null;
  const plan = contractorPlan(rows, { taxpay: true, quick: 'all', showClosed: true, lastMonth });
  const list = (plan.receive.get(pay.month)?.lines ?? []).map((x) => ({
    reportId: x.report.id,
    amount: x.amount,
  }));
  if (!list.length) return null;
  return {
    list,
    note: t('cppage.receipt.tax_note', { month: monthName(t, pay.month) }),
    ...(pay.amount ? { total: pay.amount } : {}),
  };
}

/** «Деньги на налоги за октябрь 2026 уже получены от контрагента» (прототип `pgRcptMoney`). */
export const taxReceivedText = (t: Translate, month: YearMonth) =>
  t('cppage.receipt.received', { month: monthName(t, month) });

/** Примечание оплаты за обслуживание по чеку: «По чеку из Telegram за октябрь 2026». */
export const feeReceiptNote = (t: Translate, pay: SentFilePay) =>
  pay.month
    ? t('cppage.receipt.fee_note', { month: monthName(t, pay.month) })
    : t('cppage.receipt.fee_note_any');
