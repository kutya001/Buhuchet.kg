import 'server-only';
import type { ApiApp } from '@buhuchet/api';
import { handleApiRequest } from '@buhuchet/api/web';
import { UiDictionary } from '@buhuchet/shared';
import { hc } from 'hono/client';
import { cache } from 'react';
import { makeTranslate, type Translate } from './translate';

/**
 * API в том же процессе сайта: серверная часть страницы берёт словарь тем же методом `/api/l10n`,
 * что и браузер, но без запроса по сети. К базе страница сама не обращается.
 */
const local = hc<ApiApp>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
    handleApiRequest(new Request(input, init)),
});

/** Словарь для первого показа страницы; за один показ читается один раз. */
export const loadDictionary = cache(async (): Promise<UiDictionary> => {
  const res = await local.api.l10n.$get({ query: {} });
  if (res.status !== 200) throw new Error(`GET /api/l10n: ${res.status}`);
  return UiDictionary.parse(await res.json());
});

/** `t` для серверных компонентов (макет, заголовки страницы). */
export async function getT(): Promise<Translate> {
  return makeTranslate((await loadDictionary()).texts);
}
