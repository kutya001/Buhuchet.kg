'use client';

import { TELEGRAM_LINK_TTL_MINUTES } from '@buhuchet/domain';
import { MeResponse, TelegramLinkResponse } from '@buhuchet/shared';
import { buttonClass, Icon, MONO_CLASS, useToast } from '@buhuchet/ui';
import { useEffect, useState } from 'react';
import { api, callApi } from '../api-client';
import { useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';

/** Как часто проверять, привязал ли пользователь Telegram по ссылке, мс. */
const POLL_MS = 3000;

/**
 * Запросы ссылок идут по одному: каждая новая ссылка отменяет прежние (одна действующая на
 * пользователя), и показанной должна быть выданная последней. Иначе два запроса подряд (окно
 * открыли снова, двойной запуск эффекта в разработке) могли бы выполниться на сервере в обратном
 * порядке, и на экране осталась бы уже отменённая ссылка.
 */
let linkQueue: Promise<unknown> = Promise.resolve();
function requestLink() {
  const next = linkQueue.then(() => callApi(() => api.api.telegram.link.$post()));
  linkQueue = next.catch(() => undefined);
  return next;
}

export type TelegramLinkState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'linked'; me: MeResponse }
  /** Бот не подключён к платформе (503) или ссылку получить не удалось. */
  | { status: 'failed'; error: ApiErrorLike };

/**
 * Ссылка привязки Telegram (ТЗ: «Ссылка вида t.me/бот?start=одноразовый_токен»): пока компонент на
 * экране, ссылка получается и заменяется новой, когда срок выходит (15 минут), а «кто я»
 * проверяется каждые 3 секунды — как только бот привязал чат, состояние становится `linked`.
 */
export function useTelegramLink(): TelegramLinkState {
  const [state, setState] = useState<TelegramLinkState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    let renew: ReturnType<typeof setTimeout> | undefined;
    const fetchLink = async () => {
      const res = await requestLink();
      if (!alive) return;
      if (!res.ok) {
        setState({ status: 'failed', error: res.error });
        return;
      }
      const link = TelegramLinkResponse.parse(res.data);
      setState((prev) => (prev.status === 'linked' ? prev : { status: 'ready', url: link.url }));
      // Ссылка одноразовая и живёт 15 минут: чуть раньше срока — новая.
      const left = new Date(link.expiresAt).getTime() - Date.now() - 5000;
      renew = setTimeout(() => void fetchLink(), Math.max(left, 10_000));
    };
    void fetchLink();
    const poll = setInterval(async () => {
      const res = await callApi(() => api.api.auth.me.$get());
      if (!alive || !res.ok) return;
      const me = MeResponse.parse(res.data);
      if (me.telegram) {
        clearInterval(poll);
        clearTimeout(renew);
        setState({ status: 'linked', me });
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
      clearTimeout(renew);
    };
  }, []);

  return state;
}

/**
 * Ссылка привязки, «Скопировать ссылку» и пояснение (прототип modules/profile.js): ссылку можно и
 * открыть — на телефоне она сразу ведёт в приложение Telegram.
 */
export function TelegramLinkRow({ url }: { url: string }) {
  const t = useT();
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('profile.tg_copied'), { icon: 'copy' });
    } catch {
      // Буфер обмена недоступен (нет разрешения): ссылку видно, её можно открыть или выделить.
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`min-w-0 text-link [overflow-wrap:anywhere] ${MONO_CLASS}`}
        >
          {url.replace(/^https:\/\//, '')}
        </a>
        <button type="button" className={buttonClass('default', 'sm')} onClick={copy}>
          <Icon name="copy" size="sm" />
          {t('profile.tg_copy')}
        </button>
      </div>
      <div className="text-[11.5px] leading-[1.4] text-faint">
        {t('profile.tg_hint', { minutes: TELEGRAM_LINK_TTL_MINUTES })}
      </div>
    </>
  );
}
