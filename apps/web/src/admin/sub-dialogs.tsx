'use client';

import {
  bishkekDate,
  formatDateRu,
  formatSomWithUnit,
  SUBSCRIPTION_CONFIRM_MONTHS_MAX,
  SUBSCRIPTION_REASON_MAX,
  subscriptionConfirmUntil,
  subscriptionEditDefaultUntil,
  subscriptionEditProblems,
  type IsoDate,
  type SubscriptionEdit,
  type SubscriptionEditField,
  type UiTextKey,
} from '@buhuchet/domain';
import { AdminSubscriptionCard, type AdminSubscriptionPayment } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CHECKBOX_CLASS,
  Field,
  FormGrid,
  Hint,
  inputClass,
  Modal,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { ApiResult } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { SubCalcLines } from './sub-org-window';
import {
  confirmSubPayment,
  editSubscription,
  rejectSubPayment,
  subCardQuery,
  useSubsRefresh,
} from './subs-data';
import { subPayWhat } from './subs-model';

/*
 * Окна Админки → «Подписки» (доработки 20.11.2026, блок 6, пункты 3–4; прототип admin/subs-admin.js):
 * «Подтвердить оплату» (subPayOkDlg), «Отклонить чек» (subPayRejDlg), «Изменить подписку» (subEditDlg) и
 * поля подписки, общие с блоком «Подписка» окна «Новая организация» (subEditFields, subEditRead).
 */

type Payment = AdminSubscriptionPayment;
type Card = AdminSubscriptionCard;
type Failure = Extract<ApiResult<unknown>, { ok: false }>['error'];

/** Поле ошибки ответа (`details.field`). */
export const failedField = (error: Failure): string | null => {
  const d = error.details;
  return d && typeof d === 'object' && 'field' in d && typeof d.field === 'string' ? d.field : null;
};

/** Ответ записи — окно подписки: положить в кэш, чтобы окно сразу показало новое. */
function useCardSaved() {
  const client = useQueryClient();
  const refresh = useSubsRefresh();
  return (orgId: string, data: unknown): Card | null => {
    const card = AdminSubscriptionCard.safeParse(data);
    if (card.success) client.setQueryData(subCardQuery(orgId).queryKey, card.data);
    refresh();
    return card.success ? card.data : null;
  };
}

const subLine = (t: Translate, card: Card, p: Payment) =>
  `${card.org.name} · ${subPayWhat(t, p)} · ${formatSomWithUnit(p.amount)}`;

/* ── «Подтвердить оплату» (блок 6, пункт 3) ── */

/**
 * «Число месяцев» из заявки и «Оплачено до» можно поправить: дата пересчитывается по месяцам, пока её не
 * поправили руками; у расширения и памяти месяцы не меняются, дата — нынешняя. Подписка начинает
 * действовать сразу, подтверждённую назад не вернуть.
 */
