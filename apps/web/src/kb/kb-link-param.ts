'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useRef } from 'react';
import { tabHref } from '../shell/modules';

/**
 * Ссылка на запись Базы знаний из кнопки сообщения бота (поток Т, задача Т6; прототип v103 `tgCastMsg`):
 * «Подробнее» ведёт на `/app/kb/news?news=<код>` или `/app/kb/arts?article=<код>`. Запись открывается
 * один раз на переход, когда вкладка открыта и данные пришли (`ready`), адрес — без параметра (как
 * `?video=`). Следующая ссылка, пока вкладка открыта (строка новости в колокольчике, прототип v123
 * `newsOpen`), открывает свою запись снова.
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
  const done = useRef<string | null>(null);
  const run = useEffectEvent((value: string) => open(value));
  useEffect(() => {
    if (!id) {
      // Параметр ушёл из адреса — следующая ссылка, даже на ту же запись, откроет её снова.
      done.current = null;
      return;
    }
    if (!active || !ready || done.current === id) return;
    done.current = id;
    router.replace(href, { scroll: false });
    run(id);
  }, [active, id, ready, router, href]);
}
