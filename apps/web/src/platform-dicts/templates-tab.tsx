'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { messageTemplateLabelKey, type UiTextKey } from '@buhuchet/domain';
import { AdminMessageTemplatesFields, type AdminMessageTemplate } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Field,
  inputClass,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { DictHistory } from './dict-history-box';
import { pdictsTemplatesQuery, usePdictsRefresh } from './pdicts-data';

const templates = api.api.admin['platform-dicts'].templates;

const formOf = (items: readonly AdminMessageTemplate[]): AdminMessageTemplatesFields => ({
  items: items.map((x) => ({ key: x.key, text: x.text })),
});

/** Подсказка под шаблоном: пояснение и «Подстановки: {контрагент}, {сумма}» (прототип TPL_NOTES). */
function templateHint(t: Translate, x: AdminMessageTemplate): string {
  const vars = t('pdicts.tpl.vars', { list: x.variables.map((v) => `{${v}}`).join(', ') });
  return x.note ? `${x.note}. ${vars}` : vars;
}

/**
 * Админка → «Справочники платформы» → «Шаблоны» (ТЗ «Шаблоны для организаций»; прототип renderPDicts,
 * вкладка templates): тексты сообщений WhatsApp и Telegram, под каждым — какие подстановки в нём
 * доступны. «Сохранить шаблоны» сохраняет все изменённые тексты сразу; подстановку, которой у шаблона
 * нет, и пустой текст сервер не примет — ошибка под полем.
 */
export function TemplatesTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = usePdictsRefresh();
  const id = useId();
  const data = useQuery(pdictsTemplatesQuery);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const items = data.data ?? [];
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AdminMessageTemplatesFields>({
    resolver: zodResolver(AdminMessageTemplatesFields),
    defaultValues: { items: [] },
  });

  // Тексты пришли или перечитаны — в поля.
  useEffect(() => {
    if (data.data) reset(formOf(data.data));
  }, [data.data, reset]);

  const reload = async () => {
    setReloading(true);
    await client.refetchQueries({ queryKey: pdictsTemplatesQuery.queryKey });
    setReloading(false);
    setChanged(false);
  };

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      const res = await callApi(() =>
        templates.$put({
          json: {
            items: values.items.map((v, i) => ({ ...v, version: items[i]?.version ?? 1 })),
          },
        }),
      );
      if (res.ok) {
        refresh('templates');
        return toast(t('pdicts.tpl.toast'), { icon: 'check' });
      }
      const { code } = res.error;
      if (code === 'record_changed') return setChanged(true);
      const details = (res.error.details ?? {}) as Record<string, unknown>;
      const i = items.findIndex((x) => x.key === details.field);
      if (code === 'unknown_vars' && i >= 0) {
        const message = t('pdicts.err.unknown_vars', {
          list: String(details.list ?? ''),
          known: String(details.known ?? ''),
        });
        return setError(`items.${i}.text`, { type: 'server', message }, { shouldFocus: true });
      }
      toast(errorText(res.error), { bad: true });
    })(event);

  return (
    <div className="flex flex-col gap-3.5">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <Note icon="info">{t('pdicts.note.templates')}</Note>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={() => void reload()}
            reloading={reloading}
          />
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))] items-start gap-3">
          {items.map((x, i) => (
            <div key={x.key} data-template={x.key} className="contents">
              <Box>
                <Field
                  id={`${id}-${x.key}`}
                  label={t(messageTemplateLabelKey(x.key) as UiTextKey)}
                  hint={templateHint(t, x)}
                  error={fieldError(t, errors.items?.[i]?.text)}
                  full
                >
                  {(c) => (
                    <textarea
                      {...c}
                      {...register(`items.${i}.text`)}
                      className={`${inputClass({ multiline: true })} ${x.key.startsWith('wa') ? 'min-h-[120px]' : 'min-h-[70px]'}`}
                    />
                  )}
                </Field>
              </Box>
            </div>
          ))}
        </div>
        {items.length ? (
          <div className="flex items-center">
            <div className="flex-1" />
            <button type="submit" className={buttonClass('cta')} disabled={isSubmitting || changed}>
              {t('pdicts.tpl.save')}
            </button>
          </div>
        ) : null}
      </form>
      <DictHistory dict="templates" />
    </div>
  );
}
