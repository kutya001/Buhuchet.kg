'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  monthOf,
  parseSom,
  paymentDefaults,
  paymentProblem,
  pluralForm,
} from '@buhuchet/domain';
import {
  isRecordChanged,
  PaymentSaved,
  ReceiptSaved,
  type ReceiptEditForm,
  type ReceiptForm,
  type ReportCard,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  Field,
  FormGrid,
  Icon,
  inputClass,
  KeyValues,
  MiniTable,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, callApi } from '../api-client';
import { reasonNeeded, type ChangedPart } from '../finance/edit-reason';
import { editReceipt, receiptEditFormQuery } from '../finance/journal-data';
import { useErrorText, useT } from '../l10n/provider';
import { reportSub } from '../reports/report-menu';
import { useShell } from '../shell/context';
import {
  pickedMoneyFilesProblem,
  receiptContractorsQuery,
  receiptFormQuery,
  uploadMoneyFiles,
} from './tax-data';

/*
 * Окна денег по отчётам (задача 2.19; ТЗ «Отчеты для сдачи» → «Оплата налога»; прототип
 * ui/status-scale.js payDlg, modules/contractors.js inDlg). Запись сохраняется на сервере, файлы
 * (платёжное поручение, скрин перевода) загружаются к записанной операции сразу после ответа.
 */

const todayBishkek = () => bishkekDate(new Date());

/** Поле, к которому относится отказ сервера (`details.field`). */
const fieldOf = (details: unknown): string | undefined =>
  (details as { field?: string } | undefined)?.field;

function Footer({
  label,
  icon,
  busy,
  onClose,
  onOk,
  cancel,
}: {
  label: string;
  icon: 'wallet' | 'download';
  busy: boolean;
  onClose: () => void;
  onOk: () => void;
  cancel: string;
}) {
  return (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {cancel}
      </button>
      <button
        type="button"
        data-money-ok=""
        className={buttonClass('cta')}
        disabled={busy}
        onClick={onOk}
      >
        <Icon name={icon} size="sm" />
        {label}
      </button>
    </>
  );
}

function FilesInput({ control, onPick }: { control: object; onPick: (files: File[]) => void }) {
  return (
    <input
      {...control}
      type="file"
      multiple
      data-money-files=""
      className={inputClass({ file: true })}
      onChange={(e) => onPick([...(e.target.files ?? [])])}
    />
  );
}

/* ───────────── «Оплата налога в бюджет» ───────────── */

/**
 * «Отметить оплаченным» (прототип payDlg): к уплате, уже оплачено, деньги контрагента на счёте;
 * «Оплатил контрагент сам» включён сразу, если денег контрагента на этот отчёт не хватает; дата не
 * позже сегодняшней, сумма (по умолчанию — ближайший неоплаченный платёж графика, может быть больше —
 * пеня) и платёжное поручение. Без «Оплатил сам» — только деньгами контрагента.
 */
