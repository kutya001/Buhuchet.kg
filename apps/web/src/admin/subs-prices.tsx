'use client';

import {
  SUBSCRIPTION_PRICE_FIELDS,
  SUBSCRIPTION_REQUISITE_FIELDS,
  subscriptionPurposeText,
  subscriptionSettingsProblems,
  type SubscriptionPriceField,
  type SubscriptionRequisiteField,
  type SubscriptionSettingsInput,
} from '@buhuchet/domain';
import { AdminSubscriptionSettings } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  EmptyState,
  Field,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  Note,
  RecordChangedNotice,
  Timeline,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import type { ApiResult } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { saveSubSettings, subSettingsQuery, useSubsRefresh } from './subs-data';
import { SUB_PRICE_LABEL, subConfigItems } from './subs-model';

/*
 * «Цены и реквизиты» вкладки «Подписки» (доработки 20.11.2026, блок 6, пункт 6; прототип
 * `subPricesPart`): цены и сроки, реквизиты платформы для оплаты с примером назначения, «Сохранить» —
 * все поля проверяются сразу, «История изменений» видов и цен. Цены — сомы на экране, тыйыны в запросе.
 */

type Settings = AdminSubscriptionSettings;
type FieldKey = SubscriptionPriceField | SubscriptionRequisiteField;
type Values = Record<FieldKey, string>;
type Errors = Partial<Record<FieldKey, string>>;
type Failure = Extract<ApiResult<unknown>, { ok: false }>['error'];

const isMoney = (f: (typeof SUBSCRIPTION_PRICE_FIELDS)[number]) => 'money' in f && f.money;

const valuesOf = (s: Settings): Values => {
  const out = {} as Values;
  for (const f of SUBSCRIPTION_PRICE_FIELDS)
    out[f.key] = String(isMoney(f) ? s[f.key] / 100 : s[f.key]);
  for (const f of SUBSCRIPTION_REQUISITE_FIELDS) out[f.key] = s[f.key];
  return out;
};

/** Поля окна → запрос: пустое и не число — NaN (правило домена ответит «От … до …»). */
const inputOf = (v: Values): SubscriptionSettingsInput => {
  const out = {} as SubscriptionSettingsInput;
  for (const f of SUBSCRIPTION_PRICE_FIELDS) {
    const raw = v[f.key].trim().replace(',', '.');
    const n = raw === '' ? Number.NaN : Number(raw);
    out[f.key] = isMoney(f) ? Math.round(n * 100) : n;
  }
  for (const f of SUBSCRIPTION_REQUISITE_FIELDS) out[f.key] = v[f.key].trim();
  return out;
};

const failedField = (error: Failure): string | null => {
  const d = error.details;
  return d && typeof d === 'object' && 'field' in d && typeof d.field === 'string' ? d.field : null;
};

/** Реквизит одной строкой: БИК, ИНН и счёт — моноширинно, с цифровой клавиатурой у БИК и ИНН. */
const REQ_INPUT: Partial<Record<SubscriptionRequisiteField, { mono?: true; numeric?: true }>> = {
  bik: { mono: true, numeric: true },
  recipientInn: { mono: true, numeric: true },
  account: { mono: true },
};

export function SubsPrices() {
  const t = useT();
  const cfg = useQuery(subSettingsQuery);
  if (!cfg.data) {
    return cfg.isError ? (
      <EmptyState icon="alert" title={t('subs.prices.load_error')} />
    ) : (
      <div className="min-h-40" aria-busy="true" />
    );
  }
  // Новая версия (сохранили здесь или перечитали) — поля заново из ответа.
  return <PricesForm key={cfg.data.version} data={cfg.data} />;
}

