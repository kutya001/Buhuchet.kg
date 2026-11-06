'use client';

import { DISPLAY_NAME_MAX_LENGTH } from '@buhuchet/domain';
import { Field, inputClass } from '@buhuchet/ui';
import { useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useT } from '../l10n/provider';
import { autoDisplayName } from './display-name-auto';

/** Отказы сервера в отображаемом имени — ошибка под полем «Отображаемое имя». */
export const DISPLAY_NAME_CODES = new Set(['display_name_length', 'display_name_taken']);

/**
 * `autoDisplayName` на время жизни формы. `set` берётся из первого рендера: он вызывает только
 * постоянные `setValue` и `clearErrors` формы.
 */
export function useAutoDisplayName(manual: boolean, set: (value: string) => void) {
  const [auto] = useState(() => autoDisplayName(manual, set));
  return auto;
}

/** Поле «Отображаемое имя» (прототип v74: «Новый сотрудник», «Изменить», «Мой профиль»). */
export function DisplayNameField({
  id,
  registration,
  error,
  placeholder = false,
  full = false,
}: {
  id: string;
  registration: UseFormRegisterReturn;
  error: string | undefined;
  /** «Заполнится по ФИО» — в «Новом сотруднике», пока ФИО не введено. */
  placeholder?: boolean;
  full?: boolean;
}) {
  const t = useT();
  return (
    <Field
      id={id}
      label={t('staff.display_name')}
      required
      full={full}
      hint={t('staff.display_name.hint')}
      error={error}
    >
      {(control) => (
        <input
          {...control}
          {...registration}
          type="text"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          placeholder={placeholder ? t('staff.display_name.placeholder') : undefined}
          className={inputClass()}
        />
      )}
    </Field>
  );
}
