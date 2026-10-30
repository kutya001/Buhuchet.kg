'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  BIZ_SIZES,
  NEW_REPORT_TYPE,
  payScheduleText,
  pluralForm,
  PICK_GROUPS,
  REPORT_ACTS,
  REPORT_PERIODS,
  type PayerKind,
  type ReportAct,
  type ReportKind,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  reportTypeBody,
  ReportTypeValueForm,
  type AdminDictValue,
  type ReportTypeValueFormInput,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  ChipMultiSelect,
  ChipSelect,
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
import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type FieldError,
  type Path,
} from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import {
  fetchAdminDictValue,
  pdictsBasesQuery,
  pdictsOrgansQuery,
  pdictsRegimesQuery,
} from './pdicts-data';

const pd = api.api.admin['platform-dicts'];

type Form = ReportTypeValueFormInput;

const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/**
 * Поля окна из вида отчёта (прототип typeEditDlg): у нового — месячный, срок 20-го числа следующего
 * месяца (у годового — апрель), сквозной, для всех, «По желанию», с переносом срока; «Что нужно
 * сделать» не выбрано. Свой срок оплаты пуст — «совпадает со сроком сдачи».
 */
function formOf(x: AdminDictValue | null): Form {
  const d = x?.data ?? {};
  const n = NEW_REPORT_TYPE;
  const dueDay = d.dueDay ?? n.dueDay;
  const dueAfter = x ? (d.dueAfter ?? null) : n.dueAfter;
  const dueMonth = x ? (d.dueMonth ?? null) : n.dueMonth;
  return {
    name: x?.name ?? '',
    shortName: d.shortName ?? '',
    formCode: d.formCode ?? '',
    authorityCode: d.authorityCode ?? '',
    period: d.period ?? n.period,
    dueFrom: d.dueFrom ?? n.dueFrom,
    dueDay: num(dueDay),
    dueAfter: num(dueAfter),
    dueMonth: num(dueMonth),
    paySame: (d.payDay ?? null) === null,
    payDay: num(d.payDay ?? dueDay),
    payAfter: num(d.payAfter ?? dueAfter),
    payMonth: num(d.payMonth ?? dueMonth),
    paySchedule: payScheduleText(d.paySchedule ?? []),
    kind: (d.kind as ReportKind | undefined) ?? n.kind,
    payer: d.payer ?? n.payer,
    regimes: d.regimes ?? [],
    pickGroup: d.pickGroup ?? n.pickGroup,
    bizSizes: d.bizSizes ?? [],
    bases: d.bases ?? [],
    notForRegimes: d.notForRegimes ?? [],
    notForEnRates: (d.notForEnRates ?? []).join('; '),
    preselect: d.preselect ?? n.preselect,
    choiceNote: d.choiceNote ?? '',
    description: d.description ?? '',
    clientNote: d.clientNote ?? '',
    oneOff: d.oneOff ?? n.oneOff,
    eventLabel: d.eventLabel ?? '',
    statIndex: d.statIndex ?? '',
    respondents: d.respondents ?? '',
    source: d.source ?? '',
    article: d.article ?? '',
    verify: d.verify ?? n.verify,
    verifyNote: d.verifyNote ?? '',
    rates: (d.rates ?? []).join('; '),
    shiftToWorkday: d.shiftToWorkday ?? n.shiftToWorkday,
    // «Что нужно сделать» у нового вида не выбрано: схема требует выбрать.
    act: (d.act ?? '') as ReportAct,
    payments: d.payments ?? [],
  };
}

/** Отказ сервера под полем окна: код ошибки → поле и текст. */
const FIELD_OF: Readonly<Record<string, [Path<Form>, UiTextKey]>> = {
  dict_value_taken: ['name', 'pdicts.err.type_taken'],
  short_name_required: ['shortName', 'pdicts.err.short_required'],
  authority_required: ['authorityCode', 'pdicts.err.organ_required'],
  act_required: ['act', 'pdicts.err.act_required'],
  regimes_required: ['regimes', 'pdicts.err.regimes_required'],
  payments_required: ['payments', 'pdicts.err.payments_required'],
  regimes_both: ['notForRegimes', 'pdicts.err.regimes_both'],
  invalid_en_rates: ['notForEnRates', 'pdicts.err.en_rates'],
};

