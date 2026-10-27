'use client';

import {
  bankChoices,
  joinPhone,
  requisiteNumberText,
  requisiteProblems,
  splitPhone,
  type RequisiteField,
  type RequisiteKind,
  type Translate,
} from '@buhuchet/domain';
import type { Banks, PhoneCodes } from '@buhuchet/shared';
import {
  CheckList,
  ChipSelect,
  Field,
  inputClass,
  PhoneInput,
  type PhoneInputValue,
} from '@buhuchet/ui';
import type { ReactNode } from 'react';

/*
 * Поля реквизита — общие у счёта организации и реквизита сотрудника (прототип core/requisites.js:
 * `rqKindSel`, `rqBanksFld`; modules/org.js orgAccDlg, modules/profile.js walletDlg): вид плашками,
 * у счёта — банк и номер (у организации ещё БИК), у перевода по номеру — телефон и банки номера.
 */

export type BankItem = Banks['items'][number];
export type PhoneCodeItem = PhoneCodes['items'][number];
export type RequisiteOwner = 'org' | 'employee';

/** Реквизит в форме: значения полей как их видно на экране. */
export interface RequisiteDraft {
  kind: RequisiteKind;
  bankCode: string;
  accountNo: string;
  bik: string;
  phone: PhoneInputValue;
  phoneBanks: string[];
  holderName: string;
}

export type RequisiteErrors = Partial<Record<RequisiteField, string>>;

/** Реквизит из базы (счёт организации или реквизит сотрудника) — то, что форма показывает. */
export interface RequisiteValue {
  kind: RequisiteKind;
  bankCode: string | null;
  accountNo: string | null;
  bik?: string | null;
  phone: string | null;
  phoneBanks: readonly string[];
  holderName: string;
}

/** Черновик формы: из реквизита или пустой — с банком и получателем по умолчанию. */
export function draftOf(
  value: RequisiteValue | null,
  defaults: { bankCode: string; holderName: string },
  codes: readonly PhoneCodeItem[],
): RequisiteDraft {
  return {
    kind: value?.kind ?? 'acc',
    bankCode: value?.bankCode ?? defaults.bankCode,
    accountNo: value?.accountNo ?? '',
    bik: value?.bik ?? '',
    phone: splitPhone(value?.phone ?? null, codes),
    phoneBanks: [...(value?.phoneBanks ?? [])],
    holderName: value ? value.holderName : defaults.holderName,
  };
}

/**
 * Проверка формы перед отправкой — те же правила, что на сервере (`requisiteProblems`); ошибки — под
 * каждым неверным полем. Возвращает поля для API или ошибки.
 */
export function checkDraft(
  draft: RequisiteDraft,
  owner: RequisiteOwner,
  banks: readonly BankItem[],
  codes: readonly PhoneCodeItem[],
  keep: readonly string[],
  t: Translate,
): {
  value: {
    kind: RequisiteKind;
    bankCode: string | null;
    accountNo: string | null;
    bik: string | null;
    phone: string | null;
    phoneBanks: string[];
    holderName: string;
  };
  errors: RequisiteErrors;
} {
  const typed = joinPhone(draft.phone.cc, draft.phone.local, codes);
  const acc = draft.kind === 'acc';
  const value = {
    kind: draft.kind,
    bankCode: acc ? draft.bankCode || null : null,
    accountNo: acc ? draft.accountNo.trim() : null,
    bik: acc && owner === 'org' ? draft.bik.trim() : null,
    phone: acc ? null : typed.missing > 0 ? null : typed.phone,
    phoneBanks: acc ? [] : draft.phoneBanks,
    holderName: draft.holderName.trim(),
  };
  const errors: RequisiteErrors = {};
  for (const p of requisiteProblems(value, owner, banks, codes, keep)) {
    errors[p.field] =
      p.problem === 'invalid_phone'
        ? t('money.err.phone', { n: typed.need })
        : t(`err.${p.problem}`);
  }
  return { value, errors };
}

/** Банки реквизита — чтобы отключённый с тех пор банк остался в списке выбора. */
export const banksOf = (r: RequisiteValue | null): string[] =>
  r ? [...(r.bankCode ? [r.bankCode] : []), ...r.phoneBanks] : [];

/** «Вид» реквизита словами (прототип `rqKindL`). */
export function kindText(t: Translate, kind: RequisiteKind, owner: RequisiteOwner): string {
  if (kind === 'phone') return t('money.kind.phone');
  return t(owner === 'org' ? 'money.kind.org_acc' : 'money.kind.wallet');
}

