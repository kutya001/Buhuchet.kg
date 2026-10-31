'use client';

import { whatsAppLink, withRequisites } from '@buhuchet/domain';
import type { TaxReminder } from '@buhuchet/shared';
import {
  buttonClass,
  CHECKBOX_CLASS,
  Field,
  Icon,
  inputClass,
  Modal,
  MONO_CLASS,
  Note,
  Tag,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { NewWalletDialog } from '../money/wallets';
import { logTaxReminder, taxReminderQuery } from './finance-data';

/*
 * «Напомнить в WhatsApp» о налоге по отчёту (задача 2.20; прототип ui/status-scale.js — `waDlg({r})`):
 * текст по шаблону waTax справочника платформы, реквизиты — счета организации с назначением «Налоги»
 * или реквизиты ответственного (основной отмечен). «Открыть WhatsApp» открывает сообщение на номер
 * контрагента; нажатие записывает сервер в историю отчёта.
 */

/** Окно «Напомнить в WhatsApp» по отчёту: загружает текст и реквизиты, после нового реквизита — заново. */
export function TaxReminderDialog({
  reportId,
  open,
  onClose,
  onDone,
}: {
  reportId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const client = useQueryClient();
  const query = useQuery(taxReminderQuery(reportId));
  const [wallet, setWallet] = useState(false);
  const failed = query.isError
    ? errorText(
        query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
      )
    : null;
  const holder = query.data?.holder ?? null;
  return (
    <>
      <TaxReminderModal
        key={query.dataUpdatedAt}
        t={t}
        reportId={reportId}
        data={query.data ?? null}
        failed={failed}
        open={open && !wallet}
        onClose={onClose}
        onDone={onDone}
        onAddWallet={() => setWallet(true)}
      />
      {wallet && holder ? (
        <NewWalletDialog
          open
          holderDefault={holder.name}
          onClose={() => {
            setWallet(false);
            void client.invalidateQueries({ queryKey: taxReminderQuery(reportId).queryKey });
          }}
        />
      ) : null}
    </>
  );
}

function TaxReminderModal({
  t,
  reportId,
  data,
  failed,
  open,
  onClose,
  onDone,
  onAddWallet,
}: {
  t: Translate;
  reportId: string;
  data: TaxReminder | null;
  failed: string | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  onAddWallet: () => void;
}) {
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const requisites = data?.requisites ?? [];
  const [on, setOn] = useState<ReadonlySet<string>>(
    () => new Set(requisites.filter((r) => r.main).map((r) => r.id)),
  );
  const build = (picked: ReadonlySet<string>) =>
    data
      ? withRequisites(
          data.base,
          requisites.filter((r) => picked.has(r.id)).map((r) => r.text),
        )
      : '';
  const [text, setText] = useState(() => build(on));
  const noPhone = !!data && !data.phone;
  const noReq = !!data && requisites.length === 0;
  const off = !data || noPhone || noReq;
  const toggle = (rid: string, checked: boolean) => {
    const next = new Set(on);
    if (checked) next.add(rid);
    else next.delete(rid);
    setOn(next);
    setText(build(next));
  };
  const holder = data?.holder ?? null;
  const footer = (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <a
        className={`${buttonClass('cta')} ${off ? 'pointer-events-none opacity-50' : ''}`}
        href={off || !data.phone ? undefined : whatsAppLink(data.phone, text)}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={off ? true : undefined}
        data-tax-wa-go=""
        onClick={() => {
          if (off) return;
          void logTaxReminder(reportId).then((res) => {
            onDone();
            if (!res.ok) return toast(errorText(res.error), { bad: true });
            toast(t('fee.wa.logged'), { icon: 'chat' });
          });
          onClose();
        }}
      >
        <Icon name="chat" size="sm" />
        {t('fee.wa.open')}
      </a>
    </>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('fee.wa.title')}
      sub={data ? `${data.contractor.name} · ${data.phoneText || '—'}` : ''}
      footer={footer}
    >
      <div className="flex flex-col gap-3" data-tax-wa-dialog={reportId}>
        {failed && !data ? <Note tone="bad">{failed}</Note> : null}
        {noPhone ? <Note tone="bad">{t('fee.wa.no_phone')}</Note> : null}
        {noReq ? (
          <Note tone="warn">
            <span className="flex flex-wrap items-center gap-2">
              <span className="flex-1">
                {holder
                  ? t('fin.wa.no_req_holder', { name: holder.name })
                  : t('fin.wa.no_req_none')}
              </span>
              {holder?.self ? (
                <button
                  type="button"
                  className={buttonClass('default', 'sm')}
                  onClick={onAddWallet}
                  data-tax-wa-add=""
                >
                  {t('fin.wa.add_req')}
                </button>
              ) : null}
            </span>
          </Note>
        ) : null}
        {data && requisites.length ? (
          <section
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-pane-alt px-4 py-3"
            data-tax-wa-requisites=""
          >
            <h3 className="m-0 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">
              {data.to === 'org'
                ? t('fin.wa.where_org')
                : t('fin.wa.where_emp', { name: holder?.name ?? '—' })}
            </h3>
            {requisites.map((r) => (
              <label key={r.id} className="flex flex-wrap items-center gap-1.5">
                <input
                  type="checkbox"
                  className={CHECKBOX_CLASS}
                  checked={on.has(r.id)}
                  onChange={(e) => toggle(r.id, e.target.checked)}
                  data-tax-wa-requisite={r.id}
                />
                {r.phone ? (
                  <>
                    <Icon name="phone" size="sm" />
                    <span>{t('fee.wa.by_phone')}</span>
                  </>
                ) : null}
                <b>{r.bank}</b>
                <span className={MONO_CLASS}>{r.number}</span>
                {r.holder ? <span className="text-muted">{r.holder}</span> : null}
                {r.main ? <Tag>{t('fin.wa.main')}</Tag> : null}
              </label>
            ))}
          </section>
        ) : null}
        {data ? (
          <Field id={`${id}-text`} label={t('fee.wa.text')} hint={t('fee.wa.text_hint')} full>
            {(control) => (
              <textarea
                {...control}
                data-tax-wa-text=""
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={`${inputClass({ multiline: true })} min-h-[150px]`}
              />
            )}
          </Field>
        ) : null}
        {data ? <Note>{t('fee.wa.note', { phone: data.phoneText || '—' })}</Note> : null}
      </div>
    </Modal>
  );
}