/** «Связь не подходит» — под своим полем. */
const LINK_TEXT: Readonly<Record<string, UiTextKey>> = {
  regimes: 'pdicts.err.bad_regimes',
  notForRegimes: 'pdicts.err.bad_regimes',
  bases: 'pdicts.err.bad_bases',
  authorityCode: 'pdicts.err.bad_organ',
  payments: 'pdicts.err.bad_payment_organ',
};

/** «Для кого» и «Тип» в порядке прототипа. */
const PAYERS: readonly PayerKind[] = ['all', 'org', 'ip'];
const KINDS: readonly ReportKind[] = ['cross', 'regime', 'internal'];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Поля правила срока: их правка у созданного вида пересчитывает сроки несданных отчётов. */
const RULE_FIELDS = ['dueDay', 'dueAfter', 'dueMonth', 'dueFrom', 'shiftToWorkday'] as const;

/**
 * Окно вида отчёта (прототип admin/platform-dicts-edit.js typeEditDlg и pkTypeFields; ТЗ «Виды
 * отчётов» → «Поля вида отчёта»): название, краткое название, орган и «Что нужно сделать» обязательны;
 * срок сдачи и оплаты правилом; у вида с уплатой — «Что уплачивается»; у режимного — «Применимые
 * режимы»; поля «Подбора отчётов». У созданного вида при правке правила срока или периодичности —
 * предупреждение, сколько несданных отчётов изменится. «Виды деятельности (ГКЭД)» добавит задача 2.38,
 * сверку с ГНС — 2.37. Пока окно было открыто, вид изменил другой администратор — «Запись изменена
 * другим пользователем» и «Перечитать».
 */
