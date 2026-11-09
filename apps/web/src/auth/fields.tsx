'use client';

import { PASSWORD_MIN_LENGTH } from '@buhuchet/domain';
import { Field, PasswordInput, type PasswordEyeLabels } from '@buhuchet/ui';
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';
import { useT } from '../l10n/provider';
import { fieldErrorText, type Translate } from '../l10n/translate';

/** Ошибка поля: из схемы формы — ключ словаря, из ответа сервера (`type: 'server'`) — готовый текст. */
export function fieldError(t: Translate, error: FieldError | undefined): string | undefined {
  if (!error) return undefined;
  return error.type === 'server' ? error.message : fieldErrorText(t, error.message);
}

/** Подписи глаза в полях пароля (прототип v82 pwEyeBtn): «Показать пароль» и «Скрыть пароль». */
export function usePasswordEye(): PasswordEyeLabels {
  const t = useT();
  return { show: t('auth.password_show'), hide: t('auth.password_hide') };
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
  const eye = usePasswordEye();
  return (
    <>
      <Field
        id={`${idPrefix}-p1`}
        label={t('auth.new_password')}
        hint={t('auth.password_hint', { min: PASSWORD_MIN_LENGTH })}
        error={fieldError(t, errors.newPassword)}
      >
        {(control) => (
          <PasswordInput
            {...control}
            {...fields.newPassword}
            labels={eye}
            autoComplete="new-password"
          />
        )}
      </Field>
      <Field id={`${idPrefix}-p2`} label={repeatLabel} error={fieldError(t, errors.repeat)}>
        {(control) => (
          <PasswordInput {...control} {...fields.repeat} labels={eye} autoComplete="new-password" />
        )}
      </Field>
    </>
  );
}
