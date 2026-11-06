'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { displayNameManual } from '@buhuchet/domain';
import { DisplayNameForm, DisplayNameSaved, type DisplayNameFormInput } from '@buhuchet/shared';
import { buttonClass, Modal, useToast } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import {
  DISPLAY_NAME_CODES,
  DisplayNameField,
  useAutoDisplayName,
} from '../staff/display-name-field';

/**
 * «Мой профиль» → «Отображаемое имя» → «Изменить» (решение заказчика 06.11.2026, прототип v74
 * modules/profile.js shortDlg): одно поле, пустое — имя по ФИО; «Такое имя уже у сотрудника …» — под
 * полем. Сохранено — новое имя сразу во всех списках.
 */
export function DisplayNameDialog({
  fullName,
  shortName,
  open,
  onClose,
  onSaved,
}: {
  fullName: string;
  shortName: string;
  open: boolean;
  onClose: () => void;
  onSaved: (shortName: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const router = useRouter();
  const queries = useQueryClient();
  const id = useId();
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<DisplayNameFormInput, unknown, DisplayNameForm>({
    resolver: zodResolver(DisplayNameForm),
    defaultValues: { shortName },
  });
  const auto = useAutoDisplayName(displayNameManual(shortName, fullName), (value) => {
    setValue('shortName', value, { shouldDirty: true });
    clearErrors('shortName');
  });
  const field = register('shortName', {
    onChange: (e) => auto.input(e.target.value),
    onBlur: (e) => auto.blur(e.target.value, fullName),
  });

  const submit = (event: FormEvent) => {
    void handleSubmit(async (values) => {
      const res = await callApi(() =>
        api.api.profile['display-name'].$patch({ json: { shortName: values.shortName } }),
      );
      if (res.ok) {
        const body = DisplayNameSaved.safeParse(res.data);
        if (body.success) onSaved(body.data.shortName);
        onClose();
        // Имя видно в списках, задачах и фильтрах: перечитать их и меню.
        void queries.invalidateQueries();
        router.refresh();
        return toast(t('profile.display_name.done'), { icon: 'user' });
      }
      const message = errorText(res.error);
      if (DISPLAY_NAME_CODES.has(res.error.code))
        return setError('shortName', { type: 'server', message }, { shouldFocus: true });
      toast(message, { bad: true });
    })(event);
  };
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('profile.display_name')}
      sub={fullName}
      dirty={isDirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={isSubmitting}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <DisplayNameField
          id={`${id}-short`}
          registration={field}
          error={fieldError(t, errors.shortName)}
          full
        />
      </form>
    </Modal>
  );
}
