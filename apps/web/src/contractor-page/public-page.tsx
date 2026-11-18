'use client';

import { bishkekTime, orgLogoLetters, PAGE_CODE_LENGTH } from '@buhuchet/domain';
import {
  PublicPageCodeInput,
  type CpCodeHelp,
  type PageGateOrg,
  type PublicPage,
} from '@buhuchet/shared';
import { buttonClass, Icon, inputClass, useMounted } from '@buhuchet/ui';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { parseMaxPrefs } from '../shell/prefs';
import { UiProviders } from '../shell/ui-providers';
import { OpenPage } from './open-page';
import { usePageForgot } from './page-forgot';

/** «после 14:35» — время по Бишкеку, как у страницы (прототип pgHm). */
const timeOf = (iso: string) => bishkekTime(new Date(iso));

const lockedUntilOf = (details: unknown): string | null => {
  const value = (details as { lockedUntil?: unknown } | null | undefined)?.lockedUntil;
  return typeof value === 'string' ? value : null;
};

/**
 * Страница контрагента по ссылке (прототип modules/cp-page.js, pubDraw): «Страница недоступна», ввод
 * кода, «Ввод кода временно закрыт», «Страница закрыта» (5 неверных кодов за сутки, до смены кода,
 * docs/deviations.md п. О-21) или открытая страница (open-page.tsx). Только для просмотра, без входа.
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
  // Страница подхвачена React — нажатия работают (метка для сквозных тестов, docs/typical-mistakes.md
  // № 41: до подхвата кнопки из HTML сервера видны, но нажатие теряется молча).
  const ready = useMounted();
  let main: ReactNode;
  switch (state.state) {
    case 'unavailable':
      main = (
        <Gate org={null} title={t('pub.unavailable.title')} text={t('pub.unavailable.text')} />
      );
      break;
    case 'locked':
      main = (
        <Gate
          org={state.org}
          title={t('pub.locked.title')}
          text={t('pub.locked.text', { time: timeOf(state.lockedUntil) })}
        >
          <ForgotCode slug={slug} inn={inn} />
        </Gate>
      );
      break;
    case 'closed':
      main = <Gate org={state.org} title={t('pub.closed.title')} text={t('pub.closed.text')} />;
      break;
    case 'code':
      main = <CodeGate slug={slug} inn={inn} org={state.org} help={state.help} />;
      break;
    case 'open':
      main = (
        <OpenPage
          page={state.page}
          address={{ slug, inn }}
          fileHref={(id) => `/${slug}/inn/${inn}/files/${encodeURIComponent(id)}`}
        />
      );
      break;
  }
  // На телефоне у открытой страницы внизу меню разделов: последний раздел не уходит под него. Сноска
  // «Обновлено …» — только у открытой страницы (её рисует `OpenPage`); на экранах кода и отказа сноски нет
  // (прототип v135 `pubDraw`).
  const navPad =
    state.state === 'open' ? 'max-md:pb-[calc(84px+env(safe-area-inset-bottom,0px))]' : '';
  return (
    // Окна (просмотр файла в «Файлах») и уведомления, как на лендинге.
    <UiProviders initialMax={parseMaxPrefs(undefined)}>
      <main
        data-pub-page=""
        data-pub-ready={ready ? '' : undefined}
        className={`flex min-h-dvh flex-col items-center gap-[18px] bg-frame px-4 pt-6 pb-8 max-md:gap-3.5 max-md:px-3 max-md:pt-3.5 ${navPad}`}
      >
        {main}
      </main>
    </UiProviders>
  );
}

const GATE =
  'mt-[8vh] flex w-[min(420px,100%)] flex-col gap-3 rounded-2xl border border-line bg-raised px-6 py-[26px] shadow-pop max-md:mt-[4vh] max-md:px-[18px] max-md:py-[22px]';

/**
 * Чья страница (прототип v135 `pubBrand`): логотип и название бухгалтерской компании — клиент видит, что
 * открыл страницу своего бухгалтера; «Buhuchet.kg» — только когда страницы по адресу нет.
 * ОТКЛОНЕНИЕ: docs/deviations.md#К-21
 */
function PageBrand({ org }: { org: PageGateOrg | null }) {
  if (!org) {
    return (
      <div className="flex items-center gap-2 text-[15px] text-accent">
        <Icon name="book" />
        <b>Buhuchet.kg</b>
      </div>
    );
  }
  return (
    <div data-pub-brand="" className="flex min-w-0 items-center gap-2.5 text-[15px] text-ink">
      {org.logo ? (
        <img
          src={org.logo.url}
          alt=""
          className="h-9 w-9 flex-none rounded-[10px] border border-line object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-accent text-[13px] font-bold text-on-accent"
        >
          {orgLogoLetters(org.name)}
        </span>
      )}
      <b className="overflow-hidden text-ellipsis whitespace-nowrap">{org.name}</b>
    </div>
  );
}

function Gate({
  org,
  title,
  text,
  children,
}: {
  org: PageGateOrg | null;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className={GATE} role="status">
      <PageBrand org={org} />
      <h1 className="m-0 text-[20px] font-[720]">{title}</h1>
      <p className="m-0 text-muted">{text}</p>
      {children}
    </div>
  );
}

