'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  parseSom,
} from '@buhuchet/domain';
import { isRecordChanged, OperationEdited, type OperationEditForm } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { pickedMoneyFilesProblem, uploadMoneyFiles } from '../money/tax-data';
import { useShell } from '../shell/context';
import { reasonNeeded, type ChangedPart } from './edit-reason';
import { editOperation, operationEditFormQuery } from './journal-data';

/*
 * «Изменить: …» операции по счёту контрагента (задача 2.22; ТЗ «Финансовые операции по контрагентам»
 * → «Изменить» и «Удалить» с причиной; прототип modules/fin-op.js `opEditDlg`): сумма (не больше
 * свободных денег), дата, счёт, примечание, «Добавить файлы» и причина изменения — обязательна, если
 * меняются сумма, дата или счёт. Контрагента и вид операции не меняют. Новые файлы окно загружает
 * после сохранения. Сервер проверяет всё ещё раз.
 */

const todayBishkek = () => bishkekDate(new Date());

/** Поле, к которому относится отказ сервера (`details.field`). */
const fieldOf = (details: unknown): string | undefined =>
  (details as { field?: string } | undefined)?.field;

/** Подпись счёта в списке (прототип: «Счёт организации», «Счёт Асель — ответственный»). */
export function accountLabel(
  t: Translate,
  a: { key: string; name: string | null; responsible: boolean },
): string {
  if (a.key === 'org') return t('fin.edit.acc_org');
  return t(a.responsible ? 'fin.edit.acc_resp' : 'fin.edit.acc_emp', { name: a.name ?? '—' });
}

