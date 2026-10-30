'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { GKED_LEVEL_ORDER, gkedLevelKey, pluralForm, type GkedLevel } from '@buhuchet/domain';
import {
  gkedValueForm,
  type AdminDictValueBody,
  type AdminGkedItem,
  type GkedValueFormInput,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  Field,
  FormGrid,
  Hint,
  inputClass,
  Modal,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { Controller, useForm, useWatch, type Path } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { fetchAdminDictValue } from './pdicts-data';

const pd = api.api.admin['platform-dicts'];

/** Код ГКЭД для окна и действий: из дерева (`AdminGkedItem`) или строки списка. */
export type GkedItem = AdminGkedItem;

/** «у 3 контрагентов и в 2 перечнях справочников» (прототип gkUsedTxt); нигде — пусто. */
export function gkedUsedText(t: Translate, x: Pick<GkedItem, 'used' | 'contractors'>): string {
  const rules = x.used - x.contractors;
  const parts = [
    x.contractors
      ? t(`pdicts.gked.used_cps.${pluralForm(x.contractors)}`, { n: x.contractors })
      : '',
    rules ? t(`pdicts.gked.used_rules.${pluralForm(rules)}`, { n: rules }) : '',
  ].filter(Boolean);
  return parts.length === 2
    ? t('pdicts.gked.used_and', { a: parts[0]!, b: parts[1]! })
    : (parts[0] ?? '');
}

const formOf = (x: GkedItem | null): GkedValueFormInput => ({
  code: x?.code ?? '',
  name: x?.name ?? '',
  level: x?.level ?? 'subclass',
  parentCode: x?.parentCode ?? '',
  note: x?.note ?? '',
  active: x?.active ?? true,
});

/** Отказ сервера под полем: код, «Входит в». */
const FIELD_OF: Readonly<Record<string, Path<GkedValueFormInput>>> = {
  gked_code_required: 'code',
  gked_code_format: 'code',
  gked_code_taken: 'code',
  gked_parent_section: 'parentCode',
  gked_parent_required: 'parentCode',
  gked_parent_unknown: 'parentCode',
  gked_parent_self: 'parentCode',
  gked_parent_level: 'parentCode',
};

/**
 * Окно кода ГКЭД (задача 2.38; прототип admin/gked-admin.js gkEditDlg): код — только у нового, в
 * формате классификатора; уровень, название, «Входит в» (обязательно, кроме секции; уровень выше),
 * «Действует» и примечание. У созданного — где используется и сколько вложенных кодов. Проверки «Входит
 * в» делает сервер — ответ под полем.
 */
export function GkedDialog({
  open,
  onClose,
  item,
  names,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  item: GkedItem | null;
  /** Названия кодов — подсказка под «Входит в». */
  names: ReadonlyMap<string, string>;
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
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<GkedValueFormInput, unknown, AdminDictValueBody>({
    resolver: zodResolver(gkedValueForm(!item)),
    defaultValues: formOf(item),
  });
  const parent = (useWatch({ control, name: 'parentCode' }) ?? '').trim().toUpperCase();

  const reload = async () => {
    if (!item) return;
    setReloading(true);
    const fresh = await fetchAdminDictValue('gked', item.code).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    const next: GkedItem = {
      code: fresh.code,
      name: fresh.name,
      level: (fresh.data.level ?? 'subclass') as GkedLevel,
      parentCode: fresh.data.parentCode ?? null,
      note: fresh.data.note ?? '',
      active: fresh.active,
      used: fresh.used,
      contractors: fresh.contractors,
      children: fresh.children ?? 0,
      version: fresh.version,
    };
    setCurrent(next);
    reset(formOf(next));
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      if (current && !isDirty) return onClose();
      const body = { ...values, parentCode: values.parentCode || null };
      const res = await callApi(() =>
        current
          ? pd[':dict'][':code'].$put({
              param: { dict: 'gked', code: current.code },
              json: { ...body, code: undefined, version: current.version },
            })
          : pd[':dict'].$post({ param: { dict: 'gked' }, json: body }),
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
        return setError(
          field,
          { type: 'server', message: errorText(res.error) },
          { shouldFocus: true },
        );
      }
      toast(errorText(res.error), { bad: true });
    })(event);
  const formId = `${id}-form`;
  // Ошибка сервера уже текстом, ошибка схемы — ключ словаря.
  const errorOf = (name: 'code' | 'parentCode' | 'name') =>
    errors[name]?.type === 'server' ? errors[name]?.message : fieldError(t, errors[name]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={
        current
          ? t('pdicts.gked.dlg.title', { code: current.code, name: current.name })
          : t('pdicts.gked.dlg.new')
      }
      sub={t('pdicts.gked.dlg.sub')}
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
            id={`${id}-code`}
            label={t('pdicts.gked.dlg.code')}
            required
            hint={t(current ? 'pdicts.gked.dlg.code_hint' : 'pdicts.gked.dlg.code_hint_new')}
            error={errorOf('code')}
          >
            {(c) =>
              current ? (
                <span id={c.id} className="font-mono">
                  {current.code}
                </span>
              ) : (
                <input
                  {...c}
                  {...register('code')}
                  placeholder="69.20.0"
                  className={inputClass({ mono: true })}
                />
              )
            }
          </Field>
          <Field id={`${id}-level`} label={t('pdicts.gked.dlg.level')}>
            {(c) => (
              <select {...c} {...register('level')} className={`${inputClass()} cursor-pointer`}>
                {GKED_LEVEL_ORDER.map((l) => (
                  <option key={l} value={l}>
                    {t(gkedLevelKey(l))}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-name`}
            label={t('pdicts.gked.dlg.name')}
            required
            error={errorOf('name')}
            full
          >
            {(c) => (
              <textarea
                {...c}
                {...register('name')}
                className={`${inputClass({ multiline: true })} min-h-[56px]`}
              />
            )}
          </Field>
          <Field
            id={`${id}-parentCode`}
            label={t('pdicts.gked.dlg.parent')}
            hint={
              names.get(parent)
                ? `${parent} — ${names.get(parent)}`
                : t('pdicts.gked.dlg.parent_hint')
            }
            error={errorOf('parentCode')}
          >
            {(c) => (
              <input {...c} {...register('parentCode')} className={inputClass({ mono: true })} />
            )}
          </Field>
          <Field id={`${id}-active`} label={t('pdicts.gked.dlg.active')}>
            {() => (
              <Controller
                control={control}
                name="active"
                render={({ field }) => (
                  <CheckRow
                    checked={field.value !== false}
                    onChange={field.onChange}
                    label={t('pdicts.gked.dlg.active_hint')}
                    plain
                    compact
                  />
                )}
              />
            )}
          </Field>
          <Field id={`${id}-note`} label={t('pdicts.gked.dlg.note')} full>
            {(c) => (
              <textarea
                {...c}
                {...register('note')}
                placeholder={t('pdicts.gked.dlg.note_ph')}
                className={`${inputClass({ multiline: true })} min-h-[56px]`}
              />
            )}
          </Field>
          {current ? (
            <div className="col-span-full">
              <Hint>
                {t('pdicts.gked.dlg.used', {
                  used: gkedUsedText(t, current) || t('pdicts.gked.dlg.used_none'),
                  kids: current.children,
                })}
              </Hint>
            </div>
          ) : null}
        </FormGrid>
      </form>
    </Modal>
  );
}
