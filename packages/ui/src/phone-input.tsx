'use client';

import { applyPhoneMask, maskDigits, type PhoneCodeOption } from '@buhuchet/domain';
import { inputClass, type FieldControl } from './form';

/** Код страны для поля телефона: флаг рядом с кодом в списке. */
export interface PhoneInputCode extends PhoneCodeOption {
  flag: string;
}

/** Значение поля: страна и цифры номера после кода. */
export interface PhoneInputValue {
  cc: string;
  local: string;
}

/**
 * Поле телефона (прототип ui/popups.js, phoneInput и bindPhone; css/controls.css `.phone`): слева код
 * страны с флагом из справочника «Коды телефонов», справа номер по маске страны — пробелы ставятся
 * сами, лишние цифры не вводятся, подсказка — маска нулями. Выключенный код в списке есть, только если
 * номер уже с ним. `control` — id и признаки ошибки от `Field`: они у поля номера.
 */
export function PhoneInput({
  codes,
  value,
  onChange,
  control,
  codeLabel,
  disabled = false,
}: {
  codes: readonly PhoneInputCode[];
  value: PhoneInputValue;
  onChange: (value: PhoneInputValue) => void;
  control: FieldControl;
  /** Название списка кодов для экранного диктора: «Код страны». */
  codeLabel: string;
  disabled?: boolean;
}) {
  const code = codes.find((c) => c.cc === value.cc);
  const mask = code?.mask ?? '';
  const options = codes.filter((c) => c.active || c.cc === value.cc);
  const digits = (text: string, m: string) => text.replace(/\D/g, '').slice(0, maskDigits(m));
  return (
    <div className="flex gap-1.5">
      <select
        aria-label={codeLabel}
        className={`${inputClass({ full: false })} w-[118px] flex-none cursor-pointer`}
        value={value.cc}
        disabled={disabled}
        onChange={(e) => {
          const next = codes.find((c) => c.cc === e.target.value);
          onChange({ cc: e.target.value, local: digits(value.local, next?.mask ?? '') });
        }}
      >
        {options.map((c) => (
          <option key={c.cc} value={c.cc}>
            {`${c.flag} +${c.code}`}
          </option>
        ))}
      </select>
      <input
        {...control}
        type="text"
        inputMode="tel"
        autoComplete="tel-national"
        className={`${inputClass({ mono: true })} min-w-0 flex-1`}
        value={applyPhoneMask(mask, value.local)}
        placeholder={mask.replace(/X/g, '0')}
        disabled={disabled}
        onChange={(e) => onChange({ cc: value.cc, local: digits(e.target.value, mask) })}
      />
    </div>
  );
}
