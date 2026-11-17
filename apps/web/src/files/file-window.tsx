'use client';

import { bishkekDate, bishkekTime, formatDateRu } from '@buhuchet/domain';
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
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useId, useState } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { ContractorSelect } from '../shell/contractor-select';
import { FileNoteInput } from './attach-dialog';
import { fileKindIcon, fileKindText } from './file-columns';
import { fileLinkText, fileSourceWithLinks } from './file-links';
import { FileViewer } from './file-viewer';
import { formContractorsQuery } from './files-data';

/** Байты файла для окна просмотра: подписанная ссылка хранилища на 15 минут (право «Просматривать файлы»). */
export async function fileBytesUrl(id: string): Promise<string> {
  const res = await api.api.files[':id'].link.$get({ param: { id } });
  if (!res.ok) throw await apiFailure(res);
  return FileLink.parse(await res.json()).url;
}

/** «Скачать» в окне просмотра: переход на подписанную ссылку хранилища. */
export const fileDownloadUrl = (id: string) => `/api/files/${encodeURIComponent(id)}/download`;

/**
 * Окно файла (прототип modules/files.js, `openFile` → `fileView`, v126): просмотр файла (доработки
 * 16.11.2026, блок 5 — `FileViewer`, «‹ ›» по файлам списка), под ним «Откуда», «Источник»,
 * «Контрагент», кто и когда загрузил, «Заменён» (кто и когда — прототип v95) и примечание (нет — «нет»);
 * «Скачать», «Изменить» (без права «Загружать файлы» — недоступна, с причиной) и «Перейти к источнику» —
 * у файла записи, «Готово» — у загруженного вручную. У файла контрагента, прикреплённого к записям
 * (доработки 16.11.2026, блок 2; прототип v124): записи в «Источнике» — ссылки на их окна
 * (`data-fol`), «Удалить» — «Удалить отовсюду» (`fo-del`).
 */
export function FileWindow({
  files,
  index,
  open,
  onClose,
  onSource,
  onEdit,
  onLink,
  onDelete,
}: {
  /** Файлы списка на экране — для «‹ ›»; окно открывается на `index`. */
  files: readonly FileManagerRow[];
  index: number;
  open: boolean;
  onClose: () => void;
  /** «Перейти к источнику» файла; `null` — у файла нет записи. */
  onSource: (file: FileManagerRow) => (() => void) | null;
  /** «Изменить» — окно «Изменить файл» открывает экран; нет — кнопки нет. */
  onEdit?: (file: FileManagerRow) => void;
  /** Запись ссылки из «Источника» — в её окне; нет — записи простым текстом. */
  onLink?: (link: FileLinkInfo) => void;
  /**
   * «Удалить» / «Удалить отовсюду» (без права — недоступна, с причиной); нет — кнопки нет. Окно остаётся
   * открытым до подтверждения (прототип `fDelDlg(f, () => m.close())`): вопрос — поверх окна.
   */
  onDelete?: (file: FileManagerRow) => void;
}) {
  const t = useT();
  return (
    <FileViewer
      files={files}
      index={index}
      open={open}
      onClose={onClose}
      src={fileBytesUrl}
      download={fileDownloadUrl}
      sub={(file) =>
        t('files.window.sub', {
          kind: fileKindText(t, file.kind),
          src: fileSourceWithLinks(t, file.source, file.links),
        })
      }
      info={(file) => (
        <div data-file-window={file.id}>
          <Box>
            <KeyValues items={fileInfoItems(t, file, onClose, onLink)} />
          </Box>
        </div>
      )}
      footer={(file) => {
        const source = onSource(file);
        return (
          <>
            {onEdit ? (
              <button
                type="button"
                data-file-window-edit=""
                className={buttonClass('default')}
                disabled={!file.canEdit}
                title={file.canEdit ? undefined : t('files.act.edit_reason')}
                onClick={() => onEdit(file)}
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
                onClick={() => onDelete(file)}
              >
                <Icon name="trash" size="sm" />
                {t(file.links.length > 0 ? 'files.act.delete_all' : 'files.act.delete')}
              </button>
            ) : null}
            <div className="flex-1" />
            {source ? (
              <button
                type="button"
                data-file-source=""
                className={buttonClass('cta')}
                onClick={() => {
                  onClose();
                  source();
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
        );
      }}
    />
  );
}

/** Сведения о файле под просмотром. */
function fileInfoItems(
  t: Translate,
  file: FileManagerRow,
  onClose: () => void,
  onLink: ((link: FileLinkInfo) => void) | undefined,
): KeyValueItem[] {
  const replacedAt = file.replaced ? new Date(file.replaced.at) : null;
  return [
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
