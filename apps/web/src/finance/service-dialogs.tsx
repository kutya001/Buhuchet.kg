'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  parseSom,
  servicePaymentProblem,
  serviceProblems,
  type IsoDate,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  isRecordChanged,
  OperationEdited,
  ServiceSaved,
  type ServiceCard,
  type ServiceForm,
  type ServicePaymentWindow,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  Field,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { pickedMoneyFilesProblem, uploadMoneyFiles } from '../money/tax-data';
import { useShell } from '../shell/context';
import { reasonNeeded, type ChangedPart } from './edit-reason';
import {
  createService,
  deleteService,
  deleteServicePayment,
  editService,
  editServicePayment,
  payService,
  serviceFormQuery,
} from './service-data';

/*
 * Окна разовой услуги (задача 2.22; ТЗ «Финансовые операции по контрагентам» → «Ручная операция
 * «Разовая услуга»», «Окно оплаты»; прототип modules/services.js — `serviceDlg`, `svcPay` → `tranchDlg`;
 * modules/fin-op.js — `opEditDlg` и `opDelDlg` с `sp` и `svc`). Файлы окно загружает после записи;
 * сервер проверяет права, область и правила ещё раз.
 */

const todayBishkek = () => bishkekDate(new Date());

/** Поле, к которому относится отказ сервера (`details.field`). */
const fieldOf = (details: unknown): string | undefined =>
  (details as { field?: string } | undefined)?.field;

/** Текст отказа при загрузке окна: код ответа API — из словаря, иначе — общая ошибка. */
const loadError = (errorText: (e: ApiErrorLike) => string, e: unknown) =>
  errorText(e instanceof ApiFailure ? e.error : { code: 'unknown', message: '' });

type Errors = Partial<
  Record<'contractor' | 'name' | 'date' | 'amount' | 'files' | 'reason', string>
>;

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
        data-svc-ok=""
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

/** Отказ сервера — под полем, если он про поле, иначе — всплывающим сообщением. */
function useFail(setErrors: (e: Errors) => void) {
  const toast = useToast();
  const errorText = useErrorText();
  return (error: ApiErrorLike & { details?: unknown }) => {
    const message = errorText(error);
    const field = fieldOf(error.details);
    const key = field === 'contractorId' ? 'contractor' : field;
    if (
      key === 'contractor' ||
      key === 'name' ||
      key === 'date' ||
      key === 'amount' ||
      key === 'reason'
    )
      return setErrors({ [key]: message });
    toast(message, { bad: true });
  };
}

/** Текст отказа проверки домена (`err.<код>`, сумма — `{amount}`). */
const problemText = (t: Translate, p: { problem: string; amount?: number }) =>
  t(`err.${p.problem}` as UiTextKey, {
    amount: p.amount !== undefined ? formatSomWithUnit(p.amount) : '',
  });

function FilesInput({ control, onPick }: { control: object; onPick: (files: File[]) => void }) {
  return (
    <input
      {...control}
      type="file"
      multiple
      data-svc-files=""
      className={inputClass({ file: true })}
      onChange={(e) => onPick([...(e.target.files ?? [])])}
    />
  );
}

/* ───────────── «Разовая услуга» и «Изменить разовую услугу» ───────────── */

/**
 * Окно услуги (прототип serviceDlg): контрагент (из меню контрагента и при изменении — уже выбран),
 * услуга, дата, стоимость (при изменении — не меньше полученного), исполнитель (по умолчанию —
 * ответственный контрагента или сам сотрудник), описание, «Оплачено сразу», файлы; при изменении —
 * причина, если меняются стоимость или дата.
 */
