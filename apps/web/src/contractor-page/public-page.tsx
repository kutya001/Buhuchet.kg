'use client';

import { bishkekTime, formatMomentRu, orgLogoLetters, PAGE_CODE_LENGTH } from '@buhuchet/domain';
import { PublicPageCodeInput, type PublicPage, type PublicPageBody } from '@buhuchet/shared';
import { buttonClass, Field, Icon, inputClass } from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';

/** «после 14:35» — время по Бишкеку, как у страницы (прототип pgHm). */
const timeOf = (iso: string) => bishkekTime(new Date(iso));

const lockedUntilOf = (details: unknown): string | null => {
  const value = (details as { lockedUntil?: unknown } | null | undefined)?.lockedUntil;
  return typeof value === 'string' ? value : null;
};

/**
 * Страница контрагента по ссылке (прототип modules/cp-page.js, pubDraw): «Страница недоступна», ввод
 * кода, «Ввод кода временно закрыт» или открытая страница. Только для просмотра, без входа.
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
      main = <OpenPage page={state.page} />;
      break;
  }
  return (
    <main
      data-pub-page=""
      className="flex min-h-dvh flex-col items-center gap-[18px] bg-frame px-4 pt-6 pb-8 max-md:gap-3.5 max-md:px-3 max-md:pt-3.5"
    >
      {main}
      <footer className="text-center text-[12px] text-faint">{t('pub.foot')}</footer>
    </main>
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
 * браузер на 30 дней, страница перечитывается; неверный — «Осталось попыток»; 5 неверных подряд —
 * перерыв на 15 минут, 30 неверных за час с одного адреса — час (docs/deviations.md п. Е-2).
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

/**
 * Открытая страница: шапка — логотип и название нашей организации, «Данные на», название и ИНН
 * контрагента, режим налогообложения (прототип pubBody, `pub-h`, `pub-title`). Разделы — задача 2.43.
 */
function OpenPage({ page }: { page: PublicPageBody }) {
  const t = useT();
  const { org, contractor } = page;
  return (
    <div data-pub-body="" className="flex w-[min(1120px,100%)] flex-col gap-3.5 max-md:gap-2.5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {org.logo ? (
            <img
              src={org.logo.url}
              alt=""
              className="h-10 w-10 flex-none rounded-[10px] border border-line object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-accent font-bold text-on-accent"
            >
              {orgLogoLetters(org.name)}
            </span>
          )}
          <span className="flex flex-col">
            <b>{org.name}</b>
            <span className="text-[11.5px] text-faint">{t('pub.org_hint')}</span>
          </span>
        </div>
        <span className="text-[11.5px] text-faint">
          {t('pub.as_of', { at: formatMomentRu(new Date(page.asOf)) })}
        </span>
      </header>
      <div>
        <h1 className="m-0 mb-1 text-[24px] leading-[1.25] font-[720] max-md:text-[20px]">
          {contractor.name}
        </h1>
        <span className="text-muted">
          {t('pub.inn')} <span className="font-mono">{contractor.inn}</span>
          {' · '}
          {contractor.regime ?? t('pub.regime_none')}
        </span>
      </div>
    </div>
  );
}