/** «Забыли код? Прислать в Telegram» — на вводе кода и на обоих «Ввод кода временно закрыт». */
function ForgotCode({ slug, inn }: { slug: string; inn: string }) {
  const t = useT();
  // До подхвата страницы React нажатие потерялось бы молча (docs/typical-mistakes.md № 41).
  const ready = useMounted();
  const { ask, busy, answer } = usePageForgot(slug, inn);
  return (
    <>
      <button
        type="button"
        data-pub-forgot=""
        disabled={busy || !ready}
        onClick={() => void ask()}
        className="inline-flex cursor-pointer items-center gap-1 self-center border-0 bg-transparent p-0 font-[550] text-link disabled:cursor-default disabled:opacity-60"
      >
        <Icon name="send" size="sm" />
        {t('pub.forgot')}
      </button>
      {answer ? (
        <span
          data-pub-forgot-answer={answer.ok ? 'sent' : ''}
          role="status"
          className={`text-center text-[11.5px] leading-[1.4] ${answer.ok ? 'text-ok' : 'text-faint'}`}
        >
          {answer.text}
        </span>
      ) : null}
    </>
  );
}

/**
 * «Введите код»: 6 цифр (только цифры, не больше шести); верный код — сервер запоминает этот
 * браузер на 1 день (доработки 14.11.2026, блок 6, пункт 5), страница перечитывается; неверный — «Осталось попыток» (меньший из остатков по
 * ссылке и по адресу, docs/deviations.md п. О-1); 5 неверных подряд — перерыв на 15 минут, 3 неверных
 * за час с одного адреса — час (docs/deviations.md п. Е-2); 5 неверных за сутки — страница закрыта до
 * смены кода (п. О-21).
 */
function CodeGate({
  slug,
  inn,
  org,
  help,
}: {
  slug: string;
  inn: string;
  org: PageGateOrg | null;
  help: CpCodeHelp;
}) {
  const t = useT();
  const errorText = useErrorText();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // «Открыть» до подхвата страницы React ушло бы обычной отправкой формы (docs/typical-mistakes.md № 41).
  const ready = useMounted();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ipLockedUntil, setIpLockedUntil] = useState<string | null>(null);

  if (ipLockedUntil) {
    return (
      <Gate
        org={org}
        title={t('pub.locked.title')}
        text={t('pub.ip_locked.text', { time: timeOf(ipLockedUntil) })}
      >
        <ForgotCode slug={slug} inn={inn} />
      </Gate>
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
    if (
      res.error.code === 'page_locked' ||
      res.error.code === 'page_closed' ||
      res.error.code === 'page_unavailable'
    ) {
      return router.refresh();
    }
    setError(errorText(res.error));
    input.current?.select();
  };

  return (
    <form className={GATE} onSubmit={submit} noValidate autoComplete="off">
      <PageBrand org={org} />
      <h1 className="m-0 text-[20px] font-[720]">{t('pub.code.title')}</h1>
      <p className="m-0 text-muted">{t('pub.code.text')}</p>
      {/* Подписи над полем нет: что вводить — строкой выше; имя поля — `aria-label` (прототип v135). */}
      <div className="flex min-w-0 flex-col gap-[5px]">
        <input
          id="pub-k"
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
          aria-label={t('pub.code.label')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'pub-k-err' : undefined}
          autoFocus
        />
        {error ? (
          <div id="pub-k-err" className="flex items-start gap-[5px] text-[12px] text-danger">
            <Icon name="alert" size="sm" className="mt-px" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      <button
        type="submit"
        className={`${buttonClass('cta')} justify-center`}
        disabled={busy || !ready}
      >
        {t('pub.code.open')}
      </button>
      <ForgotCode slug={slug} inn={inn} />
      <CodeWhat help={help} />
    </form>
  );
}

/**
 * «Что это за страница?» под вводом кода (доработки 15.11.2026, пункт 5.4; прототип v120
 * `cphCodeWhat`): нажатие раскрывает объяснение под ссылкой. Тексты — из «Подсказок в окнах».
 */
function CodeWhat({ help }: { help: CpCodeHelp }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  // До подхвата страницы React нажатие потерялось бы молча (docs/typical-mistakes.md № 41).
  const ready = useMounted();
  return (
    <>
      <button
        type="button"
        data-pub-what=""
        aria-expanded={open}
        aria-controls={id}
        disabled={!ready}
        onClick={() => setOpen(!open)}
        className="inline-flex cursor-pointer items-center gap-1.5 self-center border-0 bg-transparent p-0 font-[550] text-link disabled:cursor-default disabled:opacity-60 max-md:min-h-11"
      >
        <Icon name="help" size="sm" />
        {help.what || t('cph.code.what')}
      </button>
      <p
        id={id}
        data-pub-what-text=""
        hidden={!open}
        className="m-0 text-center text-[13.5px] leading-[1.5] text-muted max-md:text-[16px]"
      >
        {help.whatX}
      </p>
    </>
  );
}
