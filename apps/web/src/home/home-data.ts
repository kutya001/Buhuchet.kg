'use client';

import { HomeSummary, RevenueOverview } from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, apiFailure, SAVED_EVENT } from '../api-client';

/*
 * Данные «Главной» (задача 2.34; прототип modules/home.js, modules/analytics.js): «Сводка» и итоги
 * «Аналитики». Числа «Главной» собраны из других модулей, поэтому при каждом заходе на вкладку —
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

/** После записи с экрана «Главной» (отчёт сдан, задача выполнена…) — числа заново. */
export function useHomeRefreshOnSave() {
  const client = useQueryClient();
  useEffect(() => {
    const saved = () => {
      void client.invalidateQueries({ queryKey: ['home'] });
      void client.invalidateQueries({ queryKey: ['list', 'home.analytics'] });
    };
    window.addEventListener(SAVED_EVENT, saved);
    return () => window.removeEventListener(SAVED_EVENT, saved);
  }, [client]);
}