export function SubConfirmDialog({
  p,
  card,
  open,
  onClose,
  onDone,
}: {
  p: Payment;
  card: Card;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const saved = useCardSaved();
  const renew = p.kind === 'renew';
  const sentDay = bishkekDate(new Date(p.createdAt));
  const calc = (n: number) =>
    subscriptionConfirmUntil(
      card.sub ? { paidUntil: card.sub.paidUntil as IsoDate } : null,
      { kind: p.kind === 'renew' ? 'renew' : p.kind === 'grow' ? 'grow' : 'mem', sentDay },
      n,
      card.today as IsoDate,
    );
  const [months, setMonths] = useState(String(p.months || 0));
  const [until, setUntil] = useState<string>(() => calc(p.months));
  const [hand, setHand] = useState(false);
  const [errors, setErrors] = useState<{ months?: string; until?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(months);
    const next = {
      ...(!renew || (Number.isInteger(n) && n >= 1 && n <= SUBSCRIPTION_CONFIRM_MONTHS_MAX)
        ? {}
        : { months: t('err.sub_confirm_months') }),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(until) ? {} : { until: t('err.sub_paid_until') }),
    };
    setErrors(next);
    if (next.months || next.until) return;
    setBusy(true);
    const res = await confirmSubPayment(p.id, {
      months: renew ? n : p.months,
      paidUntil: until,
      version: p.version,
    });
    setBusy(false);
    if (res.ok) {
      const c = saved(card.org.id, res.data);
      onDone();
      const to = c?.sub?.paidUntil ?? until;
      return toast(t('subs.ok.done', { date: formatDateRu(to as IsoDate) }), { icon: 'check' });
    }
    if (res.error.code === 'sub_confirm_months') return setErrors({ months: errorText(res.error) });
    if (res.error.code === 'sub_pay_decided' || res.error.code === 'record_changed') {
      saved(card.org.id, null);
      onDone();
      return toast(t('err.sub_pay_decided'), { bad: true, icon: 'alert' });
    }
    toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  const formId = `${id}-form`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('subs.ok.title')}
      sub={subLine(t, card, p)}
      dirty={hand || months !== String(p.months || 0)}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('subs.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={busy}
            data-sub-ok=""
          >
            {t('subs.ok.title')}
          </button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3.5"
      >
        <FormGrid>
          <Field
            id={`${id}-m`}
            label={t('subs.ok.months')}
            hint={t(renew ? 'subs.ok.months.hint' : 'subs.ok.months.hint_add')}
            error={errors.months}
          >
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                type="number"
                min={renew ? 1 : 0}
                max={SUBSCRIPTION_CONFIRM_MONTHS_MAX}
                step={1}
                inputMode="numeric"
                disabled={!renew}
                value={months}
                onChange={(ev) => {
                  setMonths(ev.target.value);
                  const n = Number(ev.target.value);
                  if (!hand && Number.isInteger(n) && n > 0) setUntil(calc(n));
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-to`}
            label={t('subs.ok.until')}
            required
            hint={t(renew ? 'subs.ok.until.hint' : 'subs.ok.until.hint_add')}
            error={errors.until}
          >
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                type="date"
                value={until}
                onChange={(ev) => {
                  setHand(true);
                  setUntil(ev.target.value);
                }}
              />
            )}
          </Field>
        </FormGrid>
        <Box title={t('subs.calc')}>
          <SubCalcLines t={t} p={p} />
        </Box>
        <Hint>{t('subs.ok.note')}</Hint>
      </form>
    </Modal>
  );
}

/* ── «Отклонить чек» (блок 6, пункт 3) ── */

/** Причина обязательна, её видит организация; срок прошёл — доступ, открытый по чеку, закроется. */
export function SubRejectDialog({
  p,
  card,
  open,
  onClose,
  onDone,
}: {
  p: Payment;
  card: Card;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const saved = useCardSaved();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const stillPaid = !!card.sub && card.sub.paidUntil >= card.today;

  const submit = async () => {
    const text = reason.trim();
    if (!text) return setError(t('err.sub_reason'));
    setBusy(true);
    const res = await rejectSubPayment(p.id, { reason: text, version: p.version });
    setBusy(false);
    if (res.ok) {
      saved(card.org.id, res.data);
      onDone();
      return toast(t('subs.rej.done'), { icon: 'ban' });
    }
    if (res.error.code === 'sub_pay_decided' || res.error.code === 'record_changed') {
      saved(card.org.id, null);
      onDone();
      return toast(t('err.sub_pay_decided'), { bad: true, icon: 'alert' });
    }
    if (res.error.code === 'validation_failed') return setError(t('err.sub_reason'));
    toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('subs.rej.title')}
      sub={subLine(t, card, p)}
      dirty={reason.trim() !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('subs.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('danger')}
            disabled={busy}
            onClick={() => void submit()}
            data-sub-rej-ok=""
          >
            {t('subs.btn.reject')}
          </button>
        </>
      }
    >
      <Field id={`${id}-why`} label={t('subs.rej.reason')} required full error={error}>
        {(control) => (
          <textarea
            {...control}
            className={inputClass({ multiline: true })}
            value={reason}
            maxLength={SUBSCRIPTION_REASON_MAX}
            placeholder={t('subs.rej.placeholder')}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setError(undefined);
            }}
          />
        )}
      </Field>
      <Hint>
        {[
          t('subs.rej.note'),
          t(stillPaid ? 'subs.rej.note_open' : 'subs.rej.note_close'),
          t('subs.rej.note_next'),
        ].join(' ')}
      </Hint>
    </Modal>
  );
}

/* ── Поля подписки: «Изменить подписку» и блок «Подписка» новой организации (блок 6, пункт 4) ── */

/** Значения полей окна строками (как в полях ввода). */
export interface SubEditValues {
  planId: string;
  seats: string;
  extraGb: string;
  paidUntil: string;
  extraDiscountPct: string;
}

export interface SubEditTerms {
  plans: readonly { id: string; name: string; discountPct: number; active: boolean }[];
  prices: { seatStep: number; extraDiscountOver: number };
}

export type SubEditErrors = Partial<Record<SubscriptionEditField, string>>;

/** Начальные значения (прототип `subEditFields`): подписки нет — первый действующий вид, пакет — шаг. */
export function subEditInitial(
  terms: SubEditTerms,
  sub: Card['sub'] | null,
  today: string,
): SubEditValues {
  const first = terms.plans.find((p) => p.active);
  return {
    planId: sub?.planId ?? first?.id ?? '',
    seats: String(sub?.seats ?? terms.prices.seatStep),
    extraGb: String(sub?.extraGb ?? 0),
    paidUntil: sub?.paidUntil ?? subscriptionEditDefaultUntil(today as IsoDate),
    extraDiscountPct: String(sub?.extraDiscountPct ?? 0),
  };
}

const EDIT_ERRORS: Record<string, UiTextKey> = {
  sub_plan: 'err.sub_plan',
  sub_seats: 'err.sub_seats',
  sub_gb: 'err.sub_gb',
  sub_paid_until: 'err.sub_paid_until',
  sub_discount: 'err.sub_discount',
};

/** Проверка полей — те же правила, что у сервера (`subscriptionEditProblems`, прототип `subEditRead`). */
export function subEditRead(
  t: Translate,
  v: SubEditValues,
  terms: SubEditTerms,
  current: string | null,
): { value: SubscriptionEdit | null; errors: SubEditErrors } {
  const big = Number(v.seats) > terms.prices.extraDiscountOver;
  const value: SubscriptionEdit = {
    planId: v.planId,
    seats: v.seats.trim() === '' ? Number.NaN : Number(v.seats),
    extraGb: v.extraGb.trim() === '' ? Number.NaN : Number(v.extraGb),
    paidUntil: v.paidUntil,
    extraDiscountPct: big ? Number(v.extraDiscountPct || 0) : 0,
  };
  const errors: SubEditErrors = {};
  for (const p of subscriptionEditProblems(value, terms.prices, terms.plans, current)) {
    if (!errors[p.field]) errors[p.field] = t(EDIT_ERRORS[p.code]!, p.params);
  }
  return { value: Object.keys(errors).length ? null : value, errors };
}

/** Поля вида, пакета, памяти, «Оплачено до» и дополнительной скидки (прототип `subEditFields`). */
export function SubEditFields({
  idPrefix,
  values,
  onChange,
  errors,
  terms,
  current,
}: {
  idPrefix: string;
  values: SubEditValues;
  onChange: (next: SubEditValues) => void;
  errors: SubEditErrors;
  terms: SubEditTerms;
  /** Вид, который уже стоит у организации: выключенный виден только он. */
  current: string | null;
}) {
  const t = useT();
  const { seatStep: step, extraDiscountOver: over } = terms.prices;
  const plans = terms.plans.filter((p) => p.active || p.id === current);
  const big = Number(values.seats) > over;
  const set = (patch: Partial<SubEditValues>) => onChange({ ...values, ...patch });
  return (
    <>
      <Field id={`${idPrefix}-k`} label={t('subs.edit.kind')} error={errors.planId}>
        {(control) => (
          <select
            {...control}
            className={inputClass()}
            value={values.planId}
            onChange={(e) => set({ planId: e.target.value })}
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {t('subs.edit.kind_option', { name: p.name, disc: p.discountPct })}
                {p.active ? '' : t('subs.edit.kind_off')}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        id={`${idPrefix}-p`}
        label={t('subs.edit.pack')}
        required
        hint={t('subs.edit.pack.hint', { step })}
        error={errors.seats}
      >
        {(control) => (
          <input
            {...control}
            className={inputClass()}
            type="number"
            min={step}
            step={step}
            inputMode="numeric"
            value={values.seats}
            onChange={(e) => {
              const seats = e.target.value;
              set(Number(seats) > over ? { seats } : { seats, extraDiscountPct: '0' });
            }}
          />
        )}
      </Field>
      <Field id={`${idPrefix}-g`} label={t('subs.edit.gb')} error={errors.extraGb}>
        {(control) => (
          <input
            {...control}
            className={inputClass()}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={values.extraGb}
            onChange={(e) => set({ extraGb: e.target.value })}
          />
        )}
      </Field>
      <Field id={`${idPrefix}-to`} label={t('subs.edit.until')} required error={errors.paidUntil}>
        {(control) => (
          <input
            {...control}
            className={inputClass()}
            type="date"
            value={values.paidUntil}
            onChange={(e) => set({ paidUntil: e.target.value })}
          />
        )}
      </Field>
      <Field
        id={`${idPrefix}-a`}
        label={t('subs.edit.disc')}
        hint={t('subs.edit.disc.hint', { n: over + step })}
        error={errors.extraDiscountPct}
      >
        {(control) => (
          <input
            {...control}
            className={inputClass()}
            type="number"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            disabled={!big}
            value={big ? values.extraDiscountPct : '0'}
            onChange={(e) => set({ extraDiscountPct: e.target.value })}
          />
        )}
      </Field>
    </>
  );
}

/* ── «Изменить подписку» / «Поставить подписку» (блок 6, пункт 4; прототип subEditDlg) ── */

/**
 * Вид, пакет, память сверх, «Оплачено до», дополнительная скидка и «Бесплатный период»; причина
 * обязательна. Пакет меньше активных контрагентов — предупреждение под полем, второе «Сохранить» —
 * сохраняет. Статус ставит система по дате и чекам.
 */
export function SubEditDialog({
  card: initial,
  open,
  onClose,
}: {
  card: Card;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const saved = useCardSaved();
  const [card, setCard] = useState(initial);
  const terms: SubEditTerms = { plans: card.plans, prices: card.prices };
  const [values, setValues] = useState(() => subEditInitial(terms, card.sub, card.today));
  const [base, setBase] = useState(values);
  const [free, setFree] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<SubEditErrors & { reason?: string }>({});
  const [warned, setWarned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const current = card.sub?.planId ?? null;

  const reload = async () => {
    setReloading(true);
    try {
      const fresh = await client.fetchQuery({ ...subCardQuery(card.org.id), staleTime: 0 });
      const next = subEditInitial(
        { plans: fresh.plans, prices: fresh.prices },
        fresh.sub,
        fresh.today,
      );
      setCard(fresh);
      setValues(next);
      setBase(next);
      setErrors({});
      setWarned(false);
      setChanged(false);
    } catch {
      toast(t('subs.win.load_error'), { bad: true, icon: 'alert' });
    } finally {
      setReloading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const read = subEditRead(t, values, terms, current);
    const why = reason.trim();
    const next: SubEditErrors & { reason?: string } = {
      ...read.errors,
      ...(why ? {} : { reason: t('err.sub_reason') }),
    };
    if (!read.value || !why) return setErrors(next);
    if (read.value.seats < card.seatsUsed && !warned) {
      setWarned(true);
      return setErrors({ seats: t('subs.edit.over', { n: card.seatsUsed }) });
    }
    setErrors({});
    setBusy(true);
    const res = await editSubscription(card.org.id, {
      ...read.value,
      free,
      reason: why,
      ...(card.sub ? { version: card.sub.version } : {}),
    });
    setBusy(false);
    if (res.ok) {
      saved(card.org.id, res.data);
      onClose();
      return toast(
        free
          ? t('subs.edit.done_free', { date: formatDateRu(read.value.paidUntil as IsoDate) })
          : t('subs.edit.done'),
        { icon: 'check' },
      );
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    if (res.error.code === 'sub_no_change') return toast(t('subs.edit.no_change'));
    const field = failedField(res.error);
    if (field && field in values) return setErrors({ [field]: errorText(res.error) });
    if (res.error.code === 'validation_failed' && !why)
      return setErrors({ reason: t('err.sub_reason') });
    toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  const formId = `${id}-form`;
  const dirty =
    free ||
    reason.trim() !== '' ||
    (Object.keys(values) as (keyof SubEditValues)[]).some((k) => values[k] !== base[k]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t(card.sub ? 'subs.edit.title' : 'subs.edit.title_new')}
      sub={t('subs.edit.sub', { org: card.org.name, n: card.seatsUsed })}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('subs.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={busy || changed}
            data-sub-edit-ok=""
          >
            {t('subs.save')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form
        id={formId}
        noValidate
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3.5"
        data-sub-edit-form={card.org.id}
      >
        <FormGrid>
          <SubEditFields
            idPrefix={`${id}-se`}
            values={values}
            onChange={(v) => {
              setValues(v);
              if (v.seats !== values.seats) setWarned(false);
            }}
            errors={errors}
            terms={terms}
            current={current}
          />
          <label className="col-span-full flex items-start gap-2.5 text-[13px]">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={free}
              data-sub-free=""
              onChange={(e) => {
                setFree(e.target.checked);
                if (e.target.checked && !reason.trim()) setReason(t('subs.edit.free.reason'));
              }}
            />
            <span className="grow">
              {t('subs.edit.free')}
              <span className="block text-[12px] text-muted">{t('subs.edit.free.hint')}</span>
            </span>
          </label>
          <Field
            id={`${id}-why`}
            label={t('subs.edit.reason')}
            required
            full
            hint={t('subs.edit.reason.hint')}
            error={errors.reason}
          >
            {(control) => (
              <textarea
                {...control}
                className={inputClass({ multiline: true })}
                value={reason}
                maxLength={SUBSCRIPTION_REASON_MAX}
                placeholder={t('subs.edit.reason.placeholder')}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </FormGrid>
        <Hint>{t('subs.edit.note')}</Hint>
      </form>
    </Modal>
  );
}
