'use client';

import {
  bishkekDate,
  FILE_MAX_BYTES,
  pageDateWords,
  pluralForm,
  SENT_FILE_COMMENT_MAX,
  SENT_FILES_PER_SEND,
  sentFilesSendRefusal,
  type SentFileRefusal,
} from '@buhuchet/domain';
import { PageSentTicket, type PageSent } from '@buhuchet/shared';
import { buttonClass, Field, FormGrid, Icon, inputClass, Modal, Pill } from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { callApi } from '../api-client';
import { useDoneDialog } from '../contractor-page/page-done';
import { fileIcon } from '../contractor-page/page-files';
import { usePageHint } from '../contractor-page/page-help-context';
import { PageList } from '../contractor-page/page-parts';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';

/*
 * «Отправить файл» и вкладка «От вас» в разделе «Файлы» страницы контрагента (доработки 14.11.2026,
 * блок 2, и 17.11.2026 «простыми словами»; прототип v135 `pubSentHtml`, `pubUpDlg`). Запросы идут под адресом страницы
 * (`/<организация>/inn/<ИНН>/sent`): только туда браузер отправляет cookie этой ссылки.
 */

type Address = { slug: string; inn: string };

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
  const hint = usePageHint();
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
      title={t('pub.sent.dlg.title')}
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
          hint={hint('upHint', t('pub.sent.dlg.files_hint'), {
            мб: FILE_MAX_BYTES / 1048576,
            файлов: SENT_FILES_PER_SEND,
          })}
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
 * Окно «Отправить файл» страницы: `open()` открывает его (кнопка раздела «Файлы» и «Отправить файл» в
 * «Помощи»), `dialog` — в разметку страницы. После отправки — окно с итогом «что дальше» (доработки
 * 15.11.2026, пункт 5.1; прототип v120 `cphDone`) и данные страницы с сервера заново.
 */
export function usePageUpload(
  address: Address,
  /** Файлы ушли: страница показывает вкладку «От вас» (прототип `PUB.ft='you'`). */
  onSent?: () => void,
): { open: () => void; dialog: ReactNode } {
  const t = useT();
  const hint = usePageHint();
  const router = useRouter();
  const done = useDoneDialog();
  const [n, setN] = useState(0);
  const [isOpen, setOpen] = useState(false);
  const dialog = (
    <>
      {n ? (
        <SendDialog
          key={`pub-up-${n}`}
          address={address}
          open={isOpen}
          onClose={() => setOpen(false)}
          onSent={(count) => {
            setOpen(false);
            onSent?.();
            done.show(
              count > 1 ? t('cph.up.done_many', { n: count }) : t('cph.up.done_one'),
              hint(
                'upDone',
                count > 1 ? t('pub.sent.done.many', { n: count }) : t('pub.sent.done.one'),
              ),
            );
            // Вкладка «От вас» и данные страницы — с сервера заново.
            router.refresh();
          }}
        />
      ) : null}
      {done.dialog}
    </>
  );
  return {
    open: () => {
      setN((x) => x + 1);
      setOpen(true);
    },
    dialog,
  };
}

/** Статус отправленного файла словами клиента (прототип `PUB_SNT`, `PUB_SNTP`). */
const SENT_PILL = {
  new: { tone: 'info', icon: 'clip' },
  accepted: { tone: 'ok', icon: 'check' },
  rejected: { tone: 'bad', icon: 'ban' },
} as const;

/**
 * Вкладка «От вас» раздела «Файлы» (прототип v135 `pubSentHtml`): дата словами, «Отправлен», «Принят»,
 * «Не принят» с причиной, «хранится ещё N дней» — красным, когда осталось 3 дня и меньше.
 */
export function PageSentList({ sent, today }: { sent: PageSent | null; today: string }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const items = sent?.items ?? [];
  if (!items.length) {
    return (
      <span data-pub-sent-none="" className="text-faint">
        {t(sent?.upload ? 'pub.sent.none' : 'pub.sent.none_off')}
      </span>
    );
  }
  return (
    <div data-pub-sent="" className="flex flex-col gap-2.5">
      <PageList
        count={items.length}
        all={all}
        onAll={() => setAll(true)}
        more={t('pub.more', { n: items.length - 5 })}
      >
        {items.map((f) => (
          <div
            key={f.id}
            data-pub-sent-row={f.status}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-[9px] max-md:flex-wrap max-md:gap-2 max-md:px-2.5 max-md:py-2"
          >
            <Icon name={fileIcon(f.name)} className="flex-none text-muted" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              {/* Имя файла и комментарий клиента — его слова: «Словарик» их не трогает. */}
              <b data-no-gloss="" className="font-semibold [overflow-wrap:anywhere]">
                {f.name}
              </b>
              <span data-no-gloss="" className="text-[12px] text-faint">
                {pageDateWords(bishkekDate(new Date(f.sentAt)), today)}
                {f.telegram ? ` · ${t('pub.sent.tg')}` : ''}
                {f.comment ? ` · ${f.comment}` : ''}
              </span>
              {f.status === 'rejected' && f.reason ? (
                <span data-pub-sent-reason="" className="text-[12px] text-danger">
                  {t('pub.sent.reason', { reason: f.reason })}
                </span>
              ) : null}
            </span>
            {/* Телефон (прототип `.pub-srow .pub-fs`): статус и срок — строкой под именем. */}
            <span className="flex flex-none flex-col items-end gap-[3px] text-right text-[12px] whitespace-nowrap text-faint max-md:w-full max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-x-2 max-md:gap-y-1 max-md:pl-7 max-md:text-left max-md:whitespace-normal">
              <Pill tone={SENT_PILL[f.status].tone} icon={SENT_PILL[f.status].icon}>
                {t(`pub.sent.st.${f.status}`)}
              </Pill>
              {f.status !== 'accepted' && f.daysLeft !== null ? (
                <span data-pub-sent-left="" className={f.daysLeft <= 3 ? 'text-danger' : ''}>
                  {f.daysLeft
                    ? t(`pub.sent.left.${pluralForm(f.daysLeft)}`, { n: f.daysLeft })
                    : t('pub.sent.left.today')}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </PageList>
    </div>
  );
}
