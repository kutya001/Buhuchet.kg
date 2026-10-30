'use client';

import {
  addMonths,
  formatSom,
  monthLabelGen,
  parseSom,
  TARIFF_PERIODS,
  type TariffPeriod,
} from '@buhuchet/domain';
import { ContractorServiceSaved, type ContractorService, type TaxRegime } from '@buhuchet/shared';
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
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';
import { serviceQuery } from './service-data';

/*
 * Окна обслуживания контрагента (задача 2.12; прототип modules/services.js: pauseDlg, resumeDlg,
 * toRegularDlg): поля месяца — с идущего месяца, отказ сервера по полю — под полем, «Запись изменена
 * другим пользователем» — над окном с «Перечитать» (новая версия, введённое остаётся).
 */

/** Окно действия с обслуживанием: контрагент, обслуживание, открыто ли, после сохранения. */
interface ServiceDialogProps {
  name: string;
  service: ContractorService;
  open: boolean;
  onClose: () => void;
  onDone: (saved: ContractorServiceSaved) => void;
}

type Send = (version: number) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Сохранение окна: ответ — обслуживание и что стало с отчётами (`onDone`, окно закрывается,
 * уведомление); отказ по полю — под полем; устаревшая версия — отметка с «Перечитать».
 */
function useServiceSave({
  service: initial,
  onClose,
  onDone,
}: Pick<ServiceDialogProps, 'service' | 'onClose' | 'onDone'>) {
  const toast = useToast();
  const errorText = useErrorText();
  const t = useT();
  const client = useQueryClient();
  const [service, setService] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const save = async (
    send: Send,
    done: ((saved: ContractorServiceSaved) => string) | null,
    icon: 'pause' | 'play',
    onError?: (error: ApiErrorLike) => void,
  ) => {
    setBusy(true);
    const res = await callApi(() => send(service.version));
    setBusy(false);
    if (res.ok) {
      const saved = ContractorServiceSaved.safeParse(res.data);
      if (!saved.success) return void toast(t('err.unknown'), { bad: true });
      onDone(saved.data);
      onClose();
      if (done) toast(done(saved.data), { icon });
      return;
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    onError?.(res.error);
    const field = (res.error.details as { field?: unknown } | undefined)?.field;
    const message = errorText(res.error);
    if (typeof field === 'string') return setErrors((e) => ({ ...e, [field]: message }));
    toast(message, { bad: true });
  };

  const reload = async () => {
    setReloading(true);
    try {
      setService(await client.fetchQuery({ ...serviceQuery(service.id), staleTime: 0 }));
      setChanged(false);
    } catch {
      toast(t('err.unknown'), { bad: true });
    } finally {
      setReloading(false);
    }
  };

  const notice = changed ? (
    <RecordChangedNotice
      message={t('err.record_changed')}
      reloadLabel={t('form.reload')}
      onReload={() => void reload()}
      reloading={reloading}
    />
  ) : null;

  const setError = (field: string, message: string | undefined) =>
    setErrors((e) => ({ ...e, [field]: message }));

  return { service, busy, changed, notice, errors, setError, save };
}

/** Нижняя строка окна: «Отмена» и кнопка действия. */
function Footer({
  onClose,
  label,
  disabled,
  onOk,
}: {
  onClose: () => void;
  label: string;
  disabled: boolean;
  onOk: () => void;
}) {
  const t = useT();
  return (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <button
        type="button"
        data-service-ok=""
        className={buttonClass('cta')}
        disabled={disabled}
        onClick={onOk}
      >
        {label}
      </button>
    </>
  );
}

/** Поле месяца (`<input type="month">`) с идущего месяца. */
function MonthField({
  id,
  label,
  required = false,
  hint,
  error,
  value,
  min,
  onChange,
  data,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error: string | undefined;
  value: string;
  min: string;
  onChange: (value: string) => void;
  data: string;
}) {
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      {(control) => (
        <input
          {...control}
          type="month"
          data-service-month={data}
          className={inputClass()}
          min={min}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * «Приостановить обслуживание» (прототип `pauseDlg`): с какого месяца (по умолчанию — следующий, не
 * раньше идущего), необязательное возобновление (позже паузы) и причина; пояснение, что станет с
 * отчётами. После — «Приостановлено с …» и сколько отчётов стали «Не требуется».
 */
export function PauseServiceDialog(props: ServiceDialogProps) {
  const { name, open, onClose } = props;
  const t = useT();
  const id = useId();
  const s = useServiceSave(props);
  const month = s.service.month;
  const [from, setFrom] = useState(addMonths(month, 1));
  const [resume, setResume] = useState('');
  const [reason, setReason] = useState('');

  const submit = () => {
    if (!from) return s.setError('from', t('svc.month_required'));
    if (from < month) return s.setError('from', t('err.service_month_in_past'));
    if (resume && resume <= from) return s.setError('resume', t('err.service_resume_before_pause'));
    void s.save(
      (version) =>
        api.api.contractors[':id'].pause.$post({
          param: { id: s.service.id },
          json: { from, resume: resume || null, reason: reason.trim(), version },
        }),
      ({ effect }) =>
        effect.notRequired
          ? t('svc.pause.done_off', { month: monthLabelGen(from), n: effect.notRequired })
          : t('svc.pause.done', { month: monthLabelGen(from) }),
      'pause',
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('svc.pause.title')}
      sub={name}
      dirty={resume !== '' || reason.trim() !== ''}
      footer={
        <Footer
          onClose={onClose}
          label={t('svc.pause.ok')}
          disabled={s.busy || s.changed}
          onOk={submit}
        />
      }
    >
      {s.notice}
      <FormGrid>
        <MonthField
          id={`${id}-from`}
          data="from"
          label={t('svc.pause.from')}
          required
          hint={t('svc.pause.from_hint')}
          error={s.errors.from}
          value={from}
          min={month}
          onChange={(v) => {
            setFrom(v);
            s.setError('from', undefined);
          }}
        />
        <MonthField
          id={`${id}-resume`}
          data="resume"
          label={t('svc.pause.resume')}
          hint={t('svc.pause.resume_hint')}
          error={s.errors.resume}
          value={resume}
          min={month}
          onChange={(v) => {
            setResume(v);
            s.setError('resume', undefined);
          }}
        />
        <Field id={`${id}-reason`} label={t('svc.pause.reason')} full error={s.errors.reason}>
          {(control) => (
            <input
              {...control}
              data-service-reason=""
              className={inputClass()}
              placeholder={t('svc.pause.reason_ph')}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </FormGrid>
      <Note>{t('svc.pause.note')}</Note>
    </Modal>
  );
}

/** Месяц возобновления по умолчанию (прототип `resumeDlg`): запланированный или после паузы. */
export function defaultResumeMonth(service: ContractorService): string {
  const last = service.periods.at(-1);
  // Возобновление уже запланировано (и после запланированной приостановки) — его месяц.
  if (last && last.to === null && last.from > service.month) return last.from;
  const after = last?.to ? addMonths(last.to, 1) : service.month;
  return after > service.month ? after : service.month;
}

/**
 * «Возобновить обслуживание» и «Изменить возобновление» (прототип `resumeDlg`): с какого месяца (не
 * раньше идущего); тому, кто видит плату, — по какой ставке начнёт начисляться плата. После —
 * «Обслуживание возобновится с …» и сколько отчётов вернулось в работу.
 */
export function ResumeServiceDialog({
  tariff,
  ...props
}: ServiceDialogProps & {
  /** Текущая ставка, если сотрудник видит плату за обслуживание. */
  tariff: { amount: number; period: TariffPeriod } | null;
}) {
  const { name, open, onClose } = props;
  const t = useT();
  const id = useId();
  const s = useServiceSave(props);
  const month = s.service.month;
  // У запланированной приостановки возобновление — позже её начала (п. В-13).
  const pause = s.service.plannedPause?.from ?? null;
  const min = pause ? addMonths(pause, 1) : month;
  const [from, setFrom] = useState(() => defaultResumeMonth(props.service));

  const submit = () => {
    if (!from) return s.setError('from', t('svc.month_required'));
    if (from < month) return s.setError('from', t('err.service_month_in_past'));
    if (pause && from <= pause) {
      return s.setError('from', t('err.service_resume_before_pause'));
    }
    void s.save(
      (version) =>
        api.api.contractors[':id'].resume.$post({
          param: { id: s.service.id },
          json: { from, version },
        }),
      ({ effect }) =>
        effect.restored
          ? t('svc.resume.done_on', { month: monthLabelGen(from), n: effect.restored })
          : t('svc.resume.done', { month: monthLabelGen(from) }),
      'play',
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('svc.resume.title')}
      sub={s.service.periodsText ? `${name} · ${s.service.periodsText}` : name}
      dirty={from !== defaultResumeMonth(props.service)}
      footer={
        <Footer
          onClose={onClose}
          label={t('svc.resume.ok')}
          disabled={s.busy || s.changed}
          onOk={submit}
        />
      }
    >
      {s.notice}
      <FormGrid>
        <MonthField
          id={`${id}-from`}
          data="from"
          label={t('svc.resume.from')}
          required
          hint={t('svc.resume.from_hint')}
          error={s.errors.from}
          value={from}
          min={min}
          onChange={(v) => {
            setFrom(v);
            s.setError('from', undefined);
          }}
        />
      </FormGrid>
      {tariff ? (
        <Note>
          {t('svc.resume.fee_note', {
            sum: formatSom(tariff.amount, 'auto'),
            per: t(tariff.period === 'Y' ? 'svc.per.year' : 'svc.per.month'),
          })}
        </Note>
      ) : null}
    </Modal>
  );
}

/**
 * «Перевести в постоянное обслуживание» (прототип `toRegularDlg`): начало обслуживания (не раньше
 * идущего месяца), режим налогообложения из действующих и — тому, кто видит плату, — стоимость
 * обслуживания (обязательна, 0 — допустимо). Вопрос о праве на режим по ГКЭД — как в форме
 * контрагента: «Подтверждаю» и сохранить снова. После — выбор отчётов (`onDone`, «Дальше: выбрать
 * отчёты»).
 */
export function ToRegularDialog({
  regimeCode,
  regimes,
  feeVisible,
  ...props
}: ServiceDialogProps & {
  regimeCode: string | null;
  regimes: readonly Pick<TaxRegime, 'code' | 'name' | 'fullName'>[];
  feeVisible: boolean;
}) {
  const { name, open, onClose } = props;
  const t = useT();
  const id = useId();
  const s = useServiceSave(props);
  const month = s.service.month;
  const [from, setFrom] = useState(month);
  const [regime, setRegime] = useState(regimeCode ?? '');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<TariffPeriod>('M');
  const [ask, setAsk] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const submit = () => {
    if (!from) return s.setError('from', t('svc.month_required'));
    if (from < month) return s.setError('from', t('err.service_month_in_past'));
    const sum = feeVisible ? parseSom(amount) : null;
    if (feeVisible && (sum === null || sum < 0)) {
      return s.setError('tariff', t('err.tariff_required'));
    }
    void s.save(
      (version) =>
        api.api.contractors[':id']['to-regular'].$post({
          param: { id: s.service.id },
          json: {
            from,
            regimeCode: regime || null,
            ...(sum !== null ? { tariff: { amount: sum, period } } : {}),
            ...(confirmed ? { gkedConfirm: true } : {}),
            version,
          },
        }),
      // Уведомления нет: следом открывается выбор отчётов (прототип toRegularDlg).
      null,
      'play',
      // Вопрос о праве на режим приходит отказом по полю режима с текстом вопроса.
      (error) => {
        const question = (error.details as { ask?: unknown } | undefined)?.ask;
        if (error.code === 'gked_confirm_required' && typeof question === 'string') {
          setAsk(question);
        }
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('svc.regular.title')}
      sub={name}
      dirty={amount !== '' || regime !== (regimeCode ?? '')}
      footer={
        <Footer
          onClose={onClose}
          label={t('svc.regular.ok')}
          disabled={s.busy || s.changed}
          onOk={submit}
        />
      }
    >
      {s.notice}
      <FormGrid>
        <MonthField
          id={`${id}-from`}
          data="from"
          label={t('svc.regular.from')}
          required
          error={s.errors.from}
          value={from}
          min={month}
          onChange={(v) => {
            setFrom(v);
            s.setError('from', undefined);
          }}
        />
        <Field id={`${id}-regime`} label={t('svc.regular.regime')} error={s.errors.regimeCode}>
          {(control) => (
            <select
              {...control}
              data-service-regime=""
              className={`${inputClass()} cursor-pointer`}
              value={regime}
              onChange={(e) => {
                setRegime(e.target.value);
                setConfirmed(false);
                setAsk(null);
                s.setError('regimeCode', undefined);
              }}
            >
              <option value="">{t('svc.regular.regime_none')}</option>
              {regimes.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.fullName || r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {feeVisible ? (
          <Field id={`${id}-fee`} label={t('svc.regular.fee')} required error={s.errors.tariff}>
            {(control) => (
              <div className="flex gap-2">
                <input
                  {...control}
                  data-service-fee=""
                  className={`${inputClass()} tabular-nums`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    s.setError('tariff', undefined);
                  }}
                />
                <select
                  aria-label={t('svc.regular.fee')}
                  className={`${inputClass({ full: false })} w-auto cursor-pointer`}
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as TariffPeriod)}
                >
                  {TARIFF_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {t(p === 'Y' ? 'svc.per.year' : 'svc.per.month')}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Field>
        ) : null}
      </FormGrid>
      {ask ? (
        <label className="flex cursor-pointer items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            data-service-gked-confirm=""
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              s.setError('regimeCode', undefined);
            }}
          />
          <span>
            {ask} — {t('svc.regular.gked_confirm')}
          </span>
        </label>
      ) : null}
      <Note>{t('svc.regular.note')}</Note>
    </Modal>
  );
}
