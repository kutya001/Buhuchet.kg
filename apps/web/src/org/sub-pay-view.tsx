'use client';

import { formatDateRu, formatMomentRu, formatSomWithUnit } from '@buhuchet/domain';
import {
  Box,
  buttonClass,
  Field,
  Icon,
  KeyValues,
  linkButtonClass,
  Modal,
  Note,
  Pill,
  useToast,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useErrorText, useT } from '../l10n/provider';
import { replaceSubReceipt, SUB_QUERY_KEY } from './sub-data';
import { CalcTable, ReceiptDrop } from './sub-pay-dialog';
import { SUB_PAY_PILL, termText, whatText, whoText, type SubPay } from './sub-model';

/*
 * Окно оплаты из «Истории оплат» и «Заменить файл чека» (доработки 20.11.2026, блок 5, пункты 2, 5, 6;
 * прототип v154 `subPayView`, `subFileDlg`; этап 1, П7, поток И).
 */

/** Чек строкой-ссылкой (прототип `data-subact="file:…"`). */
export function ReceiptLink({ pay, onOpen }: { pay: SubPay; onOpen?: (pay: SubPay) => void }) {
  if (!pay.receipt) return <span className="text-faint">—</span>;
  const name = (
    <>
      <Icon name="file" size="sm" className="flex-none" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{pay.receipt.name}</span>
    </>
  );
  if (!onOpen) return <span className="inline-flex items-center gap-1.5">{name}</span>;
  return (
    <button
      type="button"
      data-sub-receipt={pay.id}
      className={`${linkButtonClass()} inline-flex items-center gap-1.5 text-left`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(pay);
      }}
    >
      {name}
    </button>
  );
}

export function PayPill({ pay }: { pay: Pick<SubPay, 'status'> }) {
  const t = useT();
  const pill = SUB_PAY_PILL[pay.status];
  return (
    <Pill tone={pill.tone} icon={pill.icon}>
      {t(`sub.pay.st.${pay.status}`)}
    </Pill>
  );
}

/**
 * Одна оплата (прототип `subPayView`): статус, вид и срок, пакет, память, кто отправил, чек, расчёт; у
 * владельца — «Заменить файл чека» у непроверенной и «Прикрепить другой чек» у отклонённой.
 */
