import { rateVariants, singleTaxRateParts, type SingleTaxRateText } from '../dicts/value-guide';
import type { Translate } from '../l10n/texts';
import type { RateAddition } from '../platform-dicts/catalog';
import type { AssignmentEnRate } from './rules';

/*
 * Ставка в назначении словами (ТЗ «Ставки и параметры отчёта», «Сумма ЕН при нескольких ставках»;
 * прототип core/tax-lines.js: aRows, aRateTxt, rtTxt): у единого налога — строки «Ставок единого
 * налога» («ЕНС-04 · 4 % безнал + 6 % нал»), у налога с продаж — основная ставка и добавленные строки.
 */

/** Виды единого налога: ставка в назначении — строки «Ставок единого налога» (прототип EN_IDS). */
export const SINGLE_TAX_TYPES: readonly string[] = ['enq', 'enm'];
export const isSingleTaxType = (code: string) => SINGLE_TAX_TYPES.includes(code);

/** Ставка, из которой получается текст: строка ЕНС или добавляемая строка вида. */
type RateSource = Pick<RateAddition, 'rate' | 'rateCashless' | 'rateCash'> & { code?: string };

const asSingleTax = (x: RateSource): SingleTaxRateText => ({
  code: x.code ?? '',
  rate: x.rate,
  rateCashless: x.rateCashless ?? '',
  rateCash: x.rateCash ?? '',
});

/** Строка, на которую ссылается «по ставкам ЕНС-04» (без петель). */
function resolved(x: SingleTaxRateText, rates: readonly SingleTaxRateText[]): SingleTaxRateText {
  const seen = new Set<string>();
  let cur = x;
  for (;;) {
    const ref = /по ставкам (ЕНС-\d+)/.exec(cur.rate)?.[1];
    const next =
      ref && ref !== cur.code && !seen.has(ref) ? rates.find((r) => r.code === ref) : null;
    if (!next) return cur;
    seen.add(cur.code);
    cur = next;
  }
}

/**
 * Текст одной ставки (прототип rtTxt): «4 % безнал + 6 % нал», «5 % (Бишкек и Ош)», «0 %»; коротко —
 * «4 / 6 %», «5 %». Ставка по датам — действующая на `date`; без процента — текст ставки как есть.
 */
export function rateText(
  source: RateSource,
  rates: readonly SingleTaxRateText[],
  options: { date: string; variant?: number | null; short?: boolean },
  t: Translate,
): string {
  const x = asSingleTax(source);
  const variant = options.variant ?? 0;
  const parts = singleTaxRateParts(x, rates, options.date, t, variant);
  if (!parts.length) return x.rate;
  if (parts.length === 2) {
    const [cashless, cash] = [parts[0]!, parts[1]!];
    return options.short
      ? t('report.rate.split_short', { cashless: cashless.pct.replace(' %', ''), cash: cash.pct })
      : t('report.rate.split', { cashless: cashless.pct, cash: cash.pct });
  }
  const pct = parts[0]!.pct;
  if (options.short) return pct;
  const variants = rateVariants(resolved(x, rates).rate);
  const name = variants.length
    ? variants[Math.min(Math.max(0, variant), variants.length - 1)]!.name
    : '';
  return name ? t('report.rate.variant', { pct, variant: name }) : pct;
}

/** Назначение — то, от чего зависит ставка словами. */
export interface AssignmentRate {
  reportTypeCode: string;
  rate: string | null;
  enRates: readonly AssignmentEnRate[];
  rateAdditions: readonly string[];
}

/**
 * Ставка назначения словами (прототип aRateTxt): «ЕНС-04 · 4 % безнал + 6 % нал; ЕНС-16 · 4 %»; у
 * налога с продаж с добавленными строками — «2 %; 1 % безнал + 2 % нал — продажа …»; иначе ставка
 * назначения. Коротко (столбец «Ставка») — «ЕНС-04 · 4 / 6 %».
 */
export function assignmentRateText(
  a: AssignmentRate,
  type: { rateAdditions: readonly RateAddition[] },
  rates: readonly SingleTaxRateText[],
  options: { date: string; short?: boolean },
  t: Translate,
): string {
  if (isSingleTaxType(a.reportTypeCode)) {
    return a.enRates
      .map((e) => ({ e, x: rates.find((r) => r.code === e.code) }))
      .filter((r) => r.x)
      .map(({ e, x }) =>
        t('report.rate.en_line', {
          code: e.code,
          rate: rateText(x!, rates, { ...options, variant: e.variant }, t),
        }),
      )
      .join('; ');
  }
  const added = a.rateAdditions
    .map((k) => type.rateAdditions.find((x) => x.k === k))
    .filter((x): x is RateAddition => Boolean(x));
  if (!added.length) return a.rate ?? '';
  return [
    ...(a.rate ? [rateText({ rate: a.rate }, rates, options, t)] : []),
    ...added.map((x) =>
      options.short
        ? rateText(x, rates, { ...options, short: true }, t)
        : t('report.rate.add_line', {
            rate: rateText(x, rates, options, t),
            name: x.name || x.short || '',
          }),
    ),
  ].join('; ');
}
