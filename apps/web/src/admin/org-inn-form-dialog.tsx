'use client';

import { isValidOrgInn, ORG_LEGAL_FORMS, type OrgLegalForm } from '@buhuchet/domain';
import { AdminOrgCard, OrgInnFormSaved, type AdminOrganization } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  Modal,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';

/*
 * «ИНН и форма организации» (доработки 14.11.2026, блок 1, пункт 4; прототип v114 modules/lead-docs.js —
 * ldInnFormDlg): меняет только администратор платформы, владелец организации эти поля не меняет. Без
 * изменений — «Изменений нет» без записи; иначе — запись в историю организации и «Сохранено». ИНН
 * другой организации — «Организация с таким ИНН уже есть» под полем.
 */

/** Что окно знает об организации: из строки списка или карточки. */
export interface OrgInnFormData {
  id: string;
  name: string;
  inn: string | null;
  legalForm: OrgLegalForm | null;
  version: number;
}

export const innFormDataOf = (o: AdminOrganization): OrgInnFormData => ({
  id: o.id,
  name: o.name,
  inn: o.inn,
  legalForm: o.legalForm,
  version: o.version,
});

export function OrgInnFormDialog({
  org,
  open,
  onClose,
  onDone,
}: {
  org: OrgInnFormData;
  open: boolean;
  onClose: () => void;
  /** Сохранено: перечитать список и карточку. */
  onDone: () => void;
}) {
  const t = useT();
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const [base, setBase] = useState(org);
  const [form, setForm] = useState<OrgLegalForm | ''>(org.legalForm ?? '');
  const [inn, setInn] = useState(org.inn ?? '');
  const [errors, setErrors] = useState<{ form?: string | undefined; inn?: string | undefined }>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);

  /** «Перечитать»: свежие ИНН, форма и версия (перечитывание карточки в историю не пишется). */
  const reload = async () => {
    setReloading(true);
    const res = await callApi(() =>
      api.api.admin.organizations[':id'].card.$get({
        param: { id: org.id },
        query: { refresh: '1' },
      }),
    );
    setReloading(false);
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const card = AdminOrgCard.parse(res.data);
    const fresh = {
      id: org.id,
      name: card.org.name,
      inn: card.org.inn,
      legalForm: card.profile.legalForm,
      version: card.org.version,
    };
    setBase(fresh);
    setForm(fresh.legalForm ?? '');
    setInn(fresh.inn ?? '');
    setErrors({});
    setChanged(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = inn.trim();
    const next = {
      ...(form ? {} : { form: t('err.org_form_required') }),
      ...(isValidOrgInn(value) ? {} : { inn: t('err.inn_invalid') }),
    };
    setErrors(next);
    if (next.form || next.inn || !form) return;
    if (value === (base.inn ?? '') && form === base.legalForm) {
      onClose();
      return toast(t('orgs.innform.same'));
    }
    setBusy(true);
    const res = await callApi(() =>
      api.api.admin.organizations[':id']['inn-form'].$put({
        param: { id: org.id },
        json: { inn: value, legalForm: form, version: base.version },
      }),
    );
    setBusy(false);
    if (res.ok) {
      const saved = OrgInnFormSaved.safeParse(res.data);
      onDone();
      onClose();
      return toast(
        t(saved.success && !saved.data.changed ? 'orgs.innform.same' : 'orgs.innform.saved'),
      );
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    if (res.error.code === 'inn_taken' || res.error.code === 'inn_invalid')
      return setErrors({ inn: errorText(res.error) });
    toast(errorText(res.error), { bad: true });
  };

  const formId = `${id}-form`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('orgs.innform.title')}
      sub={base.name}
      dirty={inn.trim() !== (base.inn ?? '') || form !== (base.legalForm ?? '')}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('orgs.innform.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            data-org-innform-ok=""
            className={buttonClass('cta')}
            disabled={busy || changed}
          >
            {t('orgs.innform.ok')}
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
      <form
        id={formId}
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex flex-col gap-3.5"
        data-org-innform={org.id}
      >
        <FormGrid>
          <Field id={`${id}-legal`} label={t('orgs.innform.form')} required error={errors.form}>
            {(control) => (
              <select
                {...control}
                className={inputClass()}
                value={form}
                onChange={(e) => {
                  setForm(e.target.value as OrgLegalForm | '');
                  setErrors((x) => ({ ...x, form: undefined }));
                }}
              >
                <option value="">{t('orgs.innform.form_none')}</option>
                {ORG_LEGAL_FORMS.map((f) => (
                  <option key={f} value={f}>
                    {t(`org.form.${f}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${id}-inn`} label={t('orgs.innform.inn')} required error={errors.inn}>
            {(control) => (
              <input
                {...control}
                type="text"
                className={inputClass({ mono: true })}
                value={inn}
                maxLength={14}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => {
                  setInn(e.target.value);
                  setErrors((x) => ({ ...x, inn: undefined }));
                }}
              />
            )}
          </Field>
        </FormGrid>
      </form>
      <div className="text-[12px] leading-[1.4] text-muted">{t('orgs.innform.hint')}</div>
    </Modal>
  );
}
