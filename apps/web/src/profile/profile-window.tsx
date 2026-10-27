'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordForm, type MeResponse, type TelegramInfo } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  KeyValues,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  useToast,
  useWindow,
} from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { fieldError, NewPasswordFields } from '../auth/fields';
import { TelegramLinkRow, useTelegramLink } from '../auth/telegram-link';
import { useErrorText, useT } from '../l10n/provider';
import { MyWalletsBox } from '../money/wallets';
import { currentTheme, setTheme } from '../shell/browser';
import type { Theme } from '../shell/prefs';

/**
 * «Мой профиль» (ТЗ «Профиль пользователя», прототип modules/profile.js profileDlg): основное
 * (ФИО, логин, телефон, роль), Telegram для уведомлений (привязка по ссылке, «Отвязать»), «Мои реквизиты
 * для переводов» (задача 2.18), тема и смена пароля. Окно — карточка; пока в «Смене пароля» что-то введено, протяжка вниз, «Назад» и выход из
 * аккаунта спрашивают. Уровень знаний и уведомления придут со своими задачами (поток Г).
 */
export function ProfileWindow({
  open,
  onClose,
  me,
}: {
  open: boolean;
  onClose: () => void;
  me: MeResponse;
}) {
  const t = useT();
  const [dirty, setDirty] = useState(false);
  const fullName = me.employee?.fullName ?? t('profile.platform_admin');
  const close = () => {
    setDirty(false);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      kind="card"
      size="mid"
      dirty={dirty}
      title={t('profile.title')}
      sub={fullName}
      footer={<ProfileFooter />}
    >
      <Box title={t('profile.main')}>
        <KeyValues
          items={[
            { id: 'fio', label: t('profile.fio'), value: fullName },
            { id: 'login', label: t('profile.login'), value: me.user.login, mono: true },
            { id: 'phone', label: t('profile.phone'), value: me.employee?.phone ?? '—' },
            {
              id: 'role',
              label: t('profile.role'),
              value: me.user.isPlatformAdmin
                ? t('profile.platform_admin')
                : (me.employee?.roleName ?? '—'),
            },
          ]}
        />
      </Box>
      <TelegramBox initial={me.telegram} />
      {me.employee ? <MyWalletsBox holderDefault={me.employee.shortName} /> : null}
      <Box title={t('profile.settings')}>
        <FormGrid>
          <ThemeField />
        </FormGrid>
      </Box>
      <PasswordBox onDirty={setDirty} />
    </Modal>
  );
}

function ProfileFooter() {
  const t = useT();
  const { close } = useWindow();
  return (
    <>
      <div className="flex-1" />
      <button type="button" className={buttonClass('cta')} onClick={close}>
        {t('btn.done')}
      </button>
    </>
  );
}

function TelegramBox({ initial }: { initial: TelegramInfo | null }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const errorText = useErrorText();
  const [telegram, setTelegram] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unlink = async () => {
    setBusy(true);
    const res = await callApi(() => api.api.telegram.link.$delete());
    setBusy(false);
    if (!res.ok) return setError(errorText(res.error));
    setError(null);
    setTelegram(null);
    toast(t('profile.tg_unlinked'), { icon: 'tg' });
    router.refresh();
  };

  return (
    <Box title={t('profile.tg')}>
      {telegram ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <Pill tone="ok" icon="check">
            {t('profile.tg_linked')}
          </Pill>
          <span className={MONO_CLASS}>{telegram.name}</span>
          <div className="grow" />
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            onClick={unlink}
            disabled={busy}
          >
            {t('profile.tg_unlink')}
          </button>
        </div>
      ) : (
        <TelegramLinkPanel
          onLinked={(info) => {
            setTelegram(info);
            toast(t('profile.tg_done'), { icon: 'tg' });
            router.refresh();
          }}
        />
      )}
      {error ? (
        <Note tone="bad" alert>
          {error}
        </Note>
      ) : null}
    </Box>
  );
}

/** Telegram не привязан: предупреждение и ссылка привязки; бот привязал чат — `onLinked`. */
function TelegramLinkPanel({ onLinked }: { onLinked: (telegram: TelegramInfo) => void }) {
  const t = useT();
  const errorText = useErrorText();
  const link = useTelegramLink();
  const linked = link.status === 'linked' ? link.me.telegram : null;
  useEffect(() => {
    if (linked) onLinked(linked);
  }, [linked, onLinked]);
  return (
    <>
      <Note tone="warn">{t('profile.tg_missing')}</Note>
      {link.status === 'ready' ? <TelegramLinkRow url={link.url} /> : null}
      {link.status === 'failed' ? <Note>{errorText(link.error)}</Note> : null}
    </>
  );
}

/** Тема (прототип: «Светлая» / «Тёмная»): применяется сразу и запоминается на этом устройстве. */
function ThemeField() {
  const t = useT();
  const [theme, choose] = useState<Theme>(currentTheme);
  return (
    <Field id="pf-theme" label={t('profile.theme')}>
      {(control) => (
        <select
          {...control}
          className={`${inputClass()} cursor-pointer`}
          value={theme}
          onChange={(e) => {
            const next = e.target.value === 'dark' ? 'dark' : 'light';
            setTheme(next);
            choose(next);
          }}
        >
          <option value="light">{t('profile.theme_light')}</option>
          <option value="dark">{t('profile.theme_dark')}</option>
        </select>
      )}
    </Field>
  );
}

function PasswordBox({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ChangePasswordForm>({
    resolver: zodResolver(ChangePasswordForm),
    defaultValues: { currentPassword: '', newPassword: '', repeat: '' },
  });
  useEffect(() => onDirty(isDirty), [isDirty, onDirty]);
  // Поля регистрируются по порядку на экране: при ошибках фокус встаёт на первое неверное.
  const currentField = register('currentPassword');
  const passwordFields = { newPassword: register('newPassword'), repeat: register('repeat') };

  const submit = handleSubmit(async ({ currentPassword, newPassword }) => {
    const res = await callApi(() =>
      api.api.auth.password.$post({ json: { currentPassword, newPassword } }),
    );
    if (res.ok) {
      toast(t('profile.password_changed'), { icon: 'key' });
      return reset();
    }
    setError(
      res.error.code === 'current_password_invalid' || res.status === 429
        ? 'currentPassword'
        : 'newPassword',
      { type: 'server', message: errorText(res.error) },
      { shouldFocus: true },
    );
  });

  return (
    <Box title={t('profile.password')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2.5">
        <FormGrid>
          <Field
            id="pf-p0"
            label={t('profile.current_password')}
            error={fieldError(t, errors.currentPassword)}
          >
            {(control) => (
              <input
                {...control}
                {...currentField}
                type="password"
                className={inputClass()}
                autoComplete="current-password"
              />
            )}
          </Field>
          <div />
          <NewPasswordFields
            idPrefix="pf"
            fields={passwordFields}
            errors={errors}
            repeatLabel={t('profile.repeat')}
          />
        </FormGrid>
        <div className="flex">
          <button type="submit" className={buttonClass('default', 'sm')} disabled={isSubmitting}>
            {t('auth.change')}
          </button>
        </div>
      </form>
    </Box>
  );
}
