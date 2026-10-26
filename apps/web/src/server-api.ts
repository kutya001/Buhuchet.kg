import 'server-only';
import type { ApiApp } from '@buhuchet/api';
import { handlePageRequest } from '@buhuchet/api/web';
import { hc } from 'hono/client';

/**
 * API в том же процессе сайта: серверная часть страницы берёт данные теми же методами `/api/…`, что и
 * браузер, но без запроса по сети. К базе страница сама не обращается. Сеанс такие запросы не
 * продлевают (`handlePageRequest`).
 */
export const localApi = hc<ApiApp>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
    handlePageRequest(new Request(input, init)),
});
