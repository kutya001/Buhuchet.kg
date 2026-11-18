import {
  AdminJobList,
  AdminJobSummary,
  AdminRunCard,
  AdminRunList,
  ListValues,
  type AdminJobRow,
  type AdminRunRow,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/** Админка → «Запуски»: запросы задач, журнала запусков и окна «Запуск». Только чтение. */

export const fetchJobs: FetchListPage<AdminJobRow> = async (params) => {
  const res = await api.api.admin.runs.jobs.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return AdminJobList.parse(await res.json());
};

export const fetchJobValues = async (col: string, q?: string) => {
  const res = await api.api.admin.runs.jobs.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export const jobSummaryQuery = queryOptions({
  queryKey: ['admin', 'runs-summary'],
  queryFn: async () => {
    const res = await api.api.admin.runs.jobs.summary.$get();
    if (!res.ok) throw await apiFailure(res);
    return AdminJobSummary.parse(await res.json());
  },
});

export const fetchRuns: FetchListPage<AdminRunRow> = async (params) => {
  const res = await api.api.admin.runs.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return AdminRunList.parse(await res.json());
};

export const fetchRunValues = async (
  extra: Readonly<Record<string, string>>,
  col: string,
  q?: string,
) => {
  const res = await api.api.admin.runs.values.$get({
    query: q ? { col, q, ...extra } : { col, ...extra },
  });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export const runCardQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'run-card', id],
    queryFn: async () => {
      const res = await api.api.admin.runs.card.$get({ query: { id } });
      if (!res.ok) throw await apiFailure(res);
      return AdminRunCard.parse(await res.json());
    },
  });
