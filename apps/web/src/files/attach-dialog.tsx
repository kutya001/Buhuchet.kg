'use client';

import { FILE_NOTE_MAX } from '@buhuchet/shared';
import { buttonClass, Field, FormGrid, Icon, inputClass, Modal, Note } from '@buhuchet/ui';
import { useId, useState } from 'react';
import { useErrorText, useT } from '../l10n/provider';
import { fileMeta, pickedFilesProblem } from './files-data';

/** Поле «Примечание» к файлу (прототип v95 `.f-note-i`): необязательное, в несколько строк. */
export function FileNoteInput({
  control,
  value,
  onChange,
}: {
  control: object;
  value: string;
  onChange: (note: string) => void;
}) {
  const t = useT();
  return (
    <textarea
      {...control}
      data-file-note-input=""
      maxLength={FILE_NOTE_MAX}
      placeholder={t('files.note_placeholder')}
      className={`${inputClass()} min-h-[58px] resize-y leading-normal`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function AttachForm({
  files,
  sub,
  onClose,
  onAttach,
}: {
  files: readonly File[];
  sub?: string;
  onClose: () => void;
  onAttach: (note: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const id = useId();
  const [note, setNote] = useState('');
  const many = files.length > 1;
  const problem = pickedFilesProblem(files);
  const problemText = problem
    ? t('files.attach.again', {
        problem:
          'names' in problem
            ? t('files.too_large', { names: problem.names })
            : t('files.upload_failed', {
                name: problem.name,
                error: errorText({ code: problem.code, message: '' }),
              }),
      })
    : null;
  return (
    <Modal
      open
      onClose={onClose}
      title={many ? t('files.attach.title_many', { n: files.length }) : t('files.attach.title_one')}
      sub={sub}
      kind="form"
      noMax
      dirty={note !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('files.attach.cancel')}
          </button>
          <button
            type="button"
            data-files-attach-ok=""
            className={buttonClass('cta')}
            disabled={problem !== null}
            onClick={() => onAttach(note)}
          >
            {t('files.attach.ok')}
          </button>
        </>
      }
    >
      <div data-files-attach="" className="flex flex-col gap-2.5">
        <ul className="m-0 flex max-h-[190px] list-none flex-col overflow-auto p-0">
          {files.map((f, i) => (
            <li
              key={`${i}-${f.name}`}
              className="flex min-w-0 items-center gap-2.5 border-b border-line px-0.5 py-[9px] last:border-b-0"
            >
              <Icon name="file" className="flex-none text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{f.name}</div>
                <div className="truncate text-xs text-faint">{fileMeta(t, f.name, f.size)}</div>
              </div>
            </li>
          ))}
        </ul>
        {problemText ? <Note tone="bad">{problemText}</Note> : null}
        <FormGrid>
          <Field
            id={`${id}-note`}
            label={t('files.note')}
            full
            hint={t(many ? 'files.attach.note_hint_many' : 'files.attach.note_hint')}
          >
            {(control) => <FileNoteInput control={control} value={note} onChange={setNote} />}
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}

/**
 * Окно «Прикрепить файл» (просьба заказчика 13.11.2026, прототип v95 modules/files.js `attachDlg`):
 * после выбора файлов — их список и необязательное примечание, одно на все выбранные. Файл больше
 * 20 МБ или запрещённого типа — сообщение и «Прикрепить» недоступна: не прикрепляется ни один.
 */
export function AttachDialog({
  files,
  sub,
  onClose,
  onAttach,
}: {
  /** Выбранные файлы; null — окно закрыто. */
  files: readonly File[] | null;
  /** Строка под заголовком: к чему прикрепляют. */
  sub?: string;
  onClose: () => void;
  /** «Прикрепить»: примечание как набрано (сервер приводит его к одной строке). */
  onAttach: (note: string) => void;
}) {
  // Форма создаётся заново для каждого выбора файлов: примечание прошлого раза не остаётся.
  return files ? (
    <AttachForm files={files} sub={sub} onClose={onClose} onAttach={onAttach} />
  ) : null;
}