/** «Банк или кошелёк»: у перевода по номеру — банки номера через запятую (прототип `rqProv`). */
export function bankText(r: RequisiteValue, banks: readonly BankItem[]): string {
  const name = (code: string) => banks.find((b) => b.code === code)?.name ?? code;
  return r.kind === 'phone'
    ? r.phoneBanks.map(name).join(', ')
    : r.bankCode
      ? name(r.bankCode)
      : '';
}

/** «Номер»: у перевода по номеру — телефон с нулём, у счёта — номер (прототип `rqNum`). */
export function numberText(r: RequisiteValue, codes: readonly PhoneCodeItem[]): string {
  return requisiteNumberText(r, codes);
}

/**
 * Поля реквизита в сетке формы. `holder` — поле получателя (подпись и подсказка у организации и
 * сотрудника разные), `after` — поля после получателя (назначение счёта организации).
 */
export function RequisiteFields({
  id,
  owner,
  draft,
  onChange,
  errors,
  banks,
  codes,
  keep,
  t,
  holder,
  after,
}: {
  id: string;
  owner: RequisiteOwner;
  draft: RequisiteDraft;
  onChange: (patch: Partial<RequisiteDraft>, field?: RequisiteField) => void;
  errors: RequisiteErrors;
  banks: readonly BankItem[];
  codes: readonly PhoneCodeItem[];
  keep: readonly string[];
  t: Translate;
  holder: { label: string; hint: string };
  after?: ReactNode;
}) {
  const org = owner === 'org';
  const accChoices = bankChoices(banks, 'acc', keep);
  const phoneChoices = bankChoices(banks, 'phone', keep);
  return (
    <>
      <Field id={`${id}-kind`} label={t('money.col.kind')} full>
        <ChipSelect
          id={`${id}-kind`}
          label={t('money.kind.label')}
          value={draft.kind}
          onChange={(kind) => onChange({ kind })}
          options={[
            { value: 'acc', label: kindText(t, 'acc', owner) },
            { value: 'phone', label: t('money.kind.phone') },
          ]}
        />
      </Field>
      {draft.kind === 'acc' ? (
        <>
          <Field
            id={`${id}-bank`}
            label={t(org ? 'money.org.field.bank' : 'money.wallets.field.bank')}
            required
            error={errors.bankCode}
          >
            {(control) => (
              <select
                {...control}
                className={`${inputClass()} cursor-pointer`}
                value={draft.bankCode}
                onChange={(e) => onChange({ bankCode: e.target.value }, 'bankCode')}
              >
                {accChoices.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {org ? (
            <Field id={`${id}-bik`} label={t('money.org.field.bik')} required error={errors.bik}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="off"
                  className={inputClass({ mono: true })}
                  value={draft.bik}
                  onChange={(e) => onChange({ bik: e.target.value }, 'bik')}
                />
              )}
            </Field>
          ) : null}
          <Field
            id={`${id}-number`}
            label={t(org ? 'money.org.field.account' : 'money.wallets.field.number')}
            required
            full={org}
            error={errors.accountNo}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="numeric"
                maxLength={40}
                autoComplete="off"
                className={inputClass({ mono: true })}
                value={draft.accountNo}
                onChange={(e) => onChange({ accountNo: e.target.value }, 'accountNo')}
              />
            )}
          </Field>
        </>
      ) : (
        <>
          <Field id={`${id}-phone`} label={t('money.field.phone')} required error={errors.phone}>
            {(control) => (
              <PhoneInput
                codes={codes}
                value={draft.phone}
                onChange={(phone) => onChange({ phone }, 'phone')}
                control={control}
                codeLabel={t('staff.phone.code')}
              />
            )}
          </Field>
          <Field
            id={`${id}-banks`}
            label={t('money.field.banks')}
            required
            full
            hint={t(org ? 'money.org.field.banks_hint' : 'money.wallets.field.banks_hint')}
            error={errors.phoneBanks}
          >
            {(control) => (
              <CheckList
                id={control.id}
                label={t('money.field.banks')}
                options={phoneChoices.map((b) => ({ value: b.code, label: b.name }))}
                value={draft.phoneBanks}
                onChange={(phoneBanks) => onChange({ phoneBanks }, 'phoneBanks')}
                invalid={Boolean(errors.phoneBanks)}
                describedBy={control['aria-describedby']}
              />
            )}
          </Field>
        </>
      )}
      <Field id={`${id}-holder`} label={holder.label} full={org} hint={holder.hint}>
        {(control) => (
          <input
            {...control}
            type="text"
            maxLength={200}
            className={inputClass()}
            value={draft.holderName}
            onChange={(e) => onChange({ holderName: e.target.value })}
          />
        )}
      </Field>
      {after}
    </>
  );
}
