'use client';

import {
  IndicatorCard,
  Indicators,
  KpiCard,
  KpiEntry,
  KpiMissingSummary,
  KpiMonth,
  KpiWho,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';

/*
 * Данные модуля «Показатели контрагентов» (задача 2.27) через TanStack Query: показатели организации,
 * «Кому вести», «Ввод за месяц», окно значения, индикатор незаполненных и вкладка карточки контрагента.
 * Всё лежит под ключом `kpi`: после любой правки модуль перечитывает его целиком (`useKpiRefresh`) —
 * значение меняет и статус месяца, и счётчики, и итоги «За период».
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/** Показатели организации по порядку (с архивными) и неразовых контрагентов в области. */
export const indicatorsQuery = queryOptions({
  queryKey: ['kpi', 'indicators'],
  queryFn: async () => json(await api.api.kpi.indicators.$get(), (v) => Indicators.parse(v)),
});

/** Окно показателя: поля, у кого ведётся, история. */
export const indicatorQuery = (id: string) =>
  queryOptions({
    queryKey: ['kpi', 'indicator', id],
    queryFn: async () =>
      json(await api.api.kpi.indicators[':id'].$get({ param: { id } }), (v) =>
        IndicatorCard.parse(v),
      ),
  });

/** «Кому вести»: контрагенты × показатели (и список «Выбранным» окна показателя). */
export const whoQuery = queryOptions({
  queryKey: ['kpi', 'who'],
  queryFn: async () => json(await api.api.kpi.who.$get(), (v) => KpiWho.parse(v)),
});

/** «Ввод за месяц»; null — месяц по умолчанию (текущий месяц заполнения). */
export const monthQuery = (month: string | null) =>
  queryOptions({
    queryKey: ['kpi', 'month', month ?? ''],
    queryFn: async () =>
      json(await api.api.kpi.month.$get({ query: month ? { month } : {} }), (v) =>
        KpiMonth.parse(v),
      ),
  });

/** Окно «контрагент × месяц». */
export const entryQuery = (contractorId: string, month: string) =>
  queryOptions({
    queryKey: ['kpi', 'entry', contractorId, month],
    queryFn: async () =>
      json(await api.api.kpi.entry.$get({ query: { contractorId, month } }), (v) =>
        KpiEntry.parse(v),
      ),
  });

/** Индикатор незаполненных: счётчик модуля, вкладки «Не заполнено» и значок в списке контрагентов. */
export const missingSummaryQuery = queryOptions({
  queryKey: ['kpi', 'missing-summary'],
  queryFn: async () =>
    json(await api.api.kpi['missing-summary'].$get(), (v) => KpiMissingSummary.parse(v)),
});

/** Вкладка «Показатели» карточки контрагента за период (по умолчанию — этот год). */
export const cardQuery = (id: string, period: { from: string; to: string } | null) =>
  queryOptions({
    queryKey: ['kpi', 'card', id, period?.from ?? '', period?.to ?? ''],
    queryFn: async () =>
      json(await api.api.kpi.contractors[':id'].$get({ param: { id }, query: period ?? {} }), (v) =>
        KpiCard.parse(v),
      ),
  });

/**
 * После правки показателя, галочки «Вести» или значения — перечитать модуль: таблицы, окна, счётчики
 * и списки «За период» и «Не заполнено».
 */
export function useKpiRefresh() {
  const client = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['kpi'] }),
        client.invalidateQueries({ queryKey: ['list', 'kpi.period'] }),
        client.invalidateQueries({ queryKey: ['list', 'kpi.missing'] }),
      ]),
    [client],
  );
}
