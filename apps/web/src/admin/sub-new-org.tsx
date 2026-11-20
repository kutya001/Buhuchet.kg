'use client';

import { bishkekDate } from '@buhuchet/domain';
import type { NewOrgSubscriptionRequest } from '@buhuchet/shared';
import { CHECKBOX_CLASS, FormGrid } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useT } from '../l10n/provider';
import {
  SubEditFields,
  subEditInitial,
  subEditRead,
  type SubEditErrors,
  type SubEditTerms,
  type SubEditValues,
} from './sub-dialogs';
import { subPlansQuery, subSettingsQuery } from './subs-data';

/*
 * Блок «Подписка» окна «Новая организация» (доработки 20.11.2026, блок 6, пункт 4; прототип
 * `subNewOrgHtml`, `subNewOrgOk`, `subNewOrgSave`): необязательный, свёрнут; «Поставить подписку
 * сразу» — поля «Изменить подписку» и «Бесплатный период» (отмечен). Без него у организации «Нет
 * подписки».
 */

/** Шаг пакета и порог дополнительной скидки, пока не пришли «Цены и реквизиты» (прототип `SUB_P()`). */
const PRICES = { seatStep: 10, extraDiscountOver: 50 };

export interface SubNewOrgState {
  on: boolean;
  free: boolean;
  values: SubEditValues | null;
}

/**
 * Состояние блока и чтение перед «Создать»: выключен — подписки нет (`undefined`); включён и поля
 * неверны — `null` (ошибки встают под поля), иначе — тело `subscription` запроса.
 */
export function useSubNewOrg() {
  const t = useT();
  const plans = useQuery(subPlansQuery);
  const cfg = useQuery(subSettingsQuery);
  const terms: SubEditTerms = {
    plans: plans.data?.plans ?? [],
    prices: cfg.data
      ? { seatStep: cfg.data.seatStep, extraDiscountOver: cfg.data.extraDiscountOver }
      : PRICES,
  };
  const [state, setState] = useState<SubNewOrgState>({ on: false, free: true, values: null });
  const [errors, setErrors] = useState<SubEditErrors>({});
  const values = state.values ?? subEditInitial(terms, null, bishkekDate(new Date()));

  const read = (): NewOrgSubscriptionRequest | undefined | null => {
    if (!state.on) return undefined;
    const r = subEditRead(t, values, terms, null);
    setErrors(r.errors);
    if (!r.value) return null;
    return { ...r.value, free: state.free };
  };

  const node = (
    <SubNewOrgBlock
      state={state}
      values={values}
      errors={errors}
      terms={terms}
      onState={setState}
    />
  );
  return { read, node, dirty: state.on };
}

function SubNewOrgBlock({
  state,
  values,
  errors,
  terms,
  onState,
}: {
  state: SubNewOrgState;
  values: SubEditValues;
  errors: SubEditErrors;
  terms: SubEditTerms;
  onState: (next: SubNewOrgState) => void;
}) {
  const t = useT();
  const id = useId();
  return (
    <details className="rounded-xl border border-line bg-raised px-4 py-3" data-new-org-sub="">
      <summary className="cursor-pointer font-semibold">
        {t('subs.new.title')}{' '}
        <span className="text-[12px] font-normal text-muted">{t('subs.new.hint')}</span>
      </summary>
      <label className="mt-2 flex items-center gap-2.5 text-[13px]">
        <input
          type="checkbox"
          className={CHECKBOX_CLASS}
          checked={state.on}
          data-new-org-sub-on=""
          onChange={(e) => onState({ ...state, on: e.target.checked, values })}
        />
        <span className="grow">{t('subs.new.on')}</span>
      </label>
      <div className="mt-2">
        <FormGrid>
          <SubEditFields
            idPrefix={`${id}-ns`}
            values={values}
            onChange={(v) => onState({ ...state, values: v })}
            errors={errors}
            terms={terms}
            current={null}
          />
          <label className="col-span-full flex items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={state.free}
              data-new-org-sub-free=""
              onChange={(e) => onState({ ...state, free: e.target.checked, values })}
            />
            <span className="grow">{t('subs.edit.free')}</span>
          </label>
        </FormGrid>
      </div>
    </details>
  );
}
