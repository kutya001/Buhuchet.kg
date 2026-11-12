'use client';

import type { ActivityPeriod } from '@buhuchet/domain';
import { ActivityEmployee, ActivityOverview, HomeSummary, RevenueOverview } from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, apiFailure, SAVED_EVENT } from '../api-client';

/*
 * Данные «Главной» (задача 2.34; прототип modules/home.js, modules/analytics.js): «Сводка», итоги
 * «Аналитики» и «Активность» (прототип v84, modules/activity.js). Числа «Главной» собраны из других модулей, поэтому при каждом заходе на вкладку —
 * свежие (`staleTime: 0`) и перечитываются после любой записи, сделанной с экрана (окна карточек).
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/** «Сводка»: плашки и блоки. */
export const homeSummaryQuery = queryOptions({
  queryKey: ['home', 'summary'],
  queryFn: async () => json(await api.api.home.summary.$get(), (v) => HomeSummary.parse(v)),
  staleTime: 0,
});

/** «Аналитика» за год: плашки, график, «Топ-10», «Концентрация». */
export const revenueOverviewQuery = (year: number) =>
  queryOptions({
    queryKey: ['home', 'analytics', year],
    queryFn: async () =>
      json(await api.api.home.analytics.summary.$get({ query: { year: String(year) } }), (v) =>
        RevenueOverview.parse(v),
      ),
    staleTime: 0,
  });

const periodQuery = (p: ActivityPeriod) => ({ k: p.k, off: String(p.off) });

/** «Активность» за период: плашки и действия по дням. */
export const activityOverviewQuery = (p: ActivityPeriod) =>
  queryOptions({
    queryKey: ['home', 'activity', p.k, p.off],
    queryFn: async () =>
      json(await api.api.home.activity.summary.$get({ query: periodQuery(p) }), (v) =>
        ActivityOverview.parse(v),
      ),
    staleTime: 0,
  });

/** Окно сотрудника «Активность по дням» за период. */
export const activityEmployeeQuery = (id: string, p: ActivityPeriod) =>
  queryOptions({
    queryKey: ['home', 'activity', 'employee', id, p.k, p.off],
    queryFn: async () =>
      json(
        await api.api.home.activity.employees[':id'].$get({
          param: { id },
          query: periodQuery(p),
        }),
        (v) => ActivityEmployee.parse(v),
      ),
    staleTime: 0,
  });

/** После записи с экрана «Главной» (отчёт сдан, задача выполнена…) — числа заново. */
export function useHomeRefreshOnSave() {
  const client = useQueryClient();
  useEffect(() => {
    const saved = () => {
      void client.invalidateQueries({ queryKey: ['home'] });
      void client.invalidateQueries({ queryKey: ['list', 'home.analytics'] });
      void client.invalidateQueries({ queryKey: ['list', 'home.act'] });
    };
    window.addEventListener(SAVED_EVENT, saved);
    return () => window.removeEventListener(SAVED_EVENT, saved);
  }, [client]);
}