export function ServiceDialog({
  contractor,
  edit,
  open,
  onClose,
  onDone,
}: {
  /** Контрагент из его меню; null — выбрать в окне. */
  contractor: { id: string; name: string } | null;
  /** Изменить эту услугу; null — новая. */
  edit: ServiceCard | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const preset = edit ? edit.contractor : contractor;
  const query = useQuery(serviceFormQuery(preset?.id ?? null));
  const failed = query.isError && !query.data ? loadError(errorText, query.error) : null;
  return (
    <ServiceModal
      key={query.data ? 'ready' : 'loading'}
      t={t}
      form={query.data ?? null}
      failed={failed}
      preset={preset}
      edit={edit}
      open={open}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function ServiceModal({
  t,
  form,
  failed,
  preset,
  edit,
  open,
  onClose,
  onDone,
}: {
  t: Translate;
  form: ServiceForm | null;
  failed: string | null;
  preset: { id: string; name: string } | null;
  edit: ServiceCard | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const errorText = useErrorText();
  const { access } = useShell();
  const id = useId();
  const canUpload = access.feature('files') && access.can('filesUpload');
  const [cp, setCp] = useState(preset?.id ?? '');
  const [name, setName] = useState(edit?.name ?? '');
  const [date, setDate] = useState<string>(edit?.date ?? form?.today ?? todayBishkek());
  const [amount, setAmount] = useState(edit ? formatSom(edit.amount, 'auto') : '');
  const [performer, setPerformer] = useState(
    edit ? (edit.performer?.id ?? '') : (form?.performer ?? ''),
  );
  const [description, setDescription] = useState(edit?.description ?? '');
  const [paidNow, setPaidNow] = useState(false);
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);
  const clear = (k: keyof Errors) => setErrors((x) => ({ ...x, [k]: undefined }));

  const save = async () => {
    if (!form) return;
    const n = parseSom(amount);
    // Прототип serviceDlg: все отказы сразу — у своих полей.
    const found: Errors = {};
    if (!edit && !preset && !cp) found.contractor = t('err.service_contractor_invalid');
    for (const p of serviceProblems(
      { name, date: date as IsoDate | '', amount: n },
      edit ? { paid: edit.paid, amount: edit.amount, date: edit.date, reason } : undefined,
    ))
      found[p.field] = problemText(t, p);
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) found.files = bad;
    if (Object.keys(found).length) return setErrors(found);
    const fields = {
      name: name.trim(),
      date,
      amount: n ?? 0,
      performerId: performer || null,
      description: description.trim(),
    };
    setBusy(true);
    const res = edit
      ? await editService(edit.id, { version: edit.version, ...fields, reason: reason.trim() })
      : await createService({
          contractorId: preset?.id ?? cp,
          ...fields,
          paidNow,
          files: picked.length,
        });
    const target = edit
      ? OperationEdited.safeParse(res.ok ? res.data : null).success
        ? edit.id
        : null
      : res.ok
        ? (ServiceSaved.safeParse(res.data).data?.id ?? null)
        : null;
    if (res.ok && target) {
      const failedUpload = picked.length
        ? await uploadMoneyFiles(t, errorText, { kind: 'one_off_service', id: target }, picked)
        : null;
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t(edit ? 'fin.svc.saved' : 'fin.svc.added'), { icon: 'coins' });
    }
    setBusy(false);
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    if (isRecordChanged(res.error)) return setChanged(true);
    fail(res.error);
  };

  const dirty =
    name !== (edit?.name ?? '') ||
    amount !== (edit ? formatSom(edit.amount, 'auto') : '') ||
    description !== (edit?.description ?? '') ||
    reason !== '' ||
    picked.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      dirty={dirty}
      title={t(edit ? 'fin.svc.title_edit' : 'fin.svc.title')}
      sub={preset ? preset.name : t('fin.svc.sub_new')}
      footer={
        <Footer
          t={t}
          label={t(edit ? 'btn.save' : 'fin.svc.add')}
          busy={busy || !form}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-svc-dialog={edit?.id ?? 'new'}>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onClose}
            reloading={false}
          />
        ) : null}
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {form ? (
          <FormGrid>
            {preset ? null : (
              <Field
                id={`${id}-cp`}
                label={t('fin.svc.cp')}
                required
                full
                error={errors.contractor}
              >
                {(control) => (
                  <select
                    {...control}
                    data-svc-cp=""
                    className={`${inputClass()} cursor-pointer`}
                    value={cp}
                    onChange={(e) => {
                      setCp(e.target.value);
                      clear('contractor');
                    }}
                  >
                    <option value="">{t('fin.svc.cp_pick')}</option>
                    {form.contractors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.oneOff ? t('fin.svc.cp_oneoff', { name: c.name }) : c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field id={`${id}-name`} label={t('fin.svc.name')} required full error={errors.name}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  data-svc-name=""
                  maxLength={300}
                  placeholder={t('fin.svc.name_ph')}
                  className={inputClass()}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clear('name');
                  }}
                />
              )}
            </Field>
            <Field id={`${id}-date`} label={t('fin.svc.date')} required error={errors.date}>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  data-svc-date=""
                  className={inputClass()}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setErrors((x) => ({ ...x, date: undefined, reason: undefined }));
                  }}
                />
              )}
            </Field>
            <Field
              id={`${id}-amount`}
              label={t('fin.svc.amount')}
              required
              hint={
                edit && edit.paid
                  ? t('fin.svc.amount_paid', { amount: formatSomWithUnit(edit.paid) })
                  : undefined
              }
              error={errors.amount}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  data-svc-amount=""
                  className={`${inputClass()} tabular-nums`}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setErrors((x) => ({ ...x, amount: undefined, reason: undefined }));
                  }}
                />
              )}
            </Field>
            <Field id={`${id}-performer`} label={t('fin.svc.performer')}>
              {(control) => (
                <select
                  {...control}
                  data-svc-performer=""
                  className={`${inputClass()} cursor-pointer`}
                  value={performer}
                  onChange={(e) => setPerformer(e.target.value)}
                >
                  {performer === '' ? <option value="">—</option> : null}
                  {edit?.performer && !form.performers.some((p) => p.id === edit.performer?.id) ? (
                    <option value={edit.performer.id}>{edit.performer.name ?? '—'}</option>
                  ) : null}
                  {form.performers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="max-md:hidden" />
            <Field id={`${id}-desc`} label={t('fin.svc.desc')} full>
              {(control) => (
                <textarea
                  {...control}
                  data-svc-desc=""
                  maxLength={2000}
                  className={`${inputClass()} min-h-[60px] resize-y leading-normal`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
            {edit ? null : (
              // Прототип serviceDlg: название обычным шрифтом, пояснение — строкой ниже, под строкой черта.
              <div className={`col-span-full ${canUpload ? 'border-b border-line' : ''}`}>
                <CheckRow
                  plain
                  checked={paidNow}
                  onChange={setPaidNow}
                  label={t('fin.svc.paid_now')}
                  data-svc-paid=""
                >
                  <Hint>{t('fin.svc.paid_now_hint')}</Hint>
                </CheckRow>
              </div>
            )}
            {canUpload ? (
              <Field id={`${id}-files`} label={t('fin.svc.files')} full error={errors.files}>
                {(control) => (
                  <FilesInput
                    control={control}
                    onPick={(files) => {
                      setPicked(files);
                      clear('files');
                    }}
                  />
                )}
              </Field>
            ) : null}
            {edit ? (
              <Field
                id={`${id}-why`}
                label={t('fin.edit.reason')}
                full
                hint={t('fin.svc.reason_hint')}
                error={errors.reason}
              >
                {(control) => (
                  <textarea
                    {...control}
                    data-svc-reason=""
                    maxLength={500}
                    placeholder={t('fin.svc.reason_ph')}
                    className={`${inputClass()} min-h-14 resize-y leading-normal`}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      clear('reason');
                    }}
                  />
                )}
              </Field>
            ) : null}
          </FormGrid>
        ) : null}
      </div>
    </Modal>
  );
}

