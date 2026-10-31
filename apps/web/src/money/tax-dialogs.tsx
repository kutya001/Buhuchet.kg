'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  parseSom,
  paymentDefaults,
  paymentProblem,
  pluralForm,
} from '@buhuchet/domain';
import {
  isRecordChanged,
  PaymentSaved,
  ReceiptSaved,
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
import { useErrorText, useT } from '../l10n/provider';
import { reportSub } from '../reports/report-menu';
import { pickedMoneyFilesProblem, receiptFormQuery, uploadMoneyFiles } from './tax-data';

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
 * (обязательны, если так отмечено у контрагента). Окно ждёт неоплаченные отчёты с сервера.
 */
export function ReceiptDialog({
  contractorId,
  preset,
  canUpload,
  open,
  onClose,
  onDone,
}: {
  contractorId: string;
  preset: ReceiptPreset | null;
  canUpload: boolean;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const query = useQuery(receiptFormQuery(contractorId));
  return (
    <ReceiptModal
      key={query.data ? 'ready' : 'loading'}
      t={t}
      form={query.data ?? null}
      failed={query.isError}
      preset={preset}
      canUpload={canUpload}
      open={open}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function ReceiptModal({
  t,
  form,
  failed,
  preset,
  canUpload,
  open,
  onClose,
  onDone,
}: {
  t: ReturnType<typeof useT>;
  form: ReceiptForm | null;
  failed: boolean;
  preset: ReceiptPreset | null;
  canUpload: boolean;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const presetOk = !!preset && !!form?.rows.some((r) => r.reportId === preset.reportId);
  const [total, setTotal] = useState(() =>
    presetOk && preset ? formatSom(preset.amount, 'auto') : '',
  );
  const [date, setDate] = useState(todayBishkek);
  const [alloc, setAlloc] = useState<Record<string, string>>(() =>
    presetOk && preset ? { [preset.reportId]: formatSom(preset.amount, 'auto') } : {},
  );
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<{
    total?: string;
    date?: string;
    rows?: string;
    files?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const rows = form?.rows ?? [];
  const today = todayBishkek();
  const value = (rid: string) => parseSom(alloc[rid] ?? '') ?? 0;
  const detail = rows.reduce((a, r) => a + Math.max(0, value(r.reportId)), 0);
  const totalN = parseSom(total);
  const totalSafe = totalN ?? 0;
  const rest = rows.reduce((a, r) => a + Math.max(0, r.left - value(r.reportId)), 0);
  const over = rows.some((r) => {
    const v = parseSom(alloc[r.reportId] ?? '');
    return v !== null && (v < 0 || v > r.left);
  });

  const distribute = () => {
    let left = totalN ?? rows.reduce((a, r) => a + r.left, 0);
    if (totalN === null) setTotal(formatSom(left, 'auto'));
    const next: Record<string, string> = {};
    for (const r of rows) {
      const x = Math.min(left, r.left);
      if (x > 0) {
        next[r.reportId] = formatSom(x, 'auto');
        left -= x;
      }
    }
    setAlloc(next);
    setErrors((e) => ({ ...e, rows: undefined, total: undefined }));
  };

  const save = async () => {
    if (!form) return;
    if (totalN === null || totalN <= 0) return setErrors({ total: t('money.amount_invalid') });
    if (detail > totalN)
      return setErrors({
        total: t('money.in.total_less', { amount: formatSomWithUnit(detail - totalN) }),
      });
    if (!date || date > todayBishkek()) return setErrors({ date: t('err.money_date_future') });
    if (over) return setErrors({ rows: t('err.receipt_row_over') });
    if (form.contractor.needReceiptFile && picked.length === 0)
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
          rows: rows
            .filter((r) => value(r.reportId) > 0)
            .map((r) => ({ reportId: r.reportId, amount: value(r.reportId) })),
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
    if (field === 'total' || field === 'date' || field === 'rows' || field === 'files')
      return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const c = form?.contractor;
  const sub = c
    ? c.paysTo === 'org'
      ? t('money.in.sub_org', { name: c.name })
      : t('money.in.sub_emp', { name: c.name, holder: c.holder ?? '—' })
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
      dirty={total !== '' || picked.length > 0}
      title={t('money.in.title')}
      sub={sub}
      footer={
        <Footer
          label={t('money.in.ok')}
          icon="download"
          busy={busy || !form}
          onClose={onClose}
          onOk={() => void save()}
          cancel={t('btn.cancel')}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-receipt-dialog={c?.id ?? ''}>
        {failed && !form ? <Note tone="bad">{t('money.in.load_error')}</Note> : null}
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
              disabled={!rows.length}
            >
              <Icon name="list" size="sm" />
              {t('money.in.auto')}
            </button>
          </h3>
          {rows.length ? (
            <MiniTable
              label={t('money.in.detail')}
              empty=""
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
                {
                  key: 'total',
                  cells: {
                    report: <b>{t('money.in.total_row')}</b>,
                    sum: <b>{formatSom(rows.reduce((a, r) => a + r.sum, 0))}</b>,
                    already: <b>{formatSom(rows.reduce((a, r) => a + r.already, 0))}</b>,
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
          <span className="text-[11.5px] leading-[1.4] text-faint">{t('money.in.hint')}</span>
        </section>
        {canUpload ? (
          <FormGrid>
            <Field
              id={`${id}-files`}
              label={t('money.in.files')}
              full
              required={c?.needReceiptFile ?? false}
              hint={c?.needReceiptFile ? t('money.in.files_need') : undefined}
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
        ) : c?.needReceiptFile ? (
          <Note tone="warn" icon="clip">
            {errors.files ?? t('err.receipt_file_required')}
          </Note>
        ) : null}
      </div>
    </Modal>
  );
}
