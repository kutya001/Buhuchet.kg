'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  RESET_CODE_LENGTH,
  RESET_CODE_TTL_MINUTES,
} from '@buhuchet/domain';
import {
  ChangePasswordForm,
  LoginForm,
  MeResponse,
  PasswordResetCodeForm,
  PasswordResetLoginForm,
  PasswordResetRequestedResponse,
} from '@buhuchet/shared';
import {
  Brand,
  buttonClass,
  Field,
  Icon,
  inputClass,
  linkButtonClass,
  Note,
  ToastProvider,
  useToast,
} from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { fieldError, NewPasswordFields } from './fields';
import { TelegramLinkRow, useTelegramLink } from './telegram-link';

/** Шаг страницы входа: вход, «Забыли пароль?» (логин, затем код), смена временного пароля, Telegram. */
type Step =
  | { id: 'login'; login: string }
  | { id: 'forgot'; login: string }
  | { id: 'code'; login: string; message: string }
  | { id: 'change'; me: MeResponse; current: string | null }
  | { id: 'telegram' };

const STEP_TITLE = 'm-0 text-[20px] font-[720] tracking-[-.015em]';
const WIDE_CTA = `${buttonClass('cta')} justify-center`;
const LINK_LEFT = `${linkButtonClass()} self-start`;

/**
 * Страница входа (прототип core/login.js showLogin): логин и пароль, «Забыли пароль?» с кодом из
 * Telegram. С временным паролем вход ведёт на смену пароля, уйти с неё в программу нельзя (ТЗ:
 * «при следующем входе система требует сменить его»); после смены — предложение привязать Telegram
 * (ТЗ: «привязка предлагается при первом входе»). `me` — уже вошёл с временным паролем.
 */
export function LoginScreen({ me }: { me: MeResponse | null }) {
  const t = useT();
  const labels = useMemo(
    () => ({ close: t('toast.close'), closeTitle: t('toast.close_title') }),
    [t],
  );
  return (
    <ToastProvider labels={labels}>
      <LoginCard me={me} />
    </ToastProvider>
  );
}

function LoginCard({ me }: { me: MeResponse | null }) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>(
    me ? { id: 'change', me, current: null } : { id: 'login', login: '' },
  );
  const enter = useCallback(() => router.replace('/app'), [router]);

  let body: ReactNode;
  switch (step.id) {
    case 'login':
      body = (
        <LoginStep
          initialLogin={step.login}
          onForgot={(login) => setStep({ id: 'forgot', login })}
          onSignedIn={(signed, password) =>
            signed.user.mustChangePassword
              ? setStep({ id: 'change', me: signed, current: password })
              : enter()
          }
        />
      );
      break;
    case 'forgot':
      body = (
        <ForgotStep
          initialLogin={step.login}
          onBack={(login) => setStep({ id: 'login', login })}
          onRequested={(login, message) => setStep({ id: 'code', login, message })}
        />
      );
      break;
    case 'code':
      body = (
        <CodeStep
          login={step.login}
          message={step.message}
          onDone={() => setStep({ id: 'login', login: step.login })}
        />
      );
      break;
    case 'change':
      body = (
        <ChangeStep
          current={step.current}
          onForget={() => setStep({ ...step, current: null })}
          onChanged={() => (step.me.telegram ? enter() : setStep({ id: 'telegram' }))}
          onLeave={() => setStep({ id: 'login', login: '' })}
        />
      );
      break;
    case 'telegram':
      body = <TelegramStep onDone={enter} />;
      break;
  }

  return (
    <main className="grid min-h-dvh place-items-center overflow-auto bg-frame px-4 py-6">
      <div className="flex w-[min(400px,100%)] animate-slide-up flex-col gap-3.5 rounded-2xl border border-line bg-pane px-[26px] py-7 shadow-pop">
        <Brand mode={t('auth.brand_mode')} className="flex-wrap" />
        {body}
      </div>
    </main>
  );
}

