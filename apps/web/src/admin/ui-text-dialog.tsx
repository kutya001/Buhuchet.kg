'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AdminUiText, UiTextForm, type UiTextFormInput } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  inputClass,
  Modal,
  MONO_CLASS,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import { uiTextFieldError } from './l10n-text';

/**
 * «Текст интерфейса» (прототип admin/l10n.js, renderL10n → open): ключ под заголовком, поле «Русский» с
 * подсказкой «Изменение применится без изменения кода». Текст не пустой, подстановки `{имя}` — те же,
 * что были (docs/deviations.md, п. Д-1): ошибка — под полем сразу, без запроса. Тот же текст — окно
 * просто закрывается. Пока окно было открыто, текст изменил другой администратор — «Запись изменена
 * другим пользователем» и «Перечитать».
 */
export function UiTextDialog({
  open,
  onClose,
  item,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  item: AdminUiText;
  onDone: (item: AdminUiText) => void;
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
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UiTextFormInput, unknown, UiTextForm>({
    resolver: zodResolver(UiTextForm),
    defaultValues: { text: item.text },
  });
  const text = register('text');

  const reload = async () => {
    setReloading(true);
    const res = await callApi(() =>
      api.api.admin['ui-texts'][':key'].$get({ param: { key: item.key } }),
    );
    setReloading(false);
    const fresh = res.ok ? AdminUiText.safeParse(res.data) : null;
    if (!fresh?.success) return toast(t('err.unknown'), { bad: true });
    setCurrent(fresh.data);
    reset({ text: fresh.data.text });
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      if (values.text === current.text) return onClose();
      const bad = uiTextFieldError(t, current.text, values.text);
      if (bad) return setError('text', { type: 'server', message: bad }, { shouldFocus: true });
      const res = await callApi(() =>
        api.api.admin['ui-texts'][':key'].$put({
          param: { key: item.key },
          json: { text: values.text, version: current.version },
        }),
      );
      if (res.ok) {
        const body = AdminUiText.safeParse(res.data);
        if (body.success) onDone(body.data);
        onClose();
        return toast(t('locale.saved'), { icon: 'check' });
      }
      const code = res.error.code;
      if (code === 'record_changed') return setChanged(true);
      const message = errorText(res.error);
      if (code === 'ui_text_placeholders')
        return setError('text', { type: 'server', message }, { shouldFocus: true });
      toast(message, { bad: true });
    })(event);
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('locale.edit.title')}
      sub={<span className={MONO_CLASS}>{item.key}</span>}
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
        <Field
          id={`${id}-text`}
          label={t('locale.edit.field')}
          hint={t('locale.edit.hint')}
          error={fieldError(t, errors.text)}
        >
          {(control) => (
            <textarea
              {...control}
              {...text}
              className={`${inputClass({ multiline: true })} min-h-[70px]`}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
