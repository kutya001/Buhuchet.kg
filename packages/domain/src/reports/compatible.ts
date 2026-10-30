import { singleTaxRateParts, type SingleTaxRateText } from '../dicts/value-guide';
import type { Translate } from '../l10n/texts';
import type { PayerKind, ReportKind } from '../platform-dicts/catalog';
import { isSingleTaxType, rateText } from './rates';
import type { AssignmentEnRate } from './rules';

/*
 * Подходит ли вид отчёта контрагенту (ТЗ «Правила при назначении отчётов контрагенту»; прототип
 * core/reference.js, compatible): «Для ИП» и «Для организаций» — по «Для ЕНД» формы собственности,
 * вид «По режиму» — к режимам контрагента, ЕНД не сдают плательщики патента, зоны торговли, налога на
 * транзакцию, КФХ без юрлица и плательщики единого налога по нулевой ставке (ст. 106). Неподходящий вид
 * не назначается; подбор отчётов (2.07) показывает ту же причину. Ответы сверены с прототипом:
 * scripts/oracle-compatible.mjs.
 */

/** ЕНД для организаций и для ИП (прототип END_IDS). */
const DECLARATION_TYPES: readonly string[] = ['endo', 'endi'];
/** Режимы, плательщики которых ЕНД не сдают (ст. 106): «Патент», «Зона торговли», «Налог на транзакцию». */
const NO_DECLARATION_REGIMES: readonly string[] = ['РЕЖ-02', 'РЕЖ-09', 'РЕЖ-11'];
/** «Крестьянское (фермерское) хозяйство» без юрлица. */
const FARM_FORM = 'ФС-11';
/** Ставки единого налога, при которых ЕНД не сдаётся (прототип EN_ZERO). */
const ZERO_RATES: readonly string[] = ['0 %', '0,1 %', '0,5 %'];

/** Вид отчёта: «Плательщик», тип и коды «Применимых режимов». */
export interface CompatibilityType {
  code: string;
  payer: PayerKind;
  kind: ReportKind;
  regimes: readonly string[];
}

/**
 * Контрагент: форма собственности (в черновике формы её может не быть — тогда «Для кого» не проверяется),
 * режимы по порядку и строки ЕНС действующего назначения единого налога.
 */
export interface CompatibilitySubject {
  form: { code: string; declarationFor: 'org' | 'ip' } | null;
  regimes: readonly { code: string; name: string }[];
  singleTax: readonly AssignmentEnRate[];
}

/** Строка «Ставок единого налога»: текст ставки и «Добавляется к» (строки-надбавки). */
export interface CompatibilityRate extends SingleTaxRateText {
  addsTo: readonly string[];
}

export type Incompatibility =
  | { reason: 'for_ip' }
  | { reason: 'for_org' }
  | { reason: 'regime'; regimes: string[] }
  | { reason: 'declaration_regime'; regime: string }
  | { reason: 'declaration_farm' }
  | { reason: 'declaration_zero'; rates: string[] };

/** Почему вид не подходит контрагенту; null — подходит. `date` — на какую дату ставка единого налога. */
export function typeIncompatibility(
  type: CompatibilityType,
  s: CompatibilitySubject,
  rates: readonly CompatibilityRate[],
  date: string,
  t: Translate,
): Incompatibility | null {
  const ip = s.form?.declarationFor === 'ip';
  if (s.form && type.payer === 'org' && ip) return { reason: 'for_ip' };
  if (s.form && type.payer === 'ip' && !ip) return { reason: 'for_org' };
  const codes = s.regimes.map((r) => r.code);
  if (type.kind === 'regime' && codes.length && !type.regimes.some((r) => codes.includes(r))) {
    return { reason: 'regime', regimes: s.regimes.map((r) => r.name) };
  }
  if (!DECLARATION_TYPES.includes(type.code)) return null;
  const free = s.regimes.find((r) => NO_DECLARATION_REGIMES.includes(r.code));
  if (free) return { reason: 'declaration_regime', regime: free.name };
  if (s.form?.code === FARM_FORM) return { reason: 'declaration_farm' };
  const rows = s.singleTax
    .map((e) => ({ e, x: rates.find((r) => r.code === e.code) }))
    .filter((r): r is { e: AssignmentEnRate; x: CompatibilityRate } => !!r.x && !r.x.addsTo.length);
  const zero =
    rows.length > 0 &&
    rows.every(({ e, x }) =>
      singleTaxRateParts(x, rates, date, t, e.variant ?? 0).every((p) =>
        ZERO_RATES.includes(p.pct),
      ),
    );
  return zero
    ? {
        reason: 'declaration_zero',
        rates: rows.map(({ e, x }) =>
          t('report.rate.en_line', {
            code: e.code,
            rate: rateText(x, rates, { date, variant: e.variant }, t),
          }),
        ),
      }
    : null;
}

/** Причина словами, как в прототипе: «Не подходит к режиму «ОНР + Патент»», «ЕНД не сдают …». */
export function incompatibilityText(x: Incompatibility, t: Translate): string {
  switch (x.reason) {
    case 'regime':
      return t('report.incompatible.regime', { regimes: x.regimes.join(' + ') });
    case 'declaration_regime':
      return t('report.incompatible.declaration_regime', { regime: x.regime });
    case 'declaration_zero':
      return t('report.incompatible.declaration_zero', { rates: x.rates.join(', ') });
    default:
      return t(`report.incompatible.${x.reason}`);
  }
}

/** Строки ЕНС действующего назначения единого налога (прототип: первое с непустыми строками). */
export function activeSingleTax(
  list: readonly {
    reportTypeCode: string;
    endedOn: string | null;
    enRates: readonly AssignmentEnRate[];
  }[],
): AssignmentEnRate[] {
  const a = list.find((x) => !x.endedOn && isSingleTaxType(x.reportTypeCode) && x.enRates.length);
  return a ? [...a.enRates] : [];
}