function LoginStep({
  initialLogin,
  onForgot,
  onSignedIn,
}: {
  initialLogin: string;
  onForgot: (login: string) => void;
  onSignedIn: (me: MeResponse, password: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(LoginForm),
    defaultValues: { login: initialLogin, password: '' },
  });

  const submit = handleSubmit(async (values) => {
    const res = await callApi(() => api.api.auth.login.$post({ json: values }));
    if (res.ok) return onSignedIn(MeResponse.parse(res.data), values.password);
    // Неверный логин или пароль — одно сообщение для любого логина и предупреждение о блокировке
    // (docs/deviations.md, п. 4); о блокировке сотрудника или организации — под логином.
    const message =
      res.error.code === 'invalid_credentials'
        ? `${errorText(res.error)}. ${t('auth.lock_warning', { count: LOGIN_MAX_FAILURES, minutes: LOGIN_LOCK_MINUTES })}`
        : errorText(res.error);
    setError(
      res.status === 403 ? 'login' : 'password',
      { type: 'server', message },
      { shouldFocus: true },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <h1 className={STEP_TITLE}>{t('auth.title')}</h1>
      <Field id="lg-login" label={t('auth.login')} error={fieldError(t, errors.login)}>
        {(control) => (
          <input
            {...control}
            {...register('login')}
            className={inputClass()}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
        )}
      </Field>
      <Field id="lg-pass" label={t('auth.password')} error={fieldError(t, errors.password)}>
        {(control) => (
          <input
            {...control}
            {...register('password')}
            type="password"
            className={inputClass()}
            autoComplete="current-password"
          />
        )}
      </Field>
      <button type="submit" className={WIDE_CTA} disabled={isSubmitting}>
        {t('auth.sign_in')}
      </button>
      <button type="button" className={LINK_LEFT} onClick={() => onForgot(getValues('login'))}>
        {t('auth.forgot')}
      </button>
    </form>
  );
}

function ForgotStep({
  initialLogin,
  onBack,
  onRequested,
}: {
  initialLogin: string;
  onBack: (login: string) => void;
  onRequested: (login: string, message: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetLoginForm>({
    resolver: zodResolver(PasswordResetLoginForm),
    defaultValues: { login: initialLogin },
  });

  const submit = handleSubmit(async ({ login }) => {
    const res = await callApi(() => api.api.auth['password-reset'].$post({ json: { login } }));
    if (res.ok) return onRequested(login, PasswordResetRequestedResponse.parse(res.data).message);
    setError('login', { type: 'server', message: errorText(res.error) }, { shouldFocus: true });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <h1 className={STEP_TITLE}>{t('auth.reset_title')}</h1>
      <p className="m-0 text-muted">{t('auth.reset_text', { minutes: RESET_CODE_TTL_MINUTES })}</p>
      <Field id="fg-login" label={t('auth.login')} error={fieldError(t, errors.login)}>
        {(control) => (
          <input
            {...control}
            {...register('login')}
            className={inputClass()}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
        )}
      </Field>
      <button type="submit" className={WIDE_CTA} disabled={isSubmitting}>
        <Icon name="tg" />
        {t('auth.get_code')}
      </button>
      <button type="button" className={LINK_LEFT} onClick={() => onBack(getValues('login'))}>
        {t('auth.back')}
      </button>
    </form>
  );
}

function CodeStep({
  login,
  message,
  onDone,
}: {
  login: string;
  message: string;
  onDone: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetCodeForm>({
    resolver: zodResolver(PasswordResetCodeForm),
    defaultValues: { code: '', newPassword: '', repeat: '' },
  });
  // Поля регистрируются по порядку на экране: при ошибках фокус встаёт на первое неверное.
  const codeField = register('code');
  const passwordFields = { newPassword: register('newPassword'), repeat: register('repeat') };

  const submit = handleSubmit(async ({ code, newPassword }) => {
    const res = await callApi(() =>
      api.api.auth['password-reset'].confirm.$post({ json: { login, code, newPassword } }),
    );
    if (res.ok) {
      toast(t('auth.reset_done'), { icon: 'key' });
      return onDone();
    }
    setError(
      res.error.code === 'reset_code_invalid' ? 'code' : 'newPassword',
      { type: 'server', message: errorText(res.error) },
      { shouldFocus: true },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <h1 className={STEP_TITLE}>{t('auth.code_title')}</h1>
      {/* Один ответ для любого логина: пришлёт ли бот код, не сообщается (docs/deviations.md, п. 4). */}
      <Note icon="tg">{message}</Note>
      <Field id="fg-code" label={t('auth.code')} error={fieldError(t, errors.code)}>
        {(control) => (
          <input
            {...control}
            {...codeField}
            className={inputClass({ mono: true })}
            inputMode="numeric"
            maxLength={RESET_CODE_LENGTH}
            autoComplete="one-time-code"
            autoFocus
          />
        )}
      </Field>
      <NewPasswordFields
        idPrefix="fg"
        fields={passwordFields}
        errors={errors}
        repeatLabel={t('auth.repeat_password')}
      />
      <button type="submit" className={WIDE_CTA} disabled={isSubmitting}>
        {t('auth.change')}
      </button>
      <div className="text-[11.5px] leading-[1.4] text-faint">{t('auth.reset_note')}</div>
    </form>
  );
}

function ChangeStep({
  current,
  onForget,
  onChanged,
  onLeave,
}: {
  /** Временный пароль, которым только что вошли; null — спросить (страницу открыли заново). */
  current: string | null;
  onForget: () => void;
  onChanged: () => void;
  onLeave: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordForm>({
    resolver: zodResolver(ChangePasswordForm),
    defaultValues: { currentPassword: current ?? '', newPassword: '', repeat: '' },
  });
  const currentField = register('currentPassword');
  const passwordFields = { newPassword: register('newPassword'), repeat: register('repeat') };
  const [leaving, setLeaving] = useState(false);

  const submit = handleSubmit(async ({ currentPassword, newPassword }) => {
    const res = await callApi(() =>
      api.api.auth.password.$post({ json: { currentPassword, newPassword } }),
    );
    if (res.ok) return onChanged();
    if (res.status === 401) return onLeave();
    // Пароль от входа не подошёл (его сменили в другом окне) — спросить временный пароль.
    if (res.error.code === 'current_password_invalid' && current !== null) {
      setValue('currentPassword', '');
      onForget();
    }
    setError(
      res.error.code === 'current_password_invalid' || res.status === 429
        ? 'currentPassword'
        : 'newPassword',
      { type: 'server', message: errorText(res.error) },
      { shouldFocus: true },
    );
  });

  const leave = async () => {
    setLeaving(true);
    await callApi(() => api.api.auth.logout.$post());
    onLeave();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <h1 className={STEP_TITLE}>{t('auth.temp_title')}</h1>
      <p className="m-0 text-muted">{t('auth.temp_text')}</p>
      {current === null ? (
        <Field
          id="ch-p0"
          label={t('auth.temp_password')}
          error={fieldError(t, errors.currentPassword)}
        >
          {(control) => (
            <input
              {...control}
              {...currentField}
              type="password"
              className={inputClass()}
              autoComplete="current-password"
              autoFocus
            />
          )}
        </Field>
      ) : null}
      <NewPasswordFields
        idPrefix="ch"
        fields={passwordFields}
        errors={errors}
        repeatLabel={t('auth.repeat_password')}
      />
      <button type="submit" className={WIDE_CTA} disabled={isSubmitting}>
        {t('auth.change')}
      </button>
      <div className="text-[11.5px] leading-[1.4] text-faint">{t('auth.reset_note')}</div>
      <button type="button" className={LINK_LEFT} onClick={leave} disabled={leaving}>
        {t('shell.logout')}
      </button>
    </form>
  );
}

function TelegramStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const link = useTelegramLink();
  const failed = link.status === 'failed';
  // Бот не подключён к платформе — предлагать нечего, сразу в программу.
  useEffect(() => {
    if (failed) onDone();
  }, [failed, onDone]);

  return (
    <div className="flex flex-col gap-3.5">
      <h1 className={STEP_TITLE}>{t('auth.tg_title')}</h1>
      <p className="m-0 text-muted">{t('auth.tg_text')}</p>
      {link.status === 'ready' ? <TelegramLinkRow url={link.url} /> : null}
      {link.status === 'linked' ? (
        <Note tone="ok" alert>
          {t('profile.tg_done')}
        </Note>
      ) : null}
      {link.status === 'linked' ? (
        <button type="button" className={WIDE_CTA} onClick={onDone}>
          {t('auth.continue')}
        </button>
      ) : (
        <button type="button" className={`${buttonClass('ghost')} justify-center`} onClick={onDone}>
          {t('auth.later')}
        </button>
      )}
    </div>
  );
}
