'use client';

import { BROADCAST_TEXT_MAX, pluralForm } from '@buhuchet/domain';
import { AdminTelegramBroadcastResult, AdminTelegramOrgs } from '@buhuchet/shared';
import { Box, buttonClass, Field, Hint, Icon, inputClass, useToast } from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';

const orgsQuery = queryOptions({
  queryKey: ['admin', 'tg-orgs'],
  queryFn: async () => {
    const res = await api.api.admin.telegram.orgs.$get();
    if (!res.ok) throw await apiFailure(res);
    return AdminTelegramOrgs.parse(await res.json());
  },
});

/** Ошибка текста объявления до запроса: пусто — «Введите текст» (прототип), длиннее предела Telegram. */
export function castTextError(t: Translate, text: string): string | undefined {
  const value = text.trim();
  if (!value) return t('tgadm.cast.err.text_required');
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-31 — предел длины сообщения Telegram.
  if (value.length > BROADCAST_TEXT_MAX) return t('tgadm.cast.err.text_too_long');
  return undefined;
}

/**
 * Админка → «Телеграм» → «Рассылка» (ТЗ: «Рассылка объявлений всем пользователям или одной
 * организации»; прототип admin/telegram.js, tab 'cast'): «Кому» — всем или одной действующей
 * организации, «Текст объявления», «Поставить в очередь» — сообщение каждому сотруднику с привязанным
 * Telegram; уведомление «В очереди: N сообщений», поле очищается.
 */
export function TgAdmCast({ focusKey }: { focusKey?: number }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const orgs = useQuery(orgsQuery);
  const [to, setTo] = useState('all');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState<number | undefined>(undefined);
  // «+ Добавить» → «Объявление» на этой вкладке — курсор в текст.
  if (focusKey !== undefined && focused !== focusKey) {
    setFocused(focusKey);
    queueMicrotask(() => textRef.current?.focus());
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const bad = castTextError(t, text);
    setError(bad);
    if (bad) return textRef.current?.focus();
    setSending(true);
    const res = await callApi(() =>
      api.api.admin.telegram.broadcast.$post({
        json: { org: to === 'all' ? null : to, text },
      }),
    );
    setSending(false);
    if (!res.ok) {
      if (res.error.code === 'broadcast_org') {
        setTo('all');
        void client.invalidateQueries({ queryKey: orgsQuery.queryKey });
      }
      return toast(errorText(res.error), { bad: true });
    }
    const body = AdminTelegramBroadcastResult.safeParse(res.data);
    const n = body.success ? body.data.queued : 0;
    setText('');
    void client.invalidateQueries({ queryKey: ['list', 'tg.log'] });
    void client.invalidateQueries({ queryKey: ['admin', 'tg-summary'] });
    toast(t(`tgadm.cast.done.${pluralForm(n)}`, { n }), { icon: 'tg' });
  };

  return (
    <div className="max-w-[720px]">
      <Box>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-2.5">
          <Field id={`${id}-to`} label={t('tgadm.cast.to')}>
            {(control) => (
              <select
                {...control}
                data-tg-cast-to=""
                className={`${inputClass()} cursor-pointer`}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="all">{t('tgadm.cast.all')}</option>
                {(orgs.data?.items ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${id}-text`} label={t('tgadm.cast.text')} required error={error}>
            {(control) => (
              <textarea
                {...control}
                ref={textRef}
                data-tg-cast-text=""
                className={`${inputClass({ multiline: true })} min-h-[120px]`}
                placeholder={t('tgadm.cast.placeholder')}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(undefined);
                }}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Hint>{t('tgadm.cast.hint')}</Hint>
            <div className="grow" />
            <button type="submit" className={buttonClass('cta')} disabled={sending}>
              <Icon name="send" size="sm" />
              {t('tgadm.cast.go')}
            </button>
          </div>
        </form>
      </Box>
    </div>
  );
}
