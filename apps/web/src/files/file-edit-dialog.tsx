'use client';

import {
  FILE_NAME_MAX_LENGTH,
  fileNameParts,
  fileRenameProblem,
  fileUploadProblem,
} from '@buhuchet/domain';
import {
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  Modal,
  MONO_CLASS,
  useToast,
} from '@buhuchet/ui';
import { useId, useState } from 'react';
import { useErrorText, useT } from '../l10n/provider';
import { FileNoteInput } from './attach-dialog';
import { fileMeta, saveFileEdit, useFilesRefresh } from './files-data';

/** Файл, который меняют: строка блока «Файлы» записи или Файлового менеджера. */
export interface EditableFile {
  id: string;
  name: string;
  size: number;
  note: string | null;
  version: number;
  /** Заменить может тот, кто может и удалить: прежний файл при замене пропадает. */
  canReplace: boolean;
}

function EditForm({
  file,
  sub,
  onClose,
  onSaved,
}: {
  file: EditableFile;
  sub?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useFilesRefresh();
  const id = useId();
  const [base0, ext0] = fileNameParts(file.name);
  const [base, setBase] = useState(base0);
  const [note, setNote] = useState(file.note ?? '');
  const [picked, setPicked] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ name?: string; file?: string }>({});
  const [busy, setBusy] = useState(false);
  // При замене расширение берётся от нового файла.
  const ext = picked ? fileNameParts(picked.name)[1] : ext0;
  const codeText = (code: string) => errorText({ code, message: '' });

  const save = async () => {
    const nameProblem = fileRenameProblem(base, ext);
    const fileProblem = picked ? fileUploadProblem(picked) : null;
    setErrors({
      name: nameProblem ? codeText(nameProblem) : undefined,
      file: fileProblem ? codeText(fileProblem) : undefined,
    });
    if (nameProblem || fileProblem) return;
    setBusy(true);
    const res = await saveFileEdit(file, {
      name: base.replace(/\s+/g, ' ').trim() + ext,
      note,
      replacement: picked,
    });
    setBusy(false);
    if (res.ok) {
      await refresh();
      const changed = res.item.version !== file.version;
      onClose();
      if (!changed) return;
      toast(t(picked ? 'files.replaced' : 'files.edited'), { icon: 'edit' });
      onSaved?.();
      return;
    }
    const field =
      typeof res.error.details === 'object' && res.error.details !== null
        ? (res.error.details as { field?: unknown }).field
        : undefined;
    if (res.status === 400 && field === 'name') return setErrors({ name: errorText(res.error) });
    toast(errorText(res.error), { bad: true, icon: 'alert' });
    // Файл изменил или удалил другой пользователь: окно закрывается, списки перечитываются.
    if (res.status === 409 || res.status === 404) {
      await refresh();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('files.editdlg.title')}
      sub={sub}
      kind="form"
      dirty={base !== base0 || note !== (file.note ?? '') || picked !== null}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('files.editdlg.cancel')}
          </button>
          <button
            type="button"
            data-file-edit-ok=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? t('files.uploading') : t('files.editdlg.ok')}
          </button>
        </>
      }
    >
      <div data-file-edit-dialog={file.id}>
        <FormGrid>
          <Field
            id={`${id}-name`}
            label={t('files.editdlg.name')}
            required
            full
            hint={t('files.editdlg.name_hint')}
            error={errors.name}
          >
            {(control) => (
              <div className="flex items-center gap-2">
                <input
                  {...control}
                  data-file-edit-name=""
                  autoComplete="off"
                  maxLength={FILE_NAME_MAX_LENGTH}
                  className={`${inputClass({ full: false })} min-w-0 flex-1`}
                  value={base}
                  onChange={(e) => {
                    setBase(e.target.value);
                    setErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                />
                <span data-file-edit-ext="" className={`${MONO_CLASS} text-muted`}>
                  {ext}
                </span>
              </div>
            )}
          </Field>
          <Field id={`${id}-note`} label={t('files.note')} full hint={t('files.note_hint')}>
            {(control) => <FileNoteInput control={control} value={note} onChange={setNote} />}
          </Field>
          <Field
            id={`${id}-file`}
            label={t('files.editdlg.replace')}
            full
            hint={
              file.canReplace
                ? t('files.editdlg.replace_hint', { meta: fileMeta(t, file.name, file.size) })
                : t('err.file_replace_forbidden')
            }
            error={errors.file}
          >
            {(control) =>
              file.canReplace ? (
                <input
                  {...control}
                  type="file"
                  data-file-edit-input=""
                  className={inputClass({ file: true })}
                  onChange={(e) => {
                    setPicked(e.target.files?.[0] ?? null);
                    setErrors((prev) => ({ ...prev, file: undefined }));
                  }}
                />
              ) : (
                <span data-file-edit-noreplace="" className="text-[13px] text-faint">
                  {t('files.editdlg.replace_off')}
                </span>
              )
            }
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}

/**
 * Окно «Изменить файл» (просьба заказчика 13.11.2026, прототип v95 modules/files.js `fileEditDlg`):
 * название (расширение не меняется, при замене — от нового файла), примечание и замена файла — тому,
 * кто может его удалить, иначе «Замена недоступна». Сохранение пишет историю записи; без изменений
 * окно просто закрывается.
 */
export function FileEditDialog({
  file,
  sub,
  onClose,
  onSaved,
}: {
  /** Файл, который меняют; null — окно закрыто. */
  file: EditableFile | null;
  /** Строка под заголовком: «Откуда · Источник». */
  sub?: string;
  onClose: () => void;
  /** После сохранения с изменениями (списки файлов уже перечитаны). */
  onSaved?: () => void;
}) {
  return file ? (
    <EditForm key={file.id} file={file} sub={sub} onClose={onClose} onSaved={onSaved} />
  ) : null;
}
