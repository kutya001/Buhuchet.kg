'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AdminSystemNameFields } from '@buhuchet/shared';
import { buttonClass, Field, inputClass, Modal, RecordChangedNotice, useToast } from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';

type Saved = { ok: boolean; status: number; json(): Promise<unknown> };

/** Что переименовывают: подписи окна, текущее название с версией и как сохранить. */
export interface NameTarget {
  title: string;
  sub?: string;
  label: string;
  hint?: string;
  name: string;
  version: number;
  save: (name: string, version: number) => Promise<Saved>;
  /** Свежее название и версия — «Перечитать» после «запись изменена другим пользователем». */
  reload: () => Promise<{ name: string; version: number } | null>;
  /** Отказ сервера «такое название уже есть»: код ответа и текст под полем. */
  taken?: { code: string; text: string };
  toast: string;
}

/**
 * Окно «Новое название» вкладок «Работа системы» (прототип renderPDicts: «Название статуса»,
 * «Название периодичности», «Название шаблона роли»): одно обязательное поле. То же название —
 * окно просто закрывается. Пока окно было открыто, название изменил другой администратор — «Запись
 * изменена другим пользователем» и «Перечитать».
 */
export function NameDialog({
  open,
  onClose,
  target,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  target: NameTarget;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [version, setVersion] = useState(target.version);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AdminSystemNameFields>({
    resolver: zodResolver(AdminSystemNameFields),
    defaultValues: { name: target.name },
  });

  const reload = async () => {
    setReloading(true);
    const fresh = await target.reload().catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setVersion(fresh.version);
    reset({ name: fresh.name });
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async ({ name }) => {
      if (!isDirty || name === target.name) return onClose();
      const res = await callApi(() => target.save(name, version));
      if (res.ok) {
        onDone();
        onClose();
        return toast(target.toast, { icon: 'check' });
      }
      if (res.error.code === 'record_changed') return setChanged(true);
      if (res.error.code === target.taken?.code) {
        return setError(
          'name',
          { type: 'server', message: target.taken.text },
          { shouldFocus: true },
        );
      }
      toast(errorText(res.error), { bad: true });
    })(event);
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={target.title}
      sub={target.sub}
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
          id={`${id}-name`}
          label={target.label}
          hint={target.hint}
          required
          error={fieldError(t, errors.name)}
          full
        >
          {(c) => <input {...c} {...register('name')} className={inputClass()} />}
        </Field>
      </form>
    </Modal>
  );
}
