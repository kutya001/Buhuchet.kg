'use client';

import {
  formatMomentRu,
  formatPhone,
  joinPhone,
  LEAD_ADDRESS_MAX,
  LEAD_DOC_KINDS,
  LEAD_DOC_TEXT_KEYS,
  LEAD_DOCS_BY_FORM,
  LEAD_FIRM_MAX,
  LEAD_HEAD_MAX,
  LEAD_NAME_MAX,
  LEAD_NOTE_MAX,
  LEAD_TELEGRAM_MAX,
  leadSizeOptions,
  ORG_LEGAL_FORMS,
  splitPhone,
  type LeadDocKind,
  type LeadDocsFound,
  type OrgLegalForm,
  type UiTextKey,
} from '@buhuchet/domain';
import { LeadSubmitted } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FieldMarks,
  Icon,
  inputClass,
  linkButtonClass,
  Note,
  PhoneInput,
  Pill,
  Segments,
  type PhoneInputCode,
  type PhoneInputValue,
} from '@buhuchet/ui';
import { useCallback, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { Stamp } from './landing-art';
import {
  docMissingKey,
  foundNote,
  LEAD_REG_FIELDS,
  leadDocErrorKey,
  leadDocProblem,
  uploadLeadDoc,
  type LeadDocResult,
  type LeadRegField,
} from './lead-docs';

/*
 * Форма «Оставить заявку» (ТЗ «Лендинг» → «Форма «Оставить заявку»»; прототип modules/landing.js,
 * landFormHtml и landFormBind): проверка полей на месте, как в прототипе, затем метод `POST /api/leads`.
 * Пока заявка отправляется — «Отправляем…» и кнопка неактивна; нет связи или сервер ответил ошибкой —
 * «Не удалось отправить заявку…», введённое не пропадает; больше 3 заявок за час с адреса — текст
 * `land.e.ip` с телефоном из контактов.
 *
 * Доработки 14.11.2026, блок 1 (прототип v114 modules/lead-docs.js — ldTopHtml, ldBind, ldParse,
 * ldCheck): первым полем — «ОсОО» или «ИП», затем документы формы в PDF до 20 МБ (ИП — свидетельство
 * ГНС; ОсОО — выписка и свидетельство Минюста). Каждый выбранный документ сразу уходит в хранилище и
 * разбирается на сервере (`lead-docs.ts`); найденное — в полях «Название фирмы», «ИНН», «ОКПО»,
 * «Руководитель», «Юридический адрес» с отметкой «из документов»: поле, которое заявитель поправил,
 * новый разбор не перезаписывает. Смена формы сбрасывает документы и то, что из них подставлено.
 */

type DocField = `doc-${LeadDocKind}`;
type FieldId =
  | 'form'
  | DocField
  | 'firm'
  | 'inn'
  | 'okpo'
  | 'head'
  | 'address'
  | 'name'
  | 'phone'
  | 'size'
  | 'telegram'
  | 'note'
  | 'consent';

const docField = (kind: LeadDocKind): DocField => `doc-${kind}`;

/** Порядок полей (как на экране): фокус после неудачной проверки — в первое поле с ошибкой. */
const ORDER: readonly FieldId[] = [
  'form',
  ...LEAD_DOC_KINDS.map(docField),
  'firm',
  'inn',
  'okpo',
  'head',
  'address',
  'name',
  'phone',
  'size',
  'telegram',
  'note',
  'consent',
];

const ID: Record<FieldId, string> = {
  form: 'lf-form',
  'doc-gns_cert': 'lf-doc-gns',
  'doc-extract': 'lf-doc-vyp',
  'doc-minjust_cert': 'lf-doc-mj',
  firm: 'lf-firm',
  inn: 'lf-inn',
  okpo: 'lf-okpo',
  head: 'lf-head',
  address: 'lf-addr',
  name: 'lf-name',
  phone: 'lf-phone',
  size: 'lf-size',
  telegram: 'lf-tg',
  note: 'lf-note',
  consent: 'lf-ok',
};

/** Что ответил сервер на заявку: ссылка на бота, «уже подключён» или бота нет (поток Т). */
export type LeadSentTg = LeadSubmitted['tg'];

const SEND = `${buttonClass('cta')} lp-lg`;

interface Values {
  name: string;
  firm: string;
  inn: string;
  okpo: string;
  head: string;
  address: string;
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
  inn: '',
  okpo: '',
  head: '',
  address: '',
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
  /** Заявка принята: номер по маске для «Спасибо! … по номеру <телефон> …» и ссылка на бота. */
  onSent: (phone: string, tg: LeadSentTg) => void;
  /** Открыть окно «Согласие на обработку персональных данных». */
  onConsent: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [phone, setPhone] = useState<PhoneInputValue>(() => splitPhone(null, codes));
  const [errors, setErrors] = useState<Partial<Record<FieldId, string>>>({});
  const [message, setMessage] = useState<{ text: string; busy?: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const sizes = leadSizeOptions(t('land.f.size.opts'));
  // Документы (прототип `LD`): форма, загруженные и прочитанные документы, что подставил разбор.
  const [legalForm, setLegalForm] = useState<OrgLegalForm | ''>('');
  const [docs, setDocs] = useState<Partial<Record<LeadDocKind, string>>>({});
  const [found, setFound] = useState<LeadDocsFound | ''>('');
  const [auto, setAuto] = useState<Partial<Record<LeadRegField, string>>>({});
  const [busy, setBusy] = useState(false);
  const autoRef = useRef<Partial<Record<LeadRegField, string>>>({});
  const draft = useRef<string | null>(null);
  // Документы разбираются по одному: у первого появляется черновик, следующие идут в него же.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  // Смена формы: прежние загрузки и разборы больше не трогают форму.
  const generation = useRef(0);
  const kinds = legalForm ? LEAD_DOCS_BY_FORM[legalForm] : [];

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in ID) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const focusFirst = (bad: Partial<Record<FieldId, string>>) => {
    const first = ORDER.find((f) => bad[f]);
    if (!first) return;
    const selector = first === 'form' ? `#${ID.form} button` : `#${ID[first]}`;
    form.current?.querySelector<HTMLElement>(selector)?.focus();
  };

  /** Смена формы: документы и подставленное из них (не поправленное заявителем) сбрасываются. */
  const pickForm = (next: OrgLegalForm) => {
    if (next === legalForm) return;
    const was = autoRef.current;
    setValues((v) => {
      const out = { ...v };
      for (const f of LEAD_REG_FIELDS) if (was[f] && v[f].trim() === was[f]) out[f] = '';
      return out;
    });
    generation.current += 1;
    draft.current = null;
    autoRef.current = {};
    setAuto({});
    setDocs({});
    setFound('');
    setLegalForm(next);
    setErrors((e) => {
      const out = { ...e, form: undefined };
      for (const k of LEAD_DOC_KINDS) out[docField(k)] = undefined;
      return out;
    });
  };

  /** Итог разбора: найденное — в пустые поля и в поля, которые подставил прежний разбор. */
  const applyRead = (read: Extract<LeadDocResult, { ok: true }>) => {
    setDocs(Object.fromEntries(read.read.docs.map((d) => [d.kind, d.name])));
    setFound(read.read.found);
    const got = read.read.values;
    const was = autoRef.current;
    const next = { ...was };
    setValues((v) => {
      const out = { ...v };
      for (const f of LEAD_REG_FIELDS) {
        if (!got[f]) continue;
        const cur = v[f].trim();
        if (!cur || cur === was[f]) {
          out[f] = got[f];
          next[f] = got[f];
        }
      }
      return out;
    });
    autoRef.current = next;
    setAuto(next);
    setErrors((e) => {
      const out = { ...e };
      for (const f of LEAD_REG_FIELDS) if (got[f]) out[f] = undefined;
      return out;
    });
  };

  const pickDoc = useCallback(
    async (kind: LeadDocKind, event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0] ?? null;
      const field = docField(kind);
      setErrors((e) => ({ ...e, [field]: undefined }));
      setDocs((d) => {
        const next = { ...d };
        delete next[kind];
        return next;
      });
      if (!file) return;
      const problem = await leadDocProblem(file);
      if (problem) {
        input.value = '';
        setErrors((e) => ({ ...e, [field]: t(problem) }));
        return;
      }
      const gen = generation.current;
      pending.current += 1;
      setBusy(true);
      chain.current = chain.current
        .then(async () => {
          if (gen !== generation.current) return;
          const res = await uploadLeadDoc(draft.current, kind, file);
          if (gen !== generation.current) return;
          if (res.draft) draft.current = res.draft;
          if (res.ok) return applyRead(res);
          input.value = '';
          const key = leadDocErrorKey(res.error);
          setErrors((e) => ({ ...e, [field]: key ? t(key) : errorText(res.error) }));
        })
        .finally(() => {
          pending.current -= 1;
          if (pending.current === 0) setBusy(false);
        });
    },
    // applyRead меняет только состояние формы через функции обновления.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, errorText],
  );

  /** «из документов» под полем, пока в нём то, что подставил разбор (прототип ldMarkSync). */
  const marks = (id: string) => {
    const f = LEAD_REG_FIELDS.find((x) => ID[x] === id);
    if (!f || !auto[f] || values[f].trim() !== auto[f]) return null;
    return {
      node: (
        <span>
          <Pill tone="info" size="sm">
            {t('land.f.fromdocs')}
          </Pill>
        </span>
      ),
    };
  };
  const note = foundNote(busy, found);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    setMessage(null);
    const joined = joinPhone(phone.cc, phone.local, codes);
    const v = {
      ...values,
      name: values.name.trim(),
      firm: values.firm.trim(),
      inn: values.inn.replace(/\s+/g, ''),
      okpo: values.okpo.replace(/\s+/g, ''),
      head: values.head.trim(),
      address: values.address.trim(),
      telegram: values.telegram.trim(),
      note: values.note.trim(),
    };
    const phoneError = t('land.e.phone', { цифр: joined.need });
    const bad: Partial<Record<FieldId, string>> = {
      form: legalForm ? undefined : t('land.e.form'),
      ...Object.fromEntries(
        kinds.map((k) => [
          docField(k),
          docs[k] ? undefined : (errors[docField(k)] ?? t(docMissingKey(k))),
        ]),
      ),
      inn: /^[0-9]{14}$/.test(v.inn) ? undefined : t('land.e.inn'),
      okpo: !v.okpo || /^[0-9]{8}$/.test(v.okpo) ? undefined : t('land.e.okpo'),
      name: v.name ? undefined : t('land.e.name'),
      firm: v.firm ? undefined : t('land.e.firm'),
      phone: joined.phone && joined.missing === 0 ? undefined : phoneError,
      size: v.size ? undefined : t('land.e.size'),
      note: v.note.length > LEAD_NOTE_MAX ? t('land.e.note') : undefined,
      consent: v.consent ? undefined : t('land.e.consent'),
    };
    setErrors(bad);
    if (ORDER.some((f) => bad[f]) || !joined.phone || !legalForm) return focusFirst(bad);
    if (busy || !draft.current) return setMessage({ text: t('land.e.busy'), busy: true });
    setSending(true);
    const res = await callApi(() =>
      api.api.leads.$post({
        json: {
          form: legalForm,
          inn: v.inn,
          okpo: v.okpo,
          address: v.address,
          head: v.head,
          draft: draft.current!,
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
    if (res.ok) return onSent(formatPhone(joined.phone, codes), LeadSubmitted.parse(res.data).tg);
    if (res.error.code === 'lead_limited') {
      return setMessage({ text: t('land.e.ip', { телефон: t('land.c.phone') }) });
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
    setMessage({ text: t('land.e.net') });
  };

  return (
    <form ref={form} className="lp-form" noValidate autoComplete="on" onSubmit={submit}>
      <FieldMarks.Provider value={marks}>
      <Field id={ID.form} label={t('land.f.form')} required full error={errors.form}>
        <div id={ID.form} className="lf-form-seg">
          <Segments<OrgLegalForm | ''>
            label={t('land.f.form')}
            options={ORG_LEGAL_FORMS.map((f) => ({ value: f, label: t(`land.f.form.${f}`) }))}
            value={legalForm}
            onChange={(f) => {
              if (f) pickForm(f);
            }}
          />
        </div>
      </Field>
      {legalForm ? (
        <div className="lp-full lf-docs">
          <div className="lf-docs-in">
            {kinds.map((k) => (
              <Field
                key={`${legalForm}-${k}`}
                id={ID[docField(k)]}
                label={t(LEAD_DOC_TEXT_KEYS[k] as UiTextKey)}
                required
                hint={t('land.f.doc.hint')}
                error={errors[docField(k)]}
              >
                {(c) => (
                  <input
                    {...c}
                    type="file"
                    className={inputClass({ file: true })}
                    accept="application/pdf,.pdf"
                    onChange={(e) => void pickDoc(k, e)}
                  />
                )}
              </Field>
            ))}
          </div>
          {note ? (
            <Note tone={note.tone} icon={note.icon}>
              {t(note.key)}
            </Note>
          ) : null}
        </div>
      ) : null}
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
      <Field id={ID.inn} label={t('land.f.inn')} required error={errors.inn}>
        {(c) => (
          <input
            {...c}
            className={inputClass({ mono: true })}
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            value={values.inn}
            onChange={(e) => set('inn', e.target.value)}
          />
        )}
      </Field>
      <Field id={ID.okpo} label={t('land.f.okpo')} error={errors.okpo}>
        {(c) => (
          <input
            {...c}
            className={inputClass({ mono: true })}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={values.okpo}
            onChange={(e) => set('okpo', e.target.value)}
          />
        )}
      </Field>
      <Field id={ID.head} label={t('land.f.head')} error={errors.head}>
        {(c) => (
          <input
            {...c}
            className={inputClass()}
            autoComplete="off"
            maxLength={LEAD_HEAD_MAX}
            value={values.head}
            onChange={(e) => set('head', e.target.value)}
          />
        )}
      </Field>
      <Field id={ID.address} label={t('land.f.addr')} full error={errors.address}>
        {(c) => (
          <input
            {...c}
            className={inputClass()}
            autoComplete="off"
            maxLength={LEAD_ADDRESS_MAX}
            value={values.address}
            onChange={(e) => set('address', e.target.value)}
          />
        )}
      </Field>
      </FieldMarks.Provider>
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
          <Note tone="bad" alert icon={message.busy ? 'hourglass' : undefined}>
            {message.text}
          </Note>
        </div>
      ) : null}
      <div className="lp-full">
        <Note icon="tg">{t('land.f.tgline')}</Note>
      </div>
      <div className="lp-full lp-send">
        <button type="submit" className={SEND} disabled={sending}>
          {sending ? t('land.f.sending') : t('land.f.send')}
        </button>
      </div>
    </form>
  );
}

/**
 * Экран после отправки (прототип v114 ldOkHtml): «Заявка отправлена. Подключите Telegram…», кнопка
 * «Подключить Telegram» (бот открывается в новой вкладке) и до какого времени действует ссылка; уже
 * подключён — «Решение по заявке придёт в Telegram». Бота нет — прежнее «Спасибо! … по номеру …».
 */
export function LeadSentBox({ phone, tg }: { phone: string; tg: LeadSentTg }) {
  const t = useT();
  if (!tg) {
    return (
      <div className="lp-ok" role="status">
        <Stamp />
        <span>{t('land.ok', { телефон: phone })}</span>
      </div>
    );
  }
  return (
    <div className="lp-ok lp-ok-tg" role="status">
      <Stamp />
      <div className="lp-ok-b">
        <span>{t('linked' in tg ? 'land.ok.tgon' : 'land.ok.docs')}</span>
        {'url' in tg ? (
          <>
            <a className={SEND} href={tg.url} target="_blank" rel="noopener noreferrer">
              <Icon name="tg" size="sm" />
              {t('land.btn.tg')}
            </a>
            <span className="text-[11.5px] leading-[1.4] text-faint">
              {t('land.ok.till', { до: formatMomentRu(new Date(tg.expiresAt)) })}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Ошибки полей из ответа 400: `details` — список `{ path, message }`, сообщение — ключ словаря. */
function serverFieldErrors(details: unknown): Partial<Record<FieldId, string>> {
  const out: Partial<Record<FieldId, string>> = {};
  if (!Array.isArray(details)) return out;
  for (const item of details as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { path, message } = item as { path?: unknown; message?: unknown };
    // Документ формы не загрузился (`['docs', <вид>]`) — ошибка под полем документа.
    const field = Array.isArray(path)
      ? path[0] === 'docs' && typeof path[1] === 'string'
        ? `doc-${path[1]}`
        : path[0]
      : undefined;
    if (typeof field === 'string' && field in ID && typeof message === 'string') {
      out[field as FieldId] = message.startsWith('land.') ? message : 'land.e.net';
    }
  }
  return out;
}
