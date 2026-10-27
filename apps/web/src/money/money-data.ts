'use client';

import { Banks, OrgAccounts, Wallets } from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';

/**
 * Данные реквизитов для переводов (задача 2.18) через TanStack Query: «Банковские провайдеры», счета
 * организации, свои реквизиты и реквизиты сотрудника в его карточке. Правка отвечает всем списком —
 * его кладут в кэш (`setQueryData`): «Основной» меняется и у соседних реквизитов.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/** Банки и кошельки по порядку справочника, с отключёнными (их название нужно старым реквизитам). */
export const banksQuery = queryOptions({
  queryKey: ['money', 'banks'],
  queryFn: async () => json(await api.api.banks.$get(), (v) => Banks.parse(v).items),
  staleTime: 5 * 60_000,
});

/** Счета организации для приёма денег от контрагентов. */
export const orgAccountsQuery = queryOptions({
  queryKey: ['money', 'org-accounts'],
  queryFn: async () => json(await api.api.org.accounts.$get(), (v) => OrgAccounts.parse(v).items),
});

/** «Мои реквизиты для переводов». */
export const myWalletsQuery = queryOptions({
  queryKey: ['money', 'wallets', 'me'],
  queryFn: async () => json(await api.api.profile.wallets.$get(), (v) => Wallets.parse(v).items),
});

/** Реквизиты сотрудника в его карточке. */
export const employeeWalletsQuery = (id: string) =>
  queryOptions({
    queryKey: ['money', 'wallets', id],
    queryFn: async () =>
      json(
        await api.api.staff[':id'].wallets.$get({ param: { id } }),
        (v) => Wallets.parse(v).items,
      ),
  });