export function PaymentDialog({
  card,
  canUpload,
  open,
  onClose,
  onDone,
  onReload,
}: {
  card: ReportCard;
  /** Можно ли прикрепить платёжку: «Файлы в карточках» и право «Загружать файлы». */
  canUpload: boolean;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  /** Запись изменил другой: перечитать карточку и открыть окно заново. */
  onReload: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const available = card.money?.available ?? 0;
  const defaults = paymentDefaults(
    { sum: card.amount, paid: card.paid },
    card.money?.schedule ?? [],
    card.funds,
  );
  const short = card.funds?.state !== 'enough';
  const [self, setSelf] = useState(defaults.self);
  const [date, setDate] = useState(todayBishkek);
  const [amount, setAmount] = useState(formatSom(Math.max(0, defaults.amount), 'auto'));
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<{ date?: string; amount?: string; files?: string }>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  const notEnough = () =>
    card.funds?.state === 'short'
      ? t('money.pay.not_enough_short', { amount: formatSomWithUnit(card.funds.short) })
      : t('money.pay.not_enough_available', { amount: formatSomWithUnit(available) });

  const save = async () => {
    if (!date || date > todayBishkek()) return setErrors({ date: t('err.money_date_future') });
    const n = parseSom(amount);
    const problem = paymentProblem(n ?? 0, self, card.funds, available);
    if (problem === 'amount_required') return setErrors({ amount: t('money.amount_invalid') });
    if (problem === 'not_enough') return setErrors({ amount: notEnough() });
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    setBusy(true);
    const res = await callApi(() =>
      api.api.reports[':id'].payments.$post({
        param: { id: card.id },
        json: { version: card.version, amount: n!, date, self },
      }),
    );
    const saved = res.ok ? PaymentSaved.safeParse(res.data) : null;
    if (res.ok && saved?.success) {
      const failed = picked.length
        ? await uploadMoneyFiles(
            t,
            errorText,
            { kind: 'tax_payment', id: saved.data.operationId },
            picked,
          )
        : null;
      setBusy(false);
      onDone();
      onClose();
      if (failed) toast(failed, { bad: true });
      return void toast(t(self ? 'money.pay.done_self' : 'money.pay.done'), { icon: 'wallet' });
    }
    setBusy(false);
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    if (isRecordChanged(res.error)) return setChanged(true);
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (field === 'date' || field === 'amount') return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={picked.length > 0}
      title={t('money.pay.title')}
      sub={reportSub(card)}
      footer={
        <Footer
          label={t('money.pay.ok')}
          icon="wallet"
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
          cancel={t('btn.cancel')}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-payment-dialog={card.id}>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onReload}
            reloading={false}
          />
        ) : null}
        <KeyValues
          items={[
            {
              id: 'due',
              label: t('money.pay.due'),
              value: <span className="tabular-nums">{formatSomWithUnit(card.amount ?? 0)}</span>,
            },
            {
              id: 'paid',
              label: t('money.pay.already'),
              value: <span className="tabular-nums">{formatSomWithUnit(card.paid)}</span>,
            },
            {
              id: 'available',
              label: t('money.pay.available'),
              value: <b className="tabular-nums">{formatSomWithUnit(available)}</b>,
            },
          ]}
        />
        <CheckRow
          checked={self}
          onChange={(on) => {
            setSelf(on);
            setErrors((x) => ({ ...x, amount: undefined }));
          }}
          data-payment-self=""
          label={t('money.pay.self')}
        >
          <span className="block text-[11.5px] leading-[1.4] text-faint">
            {t('money.pay.self_hint')}
          </span>
        </CheckRow>
        <FormGrid>
          <Field id={`${id}-date`} label={t('money.pay.date')} required error={errors.date}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-payment-date=""
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
            id={`${id}-amount`}
            label={t('money.pay.amount')}
            required
            hint={t('money.pay.amount_hint')}
            error={errors.amount}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-payment-amount=""
                className={`${inputClass()} tabular-nums`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
              />
            )}
          </Field>
          {canUpload ? (
            <Field
              id={`${id}-files`}
              label={t('money.pay.file')}
              full
              hint={t('money.pay.file_hint')}
              error={errors.files}
            >
              {(control) => (
                <FilesInput
                  control={control}
                  onPick={(f) => {
                    setPicked(f);
                    setErrors((x) => ({ ...x, files: undefined }));
                  }}
                />
              )}
            </Field>
          ) : null}
        </FormGrid>
        {self ? null : (
          <Note icon="lock">
            {t('money.pay.lock')}
            {short ? ` ${t('money.pay.lock_short')}` : ''}
          </Note>
        )}
      </div>
    </Modal>
  );
}

/* ───────────── «Поступление от контрагента» ───────────── */

/** Под какой отчёт сразу распределить (из карточки отчёта и «Принять» в списке). */
export interface ReceiptPreset {
  reportId: string;
  amount: number;
}

/**
 * «Поступление от контрагента» (прототип inDlg): общая сумма и дата, детализация по неоплаченным
 * отчётам по сроку оплаты («Распределить по срокам»), излишек — аванс; файлы — платёжка, чек, скрин
 * (обязательны, если так отмечено у контрагента и «Файлы в карточках» включены). Окно ждёт неоплаченные
 * отчёты с сервера. Без контрагента (из «+ Добавить» модуля «Финансовые операции») — сначала поле
 * «Контрагент» (прототип `inDlg()` без `c0`).
 */
