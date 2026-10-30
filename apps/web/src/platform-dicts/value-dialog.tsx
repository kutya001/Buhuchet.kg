'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  BANK_KINDS,
  DECLARATION_FOR,
  REGIME_KINDS,
  regimeAccountantNote,
  type AdminValueDict,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  AdminDictValueForm,
  PhoneValueForm,
  RegimeValueForm,
  UgnsValueForm,
  type AdminDictValue,
  type AdminDictValueFormInput,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  ChipMultiSelect,
  Field,
  FormGrid,
  Hint,
  Icon,
  iconButtonClass,
  inputClass,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { Controller, useFieldArray, useForm, type FieldError, type Path } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import { GkedRuleFields, useGkedRuleDraft } from './gked-rule-fields';
import { fetchAdminDictValue, reportTypeOptionsQuery } from './pdicts-data';

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
    case 'bases':
      return { name, description: d.description ?? '', types: d.types ?? [], note: d.note ?? '' };
    case 'regimes':
      return {
        name,
        fullName: d.fullName ?? '',
        kind: d.kind ?? 'special',
        frees: d.frees ?? '',
        who: d.who ?? '',
        how: d.how ?? '',
        combines: d.combines ?? '',
        accountantNote: regimeAccountantNote(d.accountantNote ?? ''),
        article: d.article ?? '',
      };
    case 'phones':
      return {
        name,
        dialCode: d.dialCode ?? '',
        mask: x ? (d.mask ?? '') : 'XXX XXX XXX',
        flag: x ? (d.flag ?? '') : '🏳️',
      };
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
    case 'banks':
      return { name, kind: d.kind ?? 'bank', byPhone: d.byPhone ?? false, note: d.note ?? '' };
    case 'cats':
    case 'reasons':
      return { name, note: d.note ?? '' };
    // У льготы, вида отчёта и кода ГКЭД свои окна — BenefitDialog, TypeDialog и GkedDialog.
    case 'benefits':
    case 'types':
    case 'gked':
      return { name };
  }
}

/** Отказ сервера под полем: повтор названия или кода, пустое краткое или полное название. */
const FIELD_OF: Readonly<Record<string, [Path<AdminDictValueFormInput>, UiTextKey]>> = {
  dict_value_taken: ['name', 'pdicts.err.name_taken'],
  ugns_code_taken: ['gnsCode', 'pdicts.err.ugns_code_taken'],
  short_name_required: ['shortName', 'pdicts.err.short_required'],
  full_name_required: ['fullName', 'pdicts.err.full_required'],
  invalid_link: ['types', 'pdicts.err.bad_types'],
  dial_code_required: ['dialCode', 'pdicts.err.dial_code'],
  mask_required: ['mask', 'pdicts.err.mask'],
};

/** Повтор названия словами справочника: у режима — «Такой режим уже есть» (прототип regimeDlg). */
const TAKEN_TEXT: Partial<Record<AdminValueDict, UiTextKey>> = {
  bases: 'pdicts.err.base_taken',
  regimes: 'pdicts.err.regime_taken',
  phones: 'pdicts.err.phone_taken',
};

