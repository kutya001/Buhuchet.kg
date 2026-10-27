'use client';

import type { AdminValueDict } from '@buhuchet/domain';
import {
  AdminDictGroups,
  AdminDictHistory,
  AdminDictList,
  AdminDictRequestList,
  AdminDictValue,
  ListValues,
  PdictsTabCounts,
  type AdminDictRequest,
} from '@buhuchet/shared';
import type { ShellCount } from '@buhuchet/ui';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/**
 * Данные Админки → «Справочники платформы» через TanStack Query: шапки вкладок, числа на вкладках,
 * страницы списков, значения фильтров и «История изменений». После правки — `usePdictsRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

const pd = api.api.admin['platform-dicts'];

/** Шапки вкладок (раздел `dictGroups`): правит только наполнение — один раз за сеанс страницы. */
export const pdictsGroupsQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'groups'],
  queryFn: async () => json(await pd.groups.$get(), (v) => AdminDictGroups.parse(v).items),
  staleTime: Infinity,
});

/** Число новых запросов на вкладке «Запросы» (прототип pdTabs: `count` — новые). */
export const pdictsTabCountsQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'tab-counts'],
  queryFn: async (): Promise<Partial<Record<string, ShellCount>>> => {
    const counts = await json(await pd['tab-counts'].$get(), (v) => PdictsTabCounts.parse(v));
    return { requests: { value: counts.requests } };
  },
});

/** «История изменений» справочника: последние записи и сколько всего. */
export const pdictsHistoryQuery = (dict: AdminValueDict) =>
  queryOptions({
    queryKey: ['admin', 'pdicts', dict, 'history'],
    queryFn: async () =>
      json(await pd[':dict'].history.$get({ param: { dict } }), (v) => AdminDictHistory.parse(v)),
  });

/** Страница списка значений справочника. */
export const fetchAdminDict =
  (dict: AdminValueDict): FetchListPage<AdminDictValue> =>
  async (params) =>
    json(await pd[':dict'].$get({ param: { dict }, query: params }), (v) => AdminDictList.parse(v));

/** Значения столбца для фильтра-галочек; `q` — «Найти значение». */
export const fetchAdminDictValues = (dict: AdminValueDict) => async (col: string, q?: string) =>
  json(await pd[':dict'].values.$get({ param: { dict }, query: q ? { col, q } : { col } }), (v) =>
    ListValues.parse(v),
  );

/** Значение для окна правки — «Перечитать» после «запись изменена другим». */
export const fetchAdminDictValue = async (dict: AdminValueDict, code: string) =>
  json(await pd[':dict'][':code'].$get({ param: { dict, code } }), (v) => AdminDictValue.parse(v));

const requests = api.api.admin['dict-requests'];

export const fetchDictRequests: FetchListPage<AdminDictRequest> = async (params) =>
  json(await requests.$get({ query: params }), (v) => AdminDictRequestList.parse(v));

export const fetchDictRequestValues = async (col: string, q?: string) =>
  json(await requests.values.$get({ query: q ? { col, q } : { col } }), (v) => ListValues.parse(v));

/**
 * После правки: список и история справочника, число запросов на вкладке; справочники организаций
 * (окна «Справочников платформы» и поля форм) перечитаются при следующем открытии.
 */
export function usePdictsRefresh() {
  const client = useQueryClient();
  return useCallback(
    (dict: AdminValueDict | 'requests') => {
      void client.invalidateQueries({ queryKey: ['list', `pdicts.${dict}`] });
      void client.invalidateQueries({ queryKey: ['admin', 'pdicts'] });
    },
    [client],
  );
}
