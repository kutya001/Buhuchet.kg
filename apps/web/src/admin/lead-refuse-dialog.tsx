'use client';

import { LEAD_REASON_MAX } from '@buhuchet/domain';
import { buttonClass, Field, inputClass, Modal } from '@buhuchet/ui';
import { useId, useState } from 'react';
import { useT } from '../l10n/provider';

/**
 * «Отказ по заявке» (прототип admin/leads.js, leadRefuse): обязательная «Причина отказа», под ней —
 * «Отказ» — конечная отметка вне шкалы, снять её можно откатом с причиной. Пустая причина — «Укажите
 * причину отказа» под полем. Окно открывают заново (новый `key`) — поле пустое.
 */
export function LeadRefuseDialog({
  open,
  onClose,
  sub,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** «Фирма · Имя». */
  sub: string;
  busy: boolean;
  error?: string | undefined;
  onConfirm: (reason: string) => void;
}) {
  const t = useT();
  const id = useId();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
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
      title={t('leads.refuse.title')}
      sub={sub}
      dirty={reason.trim() !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('danger')}
            disabled={busy}
            onClick={submit}
            data-lead-refuse-ok=""
          >
            {t('leads.refuse.ok')}
          </button>
        </>
      }
    >
      <Field
        id={`${id}-reason`}
        label={t('leads.refuse.reason')}
        required
        full
        error={missing ? t('leads.refuse.required') : error}
      >
        {(control) => (
          <textarea
            {...control}
            className={inputClass({ multiline: true })}
            value={reason}
            maxLength={LEAD_REASON_MAX}
            placeholder={t('leads.refuse.placeholder')}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setMissing(false);
            }}
          />
        )}
      </Field>
      <div className="text-[11.5px] leading-[1.4] text-faint">{t('leads.refuse.hint')}</div>
    </Modal>
  );
}
