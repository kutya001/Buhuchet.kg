import {
  formatDateRu,
  formatSomWithUnit,
  type MoneyOpKind,
  type UiTextKey,
} from '@buhuchet/domain';
import type { Translate } from '../l10n/translate';

/*
 * Строки истории операций с остатком (задача 2.20; прототип modules/contractors.js — `log('cp', …)` у
 * списания и возврата, modules/finance.js — у перевода и обратной записи, modules/fin-op.js — `opLog`
 * у удаления). Общие для окна операции и вкладки «История» контрагента.
 */

interface HistoryChange {
  field: string;
  from?: unknown;
  to?: unknown;
}

/** Подписи окна удаления по виду: у списания и возврата — «Отменить …» (прототип opDelDlg, `T_`). */
export const deleteWords = (kind: MoneyOpKind) =>
  kind === 'bonus' || kind === 'refund'
    ? ({
        title: `fin.del.title_${kind}`,
        ask: `fin.del.ask_${kind}`,
        ok: `fin.del.ok_${kind}`,
        done: `fin.del.done_${kind}`,
      } as const satisfies Record<string, UiTextKey>)
    : ({
        title: 'fin.del.title',
        ask: 'fin.del.ask',
        ok: 'fin.del.ok',
        done: 'fin.del.done',
      } as const satisfies Record<string, UiTextKey>);

/** Знак обратной записи (прототип: `amount < 0 ? '−' : '+'`). */
export const signedSom = (amount: number) =>
  `${amount < 0 ? '−' : '+'}${formatSomWithUnit(Math.abs(amount))}`;

const valueOf = (changes: readonly HistoryChange[], field: string, key: 'from' | 'to') =>
  changes.find((c) => c.field === field)?.[key];

/**
 * Удаление операции (прототип opLog): «Списание отменено: списание в бонус на 300 сом от 18.10.2026.
 * Причина: …». Вид, сумма и дата — из записи истории, иначе — из самой операции.
 */
export function operationDeletedText(
  t: Translate,
  changes: readonly HistoryChange[],
  reason: string | null,
  fallback?: { kind: MoneyOpKind; amount: number; date: string },
): string | null {
  const kind = valueOf(changes, 'kind', 'from');
  const amount = valueOf(changes, 'amount', 'from');
  const date = valueOf(changes, 'opDate', 'from');
  // Часть за обслуживание — тому, кто видит плату (сервер иначе её не отдаёт): сумма всего поступления.
  const fee = valueOf(changes, 'feeTotal', 'from');
  const k = (typeof kind === 'string' ? kind : fallback?.kind) as MoneyOpKind | undefined;
  const sum =
    typeof amount === 'number' ? amount + (typeof fee === 'number' ? fee : 0) : fallback?.amount;
  const day = typeof date === 'string' ? date : fallback?.date;
  if (!k || sum === undefined || !day) return null;
  const params = {
    done: t(deleteWords(k).done),
    kind: t(`money.op.${k}`).toLowerCase(),
    amount: formatSomWithUnit(Math.abs(sum)),
    date: formatDateRu(day),
  };
  return reason ? t('fin.hist.deleted_why', { ...params, reason }) : t('fin.hist.deleted', params);
}

/**
 * Ввод операции в истории контрагента: «Списано в бонус 300 сом», «Возврат контрагенту 300 сом»,
 * «Перевод 300 сом со счёта организации на счёт Иванова А.», «Обратная запись к поступлению от
 * 17.10.2026: −100 сом». Поступление и оплата налога — не здесь (null).
 */
export function operationCreatedText(
  t: Translate,
  changes: readonly HistoryChange[],
): string | null {
  const kind = valueOf(changes, 'kind', 'to');
  const amount = valueOf(changes, 'amount', 'to');
  if (typeof amount !== 'number') return null;
  switch (kind) {
    case 'bonus':
      return t('fin.hist.bonus', { amount: formatSomWithUnit(amount) });
    case 'refund':
      return t('fin.hist.refund', { amount: formatSomWithUnit(amount) });
    case 'xfer': {
      const holder = valueOf(changes, 'holder', 'to');
      return t('fin.hist.xfer', {
        amount: formatSomWithUnit(amount),
        name: typeof holder === 'string' ? holder : '—',
      });
    }
    case 'corr': {
      const receipt = valueOf(changes, 'receipt', 'to');
      return t('fin.hist.corr', {
        date: typeof receipt === 'string' ? formatDateRu(receipt) : '—',
        amount: signedSom(amount),
      });
    }
    default:
      return null;
  }
}

/**
 * Запись поступления в окне операции (прототип inDlg: «Поступление 5 000 сом записано»): вся сумма,
 * часть за обслуживание — если сервер её отдал.
 */
export function receiptCreatedText(t: Translate, changes: readonly HistoryChange[]): string | null {
  const total = valueOf(changes, 'total', 'to');
  if (typeof total !== 'number') return null;
  const fee = valueOf(changes, 'feeTotal', 'to');
  return t('fin.hist.receipt_created', {
    amount: formatSomWithUnit(total + (typeof fee === 'number' ? fee : 0)),
  });
}