/* ───────────── «Записать оплату» ───────────── */

/**
 * «Оплата разовой услуги» (прототип svcPay → tranchDlg): сумма (подставлен остаток, не больше его),
 * дата (не позже сегодняшней), файлы «платёжка, чек».
 */
export function ServicePayDialog({
  service,
  open,
  onClose,
  onDone,
}: {
  service: { id: string; name: string; contractor: string; left: number };
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const { access } = useShell();
  const id = useId();
  const canUpload = access.feature('files') && access.can('filesUpload');
  const [amount, setAmount] = useState(service.left > 0 ? formatSom(service.left, 'auto') : '');
  const [date, setDate] = useState(todayBishkek);
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);

  const save = async () => {
    const n = parseSom(amount);
    const problem = servicePaymentProblem(n, service.left);
    if (problem) return setErrors({ amount: problemText(t, problem) });
    // Пустая дата — сегодняшняя, как в прототипе (tranchDlg).
    const paidOn = date || todayBishkek();
    if (paidOn > todayBishkek()) return setErrors({ date: t('fin.edit.date_future') });
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    setBusy(true);
    const res = await payService(service.id, {
      amount: n ?? 0,
      date: paidOn,
      files: picked.length,
    });
    const saved = res.ok ? ServiceSaved.safeParse(res.data) : null;
    if (res.ok && saved?.success) {
      const failedUpload = picked.length
        ? await uploadMoneyFiles(
            t,
            errorText,
            { kind: 'one_off_service_payment', id: saved.data.id },
            picked,
          )
        : null;
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('fin.svc.pay_done'), { icon: 'wallet' });
    }
    setBusy(false);
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    fail(res.error);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={picked.length > 0}
      title={t('fin.svc.pay_title')}
      sub={t('fin.svc.pay_sub', { name: service.name, cp: service.contractor })}
      footer={
        <Footer
          t={t}
          label={t('fin.svc.pay')}
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-svc-pay={service.id}>
        <FormGrid>
          <Field
            id={`${id}-amount`}
            label={t('fin.svc.pay_amount')}
            required
            hint={t('fin.svc.pay_left', { amount: formatSomWithUnit(service.left) })}
            error={errors.amount}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-svc-amount=""
                className={`${inputClass()} tabular-nums`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-date`} label={t('fin.svc.pay_date')} required error={errors.date}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-svc-date=""
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
          {canUpload ? (
            <Field id={`${id}-files`} label={t('fin.svc.pay_files')} full error={errors.files}>
              {(control) => (
                <FilesInput
                  control={control}
                  onPick={(files) => {
                    setPicked(files);
                    setErrors((x) => ({ ...x, files: undefined }));
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

/* ───────────── «Удалить» услугу и оплату ───────────── */

/**
 * «Удалить» услугу или её оплату (прототип opDelDlg с `svc` и `sp`): причина обязательна; у услуги —
 * её оплаты тоже уйдут из итогов, у оплаты — статус оплаты услуги пересчитается; запись получает
 * отметку «Удалена» и видна с «Показать удалённые».
 */
export function ServiceDeleteDialog({
  target,
  open,
  onClose,
  onDone,
}: {
  target: { kind: 'svc'; service: ServiceCard } | { kind: 'sp'; payment: ServicePaymentWindow };
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
  const svc = target.kind === 'svc' ? target.service : null;
  const pay = target.kind === 'sp' ? target.payment : null;
  const rec = svc ?? pay!;
  const amount = formatSomWithUnit(rec.amount);
  const consequence = svc
    ? svc.payments.length
      ? t('fin.del.cons.svc', { n: svc.payments.length, amount: formatSomWithUnit(svc.paid) })
      : ''
    : t('fin.del.cons.sp');

  const save = async () => {
    if (!reason.trim()) return setErrors({ reason: t('err.op_reason_required') });
    setBusy(true);
    const res = svc
      ? await deleteService(svc.id, reason.trim())
      : await deleteServicePayment(pay!.id, reason.trim());
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
        kind: t(svc ? 'files.kind.one_off_service' : 'fin.sp.kind'),
        name: rec.contractor.name,
        amount,
        date: formatDateRu(rec.date),
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
      <div className="flex flex-col gap-3" data-svc-delete={rec.id}>
        <p className="m-0">{t('fin.del.ask', { amount })}</p>
        <Note icon="history">
          {consequence ? `${consequence} ` : ''}
          {t('fin.del.keep')}
        </Note>
        <Field id={`${id}-reason`} label={t('fin.del.reason')} required full error={errors.reason}>
          {(control) => (
            <textarea
              {...control}
              data-svc-reason=""
              maxLength={500}
              placeholder={t('fin.del.reason_ph')}
              className={`${inputClass()} min-h-16 resize-y leading-normal`}
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

/* ───────────── «Изменить: оплата разовой услуги» ───────────── */

/**
 * Изменить оплату услуги (прототип opEditDlg с `sp`): сумма (не больше стоимости услуги без остальных
 * оплат), дата, примечание, «Добавить файлы», причина — если меняются сумма или дата.
 */
export function ServicePaymentEditDialog({
  payment: p,
  open,
  onClose,
  onDone,
}: {
  payment: ServicePaymentWindow;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const { access } = useShell();
  const id = useId();
  const canUpload = access.feature('files') && access.can('filesUpload');
  const [amount, setAmount] = useState(formatSom(p.amount, 'auto'));
  const [date, setDate] = useState<string>(p.date);
  const [note, setNote] = useState(p.note);
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);
  const kind = t('fin.sp.kind');

  const save = async () => {
    const n = parseSom(amount);
    if (n === null || n <= 0) return setErrors({ amount: t('err.op_amount_required') });
    if (n > p.max)
      return setErrors({ amount: t('err.op_service_over', { max: formatSomWithUnit(p.max) }) });
    if (!date) return setErrors({ date: t('fin.edit.date_required') });
    if (date > p.today) return setErrors({ date: t('fin.edit.date_future') });
    const parts: ChangedPart[] = [];
    if (n !== p.amount) parts.push('amount');
    if (date !== p.date) parts.push('date');
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    // Новые файлы — к оплате после сохранения, каждый — своей строкой истории (п. В-28).
    const upload = async () =>
      picked.length
        ? uploadMoneyFiles(t, errorText, { kind: 'one_off_service_payment', id: p.id }, picked)
        : null;
    if (parts.length === 0 && note === p.note) {
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
    const res = await editServicePayment(p.id, {
      version: p.version,
      amount: n,
      date,
      note,
      reason: reason.trim(),
    });
    if (res.ok) {
      const failedUpload = await upload();
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('fin.edit.done'), { icon: 'edit' });
    }
    setBusy(false);
    if (isRecordChanged(res.error)) return setChanged(true);
    fail(res.error);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={reason !== '' || picked.length > 0}
      title={t('fin.edit.title', { kind: kind.toLowerCase() })}
      sub={t('fin.edit.sub', {
        name: p.contractor.name,
        amount: formatSomWithUnit(p.amount),
        date: formatDateRu(p.date),
      })}
      footer={
        <Footer
          t={t}
          label={t('btn.save')}
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-svc-pay-edit={p.id}>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onClose}
            reloading={false}
          />
        ) : null}
        <FormGrid>
          <Field
            id={`${id}-amount`}
            label={t('fin.edit.amount')}
            required
            hint={t('fin.edit.max', { amount: formatSomWithUnit(p.max) })}
            error={errors.amount}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-svc-amount=""
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
                data-svc-date=""
                max={p.today}
                className={inputClass()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setErrors((x) => ({ ...x, date: undefined, reason: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-note`} label={t('fin.edit.note')} full>
            {(control) => (
              <input
                {...control}
                type="text"
                data-svc-note=""
                maxLength={500}
                className={inputClass()}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {p.files !== null && canUpload ? (
            <Field
              id={`${id}-files`}
              label={t('fin.edit.files')}
              full
              hint={p.files > 0 ? t('fin.edit.files_have', { n: p.files }) : undefined}
              error={errors.files}
            >
              {(control) => (
                <FilesInput
                  control={control}
                  onPick={(files) => {
                    setPicked(files);
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
            hint={t('fin.edit.reason_hint')}
            error={errors.reason}
          >
            {(control) => (
              <textarea
                {...control}
                data-svc-reason=""
                maxLength={500}
                placeholder={t('fin.edit.reason_ph')}
                className={`${inputClass()} min-h-14 resize-y leading-normal`}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setErrors((x) => ({ ...x, reason: undefined }));
                }}
              />
            )}
          </Field>
        </FormGrid>
        <Note icon="info">{t('fin.edit.info')}</Note>
      </div>
    </Modal>
  );
}
