'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiFailure } from './api-client';

/**
 * Ошибка запроса повторяется один раз. Запрос дольше предела сервера (`query_timeout`) — нет: второй
 * раз он упрётся в тот же предел, а человек будет ждать вдвое дольше.
 */
export function retryOnce(failures: number, error: unknown): boolean {
  return failures < 1 && !(error instanceof ApiFailure && error.error.code === 'query_timeout');
}

/**
 * Данные экранов за входом — через TanStack Query: один кеш на вкладку браузера, поэтому соседняя
 * вкладка, которая въезжает при свайпе, и сам экран не запрашивают одно и то же дважды. Ошибка
 * запроса повторяется один раз (`retryOnce`), затем экран показывает «Повторить».
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: retryOnce, refetchOnWindowFocus: false, staleTime: 30_000 },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
