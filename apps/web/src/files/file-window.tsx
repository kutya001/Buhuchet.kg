'use client';

import { bishkekDate, filePreviewKind, formatDateRu } from '@buhuchet/domain';
import { FileLink, FILE_NOTE_MAX, type FileManagerRow } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Field,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  KeyValues,
  Modal,
  Note,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import { fileKindIcon, fileKindText, fileTypeText } from './file-columns';
import { formContractorsQuery, fileSizeText } from './files-data';

/** Ссылка на просмотр картинки или PDF в окне файла (на 15 минут). */
const viewQuery = (id: string) => ({
  queryKey: ['files', 'view', id],
  queryFn: async () => {
    const res = await api.api.files[':id'].view.$get({ param: { id } });
    if (!res.ok) throw await apiFailure(res);
    return FileLink.parse(await res.json());
  },
  // Ссылка живёт 15 минут: открытое заново окно берёт свежую.
  staleTime: 5 * 60_000,
});

/** Просмотр в окне: картинка или PDF; остальное — значок, тип и размер. */
function Preview({ file }: { file: FileManagerRow }) {
  const t = useT();
  const kind = filePreviewKind(file.contentType);
  const link = useQuery({ ...viewQuery(file.id), enabled: kind !== null });
  const meta = t('files.window.meta', {
    ext: fileTypeText(t, file.name),
    size: fileSizeText(t, file.size),
  });
  if (kind && link.data) {
    return kind === 'image' ? (
      <div data-file-preview="image" className="grid place-items-center">
        {/* Картинка из хранилища по подписанной ссылке на 15 минут. */}
        <img
          src={link.data.url}
          alt={file.name}
          referrerPolicy="no-referrer"
          className="max-h-[60vh] max-w-full rounded-[10px] object-contain"
        />
      </div>
    ) : (
      <div className="flex flex-col items-end gap-1.5">
        <iframe
          data-file-preview="pdf"
          src={link.data.url}
          title={file.name}
          referrerPolicy="no-referrer"
          className="h-[60vh] w-full rounded-[10px] border border-line bg-raised"
        />
        {/* Браузер телефона PDF во фрейме часто не показывает — открыть его отдельно. */}
        <a
          href={link.data.url}
          target="_blank"
          rel="noopener noreferrer"
          data-file-open-tab=""
          className="text-[13px] break-words text-link"
        >
          {t('files.window.open_tab')}
        </a>
      </div>
    );
  }
  return (
    <Box>
      <div
        data-file-preview="none"
        className="flex min-h-[180px] flex-col items-center justify-center gap-3 text-center"
      >
        <span className="inline-block scale-[2.2] text-muted">
          <Icon name="file" />
        </span>
        <b>{meta}</b>
        {kind && link.isError ? (
          <Note tone="bad">{t('files.window.preview_error')}</Note>
        ) : kind ? null : (
          <Hint>{t('files.window.no_preview')}</Hint>
        )}
      </div>
    </Box>
  );
}

/**
 * Окно файла (прототип modules/files.js, `openFile`): просмотр картинки или PDF (остальное — значок,
 * тип и размер), «Откуда», «Источник», «Контрагент», кто и когда загрузил, описание; «Скачать» и
 * «Перейти к источнику» — у файла записи, «Готово» — у загруженного вручную.
 */
export function FileWindow({
  file,
  open,
  onClose,
  onDownload,
  onSource,
}: {
  file: FileManagerRow;
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
  /** «Перейти к источнику»; нет — у файла нет записи. */
  onSource: (() => void) | null;
}) {
  const t = useT();
  const items: KeyValueItem[] = [
    { id: 'kind', label: t('files.window.kind'), value: fileKindText(t, file.kind) },
    { id: 'src', label: t('files.window.src'), value: file.source },
    {
      id: 'cp',
      label: t('files.window.cp'),
      value: file.contractor?.name ?? t('files.cp.general_org'),
    },
    {
      id: 'by',
      label: t('files.window.by'),
      value: t('files.window.by_value', {
        name: file.uploadedBy ?? '—',
        date: formatDateRu(bishkekDate(new Date(file.uploadedAt))),
      }),
    },
    ...(file.note ? [{ id: 'desc', label: t('files.window.desc'), value: file.note }] : []),
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={file.name}
      sub={t('files.window.sub', { kind: fileKindText(t, file.kind), src: file.source })}
      size="mid"
      kind="card"
      footer={
        <>
          <button
            type="button"
            data-file-download=""
            className={buttonClass('default')}
            onClick={onDownload}
          >
            <Icon name="download" size="sm" />
            {t('files.act.download')}
          </button>
          <div className="flex-1" />
          {onSource ? (
            <button
              type="button"
              data-file-source=""
              className={buttonClass('cta')}
              onClick={() => {
                onClose();
                onSource();
              }}
            >
              <Icon name={fileKindIcon(file.kind)} size="sm" />
              {t('files.act.source')}
            </button>
          ) : (
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('files.window.done')}
            </button>
          )}
        </>
      }
    >
      <div data-file-window={file.id} className="flex flex-col gap-3.5">
        <Preview file={file} />
        <Box>
          <KeyValues items={items} />
        </Box>
      </div>
    </Modal>
  );
}

/** Что выбрано в окне «Загрузить файл». */
export interface UploadChoice {
  files: File[];
  contractorId: string | null;
  note: string;
}

/**
 * «Загрузить файл» (прототип modules/files.js, `uploadDlg`): несколько файлов сразу, контрагент
 * (необязательно — «общий файл организации»; только свои в области «Свои контрагенты», не в архиве) и
 * комментарий. Файл больше 20 МБ и запрещённые типы — сообщением под полем, не загружается ни один.
 */
export function UploadDialog({
  open,
  onClose,
  busy,
  problemOf,
  onUpload,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  /** Что не так с выбранными файлами (текст под полем) или null. */
  problemOf: (files: File[]) => string | null;
  onUpload: (choice: UploadChoice) => void;
}) {
  const t = useT();
  const id = useId();
  const contractors = useQuery(formContractorsQuery);
  const [files, setFiles] = useState<File[]>([]);
  const [contractorId, setContractorId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    if (!files.length) return setError(t('files.upload.files_required'));
    const problem = problemOf(files);
    if (problem) return setError(problem);
    onUpload({ files, contractorId: contractorId || null, note: note.trim() });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('files.upload.title')}
      sub={t('files.upload.sub')}
      kind="form"
      dirty={files.length > 0 || note !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('files.upload.cancel')}
          </button>
          <button
            type="button"
            data-files-upload-ok=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={submit}
          >
            {busy ? t('files.uploading') : t('files.upload.ok')}
          </button>
        </>
      }
    >
      <FormGrid>
        <Field id={`${id}-files`} label={t('files.upload.files')} required full error={error}>
          {(control) => (
            <input
              {...control}
              type="file"
              multiple
              data-files-upload-input=""
              className={inputClass()}
              onChange={(e) => {
                setFiles([...(e.target.files ?? [])]);
                setError(undefined);
              }}
            />
          )}
        </Field>
        <Field id={`${id}-cp`} label={t('files.upload.cp')} hint={t('files.upload.cp_hint')}>
          {(control) => (
            <select
              {...control}
              data-files-upload-cp=""
              className={`${inputClass()} cursor-pointer`}
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
            >
              <option value="">{t('files.upload.cp_none')}</option>
              {(contractors.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={`${id}-note`} label={t('files.upload.note')} full>
          {(control) => (
            <input
              {...control}
              data-files-upload-note=""
              className={inputClass()}
              maxLength={FILE_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </Modal>
  );
}
