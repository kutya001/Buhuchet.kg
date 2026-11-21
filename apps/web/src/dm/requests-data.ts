import { DmRequestList, DmRequestSummary, ListValues, type DmRequestRow } from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/**
 * Админка → «Витрина данных» → «Журнал запросов» (поток Т, этап 2, П11): список запросов внешних
 * программ по токенам, значения столбца, «В Excel» и плашки. Только чтение.
 */
export const DM_REQUEST_GRID = 'dm.log';

const client = () => api.api.admin.dm.requests;

export const fetchRequests: FetchListPage<DmRequestRow> = async (params) => {
  const res = await client().$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return DmRequestList.parse(await res.json());
};

export const fetchRequestValues = async (col: string, q?: string) => {
  const res = await client().values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export const exportRequests = (query: Record<string, string> & { cols: string }) =>
  client().export.$get({ query });

/** «Запросов сегодня», «Ошибок сегодня», «Действующих токенов» (прототип `renderDmLog`). */
export const requestSummaryQuery = queryOptions({
  queryKey: ['dm', 'admin', 'requests-summary'],
  queryFn: async () => {
    const res = await client().summary.$get();
    if (!res.ok) throw await apiFailure(res);
    return DmRequestSummary.parse(await res.json());
  },
});
