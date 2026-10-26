'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Данные экранов за входом — через TanStack Query: один кеш на вкладку браузера, поэтому соседняя
 * вкладка, которая въезжает при свайпе, и сам экран не запрашивают одно и то же дважды. Ошибка
 * запроса повторяется один раз, затем экран показывает «Повторить».
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
