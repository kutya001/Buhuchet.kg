'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ADMIN_CODE_TTL_MINUTES,
  RESET_CODE_LENGTH,
  RESET_CODE_TTL_MINUTES,
} from '@buhuchet/domain';
import {
  AdminCodeForm,
  AdminCodeRequiredResponse,
  ChangePasswordForm,
  LoginForm,
  MeResponse,
  PasswordResetCodeForm,
  PasswordResetLoginForm,
} from '@buhuchet/shared';
import {
  Brand,
  buttonClass,
  Field,
  Icon,
  inputClass,
  linkButtonClass,
  Note,
  PasswordInput,
  ToastProvider,
  useToast,
} from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { markSignedIn } from '../news/signed-in';
import { fieldError, NewPasswordFields, usePasswordEye } from './fields';
import { loginErrorText } from './login-errors';
import { withCardHash } from './return-to';
import { TelegramLinkRow, useTelegramLink } from './telegram-link';

/**
 * Шаг страницы входа: вход, у администратора платформы — код из Telegram или привязка Telegram,
 * «Забыли пароль?» (логин, затем код), смена временного пароля, Telegram.
 */
type Step =
  | { id: 'login'; login: string }
  | { id: 'admin-code'; login: string; challenge: string; password: string }
  | { id: 'admin-telegram'; login: string; url: string }
  | { id: 'forgot'; login: string }
  | { id: 'code'; login: string }
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
export function LoginScreen({
  me,
  returnTo = '/app',
}: {
  me: MeResponse | null;
  /** Куда после входа: /app или страница программы из ссылки (задача #165). */
  returnTo?: string;
}) {
  const t = useT();
  const labels = useMemo(
    () => ({ close: t('toast.close'), closeTitle: t('toast.close_title') }),
    [t],
  );
  return (
    <ToastProvider labels={labels}>
      <LoginCard me={me} returnTo={returnTo} />
    </ToastProvider>
  );
}

function LoginCard({ me, returnTo }: { me: MeResponse | null; returnTo: string }) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>(
    me ? { id: 'change', me, current: null } : { id: 'login', login: '' },
  );
  // После входа рабочая страница один раз покажет «Что нового» (задача 2.32).
  const enter = useCallback(() => {
    markSignedIn();
    router.replace(withCardHash(returnTo, window.location.hash));
  }, [router, returnTo]);
  // Вошёл: с временным паролем — на его смену (пароль от входа подставлен), иначе в программу.
  const signedIn = (signed: MeResponse, password: string) =>
    signed.user.mustChangePassword
      ? setStep({ id: 'change', me: signed, current: password })
      : enter();

  let body: ReactNode;
  switch (step.id) {
    case 'login':
      body = (
        <LoginStep
          initialLogin={step.login}
          onForgot={(login) => setStep({ id: 'forgot', login })}
          onSignedIn={signedIn}
          onAdminCode={(login, challenge, password) =>
            setStep({ id: 'admin-code', login, challenge, password })
          }
          onTelegramRequired={(login, url) => setStep({ id: 'admin-telegram', login, url })}
        />
      );
      break;
    case 'admin-code':
      body = (
        <AdminCodeStep
          challenge={step.challenge}
          onSignedIn={(signed) => signedIn(signed, step.password)}
          onBack={() => setStep({ id: 'login', login: step.login })}
        />
      );
      break;
    case 'admin-telegram':
      body = (
        <AdminTelegramStep
          url={step.url}
          onDone={() => setStep({ id: 'login', login: step.login })}
        />
      );
      break;
    case 'forgot':
      body = (
        <ForgotStep
          initialLogin={step.login}
          onBack={(login) => setStep({ id: 'login', login })}
          onRequested={(login) => setStep({ id: 'code', login })}
        />
      );
      break;
    case 'code':
      body = (
        <CodeStep
          login={step.login}
          onDone={() => setStep({ id: 'login', login: step.login })}
          onBack={() => setStep({ id: 'login', login: step.login })}
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
  onAdminCode,
  onTelegramRequired,
}: {
  initialLogin: string;
  onForgot: (login: string) => void;
  onSignedIn: (me: MeResponse, password: string) => void;
  /** Администратор платформы: пароль верный, бот прислал код (docs/deviations.md п. О-13). */
  onAdminCode: (login: string, challenge: string, password: string) => void;
  /** Администратор платформы без Telegram: сначала привязать его по ссылке. */
  onTelegramRequired: (login: string, url: string) => void;
}) {
  const t = useT();
  const eye = usePasswordEye();
  const errorText = useErrorText();
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(LoginForm),
    defaultValues: { login: initialLogin, password: '' },
  });
  // Ошибка входа — общей плашкой над «Войти», а не под полем (прототип core/login.js `#lg-msg`):
  // по ней не видно, логин неверный или пароль. Пустые поля — под полями.
  const [message, setMessage] = useState('');

  const send = handleSubmit(async (values) => {
    const res = await callApi(() => api.api.auth.login.$post({ json: values }));
    if (res.ok && res.status === 202) {
      const { challenge } = AdminCodeRequiredResponse.parse(res.data);
      return onAdminCode(values.login, challenge, values.password);
    }
    if (res.ok) return onSignedIn(MeResponse.parse(res.data), values.password);
    const url = (res.error.details as { url?: unknown } | undefined)?.url;
    if (res.error.code === 'telegram_required' && typeof url === 'string') {
      return onTelegramRequired(values.login, url);
    }
    setMessage(loginErrorText(t, errorText, res.error));
  });
  // Прежняя ошибка гаснет при каждом нажатии «Войти», и при пустом поле тоже (прототип `msg('')`).
  const submit = (event: FormEvent<HTMLFormElement>) => {
    setMessage('');
    return send(event);
  };

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
          <PasswordInput
            {...control}
            {...register('password')}
            labels={eye}
            autoComplete="current-password"
          />
        )}
      </Field>
      {message ? (
        <Note tone="bad" alert>
          {message}
        </Note>
      ) : null}
      <button type="submit" className={WIDE_CTA} disabled={isSubmitting}>
        {t('auth.sign_in')}
      </button>
      {/* «О платформе» — лендинг для гостей (прототип core/login.js `#lg-about`, задача #165). */}
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className={LINK_LEFT} onClick={() => onForgot(getValues('login'))}>
          {t('auth.forgot')}
        </button>
        <a href="/" className={linkButtonClass()}>
          {t('auth.about')}
        </a>
      </div>
    </form>
  );
}

