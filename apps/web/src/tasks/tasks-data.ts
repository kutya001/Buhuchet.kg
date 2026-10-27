'use client';

import { ContractorTasks, Task, TaskFormOptions, TaskSummary } from '@buhuchet/shared';
import type { ShellCount } from '@buhuchet/ui';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';

/**
 * Данные модуля «Задачи» через TanStack Query: счётчики вкладок и плашка «На подтверждении»,
 * карточка задачи, значения формы, вкладка «Задачи» карточки контрагента. После действия —
 * `useTasksRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/** Счётчики вкладок, плашка «На подтверждении», с какого месяца список. */
export const taskSummaryQuery = queryOptions({
  queryKey: ['tasks', 'summary'],
  queryFn: async () => json(await api.api.tasks.summary.$get(), (v) => TaskSummary.parse(v)),
});

/**
 * Числа у вкладок (прототип `taskTabs`): «Мои» и «Поставленные мной» — открытые задачи, «Просроченные»
 * — красным; у «Все» числа нет. Нулевой счётчик не показывается (ТЗ «нулевой счётчик не показывается»).
 */
export const taskTabCountsQuery = queryOptions({
  queryKey: ['tasks', 'summary'],
  queryFn: async () => json(await api.api.tasks.summary.$get(), (v) => TaskSummary.parse(v)),
  select: (s): Partial<Record<string, ShellCount>> => ({
    mine: s.mine ? { value: s.mine } : undefined,
    byme: s.byme ? { value: s.byme } : undefined,
    overdue: s.overdue ? { value: s.overdue, tone: 'red' } : undefined,
  }),
});

/** Карточка задачи с комментариями и историей. */
export const taskQuery = (id: string) =>
  queryOptions({
    queryKey: ['tasks', 'card', id],
    queryFn: async () =>
      json(await api.api.tasks[':id'].$get({ param: { id } }), (v) => Task.parse(v)),
  });

/** Значения формы задачи: категории, исполнители, контрагенты, подтверждение по умолчанию. */
export const taskFormOptionsQuery = queryOptions({
  queryKey: ['tasks', 'form-options'],
  queryFn: async () =>
    json(await api.api.tasks['form-options'].$get(), (v) => TaskFormOptions.parse(v)),
});

/** Вкладка «Задачи» карточки контрагента. */
export const contractorTasksQuery = (contractorId: string) =>
  queryOptions({
    queryKey: ['tasks', 'contractor', contractorId],
    queryFn: async () =>
      json(await api.api.contractors[':id'].tasks.$get({ param: { id: contractorId } }), (v) =>
        ContractorTasks.parse(v),
      ),
  });

/** После действия с задачей — перечитать всё, что её показывает: списки, счётчики, карточки. */
export function useTasksRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['tasks'] });
    for (const tab of ['mine', 'byme', 'all', 'overdue'])
      void client.invalidateQueries({ queryKey: ['list', `tasks.${tab}`] });
    void client.invalidateQueries({ queryKey: ['files', 'task'] });
  }, [client]);
}
