'use client';

import {
  allocationBalance,
  allocationRowState,
  autoAllocate,
  bishkekDate,
  feePaymentErrorCode,
  feePaymentProblem,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  parseSom,
  tariffErrorCode,
  tariffProblem,
  whatsAppLink,
  type TariffPeriod,
} from '@buhuchet/domain';
import {
  FeePaymentSaved,
  isRecordChanged,
  OperationEdited,
  type ContractorFees,
  type FeePaymentEditForm,
  type FeePaymentForm,
  type FeeReminder,
} from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  Icon,
  inputClass,
  MiniTable,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { reasonNeeded, type ChangedPart } from '../finance/edit-reason';
import { editFeePayment, feePaymentEditFormQuery } from '../finance/journal-data';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { pickedMoneyFilesProblem, uploadMoneyFiles } from '../money/tax-data';
import { useShell } from '../shell/context';
import {
  addTariff,
  createFeePayment,
  feePaymentFormQuery,
  feeReminderQuery,
  logFeeReminder,
  useFeesRefresh,
} from './fees-data';

/*
 * Окна платы за обслуживание (задача 2.21; прототип modules/contractor-card.js — `tariffDlg`,
 * `feePayDlg`; ui/status-scale.js — `waDlg` с `fee`). Запись сохраняет сервер и проверяет права,
 * область и правила ещё раз; файлы оплаты загружаются к записанной оплате сразу после ответа.
 */

const todayBishkek = () => bishkekDate(new Date());

/** Текст отказа при загрузке окна: код ответа API — из словаря, иначе — общая ошибка. */
const loadError = (errorText: (e: ApiErrorLike) => string, e: unknown) =>
  errorText(e instanceof ApiFailure ? e.error : { code: 'unknown', message: '' });

/** Поле, к которому относится отказ сервера (`details.field`). */
const fieldOf = (details: unknown): string | undefined =>
  (details as { field?: string } | undefined)?.field;

/** Подзаголовок раздела окна (прототип `.box.flat h3`). */
function SectionTitle({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <h3 className="m-0 flex flex-wrap items-center gap-2 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">
      <span className="flex-1">{title}</span>
      {actions}
    </h3>
  );
}

function Footer({
  t,
  label,
  icon,
  busy,
  onClose,
  onOk,
}: {
  t: Translate;
  label: string;
  icon?: 'wallet';
  busy: boolean;
  onClose: () => void;
  onOk: () => void;
}) {
  return (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <button
        type="button"
        data-fee-ok=""
        className={buttonClass('cta')}
        disabled={busy}
        onClick={onOk}
      >
        {icon ? <Icon name={icon} size="sm" /> : null}
        {label}
      </button>
    </>
  );
}

/* ───────────── «Новая ставка обслуживания» ───────────── */

/**
 * «Новая ставка обслуживания» (прототип `tariffDlg`): сумма (подставлена действующая), «в месяц» или
 * «в год», с какого месяца (если ставка уже есть — не раньше следующего), примечание «Повышение с …».
 * Запись журнала не меняется и не удаляется.
 */
