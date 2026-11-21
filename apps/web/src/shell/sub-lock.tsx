'use client';

import { formatDateRu } from '@buhuchet/domain';
import { buttonClass, EmptyState, Icon, Modal, Note } from '@buhuchet/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MEM_FULL_EVENT } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';
import { moduleHref, subOwner, tabHref, type ShellAccess } from './modules';

/*
 * Подписка в оболочке (доработки 20.11.2026, блок 4, пункты 3–5; блок 2, пункт 5; прототип v154
 * `subBanHtml`, `SUB_CLOSED_MOD`, `subMemFullDlg`; этап 1, П7, поток И): полоса «Подписка оплачена до …»
 * владельцу, экран «Доступ закрыт» сотруднику и окно «Память организации заполнена».
 */

/** Окно оплаты на экране «Подписка»: `?pay=renew|grow|mem` (экран открывает окно и убирает метку). */
export const subPayHref = (mode: 'renew' | 'grow' | 'mem') =>
  `${tabHref('org', 'sub')}?pay=${mode}`;

/**
 * «Подписка оплачена до 30.11.2026. Продлите её, чтобы доступ не закрылся» — только владельцам, все 7
 * дней до конца срока, над экраном любого модуля (прототип `subBanHtml`).
 */
export function SubRenewBar({ access }: { access: ShellAccess }) {
  const t = useT();
  const sub = access.subscription;
  if (!subOwner(access) || !sub || sub.closed || sub.status !== 'expiring' || !sub.paidUntil) {
    return null;
  }
  return (
    <div data-sub-renew="" role="status">
      <Note tone="warn" icon="clock" center>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 grow">
            {t('sub.head.expiring', { date: formatDateRu(sub.paidUntil) })}
          </span>
          <Link href={subPayHref('renew')} className={`${buttonClass('cta', 'sm')} flex-none`}>
            <Icon name="wallet" size="sm" />
            {t('sub.btn.renew')}
          </Link>
        </div>
      </Note>
    </div>
  );
}

/** «Доступ закрыт» сотрудника, не владельца (прототип `SUB_CLOSED_MOD`). */
export function SubClosedScreen() {
  const t = useT();
  return (
    <div data-sub-closed="">
      <EmptyState icon="lock" title={t('sub.closed.title')} text={t('sub.closed.text')} />
    </div>
  );
}

/**
 * «Память организации заполнена» (прототип `subMemFullDlg`): загрузку файла сервер не принял (409
 * `mem_full`) — окно с «К файлам», владельцу — «Купить память». Ответ приходит событием `callApi`.
 */
export function MemFullHost({ access }: { access: ShellAccess }) {
  const t = useT();
  const errorText = useErrorText();
  const router = useRouter();
  const [shown, setShown] = useState<{ error: ApiErrorLike; n: number } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      const error = (e as CustomEvent<ApiErrorLike>).detail;
      setShown((s) => ({ error, n: (s?.n ?? 0) + 1 }));
      setOpen(true);
    };
    window.addEventListener(MEM_FULL_EVENT, on);
    return () => window.removeEventListener(MEM_FULL_EVENT, on);
  }, []);
  if (!shown || access.admin) return null;
  const own = subOwner(access);
  const pending = access.subscription?.status === 'pending';
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  return (
    <Modal
      key={`mem-full-${shown.n}`}
      open={open}
      onClose={() => setOpen(false)}
      title={t('sub.mem.title')}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass()} onClick={() => setOpen(false)}>
            {t('btn.close')}
          </button>
          <button
            type="button"
            data-mem-full-files=""
            className={buttonClass()}
            onClick={() => go(moduleHref('files', access))}
          >
            <Icon name="folder" size="sm" />
            {t('sub.mem.files')}
          </button>
          {own ? (
            <button
              type="button"
              data-mem-full-buy=""
              className={buttonClass('cta')}
              disabled={pending}
              title={pending ? t('sub.btn.wait') : undefined}
              onClick={() => go(subPayHref('mem'))}
            >
              <Icon name="wallet" size="sm" />
              {t('sub.btn.mem')}
            </button>
          ) : null}
        </>
      }
    >
      <div data-mem-full="" className="flex flex-col gap-2.5">
        <Note tone="bad" icon="folder">
          {errorText(shown.error)}
        </Note>
        <p className="m-0 text-muted">
          {t('sub.mem.view')}
          {own ? '' : ` ${t('sub.mem.ask')}`}
        </p>
      </div>
    </Modal>
  );
}
