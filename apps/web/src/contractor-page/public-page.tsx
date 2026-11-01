'use client';

import { bishkekTime, PAGE_CODE_LENGTH } from '@buhuchet/domain';
import { PublicPageCodeInput, type PublicPage } from '@buhuchet/shared';
import { buttonClass, Field, Icon, inputClass, ToastProvider } from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { OpenPage } from './open-page';

/** «после 14:35» — время по Бишкеку, как у страницы (прототип pgHm). */
const timeOf = (iso: string) => bishkekTime(new Date(iso));

const lockedUntilOf = (details: unknown): string | null => {
  const value = (details as { lockedUntil?: unknown } | null | undefined)?.lockedUntil;
  return typeof value === 'string' ? value : null;
};

/**
 * Страница контрагента по ссылке (прототип modules/cp-page.js, pubDraw): «Страница недоступна», ввод
 * кода, «Ввод кода временно закрыт» или открытая страница (open-page.tsx). Только для просмотра, без
 * входа.
 */
export function PublicPageScreen({
  slug,
  inn,
  state,
}: {
  slug: string;
  inn: string;
  state: PublicPage;
}) {
  const t = useT();
  const labels = useMemo(
    () => ({ close: t('toast.close'), closeTitle: t('toast.close_title') }),
    [t],
  );
  let main: ReactNode;
  switch (state.state) {
    case 'unavailable':
      main = <Gate title={t('pub.unavailable.title')} text={t('pub.unavailable.text')} />;
      break;
    case 'locked':
      main = (
        <Gate
          title={t('pub.locked.title')}
          text={t('pub.locked.text', { time: timeOf(state.lockedUntil) })}
        />
      );
      break;
    case 'code':
      main = <CodeGate slug={slug} inn={inn} />;
      break;
    case 'open':
      main = (
        <OpenPage
          page={state.page}
          fileHref={(id) => `/${slug}/inn/${inn}/files/${encodeURIComponent(id)}`}
        />
      );
      break;
  }
  // На телефоне у открытой страницы внизу панель разделов: последний раздел не уходит под неё.
  const navPad =
    state.state === 'open' ? 'max-md:pb-[calc(84px+env(safe-area-inset-bottom,0px))]' : '';
  return (
    <ToastProvider labels={labels}>
      <main
        data-pub-page=""
        className={`flex min-h-dvh flex-col items-center gap-[18px] bg-frame px-4 pt-6 pb-8 max-md:gap-3.5 max-md:px-3 max-md:pt-3.5 ${navPad}`}
      >
        {main}
        <footer className="text-center text-[12px] text-faint">{t('pub.foot')}</footer>
      </main>
    </ToastProvider>
  );
}

const GATE =
  'mt-[8vh] flex w-[min(420px,100%)] flex-col gap-3 rounded-2xl border border-line bg-raised px-6 py-[26px] shadow-pop max-md:mt-[4vh] max-md:px-[18px] max-md:py-[22px]';

function PageBrand() {
  return (
    <div className="flex items-center gap-2 text-[15px] text-accent">
      <Icon name="book" />
      <b>Buhuchet.kg</b>
    </div>
  );
}

function Gate({ title, text }: { title: string; text: string }) {
  return (
    <div className={GATE} role="status">
      <PageBrand />
      <h1 className="m-0 text-[20px] font-[720]">{title}</h1>
      <p className="m-0 text-muted">{text}</p>
    </div>
  );
}

/**
 * «Введите код доступа»: 6 цифр (только цифры, не больше шести); верный код — сервер запоминает этот
 * браузер на 30 дней, страница перечитывается; неверный — «Осталось попыток» (меньший из остатков по
 * ссылке и по адресу, docs/deviations.md п. О-1); 5 неверных подряд — перерыв на 15 минут, 3 неверных
 * за час с одного адреса — час (docs/deviations.md п. Е-2).
 */
function CodeGate({ slug, inn }: { slug: string; inn: string }) {
  const t = useT();
  const errorText = useErrorText();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ipLockedUntil, setIpLockedUntil] = useState<string | null>(null);

  if (ipLockedUntil) {
    return (
      <Gate
        title={t('pub.locked.title')}
        text={t('pub.ip_locked.text', { time: timeOf(ipLockedUntil) })}
      />
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!PublicPageCodeInput.safeParse({ code }).success) {
      setError(t('pub.code.format'));
      input.current?.focus();
      return;
    }
    setBusy(true);
    const res = await callApi(() =>
      api.api.page[':slug'][':inn'].code.$post({ param: { slug, inn }, json: { code } }),
    );
    if (res.ok) {
      // Cookie ссылки уже у браузера: сервер покажет открытую страницу.
      router.refresh();
      return;
    }
    setBusy(false);
    const until = lockedUntilOf(res.error.details);
    if (res.error.code === 'page_ip_locked' && until) return setIpLockedUntil(until);
    if (res.error.code === 'page_locked' || res.error.code === 'page_unavailable') {
      return router.refresh();
    }
    setError(errorText(res.error));
    input.current?.select();
  };

  return (
    <form className={GATE} onSubmit={submit} noValidate autoComplete="off">
      <PageBrand />
      <h1 className="m-0 text-[20px] font-[720]">{t('pub.code.title')}</h1>
      <p className="m-0 text-muted">{t('pub.code.text')}</p>
      <Field id="pub-k" label={t('pub.code.label')} error={error || undefined} full>
        {(control) => (
          <input
            {...control}
            ref={input}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, PAGE_CODE_LENGTH));
              setError('');
            }}
            className={`${inputClass()} text-center font-mono text-[22px] tracking-[.3em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={PAGE_CODE_LENGTH}
            placeholder="••••••"
            autoFocus
          />
        )}
      </Field>
      <button type="submit" className={`${buttonClass('cta')} justify-center`} disabled={busy}>
        {t('pub.code.open')}
      </button>
      <span className="text-[11.5px] leading-[1.4] text-faint">{t('pub.code.remember')}</span>
    </form>
  );
}