export function TariffDialog({
  fees,
  open,
  onClose,
  onDone,
}: {
  fees: ContractorFees;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const form = fees.tariffForm;
  const [amount, setAmount] = useState(() =>
    form?.amount != null ? formatSom(form.amount, 'auto') : '',
  );
  const [period, setPeriod] = useState<TariffPeriod>(form?.period ?? 'M');
  const [from, setFrom] = useState(form?.from ?? '');
  const [note, setNote] = useState(form?.note ?? '');
  const [errors, setErrors] = useState<{ amount?: string; from?: string }>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form) return;
    const sum = parseSom(amount);
    const problem = tariffProblem(fees.tariffs, sum, from || null, todayBishkek());
    if (problem) {
      const text = t(`err.${tariffErrorCode(problem)}`);
      return setErrors(problem === 'amount_required' ? { amount: text } : { from: text });
    }
    setBusy(true);
    const res = await addTariff(fees.contractor.id, { amount: sum ?? 0, period, from, note });
    setBusy(false);
    if (res.ok) {
      onDone();
      onClose();
      return void toast(t('fee.tariff.saved'));
    }
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (field === 'amount' || field === 'from') return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('fee.tariff.title')}
      sub={fees.contractor.name}
      footer={
        <Footer
          t={t}
          label={t('fee.tariff.ok')}
          busy={busy || !form}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-fee-tariff-dialog={fees.contractor.id}>
        <FormGrid>
          <Field id={`${id}-amount`} label={t('fee.tariff.amount')} required error={errors.amount}>
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-fee-tariff-amount=""
                className={`${inputClass()} tabular-nums`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-period`}
            label={t('fee.tariff.period')}
            hint={t('fee.tariff.period_hint')}
          >
            {(control) => (
              <select
                {...control}
                data-fee-tariff-period=""
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
            hint={t(form?.hasTariff ? 'fee.tariff.from_hint_next' : 'fee.tariff.from_hint_first')}
            error={errors.from}
          >
            {(control) => (
              <input
                {...control}
                type="month"
                data-fee-tariff-from=""
                min={form?.minFrom}
                className={inputClass()}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setErrors((x) => ({ ...x, from: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-note`} label={t('fee.tariff.note')} full>
            {(control) => (
              <input
                {...control}
                type="text"
                data-fee-tariff-note=""
                className={inputClass()}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </FormGrid>
        <Note>{t('fee.tariff.info')}</Note>
      </div>
    </Modal>
  );
}

/* ───────────── «Принять оплату за обслуживание» ───────────── */

/**
 * «Принять оплату за обслуживание» (прототип `feePayDlg`): сумма по умолчанию — долг, она сама делится
 * на неоплаченные месяцы от старых к новым (пока строки не правили руками), излишек — аванс; куда
 * поступили деньги — только организации; файл и примечание. Окно ждёт месяцы с сервера.
 */
export function FeePaymentDialog({
  contractorId,
  open,
  onClose,
  onDone,
}: {
  contractorId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { access } = useShell();
  const query = useQuery(feePaymentFormQuery(contractorId));
  const errorText = useErrorText();
  return (
    <FeePaymentModal
      key={query.data ? 'ready' : 'loading'}
      t={t}
      form={query.data ?? null}
      failed={query.isError ? loadError(errorText, query.error) : null}
      canUpload={access.feature('files') && access.can('filesUpload')}
      open={open}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/**
 * «Изменить оплату за обслуживание» (прототип `feePayDlg` с `edit`): то же окно с тем, что вводили, и
 * «Причина изменения»; сумма делится сначала на месяцы, которые оплата уже закрывала. Новые файлы окно
 * загружает к оплате после сохранения («Уже приложено: N»).
 */
export function FeePaymentEditDialog({
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
  const { access } = useShell();
  const query = useQuery(feePaymentEditFormQuery(id));
  const errorText = useErrorText();
  return (
    <FeePaymentModal
      key={query.data ? 'ready' : 'loading'}
      t={t}
      form={query.data ?? null}
      failed={query.isError ? loadError(errorText, query.error) : null}
      canUpload={access.feature('files') && access.can('filesUpload')}
      open={open}
      onClose={onClose}
      onDone={onDone}
      edit={query.data?.edit ?? null}
    />
  );
}

type FeeEdit = FeePaymentEditForm['edit'];

function FeePaymentModal({
  t,
  form,
  failed,
  canUpload,
  open,
  onClose,
  onDone,
  edit = null,
}: {
  t: Translate;
  form: FeePaymentForm | null;
  failed: string | null;
  canUpload: boolean;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  edit?: FeeEdit | null;
}) {
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const toText = (v: number) => formatSom(v, 'auto');
  const allocRows = (list: readonly { month: string; amount: number }[]) =>
    Object.fromEntries(list.map((x) => [x.month, toText(x.amount)]));
  const [sum, setSum] = useState(() => (form?.amount != null ? toText(form.amount) : ''));
  const [date, setDate] = useState(() => edit?.date ?? todayBishkek());
  const [to, setTo] = useState(() => edit?.to ?? form?.to[0]?.key ?? '');
  const [note, setNote] = useState(() => edit?.note ?? '');
  const [reason, setReason] = useState('');
  const [changed, setChanged] = useState(false);
  const [rows, setRows] = useState<Record<string, string>>(() =>
    form ? allocRows(form.allocation) : {},
  );
  // Строки правили руками — сумма их больше не перераспределяет (прототип `st.manual`).
  const [manual, setManual] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<{
    amount?: string;
    date?: string;
    to?: string;
    allocation?: string;
    files?: string;
    reason?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const months = form?.months ?? [];
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const ordered = (form?.order ?? [])
    .map((m) => byMonth.get(m))
    .filter((m): m is NonNullable<typeof m> => !!m);
  const valueOf = (month: string) => parseSom(rows[month] ?? '');
  const allocation = months
    .map((m) => ({ month: m.month, amount: valueOf(m.month) ?? 0 }))
    .filter((x) => x.amount !== 0);
  const total = parseSom(sum);
  const balance = allocationBalance(total ?? 0, allocation);
  const distributed = allocation.reduce((a, x) => a + x.amount, 0);

  const auto = (value: string) => setRows(allocRows(autoAllocate(ordered, parseSom(value) ?? 0)));

  // «Сохранить» изменения: причина — если меняются сумма, дата, месяцы или куда поступили деньги. Без
  // изменений — «Без изменений», как у остальных операций (opEditDlg), без пустой записи истории.
  // ОТКЛОНЕНИЕ: docs/deviations.md#В-28
  const saveEdit = async (e: FeeEdit) => {
    if (!form) return;
    const sig = (list: readonly { month: string; amount: number }[]) =>
      list
        .filter((x) => x.amount > 0)
        .map((x) => `${x.month}=${x.amount}`)
        .sort()
        .join(';');
    const parts: ChangedPart[] = [];
    if (total !== form.amount) parts.push('amount');
    if (date !== e.date) parts.push('date');
    if (sig(allocation) !== sig(form.allocation)) parts.push('months');
    if (to !== e.to) parts.push('to');
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    // Новые файлы — к оплате после сохранения (прототип: «добавлены файлы» без причины).
    const upload = async () =>
      picked.length
        ? uploadMoneyFiles(t, errorText, { kind: 'fee_payment', id: e.id }, picked)
        : null;
    if (parts.length === 0 && note === e.note) {
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
      return void toast(t('fin.fee.edit_done'), { icon: 'wallet' });
    }
    if (parts.length > 0 && !reason.trim())
      return setErrors({ reason: reasonNeeded(t, parts, true) });
    setBusy(true);
    const res = await editFeePayment(e.id, {
      version: e.version,
      amount: total ?? 0,
      date,
      to,
      allocation: allocation.filter((x) => x.amount > 0),
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
      return void toast(t(same ? 'fin.edit.same' : 'fin.fee.edit_done'), { icon: 'wallet' });
    }
    setBusy(false);
    if (isRecordChanged(res.error)) return setChanged(true);
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (
      field === 'amount' ||
      field === 'date' ||
      field === 'to' ||
      field === 'allocation' ||
      field === 'reason'
    )
      return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const save = async () => {
    if (!form) return;
    const problem = feePaymentProblem(months, total, allocation, date || null, todayBishkek());
    if (problem) {
      const text = t(`err.${feePaymentErrorCode(problem.problem)}`, {
        amount: problem.over !== undefined ? formatSomWithUnit(problem.over) : '',
      });
      return setErrors(problem.field === 'date' ? { date: text } : { amount: text });
    }
    if (!to) return setErrors({ to: t('err.fee_to_invalid') });
    if (edit) return saveEdit(edit);
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    setBusy(true);
    const res = await createFeePayment(form.contractor.id, {
      amount: total ?? 0,
      date,
      to,
      allocation: allocation.filter((x) => x.amount > 0),
      note,
      files: picked.length,
    });
    const saved = res.ok ? FeePaymentSaved.safeParse(res.data) : null;
    if (res.ok && saved?.success) {
      const failedUpload = picked.length
        ? await uploadMoneyFiles(t, errorText, { kind: 'fee_payment', id: saved.data.id }, picked)
        : null;
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('fee.pay.saved'), { icon: 'wallet' });
    }
    setBusy(false);
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (field === 'amount' || field === 'date' || field === 'to' || field === 'allocation')
      return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const subText = form
    ? form.debt
      ? t('fee.pay.sub_debt', { amount: formatSomWithUnit(form.debt) })
      : form.unpaid
        ? t('fee.pay.sub_unpaid', { amount: formatSomWithUnit(form.unpaid) })
        : t('fee.pay.sub_none')
    : '';
  const sub = form
    ? `${form.contractor.name} · ${
        form.advance && !edit
          ? t('fee.pay.sub_advance', { text: subText, amount: formatSomWithUnit(form.advance) })
          : subText
      }`
    : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      dirty={picked.length > 0 || (edit ? reason !== '' : note !== '') || manual}
      title={t(edit ? 'fin.fee.edit_title' : 'fee.pay.title')}
      sub={sub}
      footer={
        <Footer
          t={t}
          label={t(edit ? 'btn.save' : 'fee.pay.ok')}
          icon="wallet"
          busy={busy || !form}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div
        className="flex flex-col gap-3.5"
        data-fee-pay-dialog={form?.contractor.id ?? ''}
        data-fee-pay-edit={edit?.id}
      >
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onClose}
            reloading={false}
          />
        ) : null}
        {failed && !form ? <Note tone="bad">{failed}</Note> : null}
        <FormGrid>
          <Field
            id={`${id}-sum`}
            label={t('fee.pay.amount')}
            required
            hint={
              form?.debt
                ? t('fee.pay.amount_hint', { amount: formatSomWithUnit(form.debt) })
                : undefined
            }
            error={errors.amount}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-fee-pay-sum=""
                className={`${inputClass()} tabular-nums`}
                value={sum}
                onChange={(e) => {
                  setSum(e.target.value);
                  if (!manual) auto(e.target.value);
                  setErrors((x) => ({ ...x, amount: undefined, allocation: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-date`} label={t('fee.pay.date')} required error={errors.date}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-fee-pay-date=""
                max={todayBishkek()}
                className={inputClass()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setErrors((x) => ({ ...x, date: undefined }));
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-to`}
            label={t('fee.pay.to')}
            full
            hint={t('fee.pay.to_hint')}
            error={errors.to}
          >
            {(control) => (
              <select
                {...control}
                data-fee-pay-to=""
                className={`${inputClass()} cursor-pointer`}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setErrors((x) => ({ ...x, to: undefined }));
                }}
              >
                {(form?.to ?? []).map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </FormGrid>
        {/* Прототип: `box flat` — рамка на фоне `--pane-alt`. */}
        <section
          className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-pane-alt px-4 py-3.5"
          data-fee-pay-months=""
        >
          <SectionTitle
            title={t('fee.pay.months')}
            actions={
              months.length ? (
                <button
                  type="button"
                  data-fee-pay-auto=""
                  className={buttonClass('default', 'sm')}
                  onClick={() => {
                    setManual(false);
                    auto(sum);
                    setErrors((x) => ({ ...x, amount: undefined, allocation: undefined }));
                  }}
                >
                  <Icon name="list" size="sm" />
                  {t('fee.pay.auto')}
                </button>
              ) : null
            }
          />
          {months.length ? (
            <MiniTable
              label={t('fee.pay.months')}
              empty=""
              phoneCards={false}
              columns={[
                { key: 'month', label: t('fee.col.month') },
                { key: 'charge', label: t('fee.col.charged'), numeric: true },
                { key: 'got', label: t('fee.col.got'), numeric: true },
                { key: 'now', label: t('fee.col.allocate'), numeric: true, width: 140 },
                { key: 'state', label: t('fee.col.becomes') },
              ]}
              rows={months.map((m) => {
                const state = allocationRowState(m, valueOf(m.month) ?? 0);
                return {
                  key: m.month,
                  cells: {
                    month: (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {monthLabel(m.month)}
                        {m.overdue ? (
                          <span className="rounded bg-danger-bg px-1.5 text-[11px] text-danger-label">
                            {t('fee.pay.overdue')}
                          </span>
                        ) : null}
                      </span>
                    ),
                    charge: formatSom(m.charge),
                    got: formatSom(m.got),
                    now: (
                      <input
                        type="text"
                        inputMode="decimal"
                        data-fee-pay-row={m.month}
                        aria-label={t('fee.pay.allocate_aria', { month: monthLabel(m.month) })}
                        className={`${inputClass()} ml-auto max-w-[120px] text-right tabular-nums ${
                          state === 'over' ? 'border-danger' : ''
                        }`}
                        value={rows[m.month] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setManual(true);
                          setRows((r) => ({ ...r, [m.month]: v }));
                          setErrors((x) => ({ ...x, amount: undefined, allocation: undefined }));
                        }}
                      />
                    ),
                    state:
                      state === 'over' ? (
                        <Pill tone="bad" size="sm">
                          {t('fee.pay.row_over')}
                        </Pill>
                      ) : state === 'paid' ? (
                        <Pill tone="ok" size="sm" icon="ok">
                          {t('fee.pay.row_paid')}
                        </Pill>
                      ) : state === 'partial' ? (
                        <Pill tone="warn" size="sm">
                          {t('fee.pay.row_partial')}
                        </Pill>
                      ) : (
                        <span className="text-faint">—</span>
                      ),
                  },
                };
              })}
            />
          ) : form ? (
            <span className="text-faint">{t('fee.pay.no_months')}</span>
          ) : null}
          {errors.allocation ? (
            <div role="alert" className="text-[11.5px] text-danger">
              {errors.allocation}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2" data-fee-pay-line="">
            <span>
              {t('fee.pay.allocated')} <b className="tabular-nums">{formatSom(distributed)}</b>
            </span>
            <span className="flex-1" />
            {balance?.state === 'over' ? (
              <Pill tone="bad" icon="alert">
                {t('fee.pay.over', { amount: formatSom(balance.amount) })}
              </Pill>
            ) : balance?.state === 'advance' ? (
              <Pill tone="info" icon="info">
                {t('fee.pay.advance', { amount: formatSom(balance.amount) })}
              </Pill>
            ) : balance?.state === 'even' ? (
              <Pill tone="ok" icon="ok">
                {t('fee.pay.even')}
              </Pill>
            ) : null}
          </div>
        </section>
        <FormGrid>
          {canUpload ? (
            <Field
              id={`${id}-files`}
              label={t('fee.pay.file')}
              full
              hint={
                edit && edit.files > 0 ? t('fin.edit.files_have', { n: edit.files }) : undefined
              }
              error={errors.files}
            >
              {(control) => (
                <input
                  {...control}
                  type="file"
                  multiple
                  data-fee-pay-files=""
                  className={inputClass({ file: true })}
                  onChange={(e) => {
                    setPicked([...(e.target.files ?? [])]);
                    setErrors((x) => ({ ...x, files: undefined }));
                  }}
                />
              )}
            </Field>
          ) : null}
          <Field id={`${id}-note`} label={t('fee.pay.note')} full>
            {(control) => (
              <input
                {...control}
                type="text"
                data-fee-pay-note=""
                className={inputClass()}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {edit ? (
            <Field
              id={`${id}-why`}
              label={t('fin.edit.reason')}
              full
              hint={t('fin.fee.reason_hint')}
              error={errors.reason}
            >
              {(control) => (
                <textarea
                  {...control}
                  data-fee-pay-reason=""
                  maxLength={500}
                  placeholder={t('fin.fee.reason_ph')}
                  className={`${inputClass({ multiline: true })} min-h-14`}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setErrors((x) => ({ ...x, reason: undefined }));
                  }}
                />
              )}
            </Field>
          ) : null}
        </FormGrid>
      </div>
    </Modal>
  );
}

/* ───────────── «Напомнить в WhatsApp» о долге ───────────── */

/**
 * «Напомнить в WhatsApp» о долге за обслуживание (прототип `waDlg({cp, fee:true})`): основной счёт
 * организации для обслуживания, текст по шаблону waFee справочника платформы (его можно поправить);
 * «Открыть WhatsApp» открывает сообщение на номер контрагента, нажатие пишется в историю.
 */
export function FeeReminderDialog({
  contractorId,
  open,
  onClose,
  onDone,
}: {
  contractorId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const query = useQuery(feeReminderQuery(contractorId));
  return (
    <FeeReminderModal
      key={query.data ? 'ready' : 'loading'}
      t={t}
      data={query.data ?? null}
      failed={query.isError ? loadError(errorText, query.error) : null}
      open={open}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function FeeReminderModal({
  t,
  data,
  failed,
  open,
  onClose,
  onDone,
}: {
  t: Translate;
  data: FeeReminder | null;
  failed: string | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [text, setText] = useState(data?.text ?? '');
  const noPhone = !!data && !data.phone;
  const off = !data || noPhone;
  const req = data?.requisite ?? null;
  const footer = (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <a
        className={`${buttonClass('cta')} ${off ? 'pointer-events-none opacity-50' : ''}`}
        href={off || !data.phone ? undefined : whatsAppLink(data.phone, text)}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={off ? true : undefined}
        data-fee-wa-go=""
        onClick={() => {
          if (off) return;
          void logFeeReminder(data.contractor.id).then((res) => {
            onDone();
            if (!res.ok) return toast(errorText(res.error), { bad: true });
            toast(t('fee.wa.logged'), { icon: 'chat' });
          });
          onClose();
        }}
      >
        <Icon name="chat" size="sm" />
        {t('fee.wa.open')}
      </a>
    </>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('fee.wa.title')}
      sub={data ? `${data.contractor.name} · ${data.phoneText || '—'}` : ''}
      footer={footer}
    >
      <div className="flex flex-col gap-3" data-fee-wa-dialog={data?.contractor.id ?? ''}>
        {failed && !data ? <Note tone="bad">{failed}</Note> : null}
        {noPhone ? <Note tone="bad">{t('fee.wa.no_phone')}</Note> : null}
        {req ? (
          <section
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-pane-alt px-4 py-3"
            data-fee-wa-requisite=""
          >
            <SectionTitle title={t('fee.wa.where')} />
            <div className="flex flex-wrap items-center gap-1.5">
              {req.phone ? (
                <>
                  <Icon name="phone" size="sm" />
                  <span>{t('fee.wa.by_phone')}</span>
                </>
              ) : null}
              <b>{req.bank}</b>
              <span className={MONO_CLASS}>{req.number}</span>
              {req.holder ? <span className="text-muted">{req.holder}</span> : null}
            </div>
          </section>
        ) : null}
        {data ? (
          <Field id={`${id}-text`} label={t('fee.wa.text')} hint={t('fee.wa.text_hint')} full>
            {(control) => (
              <textarea
                {...control}
                data-fee-wa-text=""
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={`${inputClass({ multiline: true })} min-h-[150px]`}
              />
            )}
          </Field>
        ) : null}
        {data ? <Note>{t('fee.wa.note', { phone: data.phoneText || '—' })}</Note> : null}
      </div>
    </Modal>
  );
}

/* ───────────── Окна оплаты и напоминания для списка и карточки ───────────── */

/**
 * «Принять оплату за обслуживание» и «Напомнить о долге в WhatsApp» из меню «…» строки, кнопки шапки
 * карточки и вкладки «Обслуживание»: `accept(id)`, `remind(id)`, окна — `dialogs` в разметку.
 */
export function useFeeDialogs(): {
  accept: (contractorId: string) => void;
  remind: (contractorId: string) => void;
  dialogs: ReactNode;
} {
  const refresh = useFeesRefresh();
  const [pay, setPay] = useState<DialogSlot<string> | null>(null);
  const [wa, setWa] = useState<DialogSlot<string> | null>(null);
  return {
    accept: (cid) => setPay(openSlot(cid)),
    remind: (cid) => setWa(openSlot(cid)),
    dialogs: (
      <>
        {pay ? (
          <FeePaymentDialog
            key={`fee-pay-${pay.n}`}
            contractorId={pay.data}
            open={pay.open}
            onClose={() => setPay(closeSlot)}
            onDone={refresh}
          />
        ) : null}
        {wa ? (
          <FeeReminderDialog
            key={`fee-wa-${wa.n}`}
            contractorId={wa.data}
            open={wa.open}
            onClose={() => setWa(closeSlot)}
            onDone={refresh}
          />
        ) : null}
      </>
    ),
  };
}
