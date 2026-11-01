'use client';

import {
  formatPhone,
  joinPhone,
  LEAD_FIRM_MAX,
  LEAD_NAME_MAX,
  LEAD_NOTE_MAX,
  LEAD_TELEGRAM_MAX,
  leadSizeOptions,
  splitPhone,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  buttonClass,
  Field,
  Icon,
  inputClass,
  linkButtonClass,
  Note,
  PhoneInput,
  type PhoneInputCode,
  type PhoneInputValue,
} from '@buhuchet/ui';
import { useRef, useState, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { useT } from '../l10n/provider';

/*
 * Форма «Оставить заявку» (ТЗ «Лендинг» → «Форма «Оставить заявку»»; прототип modules/landing.js,
 * landFormHtml и landFormBind): проверка полей на месте, как в прототипе, затем метод `POST /api/leads`.
 * Пока заявка отправляется — «Отправляем…» и кнопка неактивна; нет связи или сервер ответил ошибкой —
 * «Не удалось отправить заявку…», введённое не пропадает; больше 3 заявок за час с адреса — текст
 * `land.e.ip` с телефоном из контактов.
 */

type FieldId = 'name' | 'firm' | 'phone' | 'size' | 'telegram' | 'note' | 'consent';

/** Порядок полей: фокус после неудачной проверки — в первое поле с ошибкой. */
const ORDER: readonly FieldId[] = ['name', 'firm', 'phone', 'size', 'telegram', 'note', 'consent'];

const ID: Record<FieldId, string> = {
  name: 'lf-name',
  firm: 'lf-firm',
  phone: 'lf-phone',
  size: 'lf-size',
  telegram: 'lf-tg',
  note: 'lf-note',
  consent: 'lf-ok',
};

const SEND = `${buttonClass('cta')} lp-lg`;

interface Values {
  name: string;
  firm: string;
  size: string;
  telegram: string;
  note: string;
  consent: boolean;
  /** Поле-ловушка: человек его не видит, бот заполняет. */
  website: string;
}

const EMPTY: Values = {
  name: '',
  firm: '',
  size: '',
  telegram: '',
  note: '',
  consent: false,
  website: '',
};

export function LeadForm({
  codes,
  onSent,
  onConsent,
}: {
  codes: readonly PhoneInputCode[];
  /** Заявка принята: номер по маске для «Спасибо! … по номеру <телефон> …». */
  onSent: (phone: string) => void;
  /** Открыть окно «Согласие на обработку персональных данных». */
  onConsent: () => void;
}) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [phone, setPhone] = useState<PhoneInputValue>(() => splitPhone(null, codes));
  const [errors, setErrors] = useState<Partial<Record<FieldId, string>>>({});
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const sizes = leadSizeOptions(t('land.f.size.opts'));

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in ID) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const focusFirst = (bad: Partial<Record<FieldId, string>>) => {
    const first = ORDER.find((f) => bad[f]);
    if (first) form.current?.querySelector<HTMLElement>(`#${ID[first]}`)?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    setMessage('');
    const joined = joinPhone(phone.cc, phone.local, codes);
    const v = {
      ...values,
      name: values.name.trim(),
      firm: values.firm.trim(),
      telegram: values.telegram.trim(),
      note: values.note.trim(),
    };
    const phoneError = t('land.e.phone', { цифр: joined.need });
    const bad: Partial<Record<FieldId, string>> = {
      name: v.name ? undefined : t('land.e.name'),
      firm: v.firm ? undefined : t('land.e.firm'),
      phone: joined.phone && joined.missing === 0 ? undefined : phoneError,
      size: v.size ? undefined : t('land.e.size'),
      note: v.note.length > LEAD_NOTE_MAX ? t('land.e.note') : undefined,
      consent: v.consent ? undefined : t('land.e.consent'),
    };
    setErrors(bad);
    if (ORDER.some((f) => bad[f]) || !joined.phone) return focusFirst(bad);
    setSending(true);
    const res = await callApi(() =>
      api.api.leads.$post({
        json: {
          name: v.name,
          firm: v.firm,
          phone: joined.phone!,
          size: v.size,
          telegram: v.telegram,
          note: v.note,
          consent: true,
          website: v.website,
        },
      }),
    );
    setSending(false);
    if (res.ok) return onSent(formatPhone(joined.phone, codes));
    if (res.error.code === 'lead_limited') {
      return setMessage(t('land.e.ip', { телефон: t('land.c.phone') }));
    }
    // Сервер не принял поле (проверка разошлась с формой) — ошибка под полем; иначе — «Не удалось…».
    const fields = serverFieldErrors(res.error.details);
    if (res.error.code === 'validation_failed' && Object.keys(fields).length > 0) {
      const next: Partial<Record<FieldId, string>> = {};
      for (const [field, key] of Object.entries(fields) as [FieldId, string][]) {
        next[field] = field === 'phone' ? phoneError : t(key as UiTextKey);
      }
      setErrors(next);
      return focusFirst(next);
    }
    setMessage(t('land.e.net'));
  };

  return (
    <form ref={form} className="lp-form" noValidate autoComplete="on" onSubmit={submit}>
      <Field id={ID.name} label={t('land.f.name')} required error={errors.name}>
        {(c) => (
          <input
            {...c}
            className={inputClass()}
            autoComplete="name"
            maxLength={LEAD_NAME_MAX}
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
          />
        )}
      </Field>
      <Field
        id={ID.firm}
        label={t('land.f.firm')}
        required
        hint={t('land.f.firm.hint')}
        error={errors.firm}
      >
        {(c) => (
          <input
            {...c}
            className={inputClass()}
            autoComplete="organization"
            maxLength={LEAD_FIRM_MAX}
            value={values.firm}
            onChange={(e) => set('firm', e.target.value)}
          />
        )}
      </Field>
      <Field id={ID.phone} label={t('land.f.phone')} required error={errors.phone}>
        {(c) => (
          <PhoneInput
            codes={codes}
            value={phone}
            onChange={(next) => {
              setPhone(next);
              setErrors((e) => ({ ...e, phone: undefined }));
            }}
            control={c}
            codeLabel={t('land.f.code')}
          />
        )}
      </Field>
      <Field id={ID.size} label={t('land.f.size')} required error={errors.size}>
        {(c) => (
          <select
            {...c}
            className={`${inputClass()} cursor-pointer`}
            value={values.size}
            onChange={(e) => set('size', e.target.value)}
          >
            <option value="">{t('land.f.size.ph')}</option>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field id={ID.telegram} label={t('land.f.tg')} error={errors.telegram}>
        {(c) => (
          <input
            {...c}
            className={inputClass()}
            autoComplete="off"
            maxLength={LEAD_TELEGRAM_MAX}
            placeholder={t('land.f.tg.ph')}
            value={values.telegram}
            onChange={(e) => set('telegram', e.target.value)}
          />
        )}
      </Field>
      <div aria-hidden="true" />
      <Field
        id={ID.note}
        label={t('land.f.note')}
        full
        hint={t('land.f.note.hint')}
        error={errors.note}
      >
        {(c) => (
          <textarea
            {...c}
            className={inputClass({ multiline: true })}
            value={values.note}
            onChange={(e) => set('note', e.target.value)}
          />
        )}
      </Field>
      {/* Поле-ловушка: вне экрана и вне порядка Tab; заполненное — заявка не сохраняется. */}
      <div className="lp-hp" aria-hidden="true">
        <label htmlFor="lf-site">{t('land.f.trap')}</label>
        <input
          id="lf-site"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => set('website', e.target.value)}
        />
      </div>
      <div className="lp-full flex flex-col gap-[5px]">
        <label className="lp-check">
          <input
            id={ID.consent}
            type="checkbox"
            checked={values.consent}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? `${ID.consent}-err` : undefined}
            onChange={(e) => set('consent', e.target.checked)}
          />
          <span>
            {t('land.f.consent.a')}{' '}
            <button
              type="button"
              className={`${linkButtonClass()} inline`}
              onClick={(e) => {
                e.preventDefault();
                onConsent();
              }}
            >
              {t('land.f.consent.b')}
            </button>
          </span>
        </label>
        {errors.consent ? (
          <div
            id={`${ID.consent}-err`}
            className="flex items-start gap-[5px] text-[12px] text-danger"
          >
            <Icon name="alert" size="sm" className="mt-px" />
            <span>{errors.consent}</span>
          </div>
        ) : null}
      </div>
      {message ? (
        <div className="lp-full">
          <Note tone="bad" alert>
            {message}
          </Note>
        </div>
      ) : null}
      <div className="lp-full lp-send">
        <button type="submit" className={SEND} disabled={sending}>
          {sending ? t('land.f.sending') : t('land.f.send')}
        </button>
      </div>
    </form>
  );
}

/** Ошибки полей из ответа 400: `details` — список `{ path, message }`, сообщение — ключ словаря. */
function serverFieldErrors(details: unknown): Partial<Record<FieldId, string>> {
  const out: Partial<Record<FieldId, string>> = {};
  if (!Array.isArray(details)) return out;
  for (const item of details as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { path, message } = item as { path?: unknown; message?: unknown };
    const field = Array.isArray(path) ? path[0] : undefined;
    if (typeof field === 'string' && field in ID && typeof message === 'string') {
      out[field as FieldId] = message.startsWith('land.') ? message : 'land.e.net';
    }
  }
  return out;
}
