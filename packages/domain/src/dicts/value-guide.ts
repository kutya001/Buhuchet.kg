import type { Translate } from '../l10n/texts';
import { dueRuleText, payRuleText, type PayRule } from './report-types';

/*
 * Окна значений справочников платформы (ТЗ «Справочники платформы — только просмотр»: «строка режима,
 * формы, органа, льготы, основания или ставки единого налога — окно значения с пояснениями»; прототип
 * modules/dict-guide.js `valueGuideHtml`, `enRateViewDlg`, report-pick.js `benDescHtml`): тексты,
 * которые считаются из правил, — «Меняет сроки» льготы и строки суммы ставки единого налога.
 */

/** Свой срок вида отчёта у статуса (строка `tax_benefit_due_rules`): пусто — как у вида. */
export interface BenefitDueOverride {
  reportType: string;
  dueDay: number | null;
  dueAfter: number | null;
  dueMonth: number | null;
  payDay: number | null;
  payAfter: number | null;
}

/** Вид отчёта для «Меняет сроки»: правило срока и краткое название. */
export interface DueOverrideType extends PayRule {
  shortName: string;
}

/**
 * «Меняет сроки» (прототип `benOvTxt` и `ovText`): «НДС: сдача — до последнего дня месяца после
 * отчётного; уплата — до 25-го числа месяца после отчётного». Свой день и «месяцев после» — из правила
 * статуса, остальное — как у вида; у вида «Уплата» основной срок — срок оплаты. Вида нет в каталоге —
 * строки нет.
 */
export function benefitDueText(
  rules: readonly BenefitDueOverride[],
  typeOf: (code: string) => DueOverrideType | undefined,
  t: Translate,
): string {
  return rules
    .flatMap((r) => {
      const x = typeOf(r.reportType);
      if (!x) return [];
      const e: PayRule = {
        ...x,
        dueDay: r.dueDay ?? x.dueDay,
        dueAfter: r.dueAfter ?? x.dueAfter,
        dueMonth: r.dueMonth ?? x.dueMonth,
        // Свой срок оплаты статуса считается от «месяцев после» вида и месяца срока сдачи.
        ...(r.payDay === null
          ? {}
          : { payDay: r.payDay, payAfter: r.payAfter ?? x.dueAfter, payMonth: null }),
      };
      const hasPay = x.act !== 'sub' && e.payDay !== null;
      const main =
        x.act === 'pay' && e.payDay !== null
          ? dueRuleText(
              {
                ...e,
                dueDay: e.payDay,
                dueAfter: e.payAfter ?? e.dueAfter,
                dueMonth: e.payMonth ?? e.dueMonth,
              },
              t,
            )
          : dueRuleText(e, t);
      const text = t(x.act === 'pay' ? 'dicts.value.due_pay' : 'dicts.value.due_sub', {
        rule: main,
      });
      return [
        `${x.shortName}: ${
          hasPay && x.act !== 'pay'
            ? t('dicts.value.due_and_pay', { text, pay: payRuleText(e, t) })
            : text
        }`,
      ];
    })
    .join('; ');
}

/** Ставка единого налога для строк суммы (поля `single_tax_rates`). */
export interface SingleTaxRateText {
  code: string;
  rate: string;
  rateCashless: string;
  rateCash: string;
}

/** Строка суммы в отчёте по ставке: что облагается и процент. */
export interface SingleTaxRatePart {
  name: string;
  pct: string;
}

const PCT = /\d+(?:,\d+)? %/;
const SINCE = /с \d\d\.\d\d\.\d{4}/;

/** Части текста ставки: «Бишкек и Ош — 5 %, остальная территория — 3 %», «0 % с 01.08.2026 по …». */
const segments = (rate: string) =>
  rate
    .replace(/[()]/g, ', ')
    .split(/\s*,\s+/)
    .map((s) => s.trim())
    .filter((s) => PCT.test(s));

/** «31.07.2031» → «2031-07-31». */
const isoOf = (s: string | undefined) => {
  const m = /(\d\d)\.(\d\d)\.(\d{4})/.exec(s ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/** Варианты ставки по территории или виду (прототип `rtVars`); ставка по датам — не варианты. */
function rateVariants(rate: string): { name: string; pct: string }[] {
  const parts = segments(rate);
  if (parts.length < 2 || parts.some((s) => SINCE.test(s))) return [];
  const variants = parts.map((s) => {
    const m = /^(.+?)\s+—\s+(\d+(?:,\d+)? %)$/.exec(s);
    return m ? { name: m[1]!, pct: m[2]! } : null;
  });
  return variants.every(Boolean) ? (variants as { name: string; pct: string }[]) : [];
}

/** Ставка, которая действует на дату (прототип `rtByDate`): резидент ПКИ и подобные. */
function rateOnDate(rate: string, date: string): string {
  const dated = segments(rate)
    .map((s) => ({
      pct: PCT.exec(s)![0],
      from: isoOf(/с (\d\d\.\d\d\.\d{4})/.exec(s)?.[1]),
      to: isoOf(/по (\d\d\.\d\d\.\d{4})/.exec(s)?.[1]),
    }))
    .filter((s) => s.from);
  if (!dated.length) return '';
  const hit =
    dated.find((s) => s.from <= date && (!s.to || date <= s.to)) ??
    dated.filter((s) => s.from <= date).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ??
    dated[0]!;
  return hit.pct;
}

/**
 * Строки суммы в отчёте по ставке единого налога (прототип `rtParts`): безнал и нал — две строки;
 * «по ставкам ЕНС-04» — строки той ставки; ставка с вариантами — вариант `variant` (по умолчанию
 * первый); ставка по датам — действующая на `date`; иначе одна строка «Выручка» или «Сумма …».
 */
export function singleTaxRateParts(
  x: SingleTaxRateText | undefined,
  rates: readonly SingleTaxRateText[],
  date: string,
  t: Translate,
  variant = 0,
  seen: ReadonlySet<string> = new Set(),
): SingleTaxRatePart[] {
  if (!x) return [];
  if (x.rateCashless && x.rateCash) {
    return [
      { name: t('dicts.value.en_cashless'), pct: x.rateCashless },
      { name: t('dicts.value.en_cash'), pct: x.rateCash },
    ];
  }
  const ref = /по ставкам (ЕНС-\d+)/.exec(x.rate)?.[1];
  if (ref && ref !== x.code && !seen.has(ref)) {
    const next = rates.find((r) => r.code === ref);
    return singleTaxRateParts(next, rates, date, t, variant, new Set([...seen, x.code]));
  }
  const revenue = t('dicts.value.en_revenue');
  const variants = rateVariants(x.rate);
  if (variants.length) {
    const v = variants[Math.min(Math.max(0, variant), variants.length - 1)]!;
    return [{ name: revenue, pct: v.pct }];
  }
  const onDate = rateOnDate(x.rate, date);
  if (onDate) return [{ name: revenue, pct: onDate }];
  const pct = PCT.exec(x.rate)?.[0];
  const base = / % от (.+)$/.exec(x.rate)?.[1];
  return pct ? [{ name: base ? t('dicts.value.en_base', { base }) : revenue, pct }] : [];
}
