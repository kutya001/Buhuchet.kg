'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  bishkekDate,
  formatDateRu,
  formatPhone,
  joinPhone,
  LOGO_LINK_SECONDS,
  LOGO_MAX_BYTES,
  splitPhone,
} from '@buhuchet/domain';
import {
  OrgMainForm,
  OrgProfile,
  OrgSlugField,
  type OrgMainFormInput,
  type PhoneCodes,
  type UpdateOrgProfileRequest,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  ConfirmDialog,
  Field,
  FormGrid,
  inputClass,
  KeyValues,
  Note,
  PhoneInput,
  RecordChangedNotice,
  TOUCH_AREA,
  useToast,
  type KeyValueItem,
  type PhoneInputValue,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { api, callApi, type ApiResult } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { phoneCodesQuery } from '../staff/staff-data';
import { orgProfileQuery, policyQuery, useOrgRefresh } from './org-data';

/** Отказы сервера, которые показываются под своим полем. */
const FIELD_OF: Record<string, keyof OrgMainFormInput> = {
  name_required: 'name',
  inn_invalid: 'inn',
  inn_taken: 'inn',
  slug_invalid: 'slug',
  slug_reserved: 'slug',
  slug_taken: 'slug',
};

const LOGO_TYPES = new Set(['image/png', 'image/jpeg']);

/**
 * «Моя организация» → «Основное» (прототип modules/org.js, renderOrg → main). С правом «Настройки и
 * учётная политика» — форма: название, ИНН, телефон, адрес, руководитель, «Адрес страницы организации»
 * (если включена «Страница контрагента по ссылке») и логотип с предпросмотром; без права — те же
 * сведения только для просмотра. Реквизиты для приёма денег — своя задача (поток В).
 */
export function OrgMain() {
  const t = useT();
  const { access } = useShell();
  const profile = useQuery(orgProfileQuery);
  const policy = useQuery(policyQuery);
  const codes = useQuery(phoneCodesQuery);
  if (profile.isError || policy.isError || codes.isError) {
    return <Note tone="bad">{t('org.load_error')}</Note>;
  }
  if (!profile.data || !policy.data || !codes.data) return null;
  const cppage = policy.data.features.cppage;
  if (!access.can('org')) {
    return (
      <div className="flex flex-col gap-3.5">
        <Note icon="lock">{t('org.readonly')}</Note>
        <OrgMainView profile={profile.data} cppage={cppage} codes={codes.data} />
      </div>
    );
  }
  return <OrgMainEdit profile={profile.data} cppage={cppage} codes={codes.data} />;
}

/**
 * Блок «Основное» только для просмотра (прототип modules/profile.js, orgMainView): то же видно в окне
 * профиля организации из левой панели.
 */
export function OrgMainView({
  profile,
  cppage,
  codes,
}: {
  profile: OrgProfile;
  cppage: boolean;
  codes: PhoneCodes['items'];
}) {
  const t = useT();
  const dash = (value: string | null) => value || '—';
  const items: KeyValueItem[] = [
    { id: 'name', label: t('org.field.name'), value: profile.name },
    { id: 'inn', label: t('org.field.inn'), value: dash(profile.inn), mono: true },
    { id: 'address', label: t('org.field.address'), value: dash(profile.address) },
    {
      id: 'phone',
      label: t('org.field.phone'),
      value: profile.phone ? formatPhone(profile.phone, codes) : '—',
    },
    { id: 'head', label: t('org.field.head'), value: dash(profile.head) },
  ];
  if (cppage) {
    items.push({ id: 'slug', label: t('org.field.slug'), value: profile.slug, mono: true });
  }
  if (profile.logo) {
    items.push({
      id: 'logo',
      label: t('org.field.logo'),
      value: <OrgLogo link={profile.logo} alt={t('org.field.logo')} />,
    });
  }
  items.push({
    id: 'since',
    label: t('org.field.since'),
    value: formatDateRu(bishkekDate(new Date(profile.audit.createdAt))),
  });
  return (
    <Box title={t('org.main.title')}>
      <KeyValues items={items} />
    </Box>
  );
}

/** Через сколько после получения ссылка на логотип могла истечь: срок без минуты на дорогу ответа. */
const LOGO_STALE_MS = (LOGO_LINK_SECONDS - 60) * 1000;

/**
 * Логотип 40 × 40 по временной ссылке; ссылка живёт 15 минут — если картинка не открылась, потому что
 * срок вышел, «Основное» перечитывается с новой ссылкой. Срок считается по часам браузера от получения
 * ответа: часы компьютера могут расходиться с сервером, а только что полученная ссылка, которая тоже не
 * открылась (хранилище недоступно), не перезапрашивается по кругу.
 */
function OrgLogo({ link, alt }: { link: NonNullable<OrgProfile['logo']>; alt: string }) {
  const client = useQueryClient();
  return (
    <img
      src={link.url}
      alt={alt}
      data-org-logo=""
      className="h-10 w-10 flex-none rounded-lg border border-line object-contain"
      onError={() => {
        const at = client.getQueryState(orgProfileQuery.queryKey)?.dataUpdatedAt ?? 0;
        if (Date.now() - at >= LOGO_STALE_MS) {
          void client.invalidateQueries({ queryKey: orgProfileQuery.queryKey });
        }
      }}
    />
  );
}

/** Значения формы из сохранённого «Основного». */
const formValues = (p: OrgProfile): OrgMainFormInput => ({
  name: p.name,
  inn: p.inn ?? '',
  address: p.address ?? '',
  head: p.head ?? '',
  slug: p.slug,
});

/** Что изменилось по сравнению с сохранённым: только эти поля уходят на сервер. */
function changedFields(
  saved: OrgProfile,
  values: OrgMainForm,
  phone: string | null,
  cppage: boolean,
): Omit<UpdateOrgProfileRequest, 'version'> {
  const before = formValues(saved);
  const patch: Omit<UpdateOrgProfileRequest, 'version'> = {};
  if (values.name !== before.name) patch.name = values.name;
  if (values.inn !== before.inn) patch.inn = values.inn;
  if (values.address !== before.address) patch.address = values.address;
  if (values.head !== before.head) patch.head = values.head;
  if (phone !== saved.phone) patch.phone = phone;
  if (cppage && values.slug !== before.slug) patch.slug = values.slug;
  return patch;
}

function OrgMainEdit({
  profile,
  cppage,
  codes,
}: {
  profile: OrgProfile;
  cppage: boolean;
  codes: PhoneCodes['items'];
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useOrgRefresh();
  const id = useId();
  /** Последнее сохранённое «Основное»: от него версия и что изменилось. */
  const [saved, setSaved] = useState(profile);
  const [phone, setPhone] = useState<PhoneInputValue>(() => splitPhone(profile.phone, codes));
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [logo, setLogo] = useState<{ file: File; url: string } | null>(null);
  const [logoError, setLogoError] = useState<string | undefined>();
  /** «Убрать» у сохранённого логотипа: логотип уходит с «Сохранить» (docs/deviations.md, п. 19). */
  const [dropLogo, setDropLogo] = useState(false);
  /** Новый адрес страницы ждёт подтверждения «Сменить адрес страницы организации?». */
  const [pending, setPending] = useState<{ values: OrgMainForm; phone: string | null } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<OrgMainFormInput, unknown, OrgMainForm>({
    resolver: zodResolver(cppage ? OrgMainForm.extend({ slug: OrgSlugField }) : OrgMainForm),
    defaultValues: formValues(profile),
  });
  // Поля регистрируются по порядку на экране: при ошибках фокус встаёт на первое неверное.
  const fields = {
    name: register('name'),
    inn: register('inn'),
    address: register('address'),
    head: register('head'),
    slug: register('slug'),
  };
  const slug = useWatch({ control, name: 'slug' });
  // Занятое слово видно сразу при вводе (прототип: og-slug oninput).
  const reserved = OrgSlugField.safeParse(slug).error?.issues[0]?.message === 'err.slug_reserved';
  const ids = { phone: `${id}-phone`, slug: `${id}-slug`, logo: `${id}-logo` };
  const focus = (target: string) => document.getElementById(target)?.focus();

  // Временная ссылка предпросмотра освобождается, когда выбран другой файл или экран закрыт.
  useEffect(() => () => (logo ? URL.revokeObjectURL(logo.url) : undefined), [logo]);

  const pickLogo = (file: File | undefined) => {
    setLogoError(
      !file
        ? undefined
        : !LOGO_TYPES.has(file.type)
          ? t('err.logo_type')
          : file.size > LOGO_MAX_BYTES
            ? t('err.logo_too_large')
            : undefined,
    );
    setLogo(file ? { file, url: URL.createObjectURL(file) } : null);
  };

  /** «Убрать»: выбранный файл — отменить выбор; сохранённый логотип — убрать при «Сохранить». */
  const removeLogo = () => {
    if (logo) {
      setLogo(null);
      setLogoError(undefined);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setDropLogo(true);
  };

  const fail = (res: Extract<ApiResult<unknown>, { ok: false }>) => {
    const code = res.error.code;
    if (code === 'record_changed') return setChanged(true);
    const message = errorText(res.error);
    const field = FIELD_OF[code];
    if (field) return setError(field, { type: 'server', message }, { shouldFocus: true });
    if (code === 'invalid_phone') {
      setPhoneError(message);
      return focus(ids.phone);
    }
    if (code === 'logo_too_large' || code === 'logo_type') {
      setLogoError(message);
      return focus(ids.logo);
    }
    toast(message, { bad: true });
  };

  const save = async (values: OrgMainForm, phoneValue: string | null) => {
    setBusy(true);
    try {
      let current = saved;
      const patch = changedFields(current, values, phoneValue, cppage);
      if (Object.keys(patch).length > 0) {
        const res = await callApi(() =>
          api.api.org.$patch({ json: { version: current.version, ...patch } }),
        );
        if (!res.ok) return fail(res);
        current = OrgProfile.parse(res.data);
        setSaved(current);
      }
      if (logo) {
        const file = logo.file;
        const version = current.version;
        const res = await callApi(() =>
          api.api.org.logo.$put(
            { query: { version: String(version) } },
            { headers: { 'content-type': file.type }, init: { body: file } },
          ),
        );
        if (!res.ok) return fail(res);
        current = OrgProfile.parse(res.data);
        setSaved(current);
        setLogo(null);
        if (fileRef.current) fileRef.current.value = '';
      } else if (dropLogo && current.logo) {
        const version = current.version;
        const res = await callApi(() =>
          api.api.org.logo.$delete({ query: { version: String(version) } }),
        );
        if (!res.ok) return fail(res);
        current = OrgProfile.parse(res.data);
        setSaved(current);
      }
      setDropLogo(false);
      reset(formValues(current));
      toast(t('org.saved'), { icon: 'check' });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    const typed = joinPhone(phone.cc, phone.local, codes);
    const bad = typed.missing > 0 ? t('staff.err.phone', { n: typed.need }) : undefined;
    setPhoneError(bad);
    void handleSubmit((values) => {
      if (bad) return focus(ids.phone);
      if (logoError) return focus(ids.logo);
      // Смена адреса: ссылки, отправленные контрагентам, перестанут открываться.
      if (cppage && values.slug !== saved.slug) {
        setPending({ values, phone: typed.phone });
        return setConfirmOpen(true);
      }
      return save(values, typed.phone);
    })(event);
  };

  const reload = async () => {
    setBusy(true);
    try {
      const fresh = await client.fetchQuery({ ...orgProfileQuery, staleTime: 0 });
      setSaved(fresh);
      reset(formValues(fresh));
      setPhone(splitPhone(fresh.phone, codes));
      setPhoneError(undefined);
      setDropLogo(false);
      setChanged(false);
    } catch {
      toast(t('err.unknown'), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  // Ссылка на сохранённый логотип — из свежих данных, если запись та же: новая ссылка взамен истёкшей
  // приходит перечитыванием «Основного», а не сохранением.
  const savedLogo = profile.version === saved.version ? profile.logo : saved.logo;
  const shownLogo = logo?.url ?? (dropLogo ? undefined : savedLogo?.url);
  return (
    <div className="flex flex-col gap-3.5">
      <Box title={t('org.main.title')}>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={() => void reload()}
            reloading={busy}
          />
        ) : null}
        <form id={`${id}-form`} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
          <FormGrid>
            <Field
              id={`${id}-name`}
              label={t('org.field.name')}
              required
              full
              error={fieldError(t, errors.name)}
            >
              {(c) => <input {...c} {...fields.name} type="text" className={inputClass()} />}
            </Field>
            <Field
              id={`${id}-inn`}
              label={t('org.field.inn')}
              required
              error={fieldError(t, errors.inn)}
            >
              {(c) => (
                <input
                  {...c}
                  {...fields.inn}
                  type="text"
                  inputMode="numeric"
                  maxLength={14}
                  className={inputClass({ mono: true })}
                />
              )}
            </Field>
            <Field id={ids.phone} label={t('org.field.phone')} error={phoneError}>
              {(c) => (
                <PhoneInput
                  codes={codes}
                  value={phone}
                  onChange={(next) => {
                    setPhone(next);
                    setPhoneError(undefined);
                  }}
                  control={c}
                  codeLabel={t('staff.phone.code')}
                />
              )}
            </Field>
            <Field
              id={`${id}-address`}
              label={t('org.field.address')}
              full
              error={fieldError(t, errors.address)}
            >
              {(c) => <input {...c} {...fields.address} type="text" className={inputClass()} />}
            </Field>
            <Field id={`${id}-head`} label={t('org.field.head')} error={fieldError(t, errors.head)}>
              {(c) => <input {...c} {...fields.head} type="text" className={inputClass()} />}
            </Field>
            {cppage ? (
              <Field
                id={ids.slug}
                label={t('org.field.slug')}
                required
                hint={t('org.field.slug_hint', { slug: saved.slug || '…' })}
                error={
                  fieldError(t, errors.slug) ?? (reserved ? t('err.slug_reserved') : undefined)
                }
              >
                {(c) => (
                  <input
                    {...c}
                    {...fields.slug}
                    type="text"
                    maxLength={30}
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                    className={inputClass({ mono: true })}
                  />
                )}
              </Field>
            ) : null}
            <Field
              id={ids.logo}
              label={t('org.field.logo')}
              hint={t('org.field.logo_hint')}
              error={logoError}
            >
              {(c) => (
                <div className="flex items-center gap-2.5">
                  {shownLogo ? (
                    logo ? (
                      <img
                        src={logo.url}
                        alt={t('org.field.logo')}
                        data-org-logo=""
                        className="h-10 w-10 flex-none rounded-lg border border-line object-contain"
                      />
                    ) : (
                      <OrgLogo link={savedLogo!} alt={t('org.field.logo')} />
                    )
                  ) : null}
                  <input
                    {...c}
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => pickLogo(e.target.files?.[0])}
                    className={`${inputClass({ file: true })} cursor-pointer`}
                  />
                  {shownLogo ? (
                    <button
                      type="button"
                      className={`${buttonClass('ghost', 'sm')} ${TOUCH_AREA}`}
                      onClick={removeLogo}
                    >
                      {t('org.logo.remove')}
                    </button>
                  ) : null}
                </div>
              )}
            </Field>
          </FormGrid>
          <div className="flex">
            <div className="grow" />
            <button type="submit" className={buttonClass('cta')} disabled={busy || changed}>
              {t('btn.save')}
            </button>
          </div>
        </form>
      </Box>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('org.slug.confirm_title')}
        text={t('org.slug.confirm_text', { slug: pending?.values.slug ?? '' })}
        ok={t('org.slug.confirm_ok')}
        danger
        onConfirm={() => {
          if (pending) void save(pending.values, pending.phone);
        }}
      />
    </div>
  );
}
