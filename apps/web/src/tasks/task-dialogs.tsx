'use client';

import { bishkekDate, formatDateRu, formatMomentRu, TASK_CONFIRM_NOTE_MAX } from '@buhuchet/domain';
import { Task, type TaskRow } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  inputClass,
  KeyValues,
  Modal,
  Note,
  useToast,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { api, callApi, type ApiResult } from '../api-client';
import { filesQuery, pickedFilesProblem, uploadFile } from '../files/files-data';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';

/** Окно действия над задачей: задача, открыто ли, закрыть, что сделать после успеха. */
interface TaskDialogProps {
  task: TaskRow;
  open: boolean;
  onClose: () => void;
  /** Задача после действия (ответ сервера). */
  onDone: (task: Task) => void;
}

/** Ответ действия — карточка задачи после него. */
function taskOf(res: ApiResult<unknown>): Task | null {
  if (!res.ok) return null;
  const parsed = Task.safeParse(res.data);
  return parsed.success ? parsed.data : null;
}

/** Нижняя строка окна: «Отмена» и кнопка действия. */
function DialogFooter({
  t,
  onClose,
  label,
  busy,
  disabled = false,
  tone = 'cta',
  onOk,
}: {
  t: Translate;
  onClose: () => void;
  label: string;
  busy: boolean;
  disabled?: boolean;
  tone?: 'ok' | 'cta';
  onOk: () => void;
}) {
  return (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <button
        type="button"
        data-task-ok=""
        className={buttonClass(tone)}
        disabled={busy || disabled}
        onClick={onOk}
      >
        {label}
      </button>
    </>
  );
}

/**
 * Отправить действие: ответ — карточка задачи (`onDone`, окно закрывается, уведомление); отказ — под
 * полем (`onField`, если код относится к полю) или уведомлением.
 */
function useSend({ onClose, onDone }: Pick<TaskDialogProps, 'onClose' | 'onDone'>) {
  const toast = useToast();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const send = async (
    request: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
    done: (task: Task) => string,
    onField?: (code: string, message: string) => boolean,
  ) => {
    setBusy(true);
    const res = await callApi(request);
    setBusy(false);
    const task = taskOf(res);
    if (task) {
      onDone(task);
      onClose();
      return void toast(done(task), { icon: 'check' });
    }
    if (res.ok) return void toast(errorText({ code: 'unknown', message: '' }), { bad: true });
    const message = errorText(res.error);
    if (onField?.(res.error.code, message)) return;
    toast(message, { bad: true });
  };
  return { busy, setBusy, send };
}

/** Новый файл в окне «Задача выполнена» (вместо уже приложенного). */
const NEW_FILE = '';

/**
 * «Задача выполнена» (прототип modules/tasks.js, `taskDoneDlg`): с «Требуется файл» (и включёнными
 * «Файлами в карточках») — поле «Файл»: уже приложенный файл задачи или новый — он загружается в блок
 * «Файлы» задачи. Без права «Загружать файлы» нового не выбрать: подсказка, «Выполнена» недоступна,
 * пока файла нет (docs/deviations.md п. Б-1). Без файла — «Постановщик увидит, когда и кем задача
 * выполнена». С подтверждением — кто подтвердит; после — «Отправлено на подтверждение».
 */