/**
 * Окно значения справочника (прототип admin/platform-dicts-forms.js valueDlg и ugnsDlg): название
 * обязательно и не повторяется; у форм — полное и краткое название и «Для ЕНД»; у органов — телефоны с
 * подписью, график, сайт и «Сверить» (решение заказчика 27.10.2026, docs/deviations.md п. Д-3); у
 * налогового органа — код ГНС (три цифры или пусто), регион, полное и краткое название; у банковского
 * провайдера — «Тип» и «Переводы по номеру телефона». Пояснение
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
    // У УГНС обязательно краткое название, у режима — полное.
    resolver: zodResolver(
      ugns
        ? UgnsValueForm
        : dict === 'regimes'
          ? RegimeValueForm
          : dict === 'phones'
            ? PhoneValueForm
            : AdminDictValueForm,
    ),
    defaultValues: formOf(dict, item, t('pdicts.ugns.region_default')),
  });
  const contacts = useFieldArray({ control, name: 'contacts' });
  // «Виды деятельности (ГКЭД)» режима (задача 2.38): перечни ИП и ИТД — если они у режима есть.
  const gked = useGkedRuleDraft(item?.data.gked, { warn: 'regime', lists: true });
  const [gkedError, setGkedError] = useState<string>();
  const regime = dict === 'regimes';
  // Виды отчётов основания: сквозные действующие и уже привязанные (прототип baseDlg).
  const typeOptions = useQuery({ ...reportTypeOptionsQuery, enabled: dict === 'bases' });

  const reload = async () => {
    if (!item) return;
    setReloading(true);
    const fresh = await fetchAdminDictValue(dict, item.code).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setCurrent(fresh);
    reset(formOf(dict, fresh, ''));
    gked.reset(fresh.data.gked);
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      if (current && !isDirty && !gked.dirty) return onClose();
      const json = regime && gked.dirty ? { ...values, gked: gked.value() } : values;
      setGkedError(undefined);
      const res = await callApi(() =>
        current
          ? pd[':dict'][':code'].$put({
              param: { dict, code: current.code },
              json: { ...json, version: current.version },
            })
          : pd[':dict'].$post({ param: { dict }, json }),
      );
      if (res.ok) {
        onDone();
        onClose();
        const done =
          !current && dict === 'phones' ? 'pdicts.toast.added_phone' : 'pdicts.toast.saved';
        return toast(t(done), { icon: 'check' });
      }
      const code = res.error.code;
      if (code === 'record_changed') return setChanged(true);
      if (code === 'gked_unknown') return setGkedError(errorText(res.error));
      const field = FIELD_OF[code];
      if (field) {
        const message = t((code === 'dict_value_taken' && TAKEN_TEXT[dict]) || field[1]);
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
  const note = (
    name: 'note' | 'description' | 'who' | 'accountantNote',
    label: string,
    hint: string | null = t('pdicts.value.note_hint'),
  ) => (
    <Field
      id={`${id}-${name}`}
      label={label}
      hint={hint ?? undefined}
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

  const mono = (name: 'dialCode' | 'mask', label: string, numeric = false) => (
    <Field id={`${id}-${name}`} label={label} required error={fieldError(t, errors[name])}>
      {(c) => (
        <input
          {...c}
          {...register(name)}
          {...(numeric ? { inputMode: 'numeric' as const, maxLength: 4 } : {})}
          className={inputClass({ mono: true })}
        />
      )}
    </Field>
  );

  let body;
  if (dict === 'phones') {
    body = (
      <FormGrid>
        <Field
          id={`${id}-name`}
          label={t('pdicts.col.country')}
          required
          error={fieldError(t, errors.name)}
        >
          {(c) => <input {...c} {...register('name')} className={inputClass()} />}
        </Field>
        {mono('dialCode', t('pdicts.phone.dial_code'), true)}
        {mono('mask', t('pdicts.phone.mask'))}
        {text('flag', t('pdicts.phone.flag'), undefined, false)}
      </FormGrid>
    );
  } else if (dict === 'bases') {
    const linked = item?.data.types ?? [];
    const chips = (typeOptions.data ?? [])
      .filter((x) => (x.kind === 'cross' && x.active) || linked.includes(x.code))
      .map((x) => ({ value: x.code, label: x.shortName || x.name, title: x.name }));
    const typesError = fieldError(t, errors.types as FieldError | undefined);
    body = (
      <FormGrid>
        <Field
          id={`${id}-name`}
          label={t('pdicts.col.name')}
          required
          error={fieldError(t, errors.name)}
          full
        >
          {(c) => (
            <input
              {...c}
              {...register('name')}
              placeholder={t('pdicts.base.name_ph')}
              className={inputClass()}
            />
          )}
        </Field>
        {note('description', t('pdicts.col.description'), t('pdicts.base.desc_hint'))}
        <Field
          id={`${id}-types`}
          label={t('pdicts.col.types')}
          hint={t('pdicts.base.types_hint')}
          error={typesError}
          full
        >
          {(c) => (
            <Controller
              control={control}
              name="types"
              render={({ field }) => (
                <ChipMultiSelect
                  id={c.id}
                  label={t('pdicts.col.types')}
                  options={chips}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  {...(c['aria-describedby'] ? { describedBy: c['aria-describedby'] } : {})}
                />
              )}
            />
          )}
        </Field>
        {text('note', t('pdicts.col.remark'))}
      </FormGrid>
    );
  } else if (dict === 'regimes') {
    body = (
      <FormGrid>
        <Field
          id={`${id}-name`}
          label={t('pdicts.col.regime_short')}
          required
          hint={current ? t('pdicts.value.name_hint') : undefined}
          error={fieldError(t, errors.name)}
        >
          {(c) => <input {...c} {...register('name')} className={inputClass()} />}
        </Field>
        <Field id={`${id}-kind`} label={t('pdicts.col.kind')}>
          {(c) => (
            <select {...c} {...register('kind')} className={`${inputClass()} cursor-pointer`}>
              {REGIME_KINDS.map((x) => (
                <option key={x} value={x}>
                  {t(`dicts.value.regime_kind.${x}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          id={`${id}-fullName`}
          label={t('pdicts.regime.full')}
          required
          error={fieldError(t, errors.fullName)}
          full
        >
          {(c) => <input {...c} {...register('fullName')} className={inputClass()} />}
        </Field>
        {text('frees', t('pdicts.col.frees'), t('pdicts.regime.frees_hint'))}
        {note('who', t('pdicts.col.who'), null)}
        {text('how', t('pdicts.col.how'))}
        {text('combines', t('pdicts.col.combines'), t('pdicts.regime.combines_hint'))}
        {note('accountantNote', t('pdicts.col.acc'), t('pdicts.regime.acc_hint'))}
        <Field
          id={`${id}-article`}
          label={t('pdicts.col.article')}
          error={fieldError(t, errors.article)}
        >
          {(c) => (
            <input
              {...c}
              {...register('article')}
              placeholder={t('pdicts.regime.article_ph')}
              className={inputClass()}
            />
          )}
        </Field>
        <GkedRuleFields id={id} state={gked} error={gkedError} />
      </FormGrid>
    );
  } else if (ugns) {
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
          full={dict === 'forms' || dict === 'banks'}
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
              {contacts.fields.map((f, i) => {
                const error = fieldError(t, errors.contacts?.[i]?.value);
                const errorId = `${id}-contact-${i}-err`;
                return (
                  <div key={f.id} data-contact className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
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
                        {...(error
                          ? { 'aria-invalid': true as const, 'aria-describedby': errorId }
                          : {})}
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
                    {error ? (
                      <div
                        id={errorId}
                        className="flex items-start gap-[5px] text-[12px] text-danger"
                      >
                        <Icon name="alert" size="sm" className="mt-px" />
                        <span>{error}</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
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
        {dict === 'banks' ? (
          <>
            <Field id={`${id}-kind`} label={t('pdicts.col.kind')}>
              {(c) => (
                <select {...c} {...register('kind')} className={`${inputClass()} cursor-pointer`}>
                  {BANK_KINDS.map((x) => (
                    <option key={x} value={x}>
                      {t(`pdicts.bank.kind.${x}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Controller
              control={control}
              name="byPhone"
              render={({ field }) => (
                <CheckRow
                  checked={field.value === true}
                  onChange={field.onChange}
                  label={t('pdicts.col.by_phone')}
                  plain
                >
                  <Hint>{t('pdicts.bank.by_phone_hint')}</Hint>
                </CheckRow>
              )}
            />
            {note('note', t('pdicts.col.note'))}
          </>
        ) : null}
        {dict === 'cats' || dict === 'reasons' ? note('note', t('pdicts.col.note')) : null}
      </FormGrid>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      // Окна режима и основания — шире (прототип regimeDlg, baseDlg: `size: 'mid'`).
      {...(dict === 'regimes' || dict === 'bases' ? { size: 'mid' as const } : {})}
      title={
        dict === 'phones'
          ? t(current ? 'pdicts.phone.title' : 'pdicts.phone.title_new')
          : dict === 'bases'
            ? current
              ? current.name
              : t('pdicts.base.title_new')
            : dict === 'regimes'
              ? current
                ? current.data.fullName || current.name
                : t('pdicts.regime.title_new')
              : ugns
                ? t(current ? 'pdicts.ugns.title' : 'pdicts.ugns.title_new')
                : current
                  ? t('pdicts.value.edit_title')
                  : t('pdicts.value.new_title', { dict: dictTitle })
      }
      sub={
        dict === 'phones' && current
          ? t('pdicts.phone.sub')
          : ugns
            ? t('pdicts.ugns.sub')
            : dict === 'regimes'
              ? t('pdicts.regime.sub')
              : dict === 'bases'
                ? t('pdicts.base.sub')
                : undefined
      }
      dirty={isDirty || gked.dirty}
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
            {t(!current && dict === 'phones' ? 'pdicts.phone.add' : 'btn.save')}
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
