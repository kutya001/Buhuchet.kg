'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Ширина телефона (ТЗ: граница ПК и телефона — 768 px). */
export const PHONE_QUERY = '(max-width: 767px)';

/** Подходит ли экран под медиазапрос; на сервере и при первой отрисовке — нет. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (change: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', change);
      return () => media.removeEventListener('change', change);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const noSubscribe = () => () => {};

/** Страница уже в браузере (после первой отрисовки): окна рисуются в `document.body`. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
