import 'server-only';
import { UiDictionary } from '@buhuchet/shared';
import { cache } from 'react';
import { localApi } from '../server-api';
import { makeTranslate, type Translate } from './translate';

/**
 * Словарь для первого показа страницы — тем же методом `/api/l10n`, что и браузер, через API в том
 * же процессе; за один показ читается один раз.
 */
export const loadDictionary = cache(async (): Promise<UiDictionary> => {
  const res = await localApi.api.l10n.$get({ query: {} });
  if (res.status !== 200) throw new Error(`GET /api/l10n: ${res.status}`);
  return UiDictionary.parse(await res.json());
});

/** `t` для серверных компонентов (макет, заголовки страницы). */
export async function getT(): Promise<Translate> {
  return makeTranslate((await loadDictionary()).texts);
}