/** Вход администратора платформы, шаг 2: код из Telegram (прототип v76, core/login.js `showLogin`). */
function AdminCodeStep({
  challenge,
  onSignedIn,
  onBack,
}: {
  challenge: string;
  onSignedIn: (me: MeResponse) => void;
  onBack: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AdminCodeForm>({
    resolver: zodResolver(AdminCodeForm),
    defaultValues: { code: '' },
  });

  const submit = handleSubmit(async ({ code }) => {
    const res = await callApi(() => api.api.auth.login.code.$post({ json: { challenge, code } }));
    if (res.ok) return onSignedIn(MeResponse.parse(res.data));
    setError('code', { type: 'server', message: errorText(res.error) }, { shouldFocus: true });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <h1 className={STEP_TITLE}>{t('auth.admin_code_title')}</h1>
      <Note icon="tg">{t('auth.admin_code_sent', { minutes: ADMIN_CODE_TTL_MINUTES })}</Note>
      {/* Имя поля — без слова «ad», как в прототипе v76 (`ac-code`): «ad-code» блокировщики рекламы прятали
          (общее правило EasyList `###ad-code`), и поля для кода не было видно (ad-block-names.test.ts). */}
      <Field id="ac-code" label={t('auth.code')} error={fieldError(t, errors.code)}>
        {(control) => (
          <input
            {...control}
            {...register('code')}
            className={inputClass({ mono: true })}
            inputMode="numeric"
            maxLength={RESET_CODE_LENGTH}
            autoComplete="one-time-code"
            autoFocus
          />
        )}
      </Field>
      <button type="submit" className={WIDE_CTA} disabled={isSubmitting}>
        {t('auth.sign_in')}
      </button>
      <button type="button" className={LINK_LEFT} onClick={onBack}>
        {t('auth.back')}
      </button>
    </form>
  );
}

/**
 * Администратор платформы без Telegram: войти можно только с кодом, поэтому сначала — привязка по
 * ссылке из ответа входа (её получает только тот, кто ввёл верный пароль), потом вход заново.
 */
function AdminTelegramStep({ url, onDone }: { url: string; onDone: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3.5">
      <h1 className={STEP_TITLE}>{t('auth.admin_tg_title')}</h1>
      <p className="m-0 text-muted">{t('auth.admin_tg_text')}</p>
      <TelegramLinkRow url={url} />
      <button type="button" className={WIDE_CTA} onClick={onDone}>
        {t('auth.admin_tg_done')}
      </button>
    </div>
  );
}

function ForgotStep({
  initialLogin,
  onBack,
  onRequested,
}: {
  initialLogin: string;
  onBack: (login: string) => void;
  onRequested: (login: string) => void;
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
    if (res.ok) return onRequested(login);
    setError('login', { type: 'server', message: errorText(res.error) }, { shouldFocus: true });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <h1 className={STEP_TITLE}>{t('auth.reset_title')}</h1>
      <p className="m-0 text-muted">{t('auth.reset_text')}</p>
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
  onDone,
  onBack,
}: {
  login: string;
  onDone: () => void;
  onBack: () => void;
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
      <Note icon="tg">
        {t('auth.code_sent')} {t('auth.code_ttl', { minutes: RESET_CODE_TTL_MINUTES })}
      </Note>
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
      <button type="button" className={LINK_LEFT} onClick={onBack}>
        {t('auth.back')}
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
  const eye = usePasswordEye();
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
            <PasswordInput
              {...control}
              {...currentField}
              labels={eye}
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