export function ReceiptDialog({
  contractorId,
  preset,
  filesOn,
  canUpload,
  open,
  onClose,
  onDone,
}: {
  contractorId: string | null;
  preset: ReceiptPreset | null;
  /** «Файлы в карточках» включены: без них «Файл при поступлении» не требуется — приложить некуда. */
  filesOn: boolean;
  canUpload: boolean;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const choices = useQuery({ ...receiptContractorsQuery, enabled: contractorId === null });
  const [picked, setPicked] = useState<string | null>(null);
  const list = choices.data ?? [];
  // По умолчанию — первый неразовый контрагент (прототип: `visCps().find(c => c.kind !== 'oneoff')`).
  const cp = contractorId ?? picked ?? list.find((c) => !c.oneOff)?.id ?? list[0]?.id ?? null;
  const query = useQuery({ ...receiptFormQuery(cp ?? ''), enabled: !!cp });
  return (
    <ReceiptModal
      key={`${cp ?? ''}-${query.data ? 'ready' : 'loading'}`}
      t={t}
      form={query.data ?? null}
      failed={query.isError || choices.isError}
      preset={preset}
      filesOn={filesOn}
      canUpload={canUpload}
      open={open}
      onClose={onClose}
      onDone={onDone}
      picker={
        contractorId === null
          ? { options: list, value: cp ?? '', onChange: setPicked, empty: choices.isSuccess && !cp }
          : null
      }
      edit={null}
      onOpenOperation={null}
    />
  );
}

/**
 * «Изменить поступление» (прототип inDlg с `edit`): то же окно с введённым, файлы, «Счёт» и «Причина
 * изменения»; уменьшить на налоги можно не ниже уже потраченного — окно называет оплаты, которые
 * мешают. Новые файлы окно загружает к поступлению после сохранения.
 */
export function ReceiptEditDialog({
  id,
  open,
  onClose,
  onDone,
  onOpenOperation,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  onOpenOperation: (id: string) => void;
}) {
  const t = useT();
  const { access } = useShell();
  const filesOn = access.feature('files');
  const query = useQuery(receiptEditFormQuery(id));
  return (
    <ReceiptModal
      key={query.data ? 'ready' : 'loading'}
      t={t}
      form={query.data ?? null}
      failed={query.isError}
      preset={null}
      filesOn={filesOn}
      canUpload={filesOn && access.can('filesUpload')}
      open={open}
      onClose={onClose}
      onDone={onDone}
      picker={null}
      edit={query.data?.edit ?? null}
      onOpenOperation={onOpenOperation}
    />
  );
}

/**
 * «Платит одной суммой» (прототип inDlg, `one`): налоги со сроком оплаты до конца текущего месяца и
 * обслуживание по текущий месяц, общая сумма — их итог.
 */
function oneSumSplit(form: ReceiptForm) {
  const month = monthOf(form.today);
  const alloc: Record<string, string> = {};
  const fee: Record<string, string> = {};
  let total = 0;
  for (const r of form.rows) {
    if (monthOf(r.payDue) <= month && r.left > 0) {
      alloc[r.reportId] = formatSom(r.left, 'auto');
      total += r.left;
    }
  }
  for (const m of form.fee?.months ?? []) {
    if (m.month <= month && m.left > 0) {
      fee[m.month] = formatSom(m.left, 'auto');
      total += m.left;
    }
  }
  return { alloc, fee, total };
}

/** Поле «Контрагент» окна без контрагента. */
interface ReceiptPicker {
  options: readonly { id: string; name: string; oneOff: boolean }[];
  value: string;
  onChange: (id: string) => void;
  /** Контрагентов нет — записать некуда. */
  empty: boolean;
}

type ReceiptEdit = ReceiptEditForm['edit'];

function ReceiptModal({
  t,
  form,
  failed,
  preset,
  filesOn,
  canUpload,
  open,
  onClose,
  onDone,
  picker,
  edit,
  onOpenOperation,
}: {
  t: ReturnType<typeof useT>;
  form: ReceiptForm | null;
  failed: boolean;
  preset: ReceiptPreset | null;
  filesOn: boolean;
  canUpload: boolean;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  picker: ReceiptPicker | null;
  edit: ReceiptEdit | null;
  onOpenOperation: ((id: string) => void) | null;
}) {
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const presetOk = !!preset && !!form?.rows.some((r) => r.reportId === preset.reportId);
  // «Платит одной суммой»: деление на налоги и обслуживание подставляется само (не для «Оплатить» и
  // не при изменении).
  const one = !presetOk && !edit && !!form?.fee && form.contractor.oneSum;
  const [split] = useState(() => (one && form ? oneSumSplit(form) : null));
  const som = (v: number) => formatSom(v, 'auto');
  const [total, setTotal] = useState(() =>
    edit
      ? som(edit.total)
      : presetOk && preset
        ? som(preset.amount)
        : split?.total
          ? som(split.total)
          : '',
  );
  const [date, setDate] = useState(() => edit?.date ?? todayBishkek());
  const [alloc, setAlloc] = useState<Record<string, string>>(() =>
    edit
      ? Object.fromEntries(edit.rows.map((x) => [x.reportId, som(x.amount)]))
      : presetOk && preset
        ? { [preset.reportId]: som(preset.amount) }
        : (split?.alloc ?? {}),
  );
  const [feeAlloc, setFeeAlloc] = useState<Record<string, string>>(() =>
    edit
      ? Object.fromEntries((edit.fee ?? []).map((x) => [x.month, som(x.amount)]))
      : (split?.fee ?? {}),
  );
  const [holder, setHolder] = useState(() => edit?.holder ?? '');
  const [reason, setReason] = useState('');
  const [changed, setChanged] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  // Файл уже приложен к изменяемому поступлению — второй не требуется (прототип: «уже приложено N»).
  const needFile = filesOn && !!form?.contractor.needReceiptFile && !(edit && edit.files > 0);
  const fileHint =
    filesOn && form?.contractor.needReceiptFile
      ? edit && edit.files > 0
        ? t('money.in.files_need_have', { n: edit.files })
        : t('money.in.files_need')
      : undefined;
  const [errors, setErrors] = useState<{
    total?: string;
    date?: string;
    rows?: string;
    files?: string;
    reason?: string;
    contractor?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const rows = form?.rows ?? [];
  const feeRows = form?.fee?.months ?? [];
  const today = todayBishkek();
  const value = (rid: string) => parseSom(alloc[rid] ?? '') ?? 0;
  const feeValue = (month: string) => parseSom(feeAlloc[month] ?? '') ?? 0;
  const taxDetail = rows.reduce((a, r) => a + Math.max(0, value(r.reportId)), 0);
  const feeDetail = feeRows.reduce((a, m) => a + Math.max(0, feeValue(m.month)), 0);
  const detail = taxDetail + feeDetail;
  const totalN = parseSom(total);
  const totalSafe = totalN ?? 0;
  const rest =
    rows.reduce((a, r) => a + Math.max(0, r.left - value(r.reportId)), 0) +
    feeRows.reduce((a, m) => a + Math.max(0, m.left - feeValue(m.month)), 0);
  const overOf = (raw: string | undefined, left: number) => {
    const v = parseSom(raw ?? '');
    return v !== null && (v < 0 || v > left);
  };
  const over =
    rows.some((r) => overOf(alloc[r.reportId], r.left)) ||
    feeRows.some((m) => overOf(feeAlloc[m.month], m.left));

  // «Распределить по срокам»: сначала налоги по сроку оплаты, потом обслуживание от старых месяцев.
  const distribute = () => {
    let left =
      totalN ?? rows.reduce((a, r) => a + r.left, 0) + feeRows.reduce((a, m) => a + m.left, 0);
    if (totalN === null) setTotal(formatSom(left, 'auto'));
    const next: Record<string, string> = {};
    for (const r of rows) {
      const x = Math.min(left, r.left);
      if (x > 0) {
        next[r.reportId] = formatSom(x, 'auto');
        left -= x;
      }
    }
    const nextFee: Record<string, string> = {};
    for (const m of feeRows) {
      const x = Math.min(left, m.left);
      if (x > 0) {
        nextFee[m.month] = formatSom(x, 'auto');
        left -= x;
      }
    }
    setAlloc(next);
    setFeeAlloc(nextFee);
    setErrors((e) => ({ ...e, rows: undefined, total: undefined }));
  };

  const rowsOut = () =>
    rows
      .filter((r) => value(r.reportId) > 0)
      .map((r) => ({ reportId: r.reportId, amount: value(r.reportId) }));
  const feeOut = () =>
    feeRows
      .filter((m) => feeValue(m.month) > 0)
      .map((m) => ({ month: m.month, amount: feeValue(m.month) }));

  // «Сохранить» изменения (прототип inDlg с `edit`): на налоги не меньше потраченного, причина — если
  // меняются сумма, дата, детализация или счёт; проверяет и сервер. Новые файлы — каждый своей строкой
  // истории, как у файлов поступлений с задачи 2.19.
  // ОТКЛОНЕНИЕ: docs/deviations.md#В-28
  const saveEdit = async (e: ReceiptEdit) => {
    if (totalN === null || totalN <= 0) return setErrors({ total: t('money.amount_invalid') });
    if (detail > totalN)
      return setErrors({
        total: t('money.in.total_less', { amount: formatSomWithUnit(detail - totalN) }),
      });
    if (!date) return setErrors({ date: t('fin.edit.date_required') });
    if (date > todayBishkek()) return setErrors({ date: t('fin.edit.date_future') });
    if (over) return setErrors({ rows: t('err.receipt_row_over') });
    if (e.spent && totalN - feeDetail < e.spent.min)
      return setErrors({
        total: t('err.receipt_min', { amount: formatSomWithUnit(e.spent.min) }),
      });
    if (needFile && picked.length === 0)
      return setErrors({ files: t('err.receipt_file_required') });
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    const sig = (list: readonly { key: string; amount: number }[]) =>
      list
        .map((x) => `${x.key}=${x.amount}`)
        .sort()
        .join(';');
    const byReport = (list: readonly { reportId: string; amount: number }[]) =>
      sig(list.map((x) => ({ key: x.reportId, amount: x.amount })));
    const byMonth = (list: readonly { month: string; amount: number }[]) =>
      sig(list.map((x) => ({ key: x.month, amount: x.amount })));
    const parts: ChangedPart[] = [];
    if (totalN !== e.total) parts.push('amount');
    if (date !== e.date) parts.push('date');
    if (
      byReport(rowsOut()) !== byReport(e.rows) ||
      (e.fee !== null && byMonth(feeOut()) !== byMonth(e.fee))
    )
      parts.push('alloc');
    if (holder !== e.holder) parts.push('holder');
    // Новые файлы — к поступлению после сохранения (прототип: «добавлены файлы» без причины).
    const upload = async () =>
      picked.length ? uploadMoneyFiles(t, errorText, { kind: 'receipt', id: e.id }, picked) : null;
    // Без изменений, только с новыми файлами — файлы без записи «Сохранено без изменений» (прототип:
    // «Прикреплены файлы»); совсем без изменений — сохраняется, в истории «Сохранено без изменений».
    if (parts.length === 0 && picked.length > 0) {
      setBusy(true);
      const failedUpload = await upload();
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('fin.in_edit.done'), { icon: 'wallet' });
    }
    if (parts.length && !reason.trim()) return setErrors({ reason: reasonNeeded(t, parts, true) });
    setBusy(true);
    const res = await editReceipt(e.id, {
      version: e.version,
      total: totalN,
      date,
      rows: rowsOut(),
      ...(e.fee !== null ? { fee: feeOut() } : {}),
      holder,
      reason: reason.trim(),
    });
    if (res.ok) {
      const failedUpload = await upload();
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('fin.in_edit.done'), { icon: 'wallet' });
    }
    setBusy(false);
    if (isRecordChanged(res.error)) return setChanged(true);
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (field === 'fee') return setErrors({ rows: message });
    if (field === 'total' || field === 'date' || field === 'rows' || field === 'reason')
      return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const save = async () => {
    if (!form) {
      if (picker?.empty) setErrors({ contractor: t('money.in.contractor_required') });
      return;
    }
    if (edit) return saveEdit(edit);
    if (totalN === null || totalN <= 0) return setErrors({ total: t('money.amount_invalid') });
    if (detail > totalN)
      return setErrors({
        total: t('money.in.total_less', { amount: formatSomWithUnit(detail - totalN) }),
      });
    if (!date || date > todayBishkek()) return setErrors({ date: t('err.money_date_future') });
    if (over) return setErrors({ rows: t('err.receipt_row_over') });
    if (needFile && picked.length === 0)
      return setErrors({ files: t('err.receipt_file_required') });
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors[':id'].receipts.$post({
        param: { id: form.contractor.id },
        json: {
          total: totalN,
          date,
          rows: rowsOut(),
          ...(feeDetail > 0 ? { fee: feeOut() } : {}),
          files: picked.length,
        },
      }),
    );
    const saved = res.ok ? ReceiptSaved.safeParse(res.data) : null;
    if (res.ok && saved?.success) {
      const failedUpload = picked.length
        ? await uploadMoneyFiles(t, errorText, { kind: 'receipt', id: saved.data.id }, picked)
        : null;
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('money.in.done'), { icon: 'wallet' });
    }
    setBusy(false);
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    const message = errorText(res.error);
    const field = fieldOf(res.error.details);
    if (field === 'fee') return setErrors({ rows: message });
    if (field === 'total' || field === 'date' || field === 'rows' || field === 'files')
      return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const c = form?.contractor;
  const sub = c
    ? (c.paysTo === 'org'
        ? t('money.in.sub_org', { name: c.name })
        : t('money.in.sub_emp', { name: c.name, holder: c.holder ?? '—' })) +
      (feeRows.length ? ` · ${t('fee.receipt.to_org')}` : '')
    : '';
  const unpaidText = form
    ? form.unpaid
      ? t('money.in.all_received', {
          n: t(`report.count.${pluralForm(form.unpaid)}`, { n: form.unpaid }),
        })
      : t('money.in.no_unpaid')
    : '';
  const advance = totalSafe - detail;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      dirty={(edit ? reason !== '' : total !== '') || picked.length > 0}
      title={t(edit ? 'fin.in_edit.title' : 'money.in.title')}
      sub={sub}
      footer={
        <Footer
          label={t(edit ? 'btn.save' : 'money.in.ok')}
          icon={edit ? 'wallet' : 'download'}
          busy={busy || !form}
          onClose={onClose}
          onOk={() => void save()}
          cancel={t('btn.cancel')}
        />
      }
    >
      <div
        className="flex flex-col gap-3.5"
        data-receipt-dialog={c?.id ?? ''}
        data-receipt-edit={edit?.id}
      >
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onClose}
            reloading={false}
          />
        ) : null}
        {failed && !form ? <Note tone="bad">{t('money.in.load_error')}</Note> : null}
        {edit?.spent ? (
          <>
            <Note tone="warn" icon="lock">
              {t('fin.in_edit.spent', { amount: formatSomWithUnit(edit.spent.min) })}
            </Note>
            <MiniTable
              label={t('fin.del.blocked_pay')}
              empty=""
              phoneCards={false}
              onOpen={onOpenOperation ? (key) => onOpenOperation(key) : undefined}
              columns={[
                { key: 'report', label: t('fin.del.blocked_pay') },
                { key: 'date', label: t('fin.op.date') },
                { key: 'amount', label: t('fin.op.amount'), numeric: true },
              ]}
              rows={edit.spent.payments.map((p) => ({
                key: p.id,
                cells: {
                  report: p.report,
                  date: formatDateRu(p.date),
                  amount: formatSom(p.amount),
                },
              }))}
            />
          </>
        ) : null}
        {picker ? (
          <FormGrid>
            <Field
              id={`${id}-cp`}
              label={t('money.in.contractor')}
              required
              full
              error={errors.contractor}
            >
              {(control) => (
                <select
                  {...control}
                  data-receipt-contractor=""
                  className={`${inputClass()} cursor-pointer`}
                  value={picker.value}
                  onChange={(e) => picker.onChange(e.target.value)}
                >
                  {picker.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </FormGrid>
        ) : null}
        {one ? (
          <Note icon="coins">
            <b>{t('fee.receipt.one_sum_title')}</b> {t('fee.receipt.one_sum_text')}
          </Note>
        ) : null}
        <FormGrid>
          <Field
            id={`${id}-total`}
            label={t('money.in.total')}
            required
            hint={t('money.in.total_hint')}
            error={errors.total}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-receipt-total=""
                placeholder={formatSom(1500000, 'auto')}
                className={`${inputClass()} tabular-nums`}
                value={total}
                onChange={(e) => {
                  setTotal(e.target.value);
                  setErrors((x) => ({ ...x, total: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-date`} label={t('money.in.date')} required error={errors.date}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-receipt-date=""
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
        </FormGrid>
        <section className="flex min-w-0 flex-col gap-2.5" data-receipt-detail="">
          <h3 className="m-0 flex flex-wrap items-center gap-2 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">
            <span className="flex-1">{t('money.in.detail')}</span>
            <button
              type="button"
              data-receipt-auto=""
              className={buttonClass('default', 'sm')}
              onClick={distribute}
              disabled={!rows.length && !feeRows.length}
            >
              <Icon name="list" size="sm" />
              {t('money.in.auto')}
            </button>
          </h3>
          {rows.length || feeRows.length ? (
            <MiniTable
              label={t('money.in.detail')}
              empty=""
              phoneCards={false}
              columns={[
                { key: 'report', label: t('money.in.col_report') },
                { key: 'period', label: t('money.in.col_period') },
                { key: 'payDue', label: t('money.in.col_pay_due') },
                { key: 'sum', label: t('money.in.col_sum'), numeric: true },
                { key: 'already', label: t('money.in.col_already'), numeric: true },
                { key: 'now', label: t('money.in.col_now'), numeric: true, width: 150 },
                { key: 'left', label: t('money.in.col_left'), numeric: true },
              ]}
              rows={[
                ...rows.map((r) => {
                  const x = r.left - value(r.reportId);
                  return {
                    key: r.reportId,
                    cells: {
                      report: r.typeShort,
                      period: r.periodLabel,
                      payDue: (
                        <span
                          className={r.payDue < today ? 'font-semibold text-danger' : undefined}
                        >
                          {formatDateRu(r.payDue)}
                        </span>
                      ),
                      sum: formatSom(r.sum),
                      already: formatSom(r.already),
                      now: (
                        <input
                          type="text"
                          inputMode="decimal"
                          data-receipt-row={r.reportId}
                          aria-label={t('money.in.row_aria', { report: r.typeShort })}
                          className={`${inputClass()} ml-auto max-w-[130px] text-right tabular-nums ${
                            x < 0 ? 'border-danger' : ''
                          }`}
                          value={alloc[r.reportId] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAlloc((a) => ({ ...a, [r.reportId]: v }));
                            setErrors((er) => ({ ...er, rows: undefined, total: undefined }));
                          }}
                        />
                      ),
                      left: (
                        <b className={x < 0 ? 'text-danger' : x === 0 ? 'text-faint' : undefined}>
                          {formatSom(x)}
                        </b>
                      ),
                    },
                  };
                }),
                ...feeRows.map((m) => {
                  const x = m.left - feeValue(m.month);
                  return {
                    key: `fee-${m.month}`,
                    cells: {
                      report: (
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name="coins" size="sm" />
                          {t('fee.receipt.row')}
                        </span>
                      ),
                      period: monthLabel(m.month),
                      payDue: formatDateRu(m.due),
                      sum: formatSom(m.charge),
                      already: formatSom(m.got),
                      now: (
                        <input
                          type="text"
                          inputMode="decimal"
                          data-receipt-fee={m.month}
                          aria-label={t('fee.receipt.aria')}
                          className={`${inputClass()} ml-auto max-w-[130px] text-right tabular-nums ${
                            x < 0 ? 'border-danger' : ''
                          }`}
                          value={feeAlloc[m.month] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setFeeAlloc((a) => ({ ...a, [m.month]: v }));
                            setErrors((er) => ({ ...er, rows: undefined, total: undefined }));
                          }}
                        />
                      ),
                      left: (
                        <b className={x < 0 ? 'text-danger' : x === 0 ? 'text-faint' : undefined}>
                          {formatSom(x)}
                        </b>
                      ),
                    },
                  };
                }),
                {
                  key: 'total',
                  cells: {
                    report: <b>{t('money.in.total_row')}</b>,
                    sum: (
                      <b>
                        {formatSom(
                          rows.reduce((a, r) => a + r.sum, 0) +
                            feeRows.reduce((a, m) => a + m.charge, 0),
                        )}
                      </b>
                    ),
                    already: (
                      <b>
                        {formatSom(
                          rows.reduce((a, r) => a + r.already, 0) +
                            feeRows.reduce((a, m) => a + m.got, 0),
                        )}
                      </b>
                    ),
                    now: <b>{formatSom(detail)}</b>,
                    left: <b>{formatSom(rest)}</b>,
                  },
                },
              ]}
            />
          ) : form ? (
            <span className="text-faint">{unpaidText}</span>
          ) : null}
          {errors.rows ? (
            <div role="alert" className="text-[11.5px] text-danger">
              {errors.rows}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2" data-receipt-sumline="">
            <span>
              {t('money.in.sumline')} <b className="tabular-nums">{formatSom(detail)}</b>
              {feeDetail ? (
                <span className="text-muted">
                  {' '}
                  {t('fee.receipt.split', {
                    tax: formatSom(taxDetail),
                    fee: formatSom(feeDetail),
                  })}
                </span>
              ) : null}
            </span>
            <span className="flex-1" />
            {detail > totalSafe ? (
              <Pill tone="bad" icon="alert">
                {t('money.in.over', { amount: formatSom(detail - totalSafe) })}
              </Pill>
            ) : advance > 0 ? (
              <Pill tone="info" icon="info">
                {t('money.in.advance', { amount: formatSom(advance) })}
              </Pill>
            ) : totalSafe > 0 ? (
              <Pill tone="ok" icon="ok">
                {t('money.in.match')}
              </Pill>
            ) : null}
          </div>
          <span className="text-[11.5px] leading-[1.4] text-faint">
            {t('money.in.hint')}
            {feeRows.length ? ` ${t('fee.receipt.hint')}` : ''}
          </span>
        </section>
        {canUpload ? (
          <FormGrid>
            <Field
              id={`${id}-files`}
              label={t('money.in.files')}
              full
              required={needFile}
              hint={fileHint}
              error={errors.files}
            >
              {(control) => (
                <FilesInput
                  control={control}
                  onPick={(f) => {
                    setPicked(f);
                    setErrors((x) => ({ ...x, files: undefined }));
                  }}
                />
              )}
            </Field>
          </FormGrid>
        ) : needFile ? (
          <Note tone="warn" icon="clip">
            {errors.files ?? t('err.receipt_file_required')}
          </Note>
        ) : null}
        {edit ? (
          <FormGrid>
            <Field id={`${id}-acc`} label={t('fin.edit.account')}>
              {(control) => (
                <select
                  {...control}
                  data-receipt-holder=""
                  className={`${inputClass()} cursor-pointer`}
                  value={holder}
                  onChange={(e) => {
                    setHolder(e.target.value);
                    setErrors((x) => ({ ...x, reason: undefined }));
                  }}
                >
                  {edit.accounts.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.key === 'org'
                        ? t('fin.edit.acc_org')
                        : t(a.responsible ? 'fin.edit.acc_resp' : 'fin.edit.acc_emp', {
                            name: a.name ?? '—',
                          })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div />
            <Field
              id={`${id}-why`}
              label={t('fin.edit.reason')}
              full
              hint={t('fin.in_edit.reason_hint')}
              error={errors.reason}
            >
              {(control) => (
                <textarea
                  {...control}
                  data-receipt-reason=""
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
      </div>
    </Modal>
  );
}
