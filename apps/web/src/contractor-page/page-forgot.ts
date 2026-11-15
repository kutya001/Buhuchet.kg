'use client';

import { PageForgot } from '@buhuchet/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';

/**
 * «Прислать код в Telegram» (доработки 14.11.2026, блок 6, пункт 6; прототип v116 `pubForgot`): код
 * уходит только в Telegram, подключённый к этой странице, не больше 3 раз за сутки; ответ — строкой.
 * Cookie страницы для этого не нужен — запрос идёт прямо в API. Тем же запросом отвечает «Помощь»
 * (прототип v120, действие `code`).
 */
export function usePageForgot(slug: string, inn: string) {
  const t = useT();
  const errorText = useErrorText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; ok: boolean } | null>(null);
  const ask = async () => {
    setBusy(true);
    const res = await callApi(() =>
      api.api.page[':slug'][':inn'].forgot.$post({ param: { slug, inn } }),
    );
    setBusy(false);
    if (!res.ok) {
      if (res.error.code === 'page_unavailable') return router.refresh();
      return setAnswer({ text: errorText(res.error), ok: false });
    }
    const r = PageForgot.parse(res.data);
    setAnswer({
      text: t(`pub.forgot.${r.outcome}`, { n: r.limit }),
      ok: r.outcome === 'sent',
    });
  };
  return { ask, busy, answer };
}
