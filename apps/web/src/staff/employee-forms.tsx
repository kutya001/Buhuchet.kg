'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { joinPhone } from '@buhuchet/domain';
import {
  CreatedEmployee,
  Employee,
  NewEmployeeForm,
  type NewEmployeeFormInput,
  type PhoneCodes,
  type RoleListItem,
} from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  Modal,
  Note,
  PhoneInput,
  RecordChangedNotice,
  useToast,
  type PhoneInputValue,
} from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import { suggestTemporaryPassword } from './temp-password';

/** Роли, которые можно назначить: все, кроме роли владельца организации (прототип `r.id!=='owner'`). */
const assignable = (roles: readonly RoleListItem[]) => roles.filter((r) => !r.isOwner);

/** Отказы сервера в роли — ошибка под полем «Роль». */
const ROLE_CODES = new Set([
  'role_not_found',
  'owner_role',
  'owner_granted',
  'beyond_own',
  'own_role',
]);

/**
 * «Сменить роль» (прототип modules/staff.js, empActions): одно поле «Роль» без роли владельца и
 * «Сохранить». Роль действует со следующего запроса сотрудника. Отказ сервера (своя роль, роль с
 * правами, которые выдаёт только владелец, или шире ваших) — под полем; запись изменили другие —
 * «Запись изменена другим пользователем» и «Перечитать».
 */
