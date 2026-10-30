'use client';

import { ContractorService, TaxRegimes } from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';

/*
 * Данные обслуживания контрагента (задача 2.12) через TanStack Query: блок «Статус обслуживания»
 * карточки и действующие режимы для окна «Перевести в постоянное обслуживание». После действия —
 * `useServiceRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/** Обслуживание контрагента: статус, периоды, запланированное, пропущенные месяцы, история. */
export const serviceQuery = (id: string) =>
  queryOptions({
    queryKey: ['contractors', 'service', id],
    queryFn: async () =>
      json(await api.api.contractors[':id'].service.$get({ param: { id } }), (v) =>
        ContractorService.parse(v),
      ),
  });

/** Действующие режимы налогообложения — выбор в окне «Перевести в постоянное обслуживание». */
export const activeRegimesQuery = queryOptions({
  queryKey: ['contractors', 'service', 'regimes'],
  queryFn: async () =>
    json(await api.api['tax-regimes'].$get({ query: {} }), (v) =>
      TaxRegimes.parse(v).items.filter((r) => r.active),
    ),
});

/**
 * После действия с обслуживанием: перечитать всё о контрагентах (карточка, список, счётчики) и отчёты —
 * приостановка и архив меняют их статусы и «Просрочено».
 */
export function useServiceRefresh(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['contractors'] });
    void client.invalidateQueries({ queryKey: ['reports'] });
  }, [client]);
}
