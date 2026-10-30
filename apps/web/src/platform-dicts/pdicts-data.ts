'use client';

import type { AdminSystemDict, AdminValueDict } from '@buhuchet/domain';
import {
  AdminMessageTemplates,
  AdminPermissionList,
  AdminRoleTemplates,
  AdminStatuses,
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
  type AdminPermission,
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

/** Вкладка с «Историей изменений»: справочник общего механизма, календарь или вкладка части 3. */
export type HistoryDict = AdminValueDict | AdminSystemDict | 'calendar';

/** Адрес истории вкладки, у которой он свой (календарь — ключ записи день, docs/deviations.md п. Д-6). */
function ownHistory(dict: HistoryDict) {
  switch (dict) {
    case 'calendar':
      return pd.calendar.history.$get();
    case 'statuses':
      return pd.statuses.history.$get();
    case 'perms':
      return pd.perms.history.$get();
    case 'roletpl':
      return pd.roletpl.history.$get();
    case 'templates':
      return pd.templates.history.$get();
    default:
      return pd[':dict'].history.$get({ param: { dict } });
  }
}

/** «История изменений» вкладки: последние записи и сколько всего. */
export const pdictsHistoryQuery = (dict: HistoryDict) =>
  queryOptions({
    queryKey: ['admin', 'pdicts', dict, 'history'],
    queryFn: async () => json(await ownHistory(dict), (v) => AdminDictHistory.parse(v)),
  });

/** «Статусы»: статусы всех шкал с местом, названием и цветом; периодичность отчётов. */
export const pdictsStatusesQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'statuses'],
  queryFn: async () => json(await pd.statuses.$get(), (v) => AdminStatuses.parse(v)),
});

/** «Права ролей»: страница списка и значения фильтра. */
export const fetchAdminPermissions: FetchListPage<AdminPermission> = async (params) =>
  json(await pd.perms.$get({ query: params }), (v) => AdminPermissionList.parse(v));

export const fetchAdminPermissionValues = async (col: string, q?: string) =>
  json(await pd.perms.values.$get({ query: q ? { col, q } : { col } }), (v) => ListValues.parse(v));

/** Все права с группами — галочки прав в окне шаблона роли. */
export const pdictsPermissionsQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'perms', 'all'],
  queryFn: async () =>
    json(
      await pd.perms.$get({ query: { size: 'all' } }),
      (v) => AdminPermissionList.parse(v).items,
    ),
});

/** «Шаблоны ролей». */
export const pdictsRoleTemplatesQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'roletpl'],
  queryFn: async () => json(await pd.roletpl.$get(), (v) => AdminRoleTemplates.parse(v).items),
});

/** «Шаблоны» сообщений с подстановками. */
export const pdictsTemplatesQuery = queryOptions({
  queryKey: ['admin', 'pdicts', 'templates'],
  queryFn: async () => json(await pd.templates.$get(), (v) => AdminMessageTemplates.parse(v).items),
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
    (dict: AdminValueDict | AdminSystemDict | 'requests') => {
      void client.invalidateQueries({ queryKey: ['list', `pdicts.${dict}`] });
      void client.invalidateQueries({ queryKey: ['admin', 'pdicts'] });
    },
    [client],
  );
}
