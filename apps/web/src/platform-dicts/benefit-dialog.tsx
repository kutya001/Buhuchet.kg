'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  BENEFIT_KINDS,
  benefitDueRuleText,
  LAST_DAY_OF_MONTH,
  type PayerKind,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  BenefitValueForm,
  TaxOffices,
  type AdminDictValue,
  type BenefitDueRule,
  type BenefitValueFormInput,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  ChipMultiSelect,
  Field,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  linkButtonClass,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { Controller, useForm, useWatch, type FieldError, type Path } from 'react-hook-form';
import { api, apiFailure, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import { duesNote, useDuesPreview } from './dues-preview';
import {
  gkedFieldError,
  GkedRuleFields,
  useGkedRuleDraft,
  type GkedFieldError,
} from './gked-rule-fields';
import { fetchAdminDictValue, reportTypeOptionsQuery } from './pdicts-data';

const pd = api.api.admin['platform-dicts'];

/** Все управления ГНС, в том числе отключённые: «Ставится по УГНС» в окне статуса. */
const officesQuery = {
  queryKey: ['admin', 'pdicts', 'benefit-offices'],
  queryFn: async () => {
    const res = await api.api['tax-offices'].$get({ query: { all: 'true' } });
    if (!res.ok) throw await apiFailure(res);
    return TaxOffices.parse(await res.json()).items;
  },
};

/** Поля окна из значения: у нового — пустые, «Кто может применять» — организации и ИП. */
function formOf(x: AdminDictValue | null): BenefitValueFormInput {
  const d = x?.data ?? {};
  return {
    name: x?.name ?? '',
    gives: d.gives ?? '',
    payer: d.payer ?? 'all',
    article: d.article ?? '',
    kind: d.kind ?? 'benefit',
    conditions: d.conditions ?? '',
    confirmation: d.confirmation ?? '',
    combines: d.combines ?? '',
    term: d.term ?? '',
    validUntil: d.validUntil ?? '',
    removes: d.removes ?? [],
    adds: d.adds ?? [],
    dueRules: d.dueRules ?? [],
    offices: d.offices ?? [],
    verify: d.verify ?? false,
    verifyNote: d.verifyNote ?? '',
  };
}

/** Отказ сервера под полем: повтор названия, пустое «Что даёт», связи и «Меняет сроки». */
const FIELD_OF: Readonly<Record<string, [Path<BenefitValueFormInput>, UiTextKey]>> = {
  dict_value_taken: ['name', 'pdicts.err.benefit_taken'],
  gives_required: ['gives', 'pdicts.err.gives_required'],
  benefit_types_both: ['adds', 'pdicts.err.benefit_types_both'],
  due_rule_empty: ['dueRules', 'pdicts.err.due_need'],
  invalid_due_rule: ['dueRules', 'pdicts.err.due_type'],
};

/** «Связь не подходит» — под своим полем: виды отчётов или УГНС. */
const LINK_TEXT: Readonly<Record<string, UiTextKey>> = {
  removes: 'pdicts.err.bad_benefit_types',
  adds: 'pdicts.err.bad_benefit_types',
  offices: 'pdicts.err.bad_offices',
};

/** «Кто может применять» в порядке прототипа: организации и ИП, только организации, только ИП. */
const PAYERS: readonly PayerKind[] = ['all', 'org', 'ip'];

/** Дни срока в строке добавления: «как в каталоге», 1–30, последний день. */
const DAYS = Array.from({ length: LAST_DAY_OF_MONTH - 1 }, (_, i) => i + 1);
/** «Месяцев после периода» в строке добавления, как в прототипе: после периода, периода, 2-го после. */
const AFTER = [1, 0, 2] as const;

/** Выбранный день срока: пусто — как в каталоге, `last` — последний день месяца. */
const dayOf = (v: string): number | null =>
  v === '' ? null : v === 'last' ? LAST_DAY_OF_MONTH : Number(v);

/**
 * Окно льготы или статуса (прототип admin/platform-dicts-forms.js benefitDlg; ТЗ «Налоговые льготы и
 * особые статусы»): название и «Что даёт» обязательны; «Тип» — льгота или статус; виды отчётов, которые
 * статус делает ненужными и добавляет; «Меняет сроки» — свой срок сдачи и уплаты видов отчётов у
 * контрагента со статусом; «Ставится по УГНС» и «Сверить». «Виды деятельности (ГКЭД)» добавит задача
 * 2.38. Пока окно было открыто, статус изменил другой администратор — «Запись изменена другим
 * пользователем» и «Перечитать».
 */
export function BenefitDialog({
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
  // Строка «Меняет сроки», которую добавляют: вид, сдача, уплата и месяц.
  const [draft, setDraft] = useState({ type: '', due: '', pay: '', after: '1' });
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<BenefitValueFormInput, unknown, BenefitValueForm>({
    resolver: zodResolver(BenefitValueForm),
    defaultValues: formOf(item),
  });
  // «Виды деятельности (ГКЭД)» и «Предупреждать при ГКЭД» статуса (задача 2.38).
  const gked = useGkedRuleDraft(item?.data.gked, { warn: 'status' });
  const [gkedError, setGkedError] = useState<GkedFieldError>();
  const types = useQuery(reportTypeOptionsQuery);
  const offices = useQuery(officesQuery);
  const typeOf = new Map((types.data ?? []).map((x) => [x.code, x]));
  const before = current?.data;

  // «Меняет сроки» изменён у созданного статуса: сколько несданных отчётов получат новые сроки —
  // сервер считает по правке тем же кодом, что пересчёт после сохранения.
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-17
  const v = useWatch({ control });
  const rulesChanged =
    current !== null &&
    JSON.stringify(v.dueRules ?? []) !== JSON.stringify(formOf(current).dueRules);
  const parsed = rulesChanged ? BenefitValueForm.safeParse(v) : null;
  const dues = useDuesPreview(
    `benefits:${current?.code ?? ''}`,
    current && parsed?.success ? { ...parsed.data, version: current.version } : null,
    (json, signal) =>
      pd[':dict'][':code']['dues-preview'].$post(
        { param: { dict: 'benefits', code: current!.code }, json },
        { init: { signal } },
      ),
    v.dueRules ?? [],
  );

  const reload = async () => {
    if (!item) return;
    setReloading(true);
    const fresh = await fetchAdminDictValue('benefits', item.code).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setCurrent(fresh);
    reset(formOf(fresh));
    gked.reset(fresh.data.gked);
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      if (current && !isDirty && !gked.dirty) return onClose();
      const json = gked.dirty ? { ...values, gked: gked.value() } : values;
      setGkedError(undefined);
      const res = await callApi(() =>
        current
          ? pd[':dict'][':code'].$put({
              param: { dict: 'benefits', code: current.code },
              json: { ...json, version: current.version },
            })
          : pd[':dict'].$post({ param: { dict: 'benefits' }, json }),
      );
      if (res.ok) {
        onDone();
        onClose();
        return toast(t('pdicts.toast.saved'), { icon: 'check' });
      }
      const code = res.error.code;
      if (code === 'record_changed') return setChanged(true);
      if (code === 'gked_unknown') {
        return setGkedError(gkedFieldError(res.error, errorText(res.error)));
      }
      const field = (res.error.details as { field?: string } | undefined)?.field ?? '';
      const target: [Path<BenefitValueFormInput>, UiTextKey] | undefined =
        code === 'invalid_link' && LINK_TEXT[field]
          ? [field as Path<BenefitValueFormInput>, LINK_TEXT[field]]
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

  const textarea = (
    name: 'gives' | 'conditions' | 'confirmation',
    label: string,
    hint?: string,
    required = false,
  ) => (
    <Field
      id={`${id}-${name}`}
      label={label}
      hint={hint}
      required={required}
      error={fieldError(t, errors[name])}
      full
    >
      {(c) => (
        <textarea
          {...c}
          {...register(name)}
          className={`${inputClass({ multiline: true })} ${name === 'confirmation' ? 'min-h-[44px]' : 'min-h-[52px]'}`}
        />
      )}
    </Field>
  );
  const input = (
    name: 'article' | 'combines' | 'term' | 'verifyNote',
    label: string,
    full = true,
    placeholder?: string,
  ) => (
    <Field id={`${id}-${name}`} label={label} error={fieldError(t, errors[name])} full={full}>
      {(c) => (
        <input
          {...c}
          {...register(name)}
          {...(placeholder ? { placeholder } : {})}
          className={inputClass()}
        />
      )}
    </Field>
  );

  /** Виды отчётов для «Делает ненужными» и «Добавляет»: действующие, кроме внутренних, и уже выбранные. */
  const typeChips = (name: 'removes' | 'adds', label: string) => {
    const was = before?.[name] ?? [];
    return (
      <Field
        id={`${id}-${name}`}
        label={label}
        error={fieldError(t, errors[name] as FieldError | undefined)}
        full
      >
        {(c) => (
          <Controller
            control={control}
            name={name}
            render={({ field }) => {
              const value = field.value ?? [];
              const options = (types.data ?? [])
                .filter(
                  (x) =>
                    (x.active && x.kind !== 'internal') ||
                    was.includes(x.code) ||
                    value.includes(x.code),
                )
                .map((x) => ({ value: x.code, label: x.shortName || x.name, title: x.name }));
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

  const select = (
    key: 'type' | 'due' | 'pay' | 'after',
    label: string,
    options: readonly (readonly [string, string])[],
  ) => (
    <select
      aria-label={label}
      value={draft[key]}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      className={`${inputClass({ full: false })} cursor-pointer`}
    >
      {options.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );

  const dueRules = (
    <Field
      id={`${id}-dueRules`}
      label={t('pdicts.benefit.due')}
      hint={t('pdicts.benefit.due_hint')}
      error={fieldError(t, errors.dueRules as FieldError | undefined)}
      full
    >
      {(c) => (
        <Controller
          control={control}
          name="dueRules"
          render={({ field }) => {
            const rules: BenefitDueRule[] = field.value ?? [];
            const has = new Set(rules.map((r) => r.reportType));
            const choices = (types.data ?? []).filter(
              (x) =>
                x.active &&
                !x.oneOff &&
                !x.periodPerAssignment &&
                x.kind !== 'internal' &&
                !has.has(x.code),
            );
            const add = () => {
              const due = dayOf(draft.due);
              const pay = dayOf(draft.pay);
              if (!draft.type || (due === null && pay === null)) {
                return toast(t('pdicts.err.due_need'), { bad: true });
              }
              const after = Number(draft.after);
              field.onChange([
                ...rules,
                {
                  reportType: draft.type,
                  dueDay: due,
                  dueAfter: due === null ? null : after,
                  dueMonth: null,
                  payDay: pay,
                  payAfter: pay === null ? null : after,
                },
              ]);
              setDraft({ type: '', due: '', pay: '', after: '1' });
            };
            return (
              <div id={c.id} className="flex flex-col gap-1.5" data-due-rules="">
                {rules.length ? (
                  rules.map((r) => {
                    const type = typeOf.get(r.reportType);
                    return (
                      <div key={r.reportType} className="flex items-center gap-2" data-due-rule="">
                        <b>{type?.shortName || r.reportType}</b>
                        <span className="min-w-0 grow">
                          {type ? benefitDueRuleText(r, type, t) : ''}
                        </span>
                        <button
                          type="button"
                          className={linkButtonClass()}
                          onClick={() =>
                            field.onChange(rules.filter((x) => x.reportType !== r.reportType))
                          }
                        >
                          {t('pdicts.benefit.due_remove')}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <span className="text-faint">{t('pdicts.benefit.due_none')}</span>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {select('type', t('pdicts.benefit.due_type'), [
                    ['', t('pdicts.benefit.due_type_ph')],
                    ...choices.map((x) => [x.code, x.shortName || x.name] as const),
                  ])}
                  {select('due', t('pdicts.benefit.due_day'), [
                    ['', t('pdicts.benefit.due_day.catalog')],
                    ...DAYS.map((n) => [String(n), t('pdicts.benefit.due_day.n', { n })] as const),
                    ['last', t('pdicts.benefit.due_day.last')],
                  ])}
                  {select('pay', t('pdicts.benefit.pay_day'), [
                    ['', t('pdicts.benefit.pay_day.catalog')],
                    ...DAYS.map((n) => [String(n), t('pdicts.benefit.pay_day.n', { n })] as const),
                    ['last', t('pdicts.benefit.pay_day.last')],
                  ])}
                  {select(
                    'after',
                    t('pdicts.benefit.due_after'),
                    AFTER.map((n) => [String(n), t(`pdicts.benefit.due_after.${n}`)] as const),
                  )}
                  <button type="button" className={buttonClass('default', 'sm')} onClick={add}>
                    <Icon name="plus" size="sm" />
                    {t('pdicts.benefit.due_add')}
                  </button>
                </div>
              </div>
            );
          }}
        />
      )}
    </Field>
  );

  // «Ставится по УГНС»: действующие управления и уже выбранные (прототип benefitDlg).
  const wasOffices = before?.offices ?? [];
  const officeChips = (offices.data ?? [])
    .filter((x) => x.active || wasOffices.includes(x.code))
    .map((x) => ({ value: x.code, label: x.shortName || x.name, title: x.name }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={current ? current.name : t('pdicts.benefit.title_new')}
      sub={t('pdicts.benefit.sub')}
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
          {textarea('gives', t('pdicts.col.gives'), t('pdicts.benefit.gives_hint'), true)}
          <Field id={`${id}-payer`} label={t('pdicts.benefit.payer')}>
            {(c) => (
              <select {...c} {...register('payer')} className={`${inputClass()} cursor-pointer`}>
                {PAYERS.map((x) => (
                  <option key={x} value={x}>
                    {t(`pdicts.benefit.payer.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {input('article', t('pdicts.col.article'), false)}
          <Field
            id={`${id}-kind`}
            label={t('pdicts.col.kind')}
            hint={t('pdicts.benefit.kind_hint')}
            full
          >
            {(c) => (
              <select {...c} {...register('kind')} className={`${inputClass()} cursor-pointer`}>
                {BENEFIT_KINDS.map((x) => (
                  <option key={x} value={x}>
                    {t(`pdicts.benefit.kind.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {textarea(
            'conditions',
            t('pdicts.benefit.conditions'),
            t('pdicts.benefit.conditions_hint'),
          )}
          {textarea('confirmation', t('pdicts.benefit.confirmation'))}
          {input('combines', t('pdicts.col.combines'))}
          {input('term', t('pdicts.benefit.term'), false, t('pdicts.benefit.term_ph'))}
          <Field
            id={`${id}-validUntil`}
            label={t('pdicts.col.until')}
            hint={t('pdicts.benefit.until_hint')}
            error={fieldError(t, errors.validUntil)}
          >
            {(c) => (
              <input {...c} {...register('validUntil')} type="date" className={inputClass()} />
            )}
          </Field>
          {typeChips('removes', t('pdicts.benefit.removes'))}
          {typeChips('adds', t('pdicts.benefit.adds'))}
          {dueRules}
          {rulesChanged ? (
            <div data-full="" className="col-span-full">
              <Note tone="warn">
                {parsed?.success
                  ? duesNote(t, dues, 'pdicts.benefit.dues')
                  : t('pdicts.dues.later')}
              </Note>
            </div>
          ) : null}
          <Field
            id={`${id}-offices`}
            label={t('pdicts.benefit.offices')}
            hint={t('pdicts.benefit.offices_hint')}
            error={fieldError(t, errors.offices as FieldError | undefined)}
            full
          >
            {(c) => (
              <Controller
                control={control}
                name="offices"
                render={({ field }) => (
                  <ChipMultiSelect
                    id={c.id}
                    label={t('pdicts.benefit.offices')}
                    options={officeChips}
                    value={field.value ?? []}
                    onChange={field.onChange}
                    {...(c['aria-describedby'] ? { describedBy: c['aria-describedby'] } : {})}
                  />
                )}
              />
            )}
          </Field>
          <GkedRuleFields id={id} state={gked} error={gkedError} />
          <div className="col-span-full">
            <Controller
              control={control}
              name="verify"
              render={({ field }) => (
                <CheckRow
                  checked={field.value === true}
                  onChange={field.onChange}
                  label={t('pdicts.benefit.verify')}
                  plain
                >
                  <Hint>{t('pdicts.benefit.verify_hint')}</Hint>
                </CheckRow>
              )}
            />
          </div>
          {input('verifyNote', t('pdicts.benefit.verify_note'))}
        </FormGrid>
      </form>
    </Modal>
  );
}
