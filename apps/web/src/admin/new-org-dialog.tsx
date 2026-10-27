'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreatedOrganization,
  NewOrganizationForm,
  type AdminOrganization,
  type NewOrganizationFormInput,
} from '@buhuchet/shared';
import { buttonClass, Field, FormGrid, inputClass, Modal, Note, useToast } from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import { suggestTemporaryPassword } from '../staff/temp-password';

/** Отказы сервера — ошибка под своим полем. */
const FIELD_OF: Partial<Record<string, keyof NewOrganizationFormInput>> = {
  name_required: 'name',
  inn_invalid: 'inn',
  inn_taken: 'inn',
  owner_fio_required: 'ownerFullName',
  invalid_login: 'ownerLogin',
  login_taken: 'ownerLogin',
};

/**
 * «Новая организация» (ТЗ «Админка» → «Модуль организаций»; прототип admin/accounts-orgs.js,
 * addOrgDlg): название, ИНН (14 цифр), ФИО владельца, логин владельца (уникален на всей платформе),
 * временный пароль — уже подставлен, его можно заменить (как у сотрудника, docs/deviations.md, п. 17).
 * Все поля обязательные. Ошибки — под полями: проверки формы сразу, «Организация с таким ИНН уже
 * есть» и «Такой логин уже занят на платформе» — после «Создать». Адрес страницы подбирает сервер по
 * названию. Окно открывают заново (новый `key`) — пароль новый, поля пустые.
 */
export function NewOrganizationDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (organization: AdminOrganization) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [initial] = useState(
    () =>
      ({
        name: '',
        inn: '',
        ownerFullName: '',
        ownerLogin: '',
        temporaryPassword: suggestTemporaryPassword(),
      }) satisfies NewOrganizationFormInput,
  );
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<NewOrganizationFormInput, unknown, NewOrganizationForm>({
    resolver: zodResolver(NewOrganizationForm),
    defaultValues: initial,
  });
  // Поля регистрируются по порядку на экране: при ошибках фокус встаёт на первое неверное.
  const fields = {
    name: register('name'),
    inn: register('inn'),
    ownerFullName: register('ownerFullName'),
    ownerLogin: register('ownerLogin'),
    temporaryPassword: register('temporaryPassword'),
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      const res = await callApi(() => api.api.admin.organizations.$post({ json: values }));
      if (res.ok) {
        const body = CreatedOrganization.safeParse(res.data);
        if (body.success) onDone(body.data.organization);
        onClose();
        return toast(t('orgs.new.done'), { icon: 'building' });
      }
      const message = errorText(res.error);
      const field = FIELD_OF[res.error.code];
      if (field) return setError(field, { type: 'server', message }, { shouldFocus: true });
      toast(message, { bad: true });
    })(event);
  const formId = `${id}-form`;
  const mono = {
    type: 'text',
    autoComplete: 'off',
    autoCapitalize: 'none',
    spellCheck: false,
    className: inputClass({ mono: true }),
  } as const;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('orgs.new.title')}
      sub={t('orgs.new.sub')}
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
            {t('btn.create')}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <FormGrid>
          <Field
            id={`${id}-name`}
            label={t('orgs.col.name')}
            required
            full
            error={fieldError(t, errors.name)}
          >
            {(control) => (
              <input {...control} {...fields.name} type="text" className={inputClass()} />
            )}
          </Field>
          <Field
            id={`${id}-inn`}
            label={t('orgs.col.inn')}
            required
            error={fieldError(t, errors.inn)}
          >
            {(control) => (
              <input {...control} {...fields.inn} {...mono} maxLength={14} inputMode="numeric" />
            )}
          </Field>
          <div />
          <Field
            id={`${id}-fio`}
            label={t('orgs.new.owner_fio')}
            required
            error={fieldError(t, errors.ownerFullName)}
          >
            {(control) => (
              <input {...control} {...fields.ownerFullName} type="text" className={inputClass()} />
            )}
          </Field>
          <Field
            id={`${id}-login`}
            label={t('orgs.new.owner_login')}
            required
            hint={t('staff.new.login_hint')}
            error={fieldError(t, errors.ownerLogin)}
          >
            {(control) => <input {...control} {...fields.ownerLogin} {...mono} />}
          </Field>
          <Field
            id={`${id}-pass`}
            label={t('staff.new.password')}
            required
            error={fieldError(t, errors.temporaryPassword)}
          >
            {(control) => <input {...control} {...fields.temporaryPassword} {...mono} />}
          </Field>
        </FormGrid>
        <Note icon="info">{t('orgs.new.note')}</Note>
      </form>
    </Modal>
  );
}
