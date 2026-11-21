import {
  DmTokenCard,
  DmTokenForm,
  DmTokenIssued,
  DmTokenList,
  ListValues,
  type DmTokenCreate,
  type DmTokenRow,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure, callApi } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/**
 * «Витрина данных» → «API Токены»: запросы списка, окна «Новый API-токен», окна токена и действий.
 * У организации — `/api/dm/tokens`, в Админке — `/api/admin/dm/tokens`: ответы одинаковые, сторона
 * выбирает только путь (поток Т, этап 1, П14; вкладку организации подключает этап 2).
 */
export type DmSide = 'org' | 'admin';

/** Ключ списка (`GRID_KEYS`): у Админки — со столбцом «Организация». */
export const DM_TOKEN_GRID = { org: 'dm.tok', admin: 'dm.tok.adm' } as const;

const client = (side: DmSide) => (side === 'admin' ? api.api.admin.dm.tokens : api.api.dm.tokens);

export const fetchTokens =
  (side: DmSide): FetchListPage<DmTokenRow> =>
  async (params) => {
    const res = await client(side).$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return DmTokenList.parse(await res.json());
  };

export const fetchTokenValues = (side: DmSide) => async (col: string, q?: string) => {
  const res = await client(side).values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export const exportTokens = (side: DmSide, query: Record<string, string> & { cols: string }) =>
  client(side).export.$get({ query });

/** Что мешает выпуску, шаблоны и сроки: и для строки над списком, и для окна «Новый API-токен». */
export const tokenFormQuery = (side: DmSide) =>
  queryOptions({
    queryKey: ['dm', side, 'token-form'],
    queryFn: async () => {
      const res = await client(side).form.$get();
      if (!res.ok) throw await apiFailure(res);
      return DmTokenForm.parse(await res.json());
    },
  });

export const tokenCardQuery = (side: DmSide, id: string) =>
  queryOptions({
    queryKey: ['dm', side, 'token-card', id],
    queryFn: async () => {
      const res = await client(side)[':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return DmTokenCard.parse(await res.json());
    },
  });

export const issueToken = (side: DmSide, body: DmTokenCreate) =>
  callApi(() => client(side).$post({ json: body }));

export const revokeToken = (side: DmSide, id: string) =>
  callApi(() => client(side)[':id'].revoke.$post({ param: { id } }));

export const reissueToken = (side: DmSide, id: string) =>
  callApi(() => client(side)[':id'].reissue.$post({ param: { id } }));

/** Ответ выпуска и перевыпуска: токен целиком — один раз. */
export const issuedOf = (data: unknown) => DmTokenIssued.safeParse(data);