export function TaskDoneDialog({
  task,
  filesOn,
  open,
  onClose,
  onDone,
}: TaskDialogProps & { filesOn: boolean }) {
  const t = useT();
  const errorText = useErrorText();
  const id = useId();
  const required = task.needFile && filesOn;
  const files = useQuery({ ...filesQuery({ kind: 'task', id: task.id }), enabled: required });
  const attached = files.data?.items ?? [];
  const canUpload = files.data?.canUpload ?? false;
  const [picked, setPicked] = useState<string | null>(null);
  const choice = picked ?? attached[0]?.id ?? NEW_FILE;
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();
  const { busy, setBusy, send } = useSend({ onClose, onDone });

  const submit = async () => {
    let fileId: string | null = null;
    if (required) {
      if (choice !== NEW_FILE) fileId = choice;
      else {
        if (!file) return setError(t('task.done.file_required'));
        const problem = pickedFilesProblem([file]);
        if (problem) {
          return setError(
            'names' in problem
              ? t('files.too_large', { names: problem.names })
              : errorText({ code: problem.code, message: '' }),
          );
        }
        setBusy(true);
        const res = await uploadFile({ kind: 'task', id: task.id }, file);
        setBusy(false);
        if (!res.ok) return setError(errorText(res.error));
        fileId = res.item.id;
      }
    }
    await send(
      () => api.api.tasks[':id'].done.$post({ param: { id: task.id }, json: { fileId } }),
      (after) =>
        after.status === 'on_confirm'
          ? t('task.done.sent', { name: task.author.shortName })
          : t('task.done.toast'),
      (code, message) => {
        if (code !== 'task_file_required' && code !== 'task_file_not_found') return false;
        setError(message);
        return true;
      },
    );
  };

  const noUpload = required && files.data && !canUpload && attached.length === 0;
  const fileField = required ? (
    <Field
      id={`${id}-file`}
      label={t('task.done.file')}
      required
      hint={noUpload ? t('task.done.no_upload') : t('task.done.file_hint')}
      error={error}
    >
      {(control) => (
        <div className="flex flex-col gap-2">
          {attached.length > 0 ? (
            <select
              {...control}
              className={`${inputClass()} cursor-pointer`}
              value={choice}
              onChange={(e) => {
                setPicked(e.target.value);
                setError(undefined);
              }}
            >
              {attached.map((f) => (
                <option key={f.id} value={f.id}>
                  {t('task.done.file_attached', {
                    name: f.name,
                    at: formatMomentRu(new Date(f.uploadedAt)),
                  })}
                </option>
              ))}
              {canUpload ? <option value={NEW_FILE}>{t('task.done.file_other')}</option> : null}
            </select>
          ) : null}
          {choice === NEW_FILE && canUpload ? (
            <input
              {...(attached.length > 0 ? {} : control)}
              type="file"
              data-task-file=""
              className={inputClass({ file: true })}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(undefined);
              }}
            />
          ) : null}
        </div>
      )}
    </Field>
  ) : (
    <p className="m-0 text-muted">{t('task.done.text')}</p>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('task.done.title')}
      sub={task.title}
      dirty={file !== null}
      footer={
        <DialogFooter
          t={t}
          onClose={onClose}
          label={t('task.action.done')}
          busy={busy}
          disabled={!!noUpload || (required && !files.data)}
          tone="ok"
          onOk={() => void submit()}
        />
      }
    >
      {fileField}
      {task.confirm ? (
        <Note icon="hourglass">{t('task.done.confirm_note', { name: task.author.shortName })}</Note>
      ) : null}
    </Modal>
  );
}

/** Окно с обязательной причиной: «Не выполнена» и «На доработку». */
function ReasonDialog({
  open,
  onClose,
  title,
  sub,
  label,
  placeholder,
  hint,
  ok,
  dataKey,
  submit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub: string;
  label: string;
  placeholder?: string;
  hint?: ReactNode;
  ok: string;
  dataKey: string;
  submit: (reason: string, setError: (message: string) => void) => void;
  busy: boolean;
}) {
  const t = useT();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={title}
      sub={sub}
      dirty={reason.trim() !== ''}
      footer={
        <DialogFooter
          t={t}
          onClose={onClose}
          label={ok}
          busy={busy}
          onOk={() => {
            if (!reason.trim()) return setError(t('task.reason_required'));
            submit(reason.trim(), setError);
          }}
        />
      }
    >
      <Field id={`${id}-reason`} label={label} required full error={error}>
        {(control) => (
          <textarea
            {...control}
            data-task-reason={dataKey}
            className={`${inputClass({ multiline: true })} min-h-[70px]`}
            placeholder={placeholder}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(undefined);
            }}
          />
        )}
      </Field>
      {hint ? <div className="text-[11.5px] leading-[1.4] text-faint">{hint}</div> : null}
    </Modal>
  );
}

/** Ошибка причины от сервера — под полем. */
const reasonField = (setError: (message: string) => void) => (code: string, message: string) => {
  if (code !== 'validation_failed') return false;
  setError(message);
  return true;
};

