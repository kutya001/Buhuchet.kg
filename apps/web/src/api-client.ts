import type { ApiApp } from '@buhuchet/api';
import { hc } from 'hono/client';

/** Типизированный клиент API: изменение метода сразу видно здесь как ошибка типов. */
export const api = hc<ApiApp>(
  typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
);