export function TypeDialog({
  open,
  onClose,
  item,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  item: AdminDictValue | null;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [current, setCurrent] = useState(item);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Form, unknown, ReportTypeValueForm>({
    resolver: zodResolver(ReportTypeValueForm),
    defaultValues: formOf(item),
  });
  const payments = useFieldArray({ control, name: 'payments' });
  const organs = useQuery(pdictsOrgansQuery);
  const regimes = useQuery(pdictsRegimesQuery);
  const bases = useQuery(pdictsBasesQuery);
  const before = current?.data;
  const v = useWatch({ control });
  const act = v.act as ReportAct | '';
  const yearly = v.period === 'Y';
  const fromStart = v.dueFrom === 'start';

  // Орган нового вида — первый действующий в порядке справочника (в прототипе — ГНС).
  useEffect(() => {
    if (item || getValues('authorityCode')) return;
    const first = (organs.data ?? []).find((x) => x.active);
    if (first) setValue('authorityCode', first.code);
  }, [item, organs.data, getValues, setValue]);

  const reload = async () => {
    if (!item) return;
    setReloading(true);
    const fresh = await fetchAdminDictValue('types', item.code).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setCurrent(fresh);
    reset(formOf(fresh));
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      if (current && !isDirty) return onClose();
      const body = reportTypeBody(values);
      const res = await callApi(() =>
        current
          ? pd[':dict'][':code'].$put({
              param: { dict: 'types', code: current.code },
              json: { ...body, version: current.version },
            })
          : pd[':dict'].$post({ param: { dict: 'types' }, json: body }),
      );
      if (res.ok) {
        onDone();
        onClose();
        return toast(t(current ? 'pdicts.toast.type_saved' : 'pdicts.toast.type_added'), {
          icon: 'check',
        });
      }
      const code = res.error.code;
      if (code === 'record_changed') return setChanged(true);
      const field = (res.error.details as { field?: string } | undefined)?.field ?? '';
      const target: [Path<Form>, UiTextKey] | undefined =
        code === 'invalid_link' && LINK_TEXT[field]
          ? [field as Path<Form>, LINK_TEXT[field]]
          : FIELD_OF[code];
      if (target) {
        return setError(
          target[0],
          { type: 'server', message: t(target[1]) },
          { shouldFocus: true },
        );
      }
      toast(errorText(res.error), { bad: true });
    })(event);
  const formId = `${id}-form`;

  /** Однострочное поле. */
  const input = (
    name:
      | 'formCode'
      | 'choiceNote'
      | 'eventLabel'
      | 'statIndex'
      | 'respondents'
      | 'source'
      | 'article'
      | 'verifyNote'
      | 'rates'
      | 'notForEnRates'
      | 'paySchedule',
    label: string,
    options: { full?: boolean; hint?: string; placeholder?: string; mono?: boolean } = {},
  ) => (
    <Field
      id={`${id}-${name}`}
      label={label}
      hint={options.hint}
      error={fieldError(t, errors[name])}
      full={options.full ?? false}
    >
      {(c) => (
        <input
          {...c}
          {...register(name)}
          {...(options.placeholder ? { placeholder: options.placeholder } : {})}
          className={inputClass({ mono: options.mono ?? false })}
        />
      )}
    </Field>
  );

  /** Число срока: «N-е число», «M-го месяца». */
  const number = (
    name: 'dueDay' | 'dueAfter' | 'payDay' | 'payAfter',
    label: string,
    max: number,
  ) => (
    <Field id={`${id}-${name}`} label={label} error={fieldError(t, errors[name])}>
      {(c) => (
        <input
          {...c}
          {...register(name)}
          inputMode="numeric"
          maxLength={String(max).length}
          className={inputClass()}
        />
      )}
    </Field>
  );

  /** Месяц срока: у пустого — «—», чтобы не показать январь, которого нет. */
  const month = (name: 'dueMonth' | 'payMonth', label: string) => (
    <Field id={`${id}-${name}`} label={label} error={fieldError(t, errors[name])}>
      {(c) => (
        <select {...c} {...register(name)} className={`${inputClass()} cursor-pointer`}>
          {v[name] === '' ? <option value="">—</option> : null}
          {MONTHS.map((m) => (
            <option key={m} value={String(m)}>
              {t(`pdicts.type.month.${m as 1}`)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const textarea = (
    name: 'description' | 'clientNote',
    label: string,
    hint: string,
    placeholder?: string,
  ) => (
    <Field id={`${id}-${name}`} label={label} hint={hint} error={fieldError(t, errors[name])} full>
      {(c) => (
        <textarea
          {...c}
          {...register(name)}
          {...(placeholder ? { placeholder } : {})}
          className={`${inputClass({ multiline: true })} ${name === 'description' ? 'min-h-[70px]' : 'min-h-[52px]'}`}
        />
      )}
    </Field>
  );

  /** Плашки режимов и оснований: действующие, уже выбранные и выбранные в окне. */
  const chips = (
    name: 'regimes' | 'notForRegimes' | 'bases',
    label: string,
    list: readonly { code: string; name: string; active: boolean }[],
    hint?: string,
  ) => {
    const was = before?.[name] ?? [];
    return (
      <Field
        id={`${id}-${name}`}
        label={label}
        hint={hint}
        error={fieldError(t, errors[name] as FieldError | undefined)}
        full
      >
        {(c) => (
          <Controller
            control={control}
            name={name}
            render={({ field }) => {
              const value = field.value ?? [];
              const options = list
                .filter((x) => x.active || was.includes(x.code) || value.includes(x.code))
                .map((x) => ({ value: x.code, label: x.name }));
              return (
                <ChipMultiSelect
                  id={c.id}
                  label={label}
                  options={options}
                  value={value}
                  onChange={field.onChange}
                  {...(c['aria-describedby'] ? { describedBy: c['aria-describedby'] } : {})}
                />
              );
            }}
          />
        )}
      </Field>
    );
  };

  /** Строка с переключателем на всю ширину: «Отмечать заранее», «Разовый», «Сверить». */
  const check = (name: 'preselect' | 'oneOff' | 'verify', label: string, hint: string) => (
    <div className="col-span-full">
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <CheckRow checked={field.value === true} onChange={field.onChange} label={label} plain>
            <Hint>{hint}</Hint>
          </CheckRow>
        )}
      />
    </div>
  );

  // Организации — только действующие органы и уже выбранный; получатель платежа — любой орган
  // справочника (прототип: весь список органов).
  const organList = organs.data ?? [];
  const organOptions = organList.filter(
    (x) => x.active || x.code === before?.authorityCode || x.code === v.authorityCode,
  );

  // Предупреждения у созданного вида (прототип `te-warn`): правило срока или периодичность изменились.
  const reports = current?.reports ?? { total: 0, open: 0, orgs: 0 };
  const initial = current ? formOf(current) : null;
  const ruleChanged = initial !== null && RULE_FIELDS.some((f) => initial[f] !== v[f]);
  const periodChanged = initial !== null && initial.period !== v.period;
  const spread =
    reports.open === 0
      ? t('pdicts.type.spread_none')
      : t(`pdicts.type.spread_orgs.${pluralForm(reports.orgs)}`, {
          n: reports.orgs,
          reports: t(`pdicts.type.spread.${pluralForm(reports.open)}`, { n: reports.open }),
        });
  const actChanged = before?.act !== undefined && act !== '' && act !== before.act;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={current ? current.name : t('pdicts.type.title_new')}
      sub={t('pdicts.type.sub')}
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
        <FormGrid>
          <Field
            id={`${id}-name`}
            label={t('pdicts.col.name')}
            required
            error={fieldError(t, errors.name)}
            full
          >
            {(c) => <input {...c} {...register('name')} className={inputClass()} />}
          </Field>
          <Field
            id={`${id}-shortName`}
            label={t('pdicts.type.short')}
            required
            error={fieldError(t, errors.shortName)}
          >
            {(c) => <input {...c} {...register('shortName')} className={inputClass()} />}
          </Field>
          {input('formCode', t('pdicts.type.form_code'), { mono: true })}
          <Field
            id={`${id}-authorityCode`}
            label={t('dicts.col.organ')}
            error={fieldError(t, errors.authorityCode)}
          >
            {(c) => (
              <select
                {...c}
                {...register('authorityCode')}
                className={`${inputClass()} cursor-pointer`}
              >
                {organOptions.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${id}-period`} label={t('dicts.col.per')}>
            {(c) => (
              <select
                {...c}
                {...register('period', {
                  // Скрытое поле срока при смене периодичности — со значением, как в прототипе.
                  onChange: (e: { target: { value: string } }) => {
                    if (e.target.value === 'Y' && getValues('dueMonth') === '') {
                      setValue('dueMonth', '1');
                    }
                    if (e.target.value !== 'Y' && getValues('dueAfter') === '') {
                      setValue('dueAfter', '1');
                    }
                  },
                })}
                className={`${inputClass()} cursor-pointer`}
              >
                {REPORT_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {t(`report.period.${p.toLowerCase() as 'm'}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-dueFrom`}
            label={t('pdicts.type.from')}
            hint={t('pdicts.type.from_hint')}
          >
            {(c) => (
              <select {...c} {...register('dueFrom')} className={`${inputClass()} cursor-pointer`}>
                <option value="end">{t('pdicts.type.from.end')}</option>
                <option value="start">{t('pdicts.type.from.start')}</option>
              </select>
            )}
          </Field>
          <div />
          {yearly ? (
            <>
              {number('dueDay', t('pdicts.type.due_day_y'), 31)}
              {month(
                'dueMonth',
                t(fromStart ? 'pdicts.type.due_month.start' : 'pdicts.type.due_month.end'),
              )}
            </>
          ) : (
            <>
              {number('dueDay', t('pdicts.type.due_day'), 31)}
              {number(
                'dueAfter',
                t(fromStart ? 'pdicts.type.due_after.start' : 'pdicts.type.due_after.end'),
                6,
              )}
            </>
          )}
          {act && act !== 'sub' ? (
            <>
              <div className="col-span-full">
                <Controller
                  control={control}
                  name="paySame"
                  render={({ field }) => (
                    <CheckRow
                      checked={field.value === true}
                      onChange={(same) => {
                        // Свой срок оплаты — сначала как срок сдачи (прототип: `e.pay || {…}`).
                        if (!same) {
                          for (const [pay, due] of [
                            ['payDay', 'dueDay'],
                            ['payAfter', 'dueAfter'],
                            ['payMonth', 'dueMonth'],
                          ] as const) {
                            if (getValues(pay) === '') setValue(pay, getValues(due));
                          }
                        }
                        field.onChange(same);
                      }}
                      label={t('pdicts.type.pay_same')}
                      plain
                    />
                  )}
                />
              </div>
              {v.paySame ? null : yearly ? (
                <>
                  {number('payDay', t('pdicts.type.pay_day_y'), 31)}
                  {month('payMonth', t('pdicts.type.pay_month'))}
                </>
              ) : (
                <>
                  {number('payDay', t('pdicts.type.pay_day'), 31)}
                  {number('payAfter', t('pdicts.type.pay_after'), 6)}
                </>
              )}
              {input('paySchedule', t('pdicts.type.schedule'), {
                full: true,
                hint: t('pdicts.type.schedule_hint'),
                placeholder: t('pdicts.type.schedule_ph'),
              })}
            </>
          ) : null}
          <Field id={`${id}-kind`} label={t('pdicts.col.kind')}>
            {(c) => (
              <select {...c} {...register('kind')} className={`${inputClass()} cursor-pointer`}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`pdicts.type.kind.${k}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${id}-payer`} label={t('pdicts.col.payer')}>
            {(c) => (
              <select {...c} {...register('payer')} className={`${inputClass()} cursor-pointer`}>
                {PAYERS.map((p) => (
                  <option key={p} value={p}>
                    {t(`pdicts.type.payer.${p}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {v.kind === 'regime'
            ? chips('regimes', t('pdicts.type.regimes'), regimes.data ?? [])
            : null}
          <div className="col-span-full">
            <b className="font-semibold">{t('pdicts.type.pick')}</b>
            <Hint>{t('pdicts.type.pick_hint')}</Hint>
          </div>
          <Field id={`${id}-pickGroup`} label={t('pdicts.type.group')}>
            {(c) => (
              <select
                {...c}
                {...register('pickGroup')}
                className={`${inputClass()} cursor-pointer`}
              >
                {PICK_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {t(`pdicts.type.group.${g}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-bizSizes`}
            label={t('pdicts.type.biz')}
            hint={t('pdicts.type.biz_hint')}
          >
            {(c) => (
              <Controller
                control={control}
                name="bizSizes"
                render={({ field }) => (
                  <ChipMultiSelect
                    id={c.id}
                    label={t('pdicts.type.biz')}
                    options={BIZ_SIZES.map((b) => ({ value: b, label: t(`pdicts.type.biz.${b}`) }))}
                    value={field.value ?? []}
                    onChange={field.onChange}
                    {...(c['aria-describedby'] ? { describedBy: c['aria-describedby'] } : {})}
                  />
                )}
              />
            )}
          </Field>
          {chips('bases', t('pdicts.type.bases'), bases.data ?? [], t('pdicts.type.bases_hint'))}
          {chips('notForRegimes', t('pdicts.type.not_regimes'), regimes.data ?? [])}
          {input('notForEnRates', t('pdicts.type.not_en'), {
            full: true,
            hint: t('pdicts.type.not_en_hint'),
            placeholder: t('pdicts.type.not_en_ph'),
          })}
          {check('preselect', t('pdicts.type.preselect'), t('pdicts.type.preselect_hint'))}
          {input('choiceNote', t('pdicts.type.choice'), {
            full: true,
            hint: t('pdicts.type.choice_hint'),
            placeholder: t('pdicts.type.choice_ph'),
          })}
          {textarea('description', t('pdicts.col.description'), t('pdicts.type.desc_hint'))}
          {textarea(
            'clientNote',
            t('pdicts.type.client'),
            t('pdicts.type.client_hint'),
            t('pdicts.type.client_ph'),
          )}
          {check('oneOff', t('pdicts.type.one_off'), t('pdicts.type.one_off_hint'))}
          {input('eventLabel', t('pdicts.type.event'), {
            full: true,
            hint: t('pdicts.type.event_hint'),
            placeholder: t('pdicts.type.event_ph'),
          })}
          {input('statIndex', t('pdicts.type.index'), {
            hint: t('pdicts.type.index_hint'),
            placeholder: t('pdicts.type.index_ph'),
            mono: true,
          })}
          {input('respondents', t('pdicts.type.resp'), { hint: t('pdicts.type.resp_hint') })}
          {input('source', t('pdicts.type.source'), {
            full: true,
            hint: t('pdicts.type.source_hint'),
            placeholder: t('pdicts.type.source_ph'),
          })}
          {input('article', t('pdicts.col.article'))}
          <div />
          {check('verify', t('pdicts.type.verify'), t('pdicts.type.verify_hint'))}
          {input('verifyNote', t('pdicts.type.verify_note'), { full: true })}
          {input('rates', t('pdicts.type.rates'), {
            hint: t('pdicts.type.rates_hint'),
            placeholder: t('pdicts.type.rates_ph'),
          })}
          <div className="flex flex-col justify-end">
            <Controller
              control={control}
              name="shiftToWorkday"
              render={({ field }) => (
                <CheckRow
                  checked={field.value === true}
                  onChange={field.onChange}
                  label={t('pdicts.type.shift')}
                  plain
                />
              )}
            />
          </div>
          <Field
            id={`${id}-act`}
            label={t('pdicts.type.act')}
            required
            hint={act ? t(`pdicts.type.act_hint.${act}`) : undefined}
            error={fieldError(t, errors.act)}
            full
          >
            {(c) => (
              <Controller
                control={control}
                name="act"
                render={({ field }) => (
                  <ChipSelect
                    id={c.id}
                    label={t('pdicts.type.act')}
                    options={REPORT_ACTS.map((a) => ({
                      value: a,
                      label: t(`report.act.${a}`),
                    }))}
                    value={field.value}
                    onChange={(next) => {
                      // У вида с уплатой — хотя бы один платёж (прототип: название вида и орган).
                      if (next !== 'sub' && !getValues('payments').length) {
                        payments.append({
                          name: getValues('name').trim() || t('pdicts.type.pay_default'),
                          authority: getValues('authorityCode'),
                          kbk: '',
                        });
                      }
                      field.onChange(next);
                    }}
                  />
                )}
              />
            )}
          </Field>
          {act && act !== 'sub' ? (
            <Field
              id={`${id}-payments`}
              label={t('pdicts.type.pays')}
              required
              hint={t('pdicts.type.pays_hint')}
              error={fieldError(t, errors.payments as FieldError | undefined)}
              full
            >
              {(c) => (
                <div id={c.id} className="flex flex-col gap-2" data-type-payments="">
                  {payments.fields.map((f, i) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-2" data-payment="">
                      <input
                        {...register(`payments.${i}.name`)}
                        aria-label={t('pdicts.type.pay_name')}
                        placeholder={t('pdicts.type.pay_name')}
                        className={`${inputClass({ full: false })} min-w-[140px] grow`}
                      />
                      <select
                        {...register(`payments.${i}.authority`)}
                        aria-label={t('pdicts.type.pay_to')}
                        className={`${inputClass({ full: false })} w-[150px] cursor-pointer`}
                      >
                        {organList.map((x) => (
                          <option key={x.code} value={x.code}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      <input
                        {...register(`payments.${i}.kbk`)}
                        aria-label={t('pdicts.type.pay_kbk')}
                        placeholder={t('pdicts.type.pay_kbk_ph')}
                        className={`${inputClass({ full: false, mono: true })} w-[130px]`}
                      />
                      {payments.fields.length > 1 ? (
                        <button
                          type="button"
                          className={iconButtonClass('sm')}
                          aria-label={t('pdicts.type.pay_remove')}
                          title={t('pdicts.type.pay_remove')}
                          onClick={() => payments.remove(i)}
                        >
                          <Icon name="x" size="sm" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <div>
                    <button
                      type="button"
                      className={buttonClass('default', 'sm')}
                      onClick={() =>
                        payments.append({
                          name: '',
                          authority: getValues('authorityCode'),
                          kbk: '',
                        })
                      }
                    >
                      <Icon name="plus" size="sm" />
                      {t('pdicts.type.pay_add')}
                    </button>
                  </div>
                </div>
              )}
            </Field>
          ) : null}
        </FormGrid>
        {actChanged && reports.total > 0 ? (
          <Note tone="warn">
            {t(`pdicts.type.act_warn.${pluralForm(reports.total)}`, {
              n: reports.total,
              act: t(`report.act.${act}`),
            })}
          </Note>
        ) : null}
        {v.kind === 'internal' ? <Note>{t('pdicts.type.internal_note')}</Note> : null}
        {ruleChanged || periodChanged ? (
          <Note tone="warn">
            {[
              periodChanged ? t('pdicts.type.warn_period') : '',
              ruleChanged ? t('pdicts.type.warn_rule', { spread }) : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </Note>
        ) : null}
      </form>
    </Modal>
  );
}