/** «Задача не выполнена» (прототип `taskFailDlg`): причина обязательна, «Сохранить». */
export function TaskFailDialog({ task, open, onClose, onDone }: TaskDialogProps) {
  const t = useT();
  const { busy, send } = useSend({ onClose, onDone });
  return (
    <ReasonDialog
      open={open}
      onClose={onClose}
      title={t('task.fail.title')}
      sub={task.title}
      label={t('task.fail.reason')}
      ok={t('task.fail.ok')}
      dataKey="fail"
      busy={busy}
      submit={(reason, setError) =>
        void send(
          () => api.api.tasks[':id'].fail.$post({ param: { id: task.id }, json: { reason } }),
          () => t('task.failed.toast'),
          reasonField(setError),
        )
      }
    />
  );
}

/** Сегодня по Бишкеку — для подсказки «Срок уже прошёл». */
const todayBishkek = () => bishkekDate(new Date());

/**
 * «Вернуть на доработку» (прототип `taskReworkDlg`): причина обязательна; задача вернётся в «В работе»
 * с отметкой «На доработке», исполнитель увидит причину; срок прошёл — станет просроченной.
 */
export function TaskReworkDialog({ task, open, onClose, onDone }: TaskDialogProps) {
  const t = useT();
  const { busy, send } = useSend({ onClose, onDone });
  const late = task.dueDate < todayBishkek();
  return (
    <ReasonDialog
      open={open}
      onClose={onClose}
      title={t('task.rework.title')}
      sub={task.title}
      label={t('task.rework.reason')}
      placeholder={t('task.rework.placeholder')}
      hint={
        <>
          {t('task.rework.hint', { name: task.executor.shortName })}
          {late ? ` ${t('task.rework.hint_overdue')}` : ''}
        </>
      }
      ok={t('task.action.rework')}
      dataKey="rework"
      busy={busy}
      submit={(reason, setError) =>
        void send(
          () => api.api.tasks[':id'].rework.$post({ param: { id: task.id }, json: { reason } }),
          () => t('task.reworked.toast'),
          reasonField(setError),
        )
      }
    />
  );
}

/**
 * «Подтвердить выполнение» (прототип `taskConfDlg`): исполнитель, когда выполнена, файл; подтверждает
 * не постановщик — «Вы подтверждаете вместо постановщика: это будет видно в истории»; комментарий
 * необязательный.
 */
export function TaskConfirmDialog({
  task,
  open,
  onClose,
  onDone,
  employeeId,
  filesOn,
}: TaskDialogProps & { employeeId: string | null; filesOn: boolean }) {
  const t = useT();
  const id = useId();
  const { busy, send } = useSend({ onClose, onDone });
  const [comment, setComment] = useState('');
  const files = useQuery({
    ...filesQuery({ kind: 'task', id: task.id }),
    enabled: filesOn && task.hasFile,
  });
  const fileNames = (files.data?.items ?? []).map((f) => f.name).join(', ');
  const full = 'executorFullName' in task ? (task as Task).executorFullName : null;
  const items: KeyValueItem[] = [
    { id: 'exec', label: t('task.kv.exec'), value: full ?? task.executor.shortName },
    {
      id: 'done',
      label: t('task.kv.done_at'),
      value: task.doneAt ? formatDateRu(bishkekDate(new Date(task.doneAt))) : '—',
    },
    ...(fileNames ? [{ id: 'file', label: t('task.kv.file'), value: fileNames }] : []),
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('task.confirm.title')}
      sub={task.title}
      dirty={comment.trim() !== ''}
      footer={
        <DialogFooter
          t={t}
          onClose={onClose}
          label={t('task.action.confirm')}
          busy={busy}
          tone="ok"
          onOk={() =>
            void send(
              () =>
                api.api.tasks[':id'].confirm.$post({
                  param: { id: task.id },
                  json: { comment: comment.trim() },
                }),
              () => t('task.confirmed.toast', { name: task.executor.shortName }),
            )
          }
        />
      }
    >
      <KeyValues items={items} />
      {task.author.id !== employeeId ? (
        <Note>{t('task.confirm.instead', { name: task.author.shortName })}</Note>
      ) : null}
      <Field id={`${id}-comment`} label={t('task.confirm.comment')} full>
        {(control) => (
          <textarea
            {...control}
            data-task-comment-confirm=""
            className={`${inputClass({ multiline: true })} min-h-[60px]`}
            placeholder={t('task.confirm.placeholder')}
            maxLength={TASK_CONFIRM_NOTE_MAX}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
      </Field>
    </Modal>
  );
}
