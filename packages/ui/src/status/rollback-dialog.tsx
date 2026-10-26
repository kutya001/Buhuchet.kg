'use client';

import { ROLLBACK_REASON_MAX } from '@buhuchet/domain';
import { useId, useState, type ReactNode } from 'react';
import { buttonClass } from '../button';
import { Field, inputClass, Note } from '../form';
import { Icon } from '../icon';
import { Modal, useWindowLabels } from '../modal';

export interface RollbackDialogLabels {
  /** «Причина отката». */
  reason: string;
  placeholder: string;
  /** «Откат делается на один шаг и попадает в историю статусов с пометкой «Откат».» */
  hint: string;
  /** «Откатить». */
  ok: string;
  /** «Укажите причину». */
  required: string;
}

/**
 * Окно отката статуса (ТЗ «Откат статуса»; прототип `rollbackDlg`): что изменится, обязательная
 * «Причина отката» и «Откатить». Пустая причина — ошибка под полем, окно остаётся открытым; причину
 * получает `onConfirm` уже без пробелов по краям. Окно закрывает вызывающий, когда откат сохранён.
 */
export function RollbackDialog({
  open,
  onClose,
  title,
  sub,
  consequences,
  extra,
  busy = false,
  error,
  labels,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** «Откатить: «Сдан» → «В работе»». */
  title: string;
  /** Запись: «НДС · ОсОО «Ала-Тоо» · сентябрь 2026». */
  sub?: ReactNode;
  /** Последствия отката для этой записи. */
  consequences: ReactNode;
  /** Своё содержимое окна под последствиями (например, что досоздать за пропущенные месяцы). */
  extra?: ReactNode;
  /** Откат сохраняется — кнопка недоступна. */
  busy?: boolean;
  /** Ошибка сохранения (текст из словаря). */
  error?: string | undefined;
  labels: RollbackDialogLabels;
  onConfirm: (reason: string) => void;
}) {
  const windowLabels = useWindowLabels();
  const id = useId();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [shown, setShown] = useState(open);
  // Окно открыто заново — поле пустое.
  if (shown !== open) {
    setShown(open);
    setReason('');
    setMissing(false);
  }
  const submit = () => {
    const text = reason.trim();
    if (!text) return setMissing(true);
    onConfirm(text);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={title}
      sub={sub}
      dirty={reason.trim() !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {windowLabels.cancel}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy}
            onClick={submit}
            data-rollback-ok=""
          >
            <Icon name="history" size="sm" />
            {labels.ok}
          </button>
        </>
      }
    >
      <Note icon="history">{consequences}</Note>
      {extra}
      <Field
        id={`${id}-reason`}
        label={labels.reason}
        required
        full
        error={missing ? labels.required : error}
      >
        {(control) => (
          <textarea
            {...control}
            className={inputClass({ multiline: true })}
            value={reason}
            maxLength={ROLLBACK_REASON_MAX}
            placeholder={labels.placeholder}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setMissing(false);
            }}
          />
        )}
      </Field>
      <div className="text-[11.5px] leading-[1.4] text-faint">{labels.hint}</div>
    </Modal>
  );
}
