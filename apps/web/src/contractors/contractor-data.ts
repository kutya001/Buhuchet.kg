'use client';

import {
  AssignmentList,
  Contractor,
  ContractorFormOptions,
  ContractorGkedNotes,
  ContractorHistory,
  ContractorList,
  ContractorSocfundCheck,
  ContractorSummary,
  ContractorTabCounts,
  GkedSearchResult,
  ListValues,
  type ContractorGkedCheckRequest,
  type ContractorSocfundCheckRequest,
} from '@buhuchet/shared';
import type { ShellCount } from '@buhuchet/ui';
import { keepPreviousData, queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';

/*
 * Данные модуля «Контрагенты» через TanStack Query: форма (задача 2.09) — значения полей, поиск по
 * ГКЭД, сверка набранного с ГКЭД и тариф Соцфонда по набранным признакам; список (2.10) — плашки и
 * счётчики вкладок; карточка (2.11) — сам контрагент, назначения и история. После сохранения —
 * `useContractorsRefresh`.
 */

/** Сотрудники для «Ответственный бухгалтер», ответственный по умолчанию и видна ли плата. */
export const formOptionsQuery = queryOptions({
  queryKey: ['contractors', 'form-options'],
  queryFn: async () => {
    const res = await api.api.contractors['form-options'].$get();
    if (!res.ok) throw await apiFailure(res);
    return ContractorFormOptions.parse(await res.json());
  },
});

/** Окно выбора ГКЭД: справочник платформы меняется редко — ответ на строку поиска не перечитывается. */
export const gkedSearchQuery = (q: string) =>
  queryOptions({
    queryKey: ['contractors', 'gked-search', q],
    queryFn: async () => {
      const res = await api.api.contractors['gked-search'].$get({ query: { q } });
      if (!res.ok) throw await apiFailure(res);
      return GkedSearchResult.parse(await res.json());
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

/** Предупреждения ГКЭД под полями формы; пока перечитывается, видны прежние. */
export const gkedCheckQuery = (req: ContractorGkedCheckRequest) =>
  queryOptions({
    queryKey: ['contractors', 'gked-check', req],
    queryFn: async () => {
      const res = await api.api.contractors['gked-check'].$post({ json: req });
      if (!res.ok) throw await apiFailure(res);
      return ContractorGkedNotes.parse(await res.json());
    },
    placeholderData: keepPreviousData,
  });

/** Тариф Соцфонда по набранным значениям (блок «Тариф Соцфонда» формы). */
export const socfundCheckQuery = (req: ContractorSocfundCheckRequest) =>
  queryOptions({
    queryKey: ['contractors', 'socfund-check', req],
    queryFn: async () => {
      const res = await api.api.contractors['socfund-check'].$post({ json: req });
      if (!res.ok) throw await apiFailure(res);
      return ContractorSocfundCheck.parse(await res.json());
    },
    placeholderData: keepPreviousData,
  });

/** Контрагент для «Изменить» и карточки. */
export const contractorQuery = (id: string) =>
  queryOptions({
    queryKey: ['contractors', 'card', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return Contractor.parse(await res.json());
    },
  });

/** Итоги плашек списка в области сотрудника. */
export const contractorSummaryQuery = queryOptions({
  queryKey: ['contractors', 'summary'],
  queryFn: async () => {
    const res = await api.api.contractors.summary.$get();
    if (!res.ok) throw await apiFailure(res);
    return ContractorSummary.parse(await res.json());
  },
});

/**
 * Числа у вкладок «Все», «Мои контрагенты» и «Должники» (прототип cpsTabs, у «Должников» — красное):
 * без архива; «Должники» — только тому, кто видит плату за обслуживание.
 */
export const contractorTabCountsQuery = queryOptions({
  queryKey: ['contractors', 'tab-counts'],
  queryFn: async (): Promise<Partial<Record<string, ShellCount>>> => {
    const res = await api.api.contractors['tab-counts'].$get();
    if (!res.ok) throw await apiFailure(res);
    const counts = ContractorTabCounts.parse(await res.json());
    return {
      all: { value: counts.all },
      mine: { value: counts.mine },
      ...(counts.debtors !== null ? { debtors: { value: counts.debtors, tone: 'red' } } : {}),
    };
  },
});

/**
 * Сколько контрагентов (без архива) закреплено за каждым сотрудником — для «Передать контрагентов» в
 * списке сотрудников; `complete` — сервер отдал всех ответственных (иначе отсутствующий — не ноль).
 */
export const responsibleCountsQuery = queryOptions({
  queryKey: ['contractors', 'responsible-counts'],
  queryFn: async () => {
    const res = await api.api.contractors.values.$get({
      query: { col: 'responsible', tab: 'all' },
    });
    if (!res.ok) throw await apiFailure(res);
    const values = ListValues.parse(await res.json());
    return {
      counts: new Map(values.items.map((v) => [v.value, v.count])),
      complete: !values.more,
    };
  },
});

/** Закреплённые за сотрудником контрагенты (вкладка «Контрагенты» карточки сотрудника). */
export const employeeContractorsQuery = (employeeId: string) =>
  queryOptions({
    queryKey: ['contractors', 'of-employee', employeeId],
    queryFn: async () => {
      const res = await api.api.contractors.$get({
        query: {
          tab: 'all',
          size: 'all',
          sort: 'name.asc',
          filters: JSON.stringify({ responsible: { type: 'enum', vals: [employeeId] } }),
        },
      });
      if (!res.ok) throw await apiFailure(res);
      return ContractorList.parse(await res.json());
    },
  });

/** Вкладка «История» карточки. */
export const contractorHistoryQuery = (id: string) =>
  queryOptions({
    queryKey: ['contractors', 'history', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id'].history.$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return ContractorHistory.parse(await res.json());
    },
  });

/** Блок «Сдаёт отчёты» карточки: назначения контрагента. */
export const assignmentsQuery = (id: string) =>
  queryOptions({
    queryKey: ['contractors', 'assignments', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id'].assignments.$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return AssignmentList.parse(await res.json()).items;
    },
  });

/** После сохранения контрагента — перечитать всё о контрагентах: список, карточку, подбор, отчёты. */
export function useContractorsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['contractors'] });
    void client.invalidateQueries({ queryKey: ['list'] });
    void client.invalidateQueries({ queryKey: ['reports'] });
  }, [client]);
}
