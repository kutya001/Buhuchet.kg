'use client';

import { formatSomWithUnit } from '@buhuchet/domain';
import { ContractorFeeTelegram, ContractorFeeTelegramSent } from '@buhuchet/shared';
import { buttonClass, Field, Icon, inputClass, Modal, Note, Pill, useToast } from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, ApiFailure, apiFailure, callApi } from '../api-client';
import { refreshContractorHistory } from '../contractors/contractor-data';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useFeesRefresh } from '../fees/fees-data';
import { useErrorText, useT } from '../l10n/provider';

/*
 * «Напомнить в Telegram» об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5; прототип v110
 * modules/cp-telegram.js: `pgFeeTgBtn`, `pgFeeTgDlg`): кнопка вкладки «Обслуживание» рядом с «Напомнить
 * в WhatsApp» и окно — получатели, текст по шаблону (его можно поправить), реквизиты для обслуживания в
 * конце сообщения. Есть ли кнопка и что мешает — решает сервер; отказ — по нажатию сообщением.
 */

/** Кнопка и окно (ключ — под `fees`: перечитывается вместе с вкладкой после оплаты и ставки). */
export const feeTelegramQuery = (id: string) =>
  queryOptions({
    queryKey: ['fees', 'telegram', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id']['fee-telegram'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return ContractorFeeTelegram.parse(await res.json());
    },
  });

type FeeTelegramDialogData = NonNullable<ContractorFeeTelegram['dialog']>;

/** Кнопка «Напомнить в Telegram»: нет кнопки — `null`; заперта — по нажатию причина. */
export function FeeTelegramButton({
  contractorId,
  iconOnPhone,
}: {
  contractorId: string;
  iconOnPhone: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const query = useQuery(feeTelegramQuery(contractorId));
  const [slot, setSlot] = useState<DialogSlot<FeeTelegramDialogData> | null>(null);
  const data = query.data;
  if (!data?.shown) return null;
  const why = data.refusal ? t(`err.${data.refusal}`, data.params ?? undefined) : null;
  const open = async () => {
    if (why) {
      toast(why, { icon: 'lock', bad: true });
      return;
    }
    // Окно — по свежим данным: долг, получатели и «сегодня уже напоминали» могли измениться.
    let fresh: ContractorFeeTelegram;
    try {
      fresh = await client.fetchQuery({ ...feeTelegramQuery(contractorId), staleTime: 0 });
    } catch (e) {
      toast(errorText(e instanceof ApiFailure ? e.error : { code: 'unknown', message: '' }), {
        bad: true,
      });
      return;
    }
    if (!fresh.shown) return;
    if (fresh.refusal) {
      toast(t(`err.${fresh.refusal}`, fresh.params ?? undefined), { icon: 'lock', bad: true });
      return;
    }
    if (fresh.dialog) setSlot(openSlot(fresh.dialog));
  };
  const label = t('cppage.fee_tg.btn');
  return (
    <>
      <button
        type="button"
        data-fee-telegram=""
        aria-disabled={why ? true : undefined}
        title={why ?? label}
        aria-label={label}
        className={`${buttonClass('default', 'sm')} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:shadow-none ${iconOnPhone ? 'max-md:px-2.5' : ''}`}
        onClick={() => void open()}
      >
        <Icon name="tg" size="sm" />
        <span className={iconOnPhone ? 'max-md:hidden' : undefined}>{label}</span>
      </button>
      {slot ? (
        <FeeTelegramDialog
          key={`fee-tg-${slot.n}`}
          contractorId={contractorId}
          data={slot.data}
          open={slot.open}
          onClose={() => setSlot(closeSlot)}
        />
      ) : null}
    </>
  );
}

const Title = ({ children }: { children: string }) => (
  <h3 className="m-0 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">{children}</h3>
);

const Hint = ({ children }: { children: string }) => (
  <span className="block text-[11.5px] leading-[1.4] text-faint">{children}</span>
);

/** Окно «Напомнить в Telegram» (прототип `pgFeeTgDlg`). */
function FeeTelegramDialog({
  contractorId,
  data,
  open,
  onClose,
}: {
  contractorId: string;
  data: FeeTelegramDialogData;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useFeesRefresh();
  const id = useId();
  const [text, setText] = useState(data.text);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const value = text.trim();
    if (!value) return setError(t('cppage.fee_tg.text_required'));
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors[':id']['fee-telegram'].$post({
        param: { id: contractorId },
        json: { text: value },
      }),
    );
    setBusy(false);
    refresh();
    if (!res.ok) {
      if (res.error.code === 'validation_failed') return setError(errorText(res.error));
      // Отказ или сбой отправки — сообщением, окно с поправленным текстом остаётся открытым (прототип
      // pgFeeTgDlg: toast и return): после сбоя Telegram можно сразу отправить снова.
      toast(errorText(res.error), { icon: 'lock', bad: true });
      return;
    }
    const done = ContractorFeeTelegramSent.safeParse(res.data);
    onClose();
    toast(t('cppage.fee_tg.sent', { n: done.success ? done.data.delivered : 0 }), { icon: 'tg' });
    void refreshContractorHistory(client, contractorId);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={text !== data.text}
      size="mid"
      title={t('cppage.fee_tg.title')}
      sub={t('cppage.fee_tg.sub', {
        contractor: data.contractor,
        debt: formatSomWithUnit(data.debt),
      })}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-fee-telegram-send=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void send()}
          >
            <Icon name="send" size="sm" />
            {t('cppage.fee_tg.send')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-fee-telegram-dialog={contractorId}>
        <section
          className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-pane-alt px-4 py-3"
          data-fee-telegram-to=""
        >
          <Title>{t('cppage.fee_tg.recipients', { n: data.recipients.length })}</Title>
          <div className="flex flex-wrap gap-1.5">
            {data.recipients.map((name, i) => (
              <Pill key={`${i}-${name}`} tone="info" size="sm" icon="tg">
                {name}
              </Pill>
            ))}
          </div>
          {data.off ? <Hint>{t('cppage.fee_tg.off', { n: data.off })}</Hint> : null}
        </section>
        <Field
          id={`${id}-text`}
          label={t('cppage.fee_tg.text')}
          hint={t('cppage.fee_tg.text_hint')}
          error={error}
          full
        >
          {(control) => (
            <textarea
              {...control}
              data-fee-telegram-text=""
              maxLength={1000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(undefined);
              }}
              className={`${inputClass({ multiline: true })} min-h-[110px]`}
            />
          )}
        </Field>
        <section
          className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-pane-alt px-4 py-3"
          data-fee-telegram-requisite=""
        >
          <Title>{t('cppage.fee_tg.req')}</Title>
          <div className="whitespace-pre-wrap">{data.requisite}</div>
          <Hint>
            {data.copy
              ? t('cppage.fee_tg.req_btns', { copy: data.copy, paid: data.paid })
              : t('cppage.fee_tg.req_btn', { paid: data.paid })}
          </Hint>
        </section>
        <Note>{t('cppage.fee_tg.note')}</Note>
      </div>
    </Modal>
  );
}
