'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useRef } from 'react';
import { tabHref } from '../shell/modules';

/**
 * Ссылка на запись Базы знаний из кнопки сообщения бота (поток Т, задача Т6; прототип v103 `tgCastMsg`):
 * «Подробнее» ведёт на `/app/kb/news?news=<код>` или `/app/kb/arts?article=<код>`. Запись открывается
 * один раз, когда вкладка открыта и данные пришли (`ready`), адрес — без параметра (как `?video=`).
 */
export function useKbLinkParam(
  tab: string,
  param: string,
  ready: boolean,
  open: (id: string) => void,
) {
  const router = useRouter();
  const href = tabHref('kb', tab);
  const active = usePathname() === href;
  const id = useSearchParams().get(param);
  const done = useRef(false);
  const run = useEffectEvent((value: string) => open(value));
  useEffect(() => {
    if (!active || !id || !ready || done.current) return;
    done.current = true;
    router.replace(href, { scroll: false });
    run(id);
  }, [active, id, ready, router, href]);
}