function PricesForm({ data }: { data: Settings }) {
  const t = useT();
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useSubsRefresh();
  const [values, setValues] = useState(() => valuesOf(data));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const set = (key: FieldKey, v: string) => setValues((x) => ({ ...x, [key]: v }));
  const formId = `${id}-form`;

  const focusFirst = () =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`#${CSS.escape(formId)} [aria-invalid="true"]`)?.focus(),
    );

  const reload = async () => {
    setReloading(true);
    try {
      await client.fetchQuery({ ...subSettingsQuery, staleTime: 0 });
    } catch {
      toast(t('subs.prices.load_error'), { bad: true, icon: 'alert' });
    } finally {
      setReloading(false);
    }
  };

  const save = async () => {
    const x = inputOf(values);
    const problems = subscriptionSettingsProblems(x);
    if (problems.length) {
      const next: Errors = {};
      for (const p of problems) next[p.field] ??= t(`err.${p.code}`, p.params ?? {});
      setErrors(next);
      focusFirst();
      return toast(t('subs.prices.fix'), { bad: true, icon: 'alert' });
    }
    setErrors({});
    const was = inputOf(valuesOf(data));
    if ((Object.keys(x) as FieldKey[]).every((k) => x[k] === was[k])) {
      return toast(t('err.sub_no_change'));
    }
    setBusy(true);
    const res = await saveSubSettings({ ...x, version: data.version });
    setBusy(false);
    if (res.ok) {
      const parsed = AdminSubscriptionSettings.safeParse(res.data);
      if (parsed.success) client.setQueryData(subSettingsQuery.queryKey, parsed.data);
      refresh();
      return toast(t('subs.prices.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    if (res.error.code === 'sub_no_change') return toast(t('err.sub_no_change'));
    const field = failedField(res.error);
    if (field && field in values) {
      setErrors({ [field]: errorText(res.error) });
      return focusFirst();
    }
    toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  const example = subscriptionPurposeText(values.purpose, {
    name: t('subs.prices.example_org'),
    inn: t('subs.prices.example_inn'),
  });
  const history = useMemo(() => subConfigItems(t, data.history), [t, data.history]);

  return (
    <div className="flex flex-col gap-3" data-subs-prices="">
      <Note>{t('subs.prices.note')}</Note>
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Box title={t('subs.prices.title')}>
            <FormGrid>
              {SUBSCRIPTION_PRICE_FIELDS.map((f) => (
                <Field
                  key={f.key}
                  id={`${id}-${f.key}`}
                  label={t(SUB_PRICE_LABEL[f.key]!)}
                  required
                  error={errors[f.key]}
                >
                  {(control) => (
                    <input
                      {...control}
                      type="number"
                      min={f.min}
                      max={f.max}
                      step={isMoney(f) ? 0.01 : 1}
                      inputMode="decimal"
                      className={inputClass()}
                      value={values[f.key]}
                      data-sub-price={f.key}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                </Field>
              ))}
            </FormGrid>
          </Box>
          <Box title={t('subs.prices.req')}>
            <FormGrid>
              {SUBSCRIPTION_REQUISITE_FIELDS.map((f) => {
                const look = REQ_INPUT[f.key];
                return (
                  <Field
                    key={f.key}
                    id={`${id}-${f.key}`}
                    label={t(SUB_PRICE_LABEL[f.key]!)}
                    required={f.required}
                    full={f.key === 'purpose' || f.key === 'recipient'}
                    hint={f.key === 'purpose' ? t('subs.prices.purpose.hint') : undefined}
                    error={errors[f.key]}
                  >
                    {(control) =>
                      f.key === 'purpose' ? (
                        <textarea
                          {...control}
                          className={`${inputClass({ multiline: true })} min-h-16`}
                          maxLength={f.max}
                          value={values[f.key]}
                          data-sub-req={f.key}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      ) : (
                        <input
                          {...control}
                          className={`${inputClass()}${look?.mono ? ' font-mono' : ''}`}
                          maxLength={f.max}
                          inputMode={look?.numeric ? 'numeric' : undefined}
                          value={values[f.key]}
                          data-sub-req={f.key}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      )
                    }
                  </Field>
                );
              })}
            </FormGrid>
            <Hint>
              <span data-sub-purpose-example="">
                {t('subs.prices.example', { org: t('subs.prices.example_org'), text: example })}
              </span>
            </Hint>
          </Box>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className={buttonClass('cta')}
            disabled={busy || changed}
            data-sub-prices-ok=""
          >
            <Icon name="check" size="sm" />
            {t('subs.save')}
          </button>
        </div>
      </form>
      <Box title={t('subs.hist.title')}>
        <div data-sub-cfg-hist="">
          {history.length ? (
            <Timeline items={history} label={t('subs.hist.title')} />
          ) : (
            <span className="text-faint">{t('subs.hist.empty')}</span>
          )}
        </div>
      </Box>
    </div>
  );
}