export function SubPayView({
  pay,
  checkDays,
  closed,
  own,
  open,
  onClose,
  onReceipt,
  onFile,
  onAgain,
}: {
  pay: SubPay;
  checkDays: number;
  closed: boolean;
  own: boolean;
  open: boolean;
  onClose: () => void;
  onReceipt?: (pay: SubPay) => void;
  onFile: (pay: SubPay) => void;
  onAgain: (pay: SubPay) => void;
}) {
  const t = useT();
  const again = own && pay.again;
  const items: KeyValueItem[] = [
    { id: 'st', label: t('sub.kv.st'), value: <PayPill pay={pay} /> },
    {
      id: 'kind',
      label: t('sub.kv.kind'),
      value: `${pay.planName || '—'} · ${termText(t, pay)}`,
    },
    { id: 'pack', label: t('sub.kv.pack'), value: pay.seats ? String(pay.seats) : '—' },
    { id: 'gb', label: t('sub.kv.gb'), value: t('sub.kv.gb_v', { n: pay.extraGb }) },
    {
      id: 'by',
      label: t('sub.kv.by'),
      value: (
        <>
          {whoText(t, pay)}
          <div className="text-[12px] text-muted">{formatMomentRu(new Date(pay.at))}</div>
        </>
      ),
    },
    {
      id: 'file',
      label: t('sub.kv.file'),
      value: pay.receipt ? (
        <ReceiptLink pay={pay} onOpen={onReceipt} />
      ) : (
        <span className="text-faint">{t('sub.kv.nofile')}</span>
      ),
    },
    ...(pay.decidedAt && pay.status !== 'pending'
      ? [
          {
            id: 'decided',
            label: t(pay.status === 'rejected' ? 'sub.kv.rejected' : 'sub.kv.confirmed'),
            value: formatMomentRu(new Date(pay.decidedAt)),
          },
        ]
      : []),
    ...(pay.paidUntil && pay.kind !== 'free' && pay.status === 'confirmed'
      ? [{ id: 'paid', label: t('sub.kv.paid'), value: formatDateRu(pay.paidUntil) }]
      : []),
    ...(pay.kind === 'free' && pay.reason
      ? [{ id: 'reason', label: t('sub.kv.reason'), value: pay.reason, wide: true }]
      : []),
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="mid"
      title={whatText(t, pay.kind)}
      sub={`${formatMomentRu(new Date(pay.at))} · ${t(`sub.pay.st.${pay.status}`)}`}
      footer={
        <>
          <div className="flex-1" />
          {own && pay.status === 'pending' ? (
            <button
              type="button"
              data-sub-view-file=""
              className={buttonClass()}
              onClick={() => onFile(pay)}
            >
              <Icon name="refresh" size="sm" />
              {t('sub.act.file')}
            </button>
          ) : null}
          {again ? (
            <button
              type="button"
              data-sub-view-again=""
              className={buttonClass('cta')}
              onClick={() => onAgain(pay)}
            >
              <Icon name="upload" size="sm" />
              {t('sub.act.again')}
            </button>
          ) : null}
          <button
            type="button"
            className={buttonClass(again ? 'default' : 'cta')}
            onClick={onClose}
          >
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-sub-view={pay.id} className="flex flex-col gap-3">
        {pay.status === 'rejected' ? (
          <Note tone="bad" icon="ban">
            <b>{t('sub.view.rej')}</b> {t('sub.view.reason', { reason: pay.reason ?? '—' })}
          </Note>
        ) : pay.status === 'pending' ? (
          <Note icon="clock">
            {t('sub.view.wait', { days: checkDays })}{' '}
            {t(pay.opensAccess || !closed ? 'sub.view.open' : 'sub.view.after')}
          </Note>
        ) : null}
        <Box>
          <KeyValues items={items} />
        </Box>
        <Box title={t('sub.view.calc')}>
          {pay.lines.length ? (
            <CalcTable lines={pay.lines} total={pay.amount} />
          ) : (
            <span className="text-faint">{t('sub.view.nosum')}</span>
          )}
        </Box>
      </div>
    </Modal>
  );
}

/** «Заменить файл чека» (прототип `subFileDlg`): только пока чек не проверен. */
export function ReplaceReceiptDialog({
  pay,
  open,
  onClose,
}: {
  pay: SubPay;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const toast = useToast();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return setError(t('sub.file.need'));
    setBusy(true);
    const res = await replaceSubReceipt(pay, file);
    setBusy(false);
    if (!res.ok) {
      // Чек успели проверить, запись изменили — список перечитывается, окно говорит причину.
      if (res.status === 409) void client.invalidateQueries({ queryKey: SUB_QUERY_KEY });
      return setError(errorText(res.error));
    }
    void client.invalidateQueries({ queryKey: SUB_QUERY_KEY });
    onClose();
    toast(t('sub.file.done'));
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={!!file}
      title={t('sub.file.title')}
      sub={`${whatText(t, pay.kind)} · ${formatSomWithUnit(pay.amount)}`}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-sub-file-ok=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void submit()}
          >
            <Icon name="check" size="sm" />
            {busy ? t('sub.file.busy') : t('sub.file.ok')}
          </button>
        </>
      }
    >
      <div data-sub-replace={pay.id} className="flex flex-col gap-2">
        {pay.receipt ? (
          <div className="text-[12px] text-muted">
            {t('sub.file.now', { name: pay.receipt.name })}
          </div>
        ) : null}
        <Field id="sfd-f" label={t('sub.file.label')}>
          <ReceiptDrop
            id="sfd-f"
            file={file}
            error={error}
            onPick={(f, e) => {
              setFile(f);
              setError(e);
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}
