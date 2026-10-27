'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { DECLARATION_FOR, type AdminValueDict, type UiTextKey } from '@buhuchet/domain';
import {
  AdminDictValueForm,
  UgnsValueForm,
  type AdminDictValue,
  type AdminDictValueFormInput,
} from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  Icon,
  iconButtonClass,
  inputClass,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { useFieldArray, useForm, type Path } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import { fetchAdminDictValue } from './pdicts-data';

const pd = api.api.admin['platform-dicts'];

/** Поля окна из значения: у нового — пустые, у налогового органа регион — «г. Бишкек». */
function formOf(
  dict: AdminValueDict,
  x: AdminDictValue | null,
  region: string,
): AdminDictValueFormInput {
  const d = x?.data ?? {};
  const name = x?.name ?? '';
  switch (dict) {
    case 'forms':
      return {
        name,
        fullName: d.fullName ?? '',
        shortName: d.shortName ?? '',
        declarationFor: d.declarationFor ?? 'org',
        note: d.note ?? '',
      };
    case 'organs':
      return {
        name,
        description: d.description ?? '',
        contacts: d.contacts ?? [],
        hours: d.hours ?? '',
        site: d.site ?? '',
        contactsNote: d.contactsNote ?? '',
      };
    case 'ugns':
      return {
        name,
        shortName: d.shortName ?? '',
        gnsCode: d.gnsCode ?? '',
        region: x ? (d.region ?? '') : region,
      };
    case 'reasons':
      return { name, note: d.note ?? '' };
  }
}

/** Отказ сервера под полем: повтор названия или кода, пустое краткое название. */
const FIELD_OF: Readonly<Record<string, [Path<AdminDictValueFormInput>, UiTextKey]>> = {
  dict_value_taken: ['name', 'pdicts.err.name_taken'],
  ugns_code_taken: ['gnsCode', 'pdicts.err.ugns_code_taken'],
  short_name_required: ['shortName', 'pdicts.err.short_required'],
};

/**
 * Окно значения справочника (прототип admin/platform-dicts-forms.js valueDlg и ugnsDlg): название
 * обязательно и не повторяется; у форм — полное и краткое название и «Для ЕНД»; у органов — телефоны с
 * подписью, график, сайт и «Сверить» (решение заказчика 27.10.2026, docs/deviations.md п. Д-3); у
 * налогового органа — код ГНС (три цифры или пусто), регион, полное и краткое название. Пояснение
 * видят все организации. Новое название сразу видно у всех организаций, в том числе в старых записях:
 * записи ссылаются на код. Пока окно было открыто, значение изменил другой администратор — «Запись
 * изменена другим пользователем» и «Перечитать».
 */
