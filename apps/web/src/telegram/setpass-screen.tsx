'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { OWNER_SETUP_DAYS } from '@buhuchet/domain';
import { PasswordSetupDone, PasswordSetupForm, PasswordSetupInfo } from '@buhuchet/shared';
import { Brand, buttonClass, MONO_CLASS, Note } from '@buhuchet/ui';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { api, callApi } from '../api-client';
import { NewPasswordFields } from '../auth/fields';
import { LoginScreen } from '../auth/login-screen';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';

type State =
  | { id: 'loading' }
  | { id: 'invalid' }
  | { id: 'failed'; error: ApiErrorLike }
  | { id: 'form'; info: PasswordSetupInfo }
  | { id: 'done'; login: string };

const TITLE = 'm-0 text-[20px] font-[720] tracking-[-.015em]';

/**
 * Текст словаря с вставками-элементами вместо `{имя}`: подстановки идут за один проход, поэтому
 * «{login}» в названии организации не станет логином.
 */
function richText(text: string, parts: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return text
    .split(/\{(\w+)\}/)
    .map((piece, i) => (
      <Fragment key={i}>
        {i % 2 ? (Object.hasOwn(parts, piece) ? parts[piece] : `{${piece}}`) : piece}
      </Fragment>
    ));
}
const WIDE_CTA = `${buttonClass('cta')} justify-center`;

/**
 * Страница «Задать пароль» по ссылке из Telegram (доработки 14.11.2026, блок 1, пункт 3; прототип v113
 * tg-lead.js setPassPage): владелец организации, созданной по заявке, задаёт пароль сам, без входа.
 * Чья ссылка — спрашивает браузер (`GET /api/auth/setup/<ключ>`; открыть страницу ссылку не тратит);
 * неизвестная, истёкшая, использованная и заменённая — «Ссылка устарела» с «Ко входу». После пароля —
 * страница входа с подставленным логином и уведомлением, ключ уходит из адресной строки.
 */
export function SetPasswordScreen({ token }: { token: string | null }) {
  const t = useT();
  const errorText = useErrorText();
  const [state, setState] = useState<State>(token ? { id: 'loading' } : { id: 'invalid' });
  useEffect(() => {
    if (!token) return;
    let live = true;
    void callApi(() => api.api.auth.setup[':token'].$get({ param: { token } })).then((res) => {
      if (!live) return;
      if (res.ok) setState({ id: 'form', info: PasswordSetupInfo.parse(res.data) });
      else if (res.status === 404 || res.status === 400) setState({ id: 'invalid' });
      else setState({ id: 'failed', error: res.error });
    });
    return () => {
      live = false;
    };
  }, [token]);

  if (state.id === 'done') {
    return (
      <LoginScreen
        me={null}
        start={{ login: state.login, toast: t('setpass.done', { login: state.login }) }}
      />
    );
  }
  let body: ReactNode;
  switch (state.id) {
    case 'loading':
      body = <p className="m-0 text-muted">{t('setpass.loading')}</p>;
      break;
    case 'failed':
      body = (
        <>
          <Note tone="bad">{errorText(state.error)}</Note>
          <ToLogin />
        </>
      );
      break;
    case 'invalid':
      body = (
        <>
          <h1 className={TITLE}>{t('setpass.invalid.title')}</h1>
          <p className="m-0 text-muted">{t('setpass.invalid.text', { days: OWNER_SETUP_DAYS })}</p>
          <ToLogin />
        </>
      );
      break;
    case 'form':
      body = (
        <SetPasswordForm
          token={token!}
          info={state.info}
          onDone={(login) => {
            // Ключ ссылки больше не нужен в адресной строке и истории браузера.
            window.history.replaceState(null, '', '/login');
            setState({ id: 'done', login });
          }}
          onInvalid={() => setState({ id: 'invalid' })}
        />
      );
      break;
  }
  return (
    <main className="grid min-h-dvh place-items-center overflow-auto bg-frame px-4 py-6">
      <div
        data-setpass={state.id}
        className="flex w-[min(400px,100%)] animate-slide-up flex-col gap-3.5 rounded-2xl border border-line bg-pane px-[26px] py-7 shadow-pop"
      >
        <Brand mode={t('auth.brand_mode')} className="flex-wrap" />
        {body}
      </div>
    </main>
  );
}

function ToLogin() {
  const t = useT();
  return (
    <a href="/login" className={WIDE_CTA}>
      {t('setpass.to_login')}
    </a>
  );
}

function SetPasswordForm({
  token,
  info,
  onDone,
  onInvalid,
}: {
  token: string;
  info: PasswordSetupInfo;
  onDone: (login: string) => void;
  /** Ссылку заменили новой или она истекла, пока страница была открыта. */
  onInvalid: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<PasswordSetupForm>({
    resolver: zodResolver(PasswordSetupForm),
    defaultValues: { newPassword: '', repeat: '' },
  });
  const fields = { newPassword: register('newPassword'), repeat: register('repeat') };
  useEffect(() => setFocus('newPassword'), [setFocus]);

  const submit = handleSubmit(async ({ newPassword }) => {
    const res = await callApi(() =>
      api.api.auth.setup[':token'].$post({ param: { token }, json: { password: newPassword } }),
    );
    if (res.ok) return onDone(PasswordSetupDone.parse(res.data).login);
    if (res.status === 404) return onInvalid();
    setError(
      'newPassword',
      { type: 'server', message: errorText(res.error) },
      { shouldFocus: true },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <h1 className={TITLE}>{t('setpass.title')}</h1>
      <p className="m-0 text-muted">
        {richText(t(info.organization ? 'setpass.lead_org' : 'setpass.lead'), {
          org: info.organization,
          login: <b className={MONO_CLASS}>{info.login}</b>,
        })}
      </p>
      {/* Логин — для менеджера паролей: он запомнит пароль вместе с ним. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={info.login}
        readOnly
        hidden
      />
      <NewPasswordFields
        idPrefix="sp"
        fields={fields}
        errors={errors}
        repeatLabel={t('auth.repeat_password')}
      />
      <button type="submit" className={WIDE_CTA} disabled={isSubmitting}>
        {t('setpass.submit')}
      </button>
    </form>
  );
}
