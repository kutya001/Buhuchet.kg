'use client';

import {
  defaultSingleTaxRates,
  defaultTypeRate,
  gkedRates,
  isSingleTaxType,
  rateText,
  rateVariants,
  SINGLE_TAX_ONE_RATES,
  SINGLE_TAX_OTHER_RATE,
  type GkedIndex,
  type SingleTaxSubject,
} from '@buhuchet/domain';
import type { ContractorNewReport, ReportType, SingleTaxRate } from '@buhuchet/shared';
import {
  CHECKBOX_CLASS,
  Icon,
  iconButtonClass,
  inputClass,
  linkButtonClass,
  MiniTable,
} from '@buhuchet/ui';
import { useT } from '../l10n/provider';

/*
 * «Ставки налога» формы создания контрагента (прототип modules/contractor-form.js: rateRows, enEdHtml,
 * addEdHtml, bindRates; core/tax-lines.js: enAuto, enSuggest, enWarn): у вида с несколькими ставками —
 * выбор (по умолчанию — как `defRate`), у единого налога — строки «Ставок единого налога» (подставлены
 * по ГКЭД и статусам, пока их не меняли), у налога с продаж — ещё и добавляемые строки.
 */

/** Строка ЕНС в форме: код, вариант ставки и «Показать все ставки» вместо предложенных по ГКЭД. */
export interface EnRow {
  code: string;
  variant: number | null;
  all?: boolean;
}

/** Ставки, выбранные в форме: обычные виды, строки ЕН, добавленные строки налога с продаж. */
export interface RateState {
  rates: Readonly<Record<string, string>>;
  en: Readonly<Record<string, readonly EnRow[]>>;
  adds: Readonly<Record<string, readonly string[]>>;
  /** Виды, у которых ставку выбрал сам пользователь: строки ЕН больше не подставляются по ГКЭД. */
  manual: readonly string[];
}

export const EMPTY_RATES: RateState = { rates: {}, en: {}, adds: {}, manual: [] };

/** Справочник и контрагент для строк ЕНС: ставки, ГКЭД с предками, статусы и место деятельности. */
export interface SingleTaxContext {
  rates: readonly SingleTaxRate[];
  index: GkedIndex;
  subject: SingleTaxSubject;
  today: string;
}

/** Строки ЕНС по умолчанию (прототип enAuto) — по ГКЭД, статусам и месту. */
export const singleTaxDefaults = (cx: SingleTaxContext): EnRow[] =>
  defaultSingleTaxRates(
    cx.subject,
    cx.rates.filter((x) => x.active),
    cx.index,
  );

/** Ставки к сохранению: у ЕН строки, которые подставлены сами, пока их не меняли, — по ГКЭД. */
export function reportsOf(
  codes: readonly string[],
  state: RateState,
  defaults: readonly EnRow[],
): ContractorNewReport[] {
  return codes.map((code) =>
    isSingleTaxType(code)
      ? {
          code,
          enRates: (state.manual.includes(code) ? (state.en[code] ?? []) : defaults).map((e) => ({
            code: e.code,
            variant: e.variant,
          })),
        }
      : {
          code,
          rate: state.rates[code] ?? null,
          rateAdditions: [...(state.adds[code] ?? [])],
        },
  );
}

/** «Добавляется к ставкам»: строка-надбавка — только к своей основной (прототип enAddOk). */
const addOk = (x: SingleTaxRate | undefined, rows: readonly EnRow[]) =>
  !x?.addsTo.length || rows.some((e) => x.addsTo.includes(e.code));

/** Предлагаемые строки: по основному и дополнительным ГКЭД, без совпадения — ЕНС-04; надбавки (прототип enSuggest). */
function suggested(cx: SingleTaxContext, rows: readonly EnRow[]): string[] {
  const out: string[] = [];
  const add = (code: string) => {
    if (!out.includes(code)) out.push(code);
  };
  const active = cx.rates.filter((x) => x.active);
  for (const code of [cx.subject.gked, ...cx.subject.gkedExtra]) {
    if (code) gkedRates(code, cx.subject.benefits, active, cx.index).forEach((x) => add(x.code));
  }
  if (!out.length) add(SINGLE_TAX_OTHER_RATE);
  active.filter((x) => x.addsTo.length && addOk(x, rows)).forEach((x) => add(x.code));
  return out;
}

