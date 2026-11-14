'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  SENT_FILE_COMMENT_MAX,
  sentFilesSendRefusal,
  type SentFileRefusal,
} from '@buhuchet/domain';
import { PageSentTicket, type PageSent } from '@buhuchet/shared';
import { buttonClass, Field, FormGrid, Icon, inputClass, Modal, useToast } from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { callApi } from '../api-client';
import { fileIcon } from '../contractor-page/page-files';
import { PageList } from '../contractor-page/page-parts';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';
import { SentStatusPill } from './sent-files';
import { sentLeftText } from './sent-data';

/*
 * «Отправить файл» и «Отправленные вами» в разделе «Файлы» страницы контрагента (доработки 14.11.2026,
 * блок 2; прототип v112 `pubSentHtml`, `pubUpDlg`). Запросы идут под адресом страницы
 * (`/<организация>/inn/<ИНН>/sent`): только туда браузер отправляет cookie этой ссылки.
 */

type Address = { slug: string; inn: string };

const momentText = (iso: string) => {
  const at = new Date(iso);
  return `${formatDateRu(bishkekDate(at))} ${bishkekTime(at)}`;
};

/** Отказ правила домена — ошибкой, как её вернул бы сервер: текст словаря с подстановками. */
const refusalError = (r: SentFileRefusal): ApiErrorLike => ({
  code: r.code,
  message: '',
  details: {
    ...(r.files ? { files: r.files.join(', ') } : {}),
    ...(r.n !== undefined ? { n: r.n } : {}),
  },
});

/**
 * Отправить выбранные файлы: начать (ссылки на хранилище) → положить каждый файл → закончить. Любой
 * отказ — ошибкой с кодом словаря; ничего не принято, если хоть один файл не такой.
 */
async function sendFiles(
  address: Address,
  files: readonly File[],
  comment: string,
): Promise<ApiErrorLike | null> {
  const base = `/${address.slug}/inn/${address.inn}/sent`;
  const post = (url: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const started = await callApi(() =>
    post(base, { files: files.map((f) => ({ name: f.name, size: f.size })), comment }),
  );
  if (!started.ok) return started.error;
  const { items } = PageSentTicket.parse(started.data);
  for (const [i, item] of items.entries()) {
    try {
      const put = await fetch(item.upload.url, {
        method: item.upload.method,
        headers: item.upload.headers,
        body: files[i],
      });
      if (!put.ok) return { code: 'file_not_uploaded', message: '' };
    } catch {
      return { code: 'network', message: '' };
    }
  }
  const done = await callApi(() => post(`${base}/complete`, { ids: items.map((x) => x.id) }));
  return done.ok ? null : done.error;
}

/** Окно «Отправить файл» (прототип `pubUpDlg`): файлы и необязательный комментарий. */
function SendDialog({
  address,
  open,
  onClose,
  onSent,
}: {
  address: Address;
  open: boolean;
  onClose: () => void;
  onSent: (n: number) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const id = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    // Те же проверки, что у сервера (без суточного предела — его знает только сервер).
    const refusal = sentFilesSendRefusal(files, 0);
    if (refusal) return setError(errorText(refusalError(refusal)));
    setBusy(true);
    const failed = await sendFiles(address, files, note);
    setBusy(false);
    if (failed) return setError(errorText(failed));
    onSent(files.length);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pub.sent.send')}
      sub={t('pub.sent.dlg.sub')}
      kind="form"
      noMax
      dirty={files.length > 0 || note !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-pub-up-ok=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void submit()}
          >
            {t('pub.sent.dlg.ok')}
          </button>
        </>
      }
    >
      <FormGrid>
        <Field
          id={`${id}-f`}
          label={t('pub.sent.dlg.files')}
          required
          full
          hint={t('pub.sent.dlg.files_hint')}
          error={error}
        >
          {(control) => (
            <input
              {...control}
              type="file"
              multiple
              data-pub-up-files=""
              className={inputClass()}
              onChange={(e) => {
                setFiles([...(e.target.files ?? [])]);
                setError(null);
              }}
            />
          )}
        </Field>
        <Field id={`${id}-note`} label={t('pub.sent.dlg.note')} full>
          {(control) => (
            <textarea
              {...control}
              data-pub-up-note=""
              maxLength={SENT_FILE_COMMENT_MAX}
              placeholder={t('pub.sent.dlg.note_placeholder')}
              className={`${inputClass()} min-h-[58px] resize-y leading-normal`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </Modal>
  );
}

/**
 * Начало раздела «Файлы» страницы (прототип `pubSentHtml`): «Отправить файл», пока бухгалтер принимает
 * файлы, и «Отправленные вами» — статус, причина отказа и «Удалится через N дней». Нет ни того, ни
 * другого — ничего.
 */
export function PageSentBlock({ sent, address }: { sent: PageSent; address: Address }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [dialog, setDialog] = useState(0);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (!sent.upload && !sent.items.length) return null;
  return (
    <div data-pub-sent="" className="mb-3.5 flex flex-col gap-2.5 border-b border-line pb-3.5">
      {sent.upload ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-pub-up=""
            className={buttonClass('cta', 'sm')}
            onClick={() => {
              setDialog((n) => n + 1);
              setOpen(true);
            }}
          >
            <Icon name="upload" size="sm" />
            {t('pub.sent.send')}
          </button>
          <span className="text-[12px] text-faint">{t('pub.sent.hint')}</span>
        </div>
      ) : null}
      {sent.items.length ? (
        <>
          <b className="text-[13px] font-semibold text-muted">{t('pub.sent.list')}</b>
          <PageList
            count={sent.items.length}
            all={all}
            onAll={() => setAll(true)}
            more={t('pub.more', { n: sent.items.length - 5 })}
          >
            {sent.items.map((f) => (
              <div
                key={f.id}
                data-pub-sent-row={f.status}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-[9px] max-md:flex-wrap max-md:gap-2 max-md:px-2.5 max-md:py-2"
              >
                <Icon name={fileIcon(f.name)} className="flex-none text-muted" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="font-semibold [overflow-wrap:anywhere]">{f.name}</b>
                  <span className="text-[12px] text-faint">
                    {momentText(f.sentAt)}
                    {f.comment ? ` · ${f.comment}` : ''}
                  </span>
                  {f.status === 'rejected' && f.reason ? (
                    <span data-pub-sent-reason="" className="text-[12px] text-danger">
                      {t('pub.sent.reason', { reason: f.reason })}
                    </span>
                  ) : null}
                </span>
                {/* Телефон (прототип `.pub-srow .pub-fs`): статус и срок — строкой под именем. */}
                <span className="flex flex-none flex-col items-end gap-[3px] whitespace-nowrap text-right text-[12px] text-faint max-md:w-full max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-x-2 max-md:gap-y-1 max-md:pl-7 max-md:text-left max-md:whitespace-normal">
                  <SentStatusPill status={f.status} />
                  {f.daysLeft !== null ? <span>{sentLeftText(t, f.daysLeft)}</span> : null}
                </span>
              </div>
            ))}
          </PageList>
        </>
      ) : null}
      {dialog ? (
        <SendDialog
          key={`pub-up-${dialog}`}
          address={address}
          open={open}
          onClose={() => setOpen(false)}
          onSent={(n) => {
            setOpen(false);
            toast(n > 1 ? t('pub.sent.done.many', { n }) : t('pub.sent.done.one'), {
              icon: 'upload',
            });
            // Список «Отправленные вами» и данные страницы — с сервера заново.
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