export function OperationEditDialog({
  id,
  open,
  onClose,
  onDone,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const { access } = useShell();
  const query = useQuery(operationEditFormQuery(id));
  const failed = query.isError
    ? errorText(
        query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
      )
    : null;
  return (
    <EditModal
      key={query.data ? 'ready' : 'loading'}
      t={t}
      form={query.data ?? null}
      failed={failed}
      canUpload={access.feature('files') && access.can('filesUpload')}
      open={open}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

type Errors = Partial<Record<'amount' | 'date' | 'holder' | 'files' | 'reason', string>>;

function EditModal({
  t,
  form,
  failed,
  canUpload,
  open,
  onClose,
  onDone,
}: {
  t: Translate;
  form: OperationEditForm | null;
  failed: string | null;
  canUpload: boolean;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [sign, setSign] = useState(() => form?.sign ?? '-');
  const [amount, setAmount] = useState(() => (form ? formatSom(form.amount, 'auto') : ''));
  const [date, setDate] = useState(() => form?.date ?? todayBishkek());
  const [holder, setHolder] = useState(() => form?.holder ?? '');
  const [note, setNote] = useState(() => form?.note ?? '');
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const kindLabel = form
    ? t(form.self && form.kind === 'pay' ? 'money.op.self' : `money.op.${form.kind}`)
    : '';
  const corr = form?.kind === 'corr';
  const signText = (s: string | null) => (s === '-' ? '−' : s === '+' ? '+' : '');

  const save = async () => {
    if (!form) return;
    const n = parseSom(amount);
    // Прототип opEditDlg: сначала сумма и её предел, потом дата, потом причина.
    // Предел суммы («Свободный остаток контрагента …», «Денег контрагента не хватает …») — текстом
    // сервера: он знает, какой предел у этого вида операции.
    if (n === null || n <= 0) return setErrors({ amount: t('err.op_amount_required') });
    if (corr) {
      const was = form.sign === '-' ? -form.amount : form.amount;
      const now = sign === '-' ? -n : n;
      if (now < was && was - now > form.available)
        return setErrors({
          amount: t('err.op_corr_over', { amount: formatSomWithUnit(form.available) }),
        });
    }
    if (!date) return setErrors({ date: t('fin.edit.date_required') });
    if (date > todayBishkek()) return setErrors({ date: t('fin.edit.date_future') });
    const parts: ChangedPart[] = [];
    if (n !== form.amount || (corr && sign !== form.sign)) parts.push('amount');
    if (date !== form.date) parts.push('date');
    if (form.accounts && holder !== form.holder) parts.push('holder');
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    // Новые файлы — к операции после сохранения (прототип: «добавлены файлы» без причины), каждый —
    // своей строкой истории.
    // ОТКЛОНЕНИЕ: docs/deviations.md#В-28
    const kind = form.kind === 'pay' ? 'tax_payment' : 'money_operation';
    const upload = async () =>
      picked.length ? uploadMoneyFiles(t, errorText, { kind, id: form.id }, picked) : null;
    if (parts.length === 0 && note === form.note) {
      if (picked.length === 0) {
        onClose();
        return void toast(t('fin.edit.same'), { icon: 'info' });
      }
      setBusy(true);
      const failedUpload = await upload();
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('fin.edit.done'), { icon: 'edit' });
    }
    if (parts.length > 0 && !reason.trim())
      return setErrors({ reason: reasonNeeded(t, parts, false) });
    setBusy(true);
    const res = await editOperation(form.id, {
      version: form.version,
      amount: n,
      ...(corr ? { sign } : {}),
      date,
      ...(form.accounts ? { holder } : {}),
      note,
      reason: reason.trim(),
    });
    if (res.ok) {
      const saved = OperationEdited.safeParse(res.data);
      const failedUpload = await upload();
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      const same = saved.success && !saved.data.changed && !picked.length;
      return void toast(t(same ? 'fin.edit.same' : 'fin.edit.done'), { icon: 'edit' });
    }
    setBusy(false);
    if (isRecordChanged(res.error)) return setChanged(true);
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (field === 'amount' || field === 'date' || field === 'holder' || field === 'reason')
      return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const hasAcc = !!form?.accounts;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={reason !== '' || picked.length > 0}
      title={form ? t('fin.edit.title', { kind: kindLabel.toLowerCase() }) : ''}
      label={form ? undefined : t('fin.op.edit')}
      sub={
        form
          ? t('fin.edit.sub', {
              name: form.contractor.name,
              amount: `${signText(form.sign)}${formatSomWithUnit(form.amount)}`,
              date: formatDateRu(form.date),
            })
          : undefined
      }
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-fin-ok=""
            className={buttonClass('cta')}
            disabled={busy || !form}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5" data-fin-edit={form?.id ?? ''}>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onClose}
            reloading={false}
          />
        ) : null}
        {failed && !form ? <Note tone="bad">{failed}</Note> : null}
        {form ? (
          <FormGrid>
            {corr ? (
              <Field id={`${id}-sign`} label={t('fin.edit.sign')} full>
                {(control) => (
                  <select
                    {...control}
                    data-fin-sign=""
                    className={`${inputClass()} cursor-pointer`}
                    value={sign}
                    onChange={(e) => {
                      setSign(e.target.value as '-' | '+');
                      setErrors({});
                    }}
                  >
                    <option value="-">{t('fin.corr.minus')}</option>
                    <option value="+">{t('fin.corr.plus')}</option>
                  </select>
                )}
              </Field>
            ) : null}
            <Field
              id={`${id}-amount`}
              label={t('fin.edit.amount')}
              required
              hint={
                form.max !== null
                  ? t('fin.edit.max', { amount: formatSomWithUnit(form.max) })
                  : undefined
              }
              error={errors.amount}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  data-fin-amount=""
                  className={`${inputClass()} tabular-nums`}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setErrors((x) => ({ ...x, amount: undefined, reason: undefined }));
                  }}
                />
              )}
            </Field>
            <Field id={`${id}-date`} label={t('fin.edit.date')} required error={errors.date}>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  data-fin-date=""
                  max={todayBishkek()}
                  className={inputClass()}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setErrors((x) => ({ ...x, date: undefined, reason: undefined }));
                  }}
                />
              )}
            </Field>
            {form.accounts ? (
              <Field
                id={`${id}-acc`}
                label={t(form.kind === 'xfer' ? 'fin.edit.to' : 'fin.edit.account')}
                error={errors.holder}
              >
                {(control) => (
                  <select
                    {...control}
                    data-fin-holder=""
                    className={`${inputClass()} cursor-pointer`}
                    value={holder}
                    onChange={(e) => {
                      setHolder(e.target.value);
                      setErrors((x) => ({ ...x, holder: undefined, reason: undefined }));
                    }}
                  >
                    {(form.accounts ?? []).map((a) => (
                      <option key={a.key} value={a.key}>
                        {accountLabel(t, a)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}
            <Field
              id={`${id}-note`}
              label={t(form.kind === 'bonus' ? 'fin.edit.note_bonus' : 'fin.edit.note')}
              full
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  data-fin-note=""
                  maxLength={500}
                  className={inputClass()}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            {form.files !== null && canUpload ? (
              <Field
                id={`${id}-files`}
                label={t('fin.edit.files')}
                full
                hint={form.files > 0 ? t('fin.edit.files_have', { n: form.files }) : undefined}
                error={errors.files}
              >
                {(control) => (
                  <input
                    {...control}
                    type="file"
                    multiple
                    data-fin-files=""
                    className={inputClass({ file: true })}
                    onChange={(e) => {
                      setPicked([...(e.target.files ?? [])]);
                      setErrors((x) => ({ ...x, files: undefined }));
                    }}
                  />
                )}
              </Field>
            ) : null}
            <Field
              id={`${id}-why`}
              label={t('fin.edit.reason')}
              full
              hint={t(hasAcc ? 'fin.edit.reason_hint_acc' : 'fin.edit.reason_hint')}
              error={errors.reason}
            >
              {(control) => (
                <textarea
                  {...control}
                  data-fin-reason=""
                  maxLength={500}
                  placeholder={t('fin.edit.reason_ph')}
                  className={`${inputClass({ multiline: true })} min-h-14`}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setErrors((x) => ({ ...x, reason: undefined }));
                  }}
                />
              )}
            </Field>
          </FormGrid>
        ) : null}
        {form ? <Note icon="info">{t('fin.edit.info')}</Note> : null}
      </div>
    </Modal>
  );
}
