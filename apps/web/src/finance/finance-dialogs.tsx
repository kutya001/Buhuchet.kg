'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  monthLabel,
  parseSom,
} from '@buhuchet/domain';
import {
  OperationSaved,
  type ArchiveRestItem,
  type FeePaymentWindow,
  type OperationWindow,
  type TransferForm,
} from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  Icon,
  inputClass,
  MiniTable,
  Modal,
  Note,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import {
  correctReceipt,
  deleteOperation,
  transfer,
  transferFormQuery,
  useFinanceRefresh,
  writeOff,
} from './finance-data';
import { deleteWords } from './finance-history';
import { deleteFeePayment } from './journal-data';

/*
 * Окна остатка контрагента и операции (задача 2.20; прототип modules/contractors.js `moneyOpDlg`,
 * `restDlg`; modules/finance.js `xferDlg`, `corrDlg`; modules/fin-op.js `opDelDlg`). Запись сохраняет
 * сервер и проверяет права, область и правила ещё раз.
 */

const todayBishkek = () => bishkekDate(new Date());

/** Поле, к которому относится отказ сервера (`details.field`). */
const fieldOf = (details: unknown): string | undefined =>
  (details as { field?: string } | undefined)?.field;

/** Текст отказа при загрузке окна: код ответа API — из словаря, иначе — общая ошибка. */
const loadError = (errorText: (e: ApiErrorLike) => string, e: unknown) =>
  errorText(e instanceof ApiFailure ? e.error : { code: 'unknown', message: '' });

/**
 * Кнопка, которую нельзя нажать (прототип `opBtn` и `.dis` с `data-why`): видна приглушённой, по
 * нажатию — подсказка почему (на телефоне title не виден).
 */
export function WhyButton({
  icon,
  label,
  why,
  onClick,
  cta = false,
  size,
  data,
}: {
  icon: IconName;
  label: string;
  why: string | null;
  onClick: () => void;
  cta?: boolean;
  size?: 'sm';
  data?: string;
}) {
  const toast = useToast();
  return (
    <button
      type="button"
      data-fin-action={data}
      className={`${buttonClass(cta ? 'cta' : 'default', size)} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:shadow-none`}
      aria-disabled={why ? true : undefined}
      title={why ?? label}
      aria-label={label}
      onClick={() => (why ? toast(why, { icon: 'lock', bad: true }) : onClick())}
    >
      <Icon name={icon} size="sm" />
      <span className={size ? 'max-md:hidden' : undefined}>{label}</span>
    </button>
  );
}

function Footer({
  t,
  label,
  icon,
  busy,
  danger = false,
  onClose,
  onOk,
}: {
  t: Translate;
  label: string;
  icon?: IconName;
  busy: boolean;
  danger?: boolean;
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
        data-fin-ok=""
        className={buttonClass(danger ? 'danger' : 'cta')}
        disabled={busy}
        onClick={onOk}
      >
        {icon ? <Icon name={icon} size="sm" /> : null}
        {label}
      </button>
    </>
  );
}