export function RateRows({
  codes,
  types,
  state,
  defaults,
  cx,
  onChange,
}: {
  codes: readonly string[];
  types: (code: string) => ReportType | undefined;
  state: RateState;
  /** Строки ЕНС по ГКЭД — пока пользователь их не менял. */
  defaults: readonly EnRow[];
  cx: SingleTaxContext;
  onChange: (next: RateState) => void;
}) {
  const t = useT();
  const shown = codes.filter((c) => (types(c)?.rates.length ?? 0) > 0 || isSingleTaxType(c));
  if (!shown.length) return null;
  const byCode = (code: string) => cx.rates.find((x) => x.code === code);
  const text = (x: SingleTaxRate, variant: number | null) =>
    rateText(x, cx.rates, { date: cx.today, variant }, t);
  const option = (code: string) => {
    const x = byCode(code);
    return x ? t('cp.form.rate.en_option', { code, rate: text(x, 0), activity: x.activity }) : code;
  };
  const manual = (code: string) => [...new Set([...state.manual, code])];

  const enEditor = (code: string) => {
    const rows = state.manual.includes(code) ? (state.en[code] ?? []) : defaults;
    const set = (next: EnRow[]) =>
      onChange({ ...state, en: { ...state.en, [code]: next }, manual: manual(code) });
    const sug = suggested(cx, rows);
    const all = cx.rates.filter((x) => x.active).map((x) => x.code);
    const warns: string[] = [];
    for (const e of rows) {
      const x = byCode(e.code);
      if (x?.addsTo.length && !addOk(x, rows)) {
        warns.push(
          t('cp.form.rate.add_only', {
            code: e.code,
            to: x.addsTo.join(', '),
            article: x.article || t('cp.form.rate.add_article'),
          }),
        );
      }
    }
    const one = rows.find((e) => SINGLE_TAX_ONE_RATES.includes(e.code));
    if (one && rows.some((e) => e.code !== one.code && !byCode(e.code)?.addsTo.length)) {
      warns.push(t('cp.form.rate.one', { code: one.code }));
    }
    return (
      <div className="flex flex-col gap-1.5" data-en-rows={code}>
        {rows.map((e, i) => {
          const list = [...new Set([...(e.all ? all : sug), e.code])];
          const x = byCode(e.code);
          const variants = x ? rateVariants(x.rate) : [];
          return (
            <div key={`${e.code}-${i}`} className="flex flex-wrap items-center gap-1.5">
              <select
                className={`${inputClass({ full: false })} min-h-[30px] max-w-full cursor-pointer px-2 py-[3px]`}
                aria-label={t('cp.form.rate.en_row', { n: i + 1 })}
                value={e.code}
                data-en-code={i}
                onChange={(ev) => {
                  const v = ev.target.value;
                  const next = rows.map((r) => ({ ...r }));
                  if (v === '__all') next[i] = { ...next[i]!, all: true };
                  else next[i] = { code: v, variant: null, ...(e.all ? { all: true } : {}) };
                  set(next);
                }}
              >
                {list.map((c) => (
                  <option key={c} value={c}>
                    {option(c)}
                  </option>
                ))}
                {e.all ? null : <option value="__all">{t('cp.form.rate.en_all')}</option>}
              </select>
              {variants.length > 1 ? (
                <select
                  className={`${inputClass({ full: false })} min-h-[30px] cursor-pointer px-2 py-[3px]`}
                  aria-label={t('cp.form.rate.en_variant', { code: e.code })}
                  value={String(e.variant ?? 0)}
                  onChange={(ev) =>
                    set(rows.map((r, j) => (j === i ? { ...r, variant: +ev.target.value } : r)))
                  }
                >
                  {variants.map((v, j) => (
                    <option key={v.name} value={String(j)}>
                      {`${v.name} — ${v.pct}`}
                    </option>
                  ))}
                </select>
              ) : null}
              {rows.length > 1 ? (
                <button
                  type="button"
                  className={iconButtonClass('sm')}
                  title={t('cp.form.rate.en_remove')}
                  aria-label={t('cp.form.rate.en_remove_code', { code: e.code })}
                  onClick={() => set(rows.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size="sm" />
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className={`${linkButtonClass()} self-start`}
          onClick={() => {
            const c = sug.find((x) => !rows.some((e) => e.code === x));
            set([
              ...rows,
              c
                ? { code: c, variant: null }
                : { code: SINGLE_TAX_OTHER_RATE, variant: null, all: true },
            ]);
          }}
        >
          <Icon name="plus" size="sm" />
          {t('cp.form.rate.en_add')}
        </button>
        {warns.length ? (
          <div className="flex items-start gap-1.5 text-[12px] text-caution-label">
            <Icon name="alert" size="sm" />
            <span>
              {warns.map((w) => (
                <span key={w} className="block">
                  {w}
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  const plain = (type: ReportType) => {
    const value = state.rates[type.code] ?? defaultTypeRate(type) ?? '';
    const on = state.adds[type.code] ?? [];
    return (
      <div className="flex flex-col gap-1.5">
        {type.rates.length > 1 ? (
          <select
            className={`${inputClass({ full: false })} min-h-[30px] w-auto cursor-pointer px-2 py-[3px]`}
            aria-label={t('cp.form.rate.label', { name: type.shortName })}
            value={value}
            data-rate={type.code}
            onChange={(e) =>
              onChange({
                ...state,
                rates: { ...state.rates, [type.code]: e.target.value },
                manual: manual(type.code),
              })
            }
          >
            {type.rates.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <span>{type.rates[0]}</span>
        )}
        {type.rateAdditions.map((x) => (
          <label key={x.k} className="flex items-start gap-2 text-[12.5px]">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={on.includes(x.k)}
              data-rate-add={`${type.code}:${x.k}`}
              onChange={(e) => {
                const next = new Set(on);
                if (e.target.checked) next.add(x.k);
                else next.delete(x.k);
                onChange({
                  ...state,
                  adds: { ...state.adds, [type.code]: [...next] },
                  manual: manual(type.code),
                });
              }}
            />
            <span>
              {t('cp.form.rate.add', {
                rate: rateText(x, cx.rates, { date: cx.today }, t),
                name: x.name,
              })}
              {x.art ? <span className="text-faint"> ({x.art})</span> : null}
            </span>
          </label>
        ))}
      </div>
    );
  };

  return (
    <MiniTable
      label={t('cp.form.rate.title')}
      empty=""
      columns={[
        { key: 'type', label: t('cp.form.rate.type') },
        { key: 'rate', label: t('cp.form.rate.rate') },
      ]}
      rows={shown.map((code) => {
        const type = types(code);
        return {
          key: code,
          cells: {
            type: (
              <span>
                <b>{type?.shortName ?? code}</b> <span className="text-faint">{type?.name}</span>
              </span>
            ),
            rate: isSingleTaxType(code) ? enEditor(code) : type ? plain(type) : null,
          },
          wide: ['rate'],
        };
      })}
    />
  );
}