export function ChangeRoleDialog({
  employee,
  roles,
  open,
  onClose,
  onDone,
}: {
  employee: Employee;
  roles: readonly RoleListItem[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [current, setCurrent] = useState(employee);
  const [roleId, setRoleId] = useState(employee.role.id);
  const [error, setError] = useState<string | undefined>();
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setBusy(true);
    const res = await callApi(() => api.api.staff[':id'].$get({ param: { id: employee.id } }));
    setBusy(false);
    const fresh = res.ok ? Employee.safeParse(res.data) : null;
    if (!fresh?.success) return toast(t('err.unknown'), { bad: true });
    setCurrent(fresh.data);
    setRoleId(fresh.data.role.id);
    setChanged(false);
    setError(undefined);
  };

  const save = async () => {
    if (roleId === current.role.id) return onClose();
    setBusy(true);
    const res = await callApi(() =>
      api.api.staff[':id'].$patch({
        param: { id: employee.id },
        json: { version: current.version, roleId },
      }),
    );
    setBusy(false);
    if (res.ok) {
      onDone();
      onClose();
      return toast(t('staff.role.done'), { icon: 'shield' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    setError(errorText(res.error));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('staff.role.title')}
      sub={employee.fullName}
      dirty={roleId !== current.role.id}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy || changed}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={busy}
        />
      ) : null}
      <Field id={`${id}-role`} label={t('staff.col.role')} error={error}>
        {(control) => (
          <select
            {...control}
            className={`${inputClass()} cursor-pointer`}
            value={roleId}
            onChange={(e) => {
              setRoleId(e.target.value);
              setError(undefined);
            }}
          >
            {assignable(roles).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </Field>
    </Modal>
  );
}

/**
 * «Новый сотрудник» (прототип modules/staff.js, empAddDlg): ФИО, логин (уникален на всей платформе),
 * временный пароль — уже подставлен, его можно заменить (docs/deviations.md, п. 17), телефон с кодом
 * страны и роль — по умолчанию из учётной политики. Ошибки — под полями: проверки формы сразу,
 * «Такой логин уже занят на платформе» и другие отказы сервера — после «Создать». Окно открывают
 * заново (новый `key`) — пароль новый, поля пустые.
 */
export function NewEmployeeDialog({
  roles,
  defaultRoleId,
  codes,
  open,
  onClose,
  onDone,
}: {
  roles: readonly RoleListItem[];
  /** Роль новых сотрудников по учётной политике; нет — первая по названию. */
  defaultRoleId: string | null;
  codes: PhoneCodes['items'];
  open: boolean;
  onClose: () => void;
  onDone: (employee: Employee) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const options = assignable(roles);
  const [initial] = useState(() => {
    const role = options.find((r) => r.id === defaultRoleId) ?? options[0];
    return {
      fullName: '',
      login: '',
      temporaryPassword: suggestTemporaryPassword(),
      roleId: role?.id ?? '',
    } satisfies NewEmployeeFormInput;
  });
  const [phone, setPhone] = useState<PhoneInputValue>(() => ({
    cc: codes.find((c) => c.active)?.cc ?? codes[0]?.cc ?? '',
    local: '',
  }));
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<NewEmployeeFormInput, unknown, NewEmployeeForm>({
    resolver: zodResolver(NewEmployeeForm),
    defaultValues: initial,
  });
  // Поля регистрируются по порядку на экране: при ошибках фокус встаёт на первое неверное.
  const fields = {
    fullName: register('fullName'),
    login: register('login'),
    temporaryPassword: register('temporaryPassword'),
    roleId: register('roleId'),
  };
  const phoneId = `${id}-phone`;

  const submit = (event: FormEvent) => {
    const typed = joinPhone(phone.cc, phone.local, codes);
    const bad = typed.missing > 0 ? t('staff.err.phone', { n: typed.need }) : undefined;
    setPhoneError(bad);
    void handleSubmit(async (values) => {
      if (bad) return document.getElementById(phoneId)?.focus();
      const res = await callApi(() =>
        api.api.staff.$post({ json: { ...values, phone: typed.phone } }),
      );
      if (res.ok) {
        const body = CreatedEmployee.safeParse(res.data);
        if (body.success) onDone(body.data.employee);
        onClose();
        return toast(t('staff.new.done'), { icon: 'user' });
      }
      const message = errorText(res.error);
      const code = res.error.code;
      if (code === 'invalid_full_name')
        return setError('fullName', { type: 'server', message }, { shouldFocus: true });
      if (code === 'invalid_login' || code === 'login_taken')
        return setError('login', { type: 'server', message }, { shouldFocus: true });
      if (code === 'invalid_phone') {
        setPhoneError(message);
        return document.getElementById(phoneId)?.focus();
      }
      if (ROLE_CODES.has(code))
        return setError('roleId', { type: 'server', message }, { shouldFocus: true });
      toast(message, { bad: true });
    })(event);
  };
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('staff.new.title')}
      sub={t('staff.new.sub')}
      dirty={isDirty || phone.local !== ''}
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
            id={`${id}-fio`}
            label={t('staff.col.full_name')}
            required
            full
            error={fieldError(t, errors.fullName)}
          >
            {(control) => (
              <input {...control} {...fields.fullName} type="text" className={inputClass()} />
            )}
          </Field>
          <Field
            id={`${id}-login`}
            label={t('staff.col.login')}
            required
            hint={t('staff.new.login_hint')}
            error={fieldError(t, errors.login)}
          >
            {(control) => (
              <input
                {...control}
                {...fields.login}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className={inputClass({ mono: true })}
              />
            )}
          </Field>
          <Field
            id={`${id}-pass`}
            label={t('staff.new.password')}
            required
            error={fieldError(t, errors.temporaryPassword)}
          >
            {(control) => (
              <input
                {...control}
                {...fields.temporaryPassword}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className={inputClass({ mono: true })}
              />
            )}
          </Field>
          <Field id={phoneId} label={t('staff.col.phone')} error={phoneError}>
            {(control) => (
              <PhoneInput
                codes={codes}
                value={phone}
                onChange={(next) => {
                  setPhone(next);
                  setPhoneError(undefined);
                }}
                control={control}
                codeLabel={t('staff.phone.code')}
              />
            )}
          </Field>
          <Field
            id={`${id}-role`}
            label={t('staff.col.role')}
            required
            error={fieldError(t, errors.roleId)}
          >
            {(control) => (
              <select {...control} {...fields.roleId} className={`${inputClass()} cursor-pointer`}>
                {options.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </FormGrid>
        <Note icon="tg">{t('staff.new.tg_note')}</Note>
      </form>
    </Modal>
  );
}
