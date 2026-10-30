'use client';

import type { AdminValueDict } from '@buhuchet/domain';
import {
  AdminDictGroups,
  Authorities,
  ReportBases,
  TaxRegimes,
  AdminDictHistory,
  AdminDictList,
  AdminDictRequestList,
  AdminDictValue,
  AdminReportTypeOptions,
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

/** Каталог видов отчётов кратко: выбор видов у основания и подписи «Виды отчётов». */
export const reportTypeOptionsQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'report-type-options'],
  queryFn: async () =>
    json(await pd['report-type-options'].$get(), (v) => AdminReportTypeOptions.parse(v).items),
});

/**
 * Органы, режимы и основания, в том числе отключённые: выбор в окне вида отчёта (отключённое, уже
 * выбранное, остаётся) и названия в «Истории изменений» видов отчётов.
 */
export const pdictsOrgansQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'all-organs'],
  queryFn: async () =>
    json(
      await api.api.authorities.$get({ query: { all: 'true' } }),
      (v) => Authorities.parse(v).items,
    ),
});
export const pdictsRegimesQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'all-regimes'],
  queryFn: async () =>
    json(
      await api.api['tax-regimes'].$get({ query: { all: 'true' } }),
      (v) => TaxRegimes.parse(v).items,
    ),
});
export const pdictsBasesQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'all-bases'],
  queryFn: async () =>
    json(
      await api.api['report-bases'].$get({ query: { all: 'true' } }),
      (v) => ReportBases.parse(v).items,
    ),
});

/** Число новых запросов на вкладке «Запросы» (прототип pdTabs: `count` — новые). */
export const pdictsTabCountsQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'tab-counts'],
  queryFn: async (): Promise<Partial<Record<string, ShellCount>>> => {
    const counts = await json(await pd['tab-counts'].$get(), (v) => PdictsTabCounts.parse(v));
    return { requests: { value: counts.requests } };
  },
});

/**
 * «История изменений» справочника или календаря (у календаря — свой адрес: ключ записи — день,
 * docs/deviations.md п. Д-6): последние записи и сколько всего.
 */
export const pdictsHistoryQuery = (dict: AdminValueDict | 'calendar') =>
  queryOptions({
    queryKey: ['admin', 'pdicts', dict, 'history'],
    queryFn: async () =>
      json(
        await (dict === 'calendar'
          ? pd.calendar.history.$get()
          : pd[':dict'].history.$get({ param: { dict } })),
        (v) => AdminDictHistory.parse(v),
      ),
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