function DateInput({
  control,
  value,
  onChange,
}: {
  control: object;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      {...control}
      type="date"
      data-fin-date=""
      max={todayBishkek()}
      className={inputClass()}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function AmountInput({
  control,
  value,
  onChange,
}: {
  control: object;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      {...control}
      type="text"
      inputMode="decimal"
      data-fin-amount=""
      className={`${inputClass()} tabular-nums`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

type Errors = Partial<Record<'amount' | 'date' | 'note' | 'to' | 'reason', string>>;

/** Отказ сервера — под полем, если он про поле, иначе — всплывающим сообщением. */
function useFail(setErrors: (e: Errors) => void) {
  const toast = useToast();
  const errorText = useErrorText();
  return (error: ApiErrorLike & { details?: unknown }) => {
    const message = errorText(error);
    const field = fieldOf(error.details);
    if (field === 'amount' || field === 'date' || field === 'to' || field === 'reason')
      return setErrors({ [field]: message });
    toast(message, { bad: true });
  };
}

/* ───────────── «Списать остаток в бонус» и «Вернуть остаток контрагенту» ───────────── */

/**
 * «Списать в бонус» и «Вернуть остаток» (прототип moneyOpDlg): сумма (подставлен свободный остаток), не
 * больше свободного; дата; у списания — «Причина» («Остаток после оплаты налогов»), у возврата —
 * «Комментарий».
 */
export function WriteOffDialog({
  contractor,
  free,
  kind,
  open,
  onClose,
  onDone,
}: {
  contractor: { id: string; name: string };
  free: number;
  kind: 'bonus' | 'refund';
  open: boolean;
  onClose: () => void;
  onDone: (amount: number) => void;
}) {
  const t = useT();
  const toast = useToast();
  const id = useId();
  const [amount, setAmount] = useState(formatSom(Math.max(0, free), 'auto'));
  const [date, setDate] = useState(todayBishkek);
  const [note, setNote] = useState(kind === 'bonus' ? t('fin.bonus.reason_default') : '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);
  const bonus = kind === 'bonus';

  const save = async () => {
    const n = parseSom(amount);
    if (!n || n <= 0) return setErrors({ amount: t('err.op_amount_required') });
    if (n > free)
      return setErrors({
        amount: t('err.writeoff_free_over', { amount: formatSomWithUnit(Math.max(0, free)) }),
      });
    if (!date || date > todayBishkek()) return setErrors({ date: t('err.money_date_future') });
    setBusy(true);
    const res = await writeOff(contractor.id, { kind, amount: n, date, note: note.trim() });
    setBusy(false);
    if (!res.ok) return fail(res.error);
    onDone(n);
    onClose();
    toast(t(bonus ? 'fin.bonus.done' : 'fin.refund.done'), { icon: bonus ? 'gift' : 'refresh' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t(bonus ? 'fin.bonus.title' : 'fin.refund.title')}
      sub={t('fin.wo.sub', { name: contractor.name, amount: formatSomWithUnit(free) })}
      footer={
        <Footer
          t={t}
          label={t(bonus ? 'fin.bonus.ok' : 'fin.refund.ok')}
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-fin-writeoff={kind}>
        <FormGrid>
          <Field id={`${id}-amount`} label={t('fin.wo.amount')} required error={errors.amount}>
            {(control) => (
              <AmountInput
                control={control}
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-date`} label={t('fin.wo.date')} required error={errors.date}>
            {(control) => (
              <DateInput
                control={control}
                value={date}
                onChange={(v) => {
                  setDate(v);
                  setErrors((x) => ({ ...x, date: undefined }));
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-note`}
            label={t(bonus ? 'fin.wo.reason' : 'fin.wo.comment')}
            full
            error={errors.note}
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
        </FormGrid>
        <Note icon="lock">
          {t(bonus ? 'fin.bonus.lock' : 'fin.refund.lock')} {t('fin.wo.lock_tail')}
        </Note>
      </div>
    </Modal>
  );
}

/* ───────────── «Перевод на счёт сотрудника» ───────────── */

/**
 * «Перевод» (прототип xferDlg): «Кому» — активные сотрудники, кроме владельца, ответственный — по
 * умолчанию; сумма не больше денег контрагента на счёте организации; дата; комментарий.
 */
export function TransferDialog({
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
  const query = useQuery(transferFormQuery(contractorId));
  const form = query.data ?? null;
  return (
    <TransferModal
      key={form ? 'ready' : 'loading'}
      t={t}
      form={form}
      failed={query.isError ? loadError(errorText, query.error) : null}
      open={open}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function TransferModal({
  t,
  form,
  failed,
  open,
  onClose,
  onDone,
}: {
  t: Translate;
  form: TransferForm | null;
  failed: string | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const id = useId();
  const [to, setTo] = useState(
    form?.targets.find((x) => x.responsible)?.id ?? form?.targets[0]?.id ?? '',
  );
  const [amount, setAmount] = useState(form ? formatSom(form.max, 'auto') : '');
  const [date, setDate] = useState(form?.today ?? todayBishkek());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);

  const save = async () => {
    if (!form) return;
    const n = parseSom(amount);
    if (!n || n <= 0) return setErrors({ amount: t('fin.xfer.amount_required') });
    if (n > form.max) return setErrors({ amount: t('err.xfer_over') });
    if (!to) return setErrors({ to: t('err.xfer_to_invalid') });
    if (!date || date > todayBishkek()) return setErrors({ date: t('err.money_date_future') });
    setBusy(true);
    const res = await transfer(form.contractor.id, { to, amount: n, date, note: note.trim() });
    setBusy(false);
    if (!res.ok) return fail(res.error);
    onDone();
    onClose();
    toast(t('fin.xfer.done'), { icon: 'send' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('fin.xfer.title')}
      sub={
        form
          ? t('fin.xfer.sub', { name: form.contractor.name, amount: formatSomWithUnit(form.max) })
          : ''
      }
      footer={
        <Footer
          t={t}
          label={t('fin.xfer.ok')}
          busy={busy || !form}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-fin-transfer={form?.contractor.id ?? ''}>
        {failed && !form ? <Note tone="bad">{failed}</Note> : null}
        {form ? (
          <>
            <FormGrid>
              <Field id={`${id}-to`} label={t('fin.xfer.to')} required error={errors.to}>
                {(control) => (
                  <select
                    {...control}
                    data-fin-to=""
                    className={`${inputClass()} cursor-pointer`}
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setErrors((x) => ({ ...x, to: undefined }));
                    }}
                  >
                    {form.targets.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.responsible ? t('fin.xfer.responsible', { name: x.name }) : x.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                id={`${id}-amount`}
                label={t('fin.xfer.amount')}
                required
                hint={t('fin.xfer.amount_hint', { amount: formatSomWithUnit(form.max) })}
                error={errors.amount}
              >
                {(control) => (
                  <AmountInput
                    control={control}
                    value={amount}
                    onChange={(v) => {
                      setAmount(v);
                      setErrors((x) => ({ ...x, amount: undefined }));
                    }}
                  />
                )}
              </Field>
              <Field id={`${id}-date`} label={t('fin.wo.date')} required error={errors.date}>
                {(control) => (
                  <DateInput
                    control={control}
                    value={date}
                    onChange={(v) => {
                      setDate(v);
                      setErrors((x) => ({ ...x, date: undefined }));
                    }}
                  />
                )}
              </Field>
              <Field id={`${id}-note`} label={t('fin.wo.comment')} full>
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
            </FormGrid>
            <Note>{t('fin.xfer.note')}</Note>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/* ───────────── «Обратная запись к поступлению» ───────────── */

/**
 * «Обратная запись» (прототип corrDlg): уменьшить или увеличить, сумма, дата, причина обязательна.
 * «Уменьшить» — не больше денег контрагента на счетах и самого поступления (проверяет сервер).
 */
export function CorrectionDialog({
  receipt,
  open,
  onClose,
  onDone,
}: {
  receipt: { id: string; contractor: string; total: number; date: string };
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const id = useId();
  const [sign, setSign] = useState<'-' | '+'>('-');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayBishkek);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);

  const save = async () => {
    const n = parseSom(amount);
    const found: Errors = {};
    if (!n || n <= 0) found.amount = t('err.op_amount_required');
    if (!reason.trim()) found.reason = t('err.op_reason_required');
    if (!date || date > todayBishkek()) found.date = t('err.money_date_future');
    if (Object.keys(found).length) return setErrors(found);
    setBusy(true);
    const res = await correctReceipt(receipt.id, { sign, amount: n!, date, reason: reason.trim() });
    setBusy(false);
    if (!res.ok) return fail(res.error);
    if (!OperationSaved.safeParse(res.data).success) return toast(t('err.unknown'), { bad: true });
    onDone();
    onClose();
    toast(t('fin.corr.done'), { icon: 'refresh' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={!!amount || !!reason}
      title={t('fin.corr.title')}
      sub={t('fin.corr.sub', {
        name: receipt.contractor,
        amount: formatSomWithUnit(receipt.total),
        date: formatDateRu(receipt.date),
      })}
      footer={
        <Footer
          t={t}
          label={t('fin.corr.ok')}
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-fin-correction={receipt.id}>
        <FormGrid>
          <Field id={`${id}-sign`} label={t('fin.corr.sign')}>
            {(control) => (
              <select
                {...control}
                data-fin-sign=""
                className={`${inputClass()} cursor-pointer`}
                value={sign}
                onChange={(e) => setSign(e.target.value as '-' | '+')}
              >
                <option value="-">{t('fin.corr.minus')}</option>
                <option value="+">{t('fin.corr.plus')}</option>
              </select>
            )}
          </Field>
          <Field id={`${id}-amount`} label={t('fin.wo.amount')} required error={errors.amount}>
            {(control) => (
              <AmountInput
                control={control}
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-date`} label={t('fin.wo.date')} required error={errors.date}>
            {(control) => (
              <DateInput
                control={control}
                value={date}
                onChange={(v) => {
                  setDate(v);
                  setErrors((x) => ({ ...x, date: undefined }));
                }}
              />
            )}
          </Field>
          <div />
          <Field id={`${id}-reason`} label={t('fin.wo.reason')} required full error={errors.reason}>
            {(control) => (
              <input
                {...control}
                type="text"
                data-fin-reason=""
                maxLength={500}
                placeholder={t('fin.corr.reason_ph')}
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
        <Note>{t('fin.corr.note')}</Note>
      </div>
    </Modal>
  );
}

/* ───────────── «Удалить», «Отменить списание», «Отменить возврат» ───────────── */

/** Что произойдёт после удаления (прототип opDelDlg, `cons`). */
function consequences(t: Translate, op: OperationWindow): string {
  switch (op.kind) {
    case 'in': {
      const head = t(op.allocations.length ? 'fin.del.cons.in_alloc' : 'fin.del.cons.in');
      const fee = op.receiptParts?.fee ?? 0;
      return fee ? `${head} ${t('fin.del.cons.in_fee', { amount: formatSomWithUnit(fee) })}` : head;
    }
    case 'pay':
      return t('fin.del.cons.pay', { report: op.report?.label ?? '' });
    case 'bonus':
      return t('fin.del.cons.bonus', { name: op.holder.name ?? '—' });
    case 'refund':
      return t('fin.del.cons.refund');
    case 'xfer':
      return t('fin.del.cons.xfer');
    case 'corr':
      return t('fin.del.cons.corr');
    default:
      return '';
  }
}

/**
 * «Удалить» (прототип opDelDlg): поступление, из которого уже оплачены налоги, и обратную запись «+»,
 * деньги которой потрачены, удалить нельзя — окно объясняет и показывает оплаты; иначе — причина
 * обязательна, запись получает отметку «Удалена».
 */
export function OperationDeleteDialog({
  op,
  open,
  onClose,
  onDone,
  onOpenOperation,
}: {
  op: OperationWindow;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  onOpenOperation: (id: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const id = useId();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);
  const words = deleteWords(op.kind);
  const label = t(`money.op.${op.kind}`);
  const amount = formatSomWithUnit(Math.abs(op.amount));
  const block = op.deleteBlock;
  const sub = t('fin.del.sub', {
    kind: label,
    name: op.contractor.name,
    amount,
    date: formatDateRu(op.date),
  });

  const save = async () => {
    if (!reason.trim()) return setErrors({ reason: t('err.op_reason_required') });
    setBusy(true);
    const res = await deleteOperation(op.id, reason.trim());
    setBusy(false);
    if (!res.ok) return fail(res.error);
    onDone();
    onClose();
    toast(t(words.done), { icon: 'trash' });
  };

  if (block) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        kind="form"
        title={t('fin.del.title_blocked')}
        sub={sub}
        footer={
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('fin.del.understood')}
          </button>
        }
      >
        <div className="flex flex-col gap-3" data-fin-delete-blocked={block.code}>
          <Note tone="warn" icon="lock">
            {t(`err.${block.code}`, {
              available: formatSomWithUnit(block.available),
              amount: formatSomWithUnit(block.amount),
            })}
          </Note>
          {block.payments.length ? (
            <MiniTable
              label={t('fin.del.blocked_pay')}
              empty=""
              phoneCards={false}
              onOpen={(key) => onOpenOperation(key)}
              columns={[
                { key: 'report', label: t('fin.del.blocked_pay') },
                { key: 'date', label: t('fin.op.date') },
                { key: 'amount', label: t('fin.op.amount'), numeric: true },
              ]}
              rows={block.payments.map((p) => ({
                key: p.id,
                cells: {
                  report: p.report,
                  date: formatDateRu(p.date),
                  amount: formatSom(p.amount),
                },
              }))}
            />
          ) : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={!!reason}
      title={t(words.title)}
      sub={sub}
      footer={
        <Footer
          t={t}
          label={t(words.ok)}
          icon={op.kind === 'bonus' || op.kind === 'refund' ? 'history' : 'trash'}
          danger
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3" data-fin-delete={op.id}>
        <p className="m-0">{t(words.ask, { amount })}</p>
        <Note icon="history">
          {consequences(t, op)} {t('fin.del.keep')}
        </Note>
        <Field id={`${id}-reason`} label={t('fin.del.reason')} required full error={errors.reason}>
          {(control) => (
            <textarea
              {...control}
              data-fin-reason=""
              maxLength={500}
              placeholder={t('fin.del.reason_ph')}
              className={`${inputClass({ multiline: true })} min-h-16`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setErrors({});
              }}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

/**
 * «Удалить» оплату за обслуживание (задача 2.22; прототип opDelDlg с `src:'fee'`): причина обязательна;
 * долг за её месяцы пересчитается (без месяцев — уменьшится аванс); запись получает отметку «Удалена» и
 * видна с «Показать удалённые».
 */
export function FeePaymentDeleteDialog({
  payment,
  open,
  onClose,
  onDone,
}: {
  payment: FeePaymentWindow;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const id = useId();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);
  const amount = formatSomWithUnit(payment.amount);
  const months = payment.allocation
    .map((x) => monthLabel(x.month as `${number}-${number}`))
    .join(', ');

  const save = async () => {
    if (!reason.trim()) return setErrors({ reason: t('err.op_reason_required') });
    setBusy(true);
    const res = await deleteFeePayment(payment.id, reason.trim());
    setBusy(false);
    if (!res.ok) return fail(res.error);
    onDone();
    onClose();
    toast(t('fin.del.done'), { icon: 'trash' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={!!reason}
      title={t('fin.del.title')}
      sub={t('fin.del.sub', {
        kind: t('fin.fee.kind'),
        name: payment.contractor.name,
        amount,
        date: formatDateRu(payment.date),
      })}
      footer={
        <Footer
          t={t}
          label={t('fin.del.ok')}
          icon="trash"
          danger
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3" data-fee-delete={payment.id}>
        <p className="m-0">{t('fin.del.ask', { amount })}</p>
        <Note icon="history">
          {months ? t('fin.del.cons.fee', { months }) : t('fin.del.cons.fee_adv')}{' '}
          {t('fin.del.keep')}
        </Note>
        <Field id={`${id}-reason`} label={t('fin.del.reason')} required full error={errors.reason}>
          {(control) => (
            <textarea
              {...control}
              data-fin-reason=""
              maxLength={500}
              placeholder={t('fin.del.reason_ph')}
              className={`${inputClass({ multiline: true })} min-h-16`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setErrors({});
              }}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

/* ───────────── «Остаток денег у архивных контрагентов» ───────────── */

/**
 * После «В архив» (прототип restDlg): контрагенты со свободным остатком — где деньги и сколько;
 * «Вернуть» и «В бонус» (у контрагента, который переводит деньги ответственному, при «Виртуальных
 * счетах») открывают те же окна, что вкладка «Деньги». «Решить позже» — кнопки остаются там.
 */
export function RestDialog({
  items,
  open,
  onClose,
}: {
  items: readonly ArchiveRestItem[];
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { access } = useShell();
  const refresh = useFinanceRefresh();
  const [rows, setRows] = useState(items);
  const [dialog, setDialog] = useState<DialogSlot<{
    item: ArchiveRestItem;
    kind: 'bonus' | 'refund';
  }> | null>(null);
  const left = rows.filter((x) => x.free > 0);
  const bonusOn = access.feature('accounts');
  const action = (item: ArchiveRestItem, kind: 'bonus' | 'refund', icon: IconName): ReactNode => (
    <button
      type="button"
      data-fin-rest={kind}
      className={buttonClass('default', 'sm')}
      onClick={() => setDialog(openSlot({ item, kind }))}
    >
      <Icon name={icon} size="sm" />
      {t(kind === 'bonus' ? 'fin.rest.bonus' : 'fin.rest.refund')}
    </button>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('fin.rest.title')}
      sub={t('fin.rest.sub')}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t(left.length ? 'fin.rest.later' : 'btn.done')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-fin-rest-dialog={left.length}>
        {left.length ? (
          <>
            <MiniTable
              label={t('fin.rest.title')}
              empty=""
              phoneCards={false}
              columns={[
                { key: 'name', label: t('fin.rest.col.cp') },
                { key: 'where', label: t('fin.rest.col.where') },
                { key: 'rest', label: t('fin.rest.col.rest'), numeric: true },
                { key: 'act', label: '', numeric: true },
              ]}
              rows={left.map((x) => ({
                key: x.id,
                cells: {
                  name: x.name,
                  where: x.paysTo === 'org' ? t('fin.rest.org') : (x.holder ?? '—'),
                  rest: <b>{formatSom(x.free)}</b>,
                  act: (
                    <span className="inline-flex gap-1.5 whitespace-nowrap">
                      {action(x, 'refund', 'refresh')}
                      {x.paysTo === 'emp' && bonusOn ? action(x, 'bonus', 'gift') : null}
                    </span>
                  ),
                },
              }))}
            />
            <span className="text-[11.5px] leading-[1.4] text-faint">{t('fin.rest.hint')}</span>
          </>
        ) : (
          <Note icon="ok">{t('fin.rest.empty')}</Note>
        )}
      </div>
      {dialog ? (
        <WriteOffDialog
          key={`rest-${dialog.n}`}
          contractor={{ id: dialog.data.item.id, name: dialog.data.item.name }}
          free={dialog.data.item.free}
          kind={dialog.data.kind}
          open={dialog.open}
          onClose={() => setDialog(closeSlot)}
          onDone={(amount) => {
            refresh();
            setRows((list) =>
              list.map((x) => (x.id === dialog.data.item.id ? { ...x, free: x.free - amount } : x)),
            );
          }}
        />
      ) : null}
    </Modal>
  );
}
