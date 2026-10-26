'use client';

import { PASSWORD_MIN_LENGTH } from '@buhuchet/domain';
import { Field, inputClass } from '@buhuchet/ui';
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';
import { useT } from '../l10n/provider';
import { fieldErrorText, type Translate } from '../l10n/translate';

/** Ошибка поля: из схемы формы — ключ словаря, из ответа сервера (`type: 'server'`) — готовый текст. */
export function fieldError(t: Translate, error: FieldError | undefined): string | undefined {
  if (!error) return undefined;
  return error.type === 'server' ? error.message : fieldErrorText(t, error.message);
}

/** «Новый пароль» с подсказкой и его повтор — в «Забыли пароль?», смене временного пароля и профиле. */
export function NewPasswordFields({
  idPrefix,
  fields,
  errors,
  repeatLabel,
}: {
  idPrefix: string;
  /** `register('newPassword')` и `register('repeat')` формы. */
  fields: { newPassword: UseFormRegisterReturn; repeat: UseFormRegisterReturn };
  errors: { newPassword?: FieldError | undefined; repeat?: FieldError | undefined };
  repeatLabel: string;
}) {
  const t = useT();
  return (
    <>
      <Field
        id={`${idPrefix}-p1`}
        label={t('auth.new_password')}
        hint={t('auth.password_hint', { min: PASSWORD_MIN_LENGTH })}
        error={fieldError(t, errors.newPassword)}
      >
        {(control) => (
          <input
            {...control}
            {...fields.newPassword}
            type="password"
            className={inputClass()}
            autoComplete="new-password"
          />
        )}
      </Field>
      <Field id={`${idPrefix}-p2`} label={repeatLabel} error={fieldError(t, errors.repeat)}>
        {(control) => (
          <input
            {...control}
            {...fields.repeat}
            type="password"
            className={inputClass()}
            autoComplete="new-password"
          />
        )}
      </Field>
    </>
  );
}
