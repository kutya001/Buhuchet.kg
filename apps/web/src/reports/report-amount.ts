import { formatSom, lineTax, parseSom, type Tyiyn } from '@buhuchet/domain';
import type { ReportCard } from '@buhuchet/shared';

/**
 * Поля суммы окон «Отметить сданным» и «Сумма к уплате» (прототип ui/status-scale.js: linesFld,
 * bindLines, readLines, partsFld, bindParts): строки по ставкам — выручка и налог (налог подставляется
 * как выручка × ставка, пока его не исправили руками); строки по платежам — сумма по каждому; итог
 * строк — сумма к уплате, руками не вводится. Без строк — одно поле суммы.
 */

type LineDef = ReportCard['lineDefs'][number];

export interface AmountLine {
  revenue: string;
  tax: string;
  /** Налог введён руками (не равен выручке × ставку): выручка его больше не перезаписывает. */
  manual: boolean;
}

export interface AmountForm {
  lines: AmountLine[];
  /** Итог: при строках — их сумма, без строк — введённая сумма. */
  amount: string;
  /** Итог при открытии окна: все строки пустые — показывается он. */
  initial: string;
}

const som = (v: Tyiyn | null) => (v === null ? '' : formatSom(v, 'auto'));

/** Поля при открытии окна: сохранённые строки отчёта по ключам, сумма — как есть. */
export function amountFormOf(card: Pick<ReportCard, 'amount' | 'lines' | 'lineDefs'>): AmountForm {
  const initial = som(card.amount);
  return {
    lines: card.lineDefs.map((d) => {
      const stored = card.lines.find((l) => l.key === d.key);
      if (!stored) return { revenue: '', tax: '', manual: false };
      return {
        revenue: som(stored.revenue),
        tax: som(stored.tax),
        manual: stored.revenue === null || stored.tax !== lineTax(stored.revenue, d.pct),
      };
    }),
    amount: initial,
    initial,
  };
}

/** Значение поля: пусто — null, не сумма или меньше нуля — NaN. */
function valueOf(text: string): Tyiyn | null {
  if (text.trim() === '') return null;
  const n = parseSom(text);
  return n === null || n < 0 ? Number.NaN : n;
}

/** Итог строк: все пустые — итог при открытии, ошибка в строке — пусто (прототип bindLines `f`). */
function total(defs: readonly LineDef[], lines: readonly AmountLine[], initial: string): string {
  let sum = 0;
  let any = false;
  for (const [k, l] of lines.entries()) {
    const tax = valueOf(l.tax);
    const revenue = valueOf(l.revenue);
    const value =
      tax ?? (revenue !== null && !Number.isNaN(revenue) ? lineTax(revenue, defs[k]!.pct) : null);
    if (value === null) continue;
    if (Number.isNaN(value)) return '';
    any = true;
    sum += value;
  }
  return any ? som(sum) : initial;
}

/** Введена выручка строки: налог — выручка × ставка, если его не правили руками. */
export function withRevenue(
  defs: readonly LineDef[],
  form: AmountForm,
  k: number,
  revenue: string,
): AmountForm {
  const lines = form.lines.map((l, i) => {
    if (i !== k) return l;
    if (l.manual) return { ...l, revenue };
    const n = valueOf(revenue);
    const tax = n === null || Number.isNaN(n) ? '' : som(lineTax(n, defs[k]!.pct));
    return { ...l, revenue, tax };
  });
  return { ...form, lines, amount: total(defs, lines, form.initial) };
}

/** Введён налог строки: введённый руками выручка больше не перезаписывает, пустой — снова считается. */
export function withTax(
  defs: readonly LineDef[],
  form: AmountForm,
  k: number,
  tax: string,
): AmountForm {
  const lines = form.lines.map((l, i) => (i === k ? { ...l, tax, manual: tax.trim() !== '' } : l));
  return { ...form, lines, amount: total(defs, lines, form.initial) };
}

/** Введённое для запроса: итог (null — не введён) и строки (null — строк в окне нет). */
export type AmountRead =
  | {
      ok: true;
      amount: Tyiyn | null;
      lines: { key: string; revenue: Tyiyn | null; tax: Tyiyn | null }[] | null;
    }
  | { ok: false; field: 'lines'; label: string }
  | { ok: false; field: 'amount' };

/**
 * Проверить и собрать сумму (прототип readLines, submitDlg, sumDlg): строка с выручкой или налогом не
 * числом или меньше нуля — ошибка у строк; итог не числом — у поля суммы. В «Отметить сданным» пустой
 * итог — сумма не меняется; в «Сумме к уплате» сумма обязательна.
 */
export function readAmount(
  defs: readonly LineDef[],
  form: AmountForm,
  required: boolean,
): AmountRead {
  let lines: { key: string; revenue: Tyiyn | null; tax: Tyiyn | null }[] | null = null;
  if (defs.length) {
    lines = [];
    for (const [k, d] of defs.entries()) {
      const l = form.lines[k]!;
      const revenue = d.kind === 'rate' ? valueOf(l.revenue) : null;
      const tax = valueOf(l.tax);
      if (Number.isNaN(revenue) || Number.isNaN(tax))
        return { ok: false, field: 'lines', label: d.label };
      lines.push({ key: d.key, revenue, tax });
    }
  }
  const amount = valueOf(form.amount);
  if (amount === null) {
    if (required) return { ok: false, field: 'amount' };
    // Итог не введён — строки и сумма не меняются (прототип: `if (v !== '')`).
    return { ok: true, amount: null, lines: null };
  }
  if (Number.isNaN(amount)) return { ok: false, field: 'amount' };
  return { ok: true, amount, lines };
}
