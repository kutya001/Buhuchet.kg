'use client';

import {
  formatDateRu,
  formatSom,
  monthLabel,
  monthLabelGen,
  parseSom,
  tariffEditChanges,
  tariffEditProblems,
  type FirstMonthMode,
  type TariffEditProblem,
  type TariffPeriod,
} from '@buhuchet/domain';
import { TariffEdited, type ContractorFees } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  Icon,
  inputClass,
  Modal,
  Note,
  useToast,
} from '@buhuchet/ui';
import { useId, useState } from 'react';
import { useErrorText, useT } from '../l10n/provider';
import { deleteTariff, editTariff } from './fees-data';
import { tariffGone, tariffSavedText } from './tariff-edit';

/*
 * «Изменить ставку обслуживания» (прототип v86 modules/contractor-card.js `tariffEditDlg`;
 * docs/deviations.md п. О-78): сумма, периодичность, месяц «действует с» и — у первой ставки неполного
 * месяца — правило первого месяца; причина обязательна. Ставку, которая ещё не начала действовать,
 * можно удалить. Правила — домен (`tariffEditProblems`, `tariffEditChanges`), сервер проверяет их ещё
 * раз вместе с правом, областью и версией записи.
 */

export type TariffRow = ContractorFees['tariffs'][number];

type Errors = { amount?: string; from?: string; reason?: string };

const FIRST_MONTH_OPTIONS = ['full', 'prorate', 'next'] as const;

export function TariffEditDialog({
  fees,
  tariff,
  open,
  onClose,
  onDone,
}: {
  fees: ContractorFees;
  tariff: TariffRow;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const cp = fees.contractor;
  const [amount, setAmount] = useState(() => formatSom(tariff.amount, 'auto'));
  const [period, setPeriod] = useState<TariffPeriod>(tariff.period);
  const [from, setFrom] = useState<string>(tariff.from);
  const [first, setFirst] = useState<FirstMonthMode>(cp.firstMonth);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const problemText = (problem: TariffEditProblem | undefined) =>
    problem
      ? t(`err.tariff_${problem}`, { month: monthLabel(cp.startDate.slice(0, 7)) })
      : undefined;

  /**
   * Отказ сервера: у своего поля, иначе — сообщением. Ставку тем временем изменили или удалили —
   * окно закрывается, журнал перечитывается: правку начинают заново по свежей записи.
   */
  const refused = (error: Parameters<typeof errorText>[0]) => {
    const message = errorText(error);
    const field = (error.details as { field?: string } | undefined)?.field;
    if (field === 'amount' || field === 'from' || field === 'reason')
      return setErrors({ [field]: message });
    toast(message, { bad: true });
    if (tariffGone(error.code)) {
      onDone();
      onClose();
    }
  };

  const save = async () => {
    const sum = parseSom(amount);
    const edit = {
      amount: sum,
      period,
      from: from || null,
      firstMonth: tariff.firstMonthEditable ? first : undefined,
      reason,
    };
    const problems = tariffEditProblems(fees.tariffs, tariff, edit, cp.startDate);
    if (problems.amount || problems.from || problems.reason) {
      return setErrors({
        amount: problemText(problems.amount),
        from: problemText(problems.from),
        reason: problemText(problems.reason),
      });
    }
    if (!tariffEditChanges(tariff, edit, cp.firstMonth).length) {
      onClose();
      return void toast(t('fee.tedit.none'));
    }
    setBusy(true);
    const res = await editTariff(cp.id, tariff.id, {
      amount: sum ?? 0,
      period,
      from,
      ...(tariff.firstMonthEditable ? { firstMonth: first } : {}),
      reason,
      version: tariff.version,
    });
    setBusy(false);
    if (!res.ok) return refused(res.error);
    const saved = TariffEdited.safeParse(res.data);
    onDone();
    onClose();
    toast(tariffSavedText(t, saved.success ? saved.data : null));
  };

  const remove = async () => {
    if (!reason.trim()) return setErrors({ reason: t('err.tariff_edit_reason_required') });
    setBusy(true);
    const res = await deleteTariff(cp.id, tariff.id, { reason, version: tariff.version });
    setBusy(false);
    if (!res.ok) return refused(res.error);
    onDone();
    onClose();
    toast(t('fee.tedit.deleted'));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('fee.tedit.title')}
      sub={t('fee.tedit.sub', { name: cp.name, month: monthLabelGen(tariff.from) })}
      footer={
        <>
          {tariff.deletable ? (
            <button
              type="button"
              data-fee-tedit-delete=""
              className={buttonClass('danger')}
              disabled={busy}
              onClick={() => void remove()}
            >
              <Icon name="trash" size="sm" />
              {t('fee.tedit.delete')}
            </button>
          ) : null}
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-fee-tedit-ok=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5" data-fee-tedit-dialog={tariff.id}>
        <FormGrid>
          <Field id={`${id}-amount`} label={t('fee.tariff.amount')} required error={errors.amount}>
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-fee-tedit-amount=""
                className={`${inputClass()} tabular-nums`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-period`} label={t('fee.tariff.period')}>
            {(control) => (
              <select
                {...control}
                data-fee-tedit-period=""
                className={`${inputClass()} cursor-pointer`}
                value={period}
                onChange={(e) => setPeriod(e.target.value as TariffPeriod)}
              >
                <option value="M">{t('fee.tariff.period_month')}</option>
                <option value="Y">{t('fee.tariff.period_year')}</option>
              </select>
            )}
          </Field>
          <Field
            id={`${id}-from`}
            label={t('fee.tariff.from')}
            required
            hint={t(tariff.first ? 'fee.tedit.from_hint_first' : 'fee.tedit.from_hint')}
            error={errors.from}
          >
            {(control) => (
              <input
                {...control}
                type="month"
                data-fee-tedit-from=""
                min={tariff.first ? cp.startDate.slice(0, 7) : undefined}
                className={inputClass()}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setErrors((x) => ({ ...x, from: undefined }));
                }}
              />
            )}
          </Field>
          {tariff.firstMonthEditable ? (
            <Field
              id={`${id}-first`}
              label={t('fee.tedit.first')}
              hint={t('fee.tedit.first_hint', { date: formatDateRu(cp.startDate) })}
            >
              {(control) => (
                <select
                  {...control}
                  data-fee-tedit-first=""
                  className={`${inputClass()} cursor-pointer`}
                  value={first}
                  onChange={(e) => setFirst(e.target.value as FirstMonthMode)}
                >
                  {FIRST_MONTH_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {t(`cp.form.first.${m}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <div />
          )}
          <Field
            id={`${id}-reason`}
            label={t('fee.tedit.reason')}
            required
            full
            error={errors.reason}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                data-fee-tedit-reason=""
                maxLength={500}
                placeholder={t('fee.tedit.reason_ph')}
                className={inputClass()}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setErrors((x) => ({ ...x, reason: undefined }));
                }}
              />
            )}
          </Field>
        </FormGrid>
        <Note tone="warn">{t('fee.tedit.warn')}</Note>
      </div>
    </Modal>
  );
}
