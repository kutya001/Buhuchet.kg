'use client';

import { bishkekDate, bishkekTime, filePreviewKind, formatDateRu } from '@buhuchet/domain';
import { FileLink, type FileLinkInfo, type FileManagerRow } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  Field,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  KeyValues,
  linkButtonClass,
  Modal,
  Note,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useId, useState } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import { ContractorSelect } from '../shell/contractor-select';
import { FileNoteInput } from './attach-dialog';
import { fileKindIcon, fileKindText, fileTypeText } from './file-columns';
import { fileLinkText, fileSourceWithLinks } from './file-links';
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

/**
 * Просмотр в окне: картинка или PDF; остальное — значок, тип и размер. `view` — запрос ссылки на
 * просмотр (у файла записи — `…/view`, у отправленного контрагентом — `/files/sent/{id}/link`).
 */
export function FilePreview({
  file,
  view,
}: {
  file: { name: string; contentType: string; size: number };
  view: { queryKey: readonly unknown[]; queryFn: () => Promise<FileLink>; staleTime?: number };
}) {
  const t = useT();
  const kind = filePreviewKind(file.contentType);
  const link = useQuery({ ...view, enabled: kind !== null });
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
 * тип и размер), «Откуда», «Источник», «Контрагент», кто и когда загрузил, «Заменён» (кто и когда —
 * прототип v95) и примечание (нет — «нет»); «Скачать», «Изменить» (без права «Загружать файлы» —
 * недоступна, с причиной) и «Перейти к источнику» — у файла записи, «Готово» — у загруженного вручную.
 * У файла контрагента, прикреплённого к записям (доработки 16.11.2026, блок 2; прототип v124): записи в
 * «Источнике» — ссылки на их окна (`data-fol`), «Удалить» — «Удалить отовсюду» (`fo-del`).
 */
export function FileWindow({
  file,
  open,
  onClose,
  onDownload,
  onSource,
  onEdit,
  onLink,
  onDelete,
}: {
  file: FileManagerRow;
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
  /** «Перейти к источнику»; нет — у файла нет записи. */
  onSource: (() => void) | null;
  /** «Изменить» — окно «Изменить файл» открывает экран; нет — кнопки нет. */
  onEdit?: () => void;
  /** Запись ссылки из «Источника» — в её окне; нет — записи простым текстом. */
  onLink?: (link: FileLinkInfo) => void;
  /**
   * «Удалить» / «Удалить отовсюду» (без права — недоступна, с причиной); нет — кнопки нет. Окно остаётся
   * открытым до подтверждения (прототип `fDelDlg(f, () => m.close())`): вопрос — поверх окна.
   */
  onDelete?: () => void;
}) {
  const t = useT();
  // Надпись — по видимым ссылкам, как в меню «…» и в прототипе (`f.links.length`).
  const linked = file.links.length > 0;
  const replacedAt = file.replaced ? new Date(file.replaced.at) : null;
  const items: KeyValueItem[] = [
    { id: 'kind', label: t('files.window.kind'), value: fileKindText(t, file.kind) },
    {
      id: 'src',
      label: t('files.window.src'),
      // Прототип v124 `openFile`: «От контрагента · <запись> · <запись>», запись — ссылка на её окно.
      value: (
        <span data-file-window-src="">
          {file.source}
          {file.links.map((link) => {
            const text = fileLinkText(t, link, 'src');
            return (
              <Fragment key={`${link.kind}-${link.id}`}>
                {' · '}
                {onLink ? (
                  <button
                    type="button"
                    data-file-link-open={`${link.kind}:${link.id}`}
                    className={linkButtonClass()}
                    onClick={() => {
                      onClose();
                      onLink(link);
                    }}
                  >
                    {text}
                  </button>
                ) : (
                  text
                )}
              </Fragment>
            );
          })}
        </span>
      ),
    },
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
    ...(file.replaced && replacedAt
      ? [
          {
            id: 'replaced',
            label: t('files.window.replaced'),
            value: t('files.window.replaced_value', {
              name: file.replaced.by ?? '—',
              date: `${formatDateRu(bishkekDate(replacedAt))} ${bishkekTime(replacedAt)}`,
            }),
          },
        ]
      : []),
    {
      id: 'desc',
      label: t('files.window.desc'),
      value: file.note ? (
        <span data-file-window-note="">{file.note}</span>
      ) : (
        <span className="text-faint">{t('files.window.no_note')}</span>
      ),
    },
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={file.name}
      sub={t('files.window.sub', {
        kind: fileKindText(t, file.kind),
        src: fileSourceWithLinks(t, file.source, file.links),
      })}
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
          {onEdit ? (
            <button
              type="button"
              data-file-window-edit=""
              className={buttonClass('default')}
              disabled={!file.canEdit}
              title={file.canEdit ? undefined : t('files.act.edit_reason')}
              onClick={onEdit}
            >
              <Icon name="edit" size="sm" />
              {t('files.window.edit')}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              data-file-window-delete=""
              className={buttonClass('danger')}
              disabled={!file.canDelete}
              title={file.canDelete ? undefined : t('err.file_delete_forbidden')}
              onClick={onDelete}
            >
              <Icon name="trash" size="sm" />
              {t(linked ? 'files.act.delete_all' : 'files.act.delete')}
            </button>
          ) : null}
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
              {/* Файл контрагента с ссылками (прототип v124): кнопка ведёт в его файлы. */}
              {file.links.length ? t('files.window.cp_files') : t('files.act.source')}
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
        <FilePreview file={file} view={viewQuery(file.id)} />
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
  /** «Показывать контрагенту на его странице» (решение заказчика 06.11.2026). */
  page: boolean;
}

/**
 * «Загрузить файл» (прототип modules/files.js, `uploadDlg`): несколько файлов сразу, контрагент
 * (необязательно — «общий файл организации»; только свои в области «Свои контрагенты», не в архиве) и
 * примечание. Файл больше 20 МБ и запрещённые типы — сообщением под полем, не загружается ни один.
 */
export function UploadDialog({
  open,
  onClose,
  busy,
  problemOf,
  onUpload,
  cppage = false,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  /** Включена «Страница контрагента по ссылке» — галочка «Показывать контрагенту на его странице». */
  cppage?: boolean;
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
  const [page, setPage] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    if (!files.length) return setError(t('files.upload.files_required'));
    const problem = problemOf(files);
    if (problem) return setError(problem);
    onUpload({ files, contractorId: contractorId || null, note: note.trim(), page });
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
            <ContractorSelect
              {...control}
              data-files-upload-cp=""
              contractors={contractors.data ?? []}
              value={contractorId}
              empty={t('files.upload.cp_none')}
              onChange={setContractorId}
            />
          )}
        </Field>
        <Field id={`${id}-note`} label={t('files.upload.note')} full hint={t('files.note_hint')}>
          {(control) => (
            <FileNoteInput
              control={{ ...control, 'data-files-upload-note': '' }}
              value={note}
              onChange={setNote}
            />
          )}
        </Field>
        {cppage ? (
          // Прототип v74 uploadDlg: галочка во всю ширину, по умолчанию включена.
          <div className="col-span-full">
            <CheckRow
              kind="check"
              data-files-upload-page=""
              checked={page}
              onChange={setPage}
              label={t('files.upload.page')}
            >
              <Hint>{t('files.upload.page_hint')}</Hint>
            </CheckRow>
          </div>
        ) : null}
      </FormGrid>
    </Modal>
  );
}