export function ValueDialog({
  open,
  onClose,
  dict,
  item,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  dict: AdminValueDict;
  item: AdminDictValue | null;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const ugns = dict === 'ugns';
  const [current, setCurrent] = useState(item);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AdminDictValueFormInput, unknown, AdminDictValueForm>({
    resolver: zodResolver(ugns ? UgnsValueForm : AdminDictValueForm),
    defaultValues: formOf(dict, item, t('pdicts.ugns.region_default')),
  });
  const contacts = useFieldArray({ control, name: 'contacts' });

  const reload = async () => {
    if (!item) return;
    setReloading(true);
    const fresh = await fetchAdminDictValue(dict, item.code).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setCurrent(fresh);
    reset(formOf(dict, fresh, ''));
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      if (current && !isDirty) return onClose();
      const res = await callApi(() =>
        current
          ? pd[':dict'][':code'].$put({
              param: { dict, code: current.code },
              json: { ...values, version: current.version },
            })
          : pd[':dict'].$post({ param: { dict }, json: values }),
      );
      if (res.ok) {
        onDone();
        onClose();
        return toast(t('pdicts.toast.saved'), { icon: 'check' });
      }
      const code = res.error.code;
      if (code === 'record_changed') return setChanged(true);
      const field = FIELD_OF[code];
      if (field) {
        const message = t(field[1]);
        return setError(field[0], { type: 'server', message }, { shouldFocus: true });
      }
      toast(errorText(res.error), { bad: true });
    })(event);
  const formId = `${id}-form`;
  const dictTitle = t(`pdicts.title.${dict}`);
  const used = current?.contractors ?? 0;

  const text = (name: Path<AdminDictValueFormInput>, label: string, hint?: string, full = true) => (
    <Field
      id={`${id}-${name}`}
      label={label}
      hint={hint}
      error={fieldError(t, errors[name as 'name'])}
      full={full}
    >
      {(c) => <input {...c} {...register(name)} className={inputClass()} />}
    </Field>
  );
  const note = (name: 'note' | 'description', label: string) => (
    <Field
      id={`${id}-${name}`}
      label={label}
      hint={t('pdicts.value.note_hint')}
      error={fieldError(t, errors[name])}
      full
    >
      {(c) => (
        <textarea
          {...c}
          {...register(name)}
          className={`${inputClass({ multiline: true })} min-h-[60px]`}
        />
      )}
    </Field>
  );

  let body;
  if (ugns) {
    body = (
      <FormGrid>
        <Field
          id={`${id}-gnsCode`}
          label={t('pdicts.col.code')}
          hint={t('pdicts.ugns.code_hint')}
          error={fieldError(t, errors.gnsCode)}
        >
          {(c) => (
            <input
              {...c}
              {...register('gnsCode')}
              inputMode="numeric"
              maxLength={3}
              placeholder="002"
              className={inputClass({ mono: true })}
            />
          )}
        </Field>
        {text('region', t('pdicts.col.region'), undefined, false)}
        <Field
          id={`${id}-name`}
          label={t('pdicts.col.ugns_name')}
          required
          error={fieldError(t, errors.name)}
          full
        >
          {(c) => (
            <input
              {...c}
              {...register('name')}
              placeholder={t('pdicts.ugns.name_ph')}
              className={inputClass()}
            />
          )}
        </Field>
        <Field
          id={`${id}-shortName`}
          label={t('pdicts.ugns.short')}
          required
          hint={t('pdicts.ugns.short_hint')}
          error={fieldError(t, errors.shortName)}
          full
        >
          {(c) => (
            <input
              {...c}
              {...register('shortName')}
              placeholder={t('pdicts.ugns.short_ph')}
              className={inputClass()}
            />
          )}
        </Field>
      </FormGrid>
    );
  } else {
    body = (
      <FormGrid>
        <Field
          id={`${id}-name`}
          label={t('pdicts.value.name')}
          required
          hint={current ? t('pdicts.value.name_hint') : undefined}
          error={fieldError(t, errors.name)}
          full={dict !== 'reasons'}
        >
          {(c) => <input {...c} {...register('name')} className={inputClass()} />}
        </Field>
        {dict === 'forms' ? (
          <>
            {text('fullName', t('pdicts.col.full'))}
            {text('shortName', t('pdicts.col.short'), undefined, false)}
            <Field id={`${id}-end`} label={t('pdicts.col.end')} hint={t('pdicts.value.end_hint')}>
              {(c) => (
                <select
                  {...c}
                  {...register('declarationFor')}
                  className={`${inputClass()} cursor-pointer`}
                >
                  {DECLARATION_FOR.map((x) => (
                    <option key={x} value={x}>
                      {t(`dicts.platform.end.${x}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {note('note', t('pdicts.col.forms_note'))}
          </>
        ) : null}
        {dict === 'organs' ? (
          <>
            {note('description', t('pdicts.col.organs_note'))}
            {/* ОТКЛОНЕНИЕ: docs/deviations.md#Д-3 — контакты органа, как в ТЗ. */}
            <fieldset className="col-span-full m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="mb-[5px] p-0 text-[12px] font-semibold tracking-[.01em] text-muted">
                {t('pdicts.col.contacts')}
              </legend>
              {contacts.fields.map((f, i) => (
                <div key={f.id} data-contact className="flex items-center gap-2">
                  <input
                    {...register(`contacts.${i}.label`)}
                    aria-label={t('pdicts.organ.contact_label')}
                    placeholder={t('pdicts.organ.contact_label_ph')}
                    className={`${inputClass({ full: false })} w-[40%] min-w-0`}
                  />
                  <input
                    {...register(`contacts.${i}.value`)}
                    aria-label={t('pdicts.organ.contact_value')}
                    inputMode="tel"
                    className={`${inputClass({ full: false })} min-w-0 grow`}
                  />
                  <button
                    type="button"
                    className={iconButtonClass()}
                    aria-label={t('pdicts.organ.contact_remove')}
                    title={t('pdicts.organ.contact_remove')}
                    onClick={() => contacts.remove(i)}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={buttonClass('default', 'sm')}
                  onClick={() => contacts.append({ label: '', value: '' })}
                >
                  <Icon name="plus" size="sm" />
                  {t('pdicts.organ.contact_add')}
                </button>
                <span className="text-[11.5px] leading-[1.4] text-faint">
                  {t('pdicts.organ.contacts_hint')}
                </span>
              </div>
            </fieldset>
            {text('hours', t('pdicts.col.hours'), undefined, false)}
            {text('site', t('pdicts.col.site'), undefined, false)}
            {text(
              'contactsNote',
              t('pdicts.col.contacts_note'),
              t('pdicts.organ.contacts_note_hint'),
            )}
          </>
        ) : null}
        {dict === 'reasons' ? note('note', t('pdicts.col.note')) : null}
      </FormGrid>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={
        ugns
          ? t(current ? 'pdicts.ugns.title' : 'pdicts.ugns.title_new')
          : current
            ? t('pdicts.value.edit_title')
            : t('pdicts.value.new_title', { dict: dictTitle })
      }
      sub={ugns ? t('pdicts.ugns.sub') : undefined}
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
            disabled={isSubmitting || changed}
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
          reloading={reloading}
        />
      ) : null}
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        {body}
        {ugns && used > 0 ? (
          <Note icon="alert" tone="warn">
            {t('pdicts.ugns.used_warn', { n: used })}
          </Note>
        ) : null}
      </form>
    </Modal>
  );
}
