'use client';

import type { ContractorRegistration, UiTextKey } from '@buhuchet/domain';
import { Field, inputClass } from '@buhuchet/ui';
import { useT } from '../l10n/provider';

/*
 * «Регистрационные данные» формы контрагента (ТЗ «Реквизиты из регистрационных документов»; прототип
 * modules/contractor-regdocs.js: REG_F, regFields, regRead, regCheck): все поля необязательные; код ОКПО —
 * 8 цифр, почта — с «@» и точкой в домене.
 */

/** Поля как в форме: строки (число учредителей — тоже строкой, пусто — не указано). */
export type RegistrationDraft = Readonly<Record<RegKey, string>>;

const REG_KEYS = [
  'fullName',
  'regNo',
  'okpo',
  'address',
  'email',
  'regDate',
  'reRegDate',
  'founders',
  'foreign',
] as const;
type RegKey = (typeof REG_KEYS)[number];

/** Поля на всю строку (прототип REG_F: признак full). */
const FULL: ReadonlySet<RegKey> = new Set(['fullName', 'address']);

/** Подписи полей в словаре. */
const LABEL: Readonly<Record<RegKey, UiTextKey>> = {
  fullName: 'cp.reg.full_name',
  regNo: 'cp.reg.reg_no',
  okpo: 'cp.reg.okpo',
  address: 'cp.reg.address',
  email: 'cp.reg.email',
  regDate: 'cp.reg.reg_date',
  reRegDate: 'cp.reg.rereg_date',
  founders: 'cp.reg.founders',
  foreign: 'cp.reg.foreign',
};

export const registrationDraftOf = (r: ContractorRegistration = {}): RegistrationDraft =>
  Object.fromEntries(
    REG_KEYS.map((k) => [k, r[k] === undefined ? '' : String(r[k])]),
  ) as RegistrationDraft;

/** Только заполненные поля — как хранит сервер. */
export function registrationOf(d: RegistrationDraft): ContractorRegistration {
  const out: Record<string, unknown> = {};
  for (const k of REG_KEYS) {
    const v = d[k].trim();
    if (!v) continue;
    out[k] = k === 'founders' ? Math.max(0, parseInt(v, 10) || 0) : v;
  }
  return out as ContractorRegistration;
}

/** Ошибки полей (прототип regCheck): ключ поля — текст словаря. */
export function registrationErrors(
  d: RegistrationDraft,
): Partial<Record<'okpo' | 'email', UiTextKey>> {
  const out: Partial<Record<'okpo' | 'email', UiTextKey>> = {};
  if (d.okpo.trim() && !/^\d{8}$/.test(d.okpo.trim())) out.okpo = 'err.okpo_format';
  if (d.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) {
    out.email = 'err.email_format';
  }
  return out;
}

export function RegistrationFields({
  idPrefix,
  value,
  errors,
  onChange,
}: {
  idPrefix: string;
  value: RegistrationDraft;
  /** Тексты ошибок по полям (`registrationErrors` и ответ сервера). */
  errors: Partial<Record<string, string | undefined>>;
  onChange: (next: RegistrationDraft) => void;
}) {
  const t = useT();
  const set = (k: RegKey, v: string) => onChange({ ...value, [k]: v });
  return (
    <>
      {REG_KEYS.map((k) => {
        const id = `${idPrefix}-reg-${k}`;
        return (
          <Field key={k} id={id} label={t(LABEL[k])} full={FULL.has(k)} error={errors[k]}>
            {(control) =>
              k === 'foreign' ? (
                <select
                  {...control}
                  className={`${inputClass()} cursor-pointer`}
                  value={value[k]}
                  onChange={(e) => set(k, e.target.value)}
                >
                  <option value="">{t('cp.reg.foreign_unset')}</option>
                  <option value="no">{t('cp.reg.foreign_no')}</option>
                  <option value="yes">{t('cp.reg.foreign_yes')}</option>
                </select>
              ) : (
                <input
                  {...control}
                  data-reg={k}
                  className={inputClass({ mono: k === 'okpo' || k === 'regNo' })}
                  value={value[k]}
                  type={
                    k === 'regDate' || k === 'reRegDate'
                      ? 'date'
                      : k === 'founders'
                        ? 'number'
                        : k === 'email'
                          ? 'email'
                          : 'text'
                  }
                  {...(k === 'founders' ? { min: 0 } : {})}
                  {...(k === 'okpo' ? { inputMode: 'numeric' as const, maxLength: 8 } : {})}
                  placeholder={
                    k === 'okpo'
                      ? t('cp.reg.okpo_placeholder')
                      : k === 'regNo'
                        ? t('cp.reg.regno_placeholder')
                        : k === 'email'
                          ? t('cp.reg.email_placeholder')
                          : undefined
                  }
                  onChange={(e) => set(k, e.target.value)}
                />
              )
            }
          </Field>
        );
      })}
    </>
  );
}
