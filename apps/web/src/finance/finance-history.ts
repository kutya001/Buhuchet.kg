import {
  allocationText,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  type Allocation,
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

const numberOf = (v: unknown): number | null => (typeof v === 'number' ? v : null);

const reportAmounts = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter(
    (a): a is { report: string; amount: number } =>
      typeof a === 'object' &&
      a !== null &&
      typeof a.report === 'string' &&
      typeof a.amount === 'number',
  );

const monthAmounts = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter(
    (a): a is { month: string; amount: number } =>
      typeof a === 'object' &&
      a !== null &&
      typeof a.month === 'string' &&
      /^\d{4}-\d{2}$/.test(a.month) &&
      typeof a.amount === 'number',
  );

/** Счёт в истории (прототип accName): «счёт организации», «счёт Иванова А.». */
function holderText(t: Translate, v: unknown): string {
  const h = typeof v === 'object' && v !== null ? (v as { kind?: unknown; name?: unknown }) : null;
  if (!h) return '—';
  if (h.kind === 'org') return t('fin.hist.acc_org');
  return t('fin.hist.acc_emp', { name: typeof h.name === 'string' ? h.name : '—' });
}

/** Целые сомы без копеек (прототип `fmtM(x, false)`): «21 490». */
const wholeSom = (x: number) => formatSom(Math.round(x / 100) * 100, 'auto');

/**
 * Детализация поступления (прототип allocText): «НДС 09.2026 — 3 000; обслуживание октябрь 2026 —
 * 14 000; аванс — 1 000» — целые сомы, как `fmtM(x, false)`; без строк — «аванс».
 */
function detailText(
  t: Translate,
  reports: readonly { report: string; amount: number }[],
  fee: readonly { month: string; amount: number }[],
  tax: number | null,
): string {
  const list = [
    ...reports.map((a) => `${a.report} — ${wholeSom(a.amount)}`),
    ...fee.map((a) =>
      t('fee.hist.receipt_item', {
        month: monthLabel(a.month as `${number}-${number}`),
        amount: wholeSom(a.amount),
      }),
    ),
  ];
  const advance = tax === null ? 0 : tax - reports.reduce((sum, a) => sum + a.amount, 0);
  if (list.length && advance > 0)
    list.push(t('cp.hist.receipt_advance', { amount: wholeSom(advance) }));
  return list.join('; ') || t('fin.hist.alloc_none');
}

const withReason = (t: Translate, parts: readonly string[], reason: string | null) =>
  reason
    ? t('fin.hist.edited_why', { what: parts.join('; '), reason })
    : t('fin.hist.edited', { what: parts.join('; ') });

/**
 * Изменение операции или поступления (прототип opEditDlg и inDlg с `edit`, opLog): «Изменено: сумма
 * 1 000,00 → 1 200,00 сом; дата 18.10.2026 → 17.10.2026; счёт: счёт организации → счёт Иванова А.;
 * примечание «—» → «…». Причина: …». Поступление — «общая сумма …», «детализация «…» → «…»». Запись
 * не об изменении (без поля `kind`) — null.
 */
export function operationEditedText(
  t: Translate,
  changes: readonly HistoryChange[],
  reason: string | null,
): string | null {
  const kind = valueOf(changes, 'kind', 'to');
  if (typeof kind !== 'string') return null;
  const parts: string[] = [];
  const amount = changes.find((c) => c.field === 'amount');
  if (amount) {
    const corr = kind === 'corr';
    const som = (v: unknown) => {
      const n = numberOf(v) ?? 0;
      return corr ? `${n < 0 ? '−' : '+'}${formatSom(Math.abs(n))}` : formatSom(n);
    };
    parts.push(t('fin.hist.ch.amount', { from: som(amount.from), to: som(amount.to) }));
  }
  const total = changes.find((c) => c.field === 'total');
  const fee = changes.find((c) => c.field === 'feeTotal');
  if (total) {
    const from = (numberOf(total.from) ?? 0) + (numberOf(fee?.from) ?? 0);
    const to = (numberOf(total.to) ?? 0) + (numberOf(fee?.to) ?? 0);
    if (from !== to)
      parts.push(t('fin.hist.ch.total', { from: formatSom(from), to: formatSom(to) }));
  }
  const date = changes.find((c) => c.field === 'opDate');
  if (date && typeof date.from === 'string' && typeof date.to === 'string')
    parts.push(t('fin.hist.ch.date', { from: formatDateRu(date.from), to: formatDateRu(date.to) }));
  const allocs = changes.find((c) => c.field === 'allocations');
  const feeAllocs = changes.find((c) => c.field === 'feeAllocations');
  if (allocs || feeAllocs) {
    const from = detailText(
      t,
      reportAmounts(allocs?.from),
      monthAmounts(feeAllocs?.from),
      numberOf(total?.from),
    );
    const to = detailText(
      t,
      reportAmounts(allocs?.to),
      monthAmounts(feeAllocs?.to),
      numberOf(total?.to),
    );
    if (from !== to) parts.push(t('fin.hist.ch.alloc', { from, to }));
  }
  const holder = changes.find((c) => c.field === 'holder');
  if (holder)
    parts.push(
      t('fin.hist.ch.holder', { from: holderText(t, holder.from), to: holderText(t, holder.to) }),
    );
  const note = changes.find((c) => c.field === 'note');
  if (note)
    parts.push(
      t('fin.hist.ch.note', {
        from: (typeof note.from === 'string' && note.from) || '—',
        to: (typeof note.to === 'string' && note.to) || '—',
      }),
    );
  if (!parts.length) return null;
  return withReason(t, parts, reason);
}

/**
 * Изменение оплаты за обслуживание (прототип contractor-card.js, `ent:'fp'`): «Изменено: сумма 14 000,00
 * → 16 000,00 сом; дата …; месяцы «октябрь 2026 — 14 000» → «…»; куда: … → …; примечание. Причина: …».
 */
export function feePaymentEditedText(
  t: Translate,
  changes: readonly HistoryChange[],
  reason: string | null,
): string | null {
  const parts: string[] = [];
  const amount = changes.find((c) => c.field === 'amount');
  if (amount && amount.to !== undefined)
    parts.push(
      t('fin.hist.ch.amount', {
        from: formatSom(numberOf(amount.from) ?? 0),
        to: formatSom(numberOf(amount.to) ?? 0),
      }),
    );
  const date = changes.find((c) => c.field === 'paidOn');
  if (date && typeof date.from === 'string' && typeof date.to === 'string')
    parts.push(t('fin.hist.ch.date', { from: formatDateRu(date.from), to: formatDateRu(date.to) }));
  const alloc = changes.find((c) => c.field === 'allocation');
  if (alloc) {
    const text = (v: unknown) =>
      allocationText(t, 0, monthAmounts(v) as Allocation) || t('fin.hist.alloc_none');
    parts.push(t('fin.hist.ch.months', { from: text(alloc.from), to: text(alloc.to) }));
  }
  const to = changes.find((c) => c.field === 'to');
  if (to && typeof to.from === 'string' && typeof to.to === 'string')
    parts.push(t('fin.hist.ch.to', { from: to.from, to: to.to }));
  if (changes.some((c) => c.field === 'note')) parts.push(t('fin.hist.ch.note_word'));
  if (!parts.length) return null;
  return withReason(t, parts, reason);
}

/**
 * Удаление оплаты за обслуживание (прототип opDelDlg, opLog): «Операция удалена: оплата за обслуживание
 * на 14 000 сом от 18.10.2026. Причина: …»; часть поступления — «Удалена вместе с поступлением от …».
 */
export function feePaymentDeletedText(
  t: Translate,
  changes: readonly HistoryChange[],
  reason: string | null,
): string | null {
  const receipt = valueOf(changes, 'receipt', 'from');
  if (typeof receipt === 'string') {
    const text = t('fin.hist.fee_receipt_deleted', { date: formatDateRu(receipt) });
    return reason ? `${text} (${reason})` : text;
  }
  const amount = numberOf(valueOf(changes, 'amount', 'from'));
  const date = valueOf(changes, 'paidOn', 'from');
  if (amount === null || typeof date !== 'string') return null;
  const params = { amount: formatSomWithUnit(amount), date: formatDateRu(date) };
  return reason
    ? t('fin.hist.fee_deleted_why', { ...params, reason })
    : t('fin.hist.fee_deleted', params);
}
